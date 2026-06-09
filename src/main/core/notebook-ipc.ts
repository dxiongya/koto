/**
 * Notebook IPC — bridges renderer requests to the storage + pipeline + agent
 * modules in main process. Also forwards source-status events and chat-agent
 * events to every renderer window.
 */
import { ipcMain, BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import {
  listSessions, getSession, createSession, saveSession, deleteSession,
  registerSource, removeSource, getPassage, readSourceRaw, readChatLog,
} from './notebook-storage'
import { onSourceEvent, processSource } from './notebook-source-pipeline'
import { onAgentEvent, promptAgent, abortAgent } from './notebook-agent'
import type { Session, SourceRef } from '../../shared/notebook'

export function setupNotebookIpc(): void {
  // ── Session CRUD ────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.NOTEBOOK_LIST_SESSIONS, () => {
    try { return { ok: true, data: listSessions() } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle(IpcChannels.NOTEBOOK_GET_SESSION, (_, id: string) => {
    const s = getSession(id)
    return s ? { ok: true, data: s } : { ok: false, error: 'not found' }
  })

  ipcMain.handle(IpcChannels.NOTEBOOK_CREATE_SESSION, (_, name: string) => {
    try { return { ok: true, data: createSession(name) } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle(IpcChannels.NOTEBOOK_UPDATE_SESSION, (_, session: Session) => {
    try { return { ok: true, data: saveSession(session) } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle(IpcChannels.NOTEBOOK_DELETE_SESSION, (_, id: string) => {
    return { ok: true, data: deleteSession(id) }
  })

  // ── Source CRUD + processing ────────────────────────────────────
  ipcMain.handle(
    IpcChannels.NOTEBOOK_ADD_SOURCE,
    async (_, sessionId: string, ref: SourceRef, title: string, subtitle?: string) => {
      try {
        const meta = registerSource(sessionId, ref, title, subtitle)
        if (!meta) return { ok: false, error: 'session not found' }
        // Fire-and-forget — UI tracks progress via NOTEBOOK_EVENT stream.
        void processSource(sessionId, meta.key)
        return { ok: true, data: meta }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },
  )

  ipcMain.handle(IpcChannels.NOTEBOOK_REMOVE_SOURCE, (_, sessionId: string, sourceKey: string) => {
    return { ok: true, data: removeSource(sessionId, sourceKey) }
  })

  ipcMain.handle(
    IpcChannels.NOTEBOOK_REPROCESS_SOURCE,
    async (_, sessionId: string, sourceKey: string) => {
      try {
        void processSource(sessionId, sourceKey)
        return { ok: true, data: true }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },
  )

  // ── Read-only artifact access ───────────────────────────────────
  ipcMain.handle(
    IpcChannels.NOTEBOOK_GET_PASSAGE,
    (_, sessionId: string, sourceKey: string, passageId: string) => {
      const p = getPassage(sessionId, sourceKey, passageId)
      return p ? { ok: true, data: p } : { ok: false, error: 'passage not found' }
    },
  )

  ipcMain.handle(IpcChannels.NOTEBOOK_READ_RAW, (_, sessionId: string, sourceKey: string) => {
    const raw = readSourceRaw(sessionId, sourceKey)
    return raw != null ? { ok: true, data: raw } : { ok: false, error: 'raw not found' }
  })

  ipcMain.handle(IpcChannels.NOTEBOOK_CHAT_HISTORY, (_, sessionId: string) => {
    return { ok: true, data: readChatLog(sessionId) }
  })

  // ── Agent prompt / abort ─────────────────────────────────────────
  ipcMain.handle(IpcChannels.NOTEBOOK_PROMPT, async (_, sessionId: string, text: string) => {
    return promptAgent(sessionId, text)
  })
  ipcMain.handle(IpcChannels.NOTEBOOK_ABORT, (_, sessionId: string) => {
    return { ok: true, data: abortAgent(sessionId) }
  })

  // ── Forward source + agent events to all renderer windows ────────
  const broadcast = (event: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.NOTEBOOK_EVENT, event)
      }
    }
  }
  onSourceEvent(broadcast)
  onAgentEvent(broadcast)
}
