import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupIpcHandlers } from './core/ipc'
import { initLiteHome, loadConfig, saveConfig } from './core/lite-home'
import { setProjectPath } from './core/fs'
import { fileWatcher } from './core/watcher'
import { ptyManager } from './core/pty-manager'
import { registerAssetProtocol } from './core/asset-protocol'

function createWindow(): void {
  const liteHome = initLiteHome()
  const config = loadConfig()

  // Restore saved window bounds or use defaults
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register custom protocol scheme before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'lite-asset', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  // Register custom asset protocol for serving images from liteHome/images/
  registerAssetProtocol()

  // Setup IPC Handlers
  setupIpcHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  fileWatcher.stopAll()
  ptyManager.closeAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
