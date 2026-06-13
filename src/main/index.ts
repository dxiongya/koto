import { app, shell, BrowserWindow, ipcMain, protocol, Menu, session } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpcHandlers } from './core/ipc'
import { setupNotebookIpc } from './core/notebook-ipc'
import { initLiteHome, loadConfig, saveConfig } from './core/lite-home'
import { setProjectPath } from './core/fs'
import { fileWatcher } from './core/watcher'
import { ptyManager } from './core/pty-manager'
import { registerAssetProtocol } from './core/asset-protocol'
import { registerAppProtocol } from './core/app-loader'
import { mcpManager } from './core/mcp-manager'
import { automationScheduler } from './core/automation-scheduler'
import { collectorSyncScheduler } from './core/collector-sync-scheduler'
import { taskScheduler } from './core/task-scheduler'
import { registerBuiltinExecutors } from './core/task-executors'
import { refreshBusTools } from './core/ai-tools'

function sendToRenderer(win: BrowserWindow, shortcut: string): void {
  win.webContents.send('shortcut', shortcut)
}

function createWindow(): void {
  const liteHome = initLiteHome()
  const config = loadConfig()

  const bounds = config.windowBounds ?? { width: 1200, height: 800 }

  const mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  // Always watch notes directory
  fileWatcher.watchNotes(join(liteHome, 'notes'))

  // Restore last project path for code.app
  if (config.codeProjectPath) {
    setProjectPath(config.codeProjectPath)
    fileWatcher.watchProject(config.codeProjectPath)
  }

  // Save window bounds on resize/move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      const b = mainWindow.getBounds()
      saveConfig({ windowBounds: b })
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // Intercept keyboard shortcuts that Chromium eats
  let fileSwitcherOpen = false

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Detect Ctrl release when file switcher is open
    if (fileSwitcherOpen && input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      fileSwitcherOpen = false
      sendToRenderer(mainWindow, 'ctrl-release')
      return
    }

    if (input.type !== 'keyDown') return

    // Ctrl+Tab / Ctrl+Shift+Tab — file switcher
    // Do NOT preventDefault so that Ctrl keyUp can still reach the renderer
    if (input.control && !input.meta && !input.alt && (input.key === 'Tab' || input.code === 'Tab')) {
      fileSwitcherOpen = true
      sendToRenderer(mainWindow, input.shift ? 'ctrl+shift+tab' : 'ctrl+tab')
      return
    }

    // Ctrl+- (Go Back) / Ctrl+Shift+- (Go Forward)
    if (input.control && !input.meta && !input.alt && (input.key === '-' || input.code === 'Minus')) {
      event.preventDefault()
      sendToRenderer(mainWindow, input.shift ? 'ctrl+shift+-' : 'ctrl+-')
      return
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Block any attempt to navigate the renderer to a `file://` URL — which
  // is what Electron does by default when an external file is dropped onto
  // the window. The renderer's window-level dragover/drop handler intercepts
  // most cases, but some Electron releases still try to navigate before JS
  // sees the event. This guard is the catch-all.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) e.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'lite-asset', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'lite-app', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
])

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.koto.desktop')

  // NOTE: removed optimizer.watchWindowShortcuts — it can intercept our custom shortcuts

  ipcMain.on('ping', () => console.log('pong'))

  // Set CSP for production (dev mode is relaxed for Vite HMR)
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' lite-app:; script-src 'self' lite-app:; style-src 'self' 'unsafe-inline'; img-src 'self' data: lite-asset: lite-app: https: http:; connect-src 'self' https:;"
          ],
        },
      })
    })
  }

  registerAssetProtocol()
  registerAppProtocol()
  setupIpcHandlers()
  setupNotebookIpc()
  createWindow()

  // Initialize MCP servers from config
  const mcpConfig = loadConfig()
  if (mcpConfig.mcpServers?.length) {
    mcpManager.initFromConfig(mcpConfig.mcpServers).catch((err) => {
      console.error('[MCP] Init failed:', err)
    })
  }

  // Note: BUS_TOOLS_READY handler is in setupIpcHandlers (ipc.ts)

  // Start schedulers
  automationScheduler.start()
  collectorSyncScheduler.start()

  // Unified task scheduler
  registerBuiltinExecutors()
  taskScheduler.start()

  // Background: embed any collector items missing vectors (fire-and-forget).
  // Runs after a delay so startup isn't blocked; uses its own error handling.
  setTimeout(() => {
    (async () => {
      try {
        const { loadConfig } = await import('./core/lite-home')
        if (!loadConfig().embeddingGeminiApiKey) return // no API key configured
        const { listCollectedItems, getEmbeddingStats } = await import('./core/collector-store')
        const stats = getEmbeddingStats()
        const missing = stats.total - stats.embedded
        if (missing <= 0) return
        console.log(`[Collector] Auto-embedding ${missing} items without vectors...`)
        const { embedAllPending } = await import('./core/collector-embedding')
        const items = listCollectedItems(1000, 0)
        const result = await embedAllPending(items)
        console.log(`[Collector] Auto-embed complete: +${result.embedded} embedded, ${result.failed} failed`)
      } catch (e) {
        console.warn('[Collector] Auto-embed failed:', e)
      }
    })()
  }, 5000)

  // ── Application Menu with accelerators as backup ──
  const sendShortcut = (name: string): void => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) sendToRenderer(win, name)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Koto',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Go Back', accelerator: 'Ctrl+-', click: () => sendShortcut('ctrl+-') },
        { label: 'Go Forward', accelerator: 'Ctrl+Shift+-', click: () => sendShortcut('ctrl+shift+-') },
        { type: 'separator' },
        { label: 'Switch File', accelerator: 'Ctrl+Tab', click: () => sendShortcut('ctrl+tab') },
        { label: 'Switch File (Prev)', accelerator: 'Ctrl+Shift+Tab', click: () => sendShortcut('ctrl+shift+tab') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  fileWatcher.stopAll()
  ptyManager.closeAll()
  mcpManager.shutdown().catch(() => {})
  automationScheduler.stop()
  collectorSyncScheduler.stop()
  taskScheduler.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
