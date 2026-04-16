/**
 * Collector Sync Runner — Executes sync scripts in a sandboxed vm.
 *
 * Built-in adapters run with full Node access.
 * Custom scripts run in vm sandbox with only SyncContext API.
 */
import vm from 'node:vm'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types'
import { getLiteHome } from './lite-home'
import { addCollectedItem, findDuplicateByUrl, fetchAndSaveMarkdown, getItemsByIds } from './collector-store'
import { getSyncConfig, getScriptSource, updateSyncResult } from './collector-sync-store'
import { emitAppEvent, emitItemReadyIfReady } from './event-bus'
import type { CollectorAddInput, CollectedItem } from '../../shared/types'

export interface SyncRunEvent {
  groupName: string
  status: 'started' | 'progress' | 'completed' | 'error' | 'cancelled'
  timestamp: number
  message?: string
  current?: number
  total?: number
  itemsAdded?: number
}

// Active sync abort controllers
const activeAborts = new Map<string, AbortController>()

function emitEvent(event: SyncRunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.COLLECTOR_SYNC_RUN_EVENT, event)
    }
  }
}

/** File access whitelist */
function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  const resolved = path.resolve(filePath.replace(/^~/, os.homedir()))
  const defaults = [
    path.join(os.homedir(), '.ft-bookmarks'),
    path.join(getLiteHome(), 'collected'),
  ]
  const all = [...defaults, ...allowedPaths.map(p => path.resolve(p.replace(/^~/, os.homedir())))]
  return all.some(allowed => resolved.startsWith(allowed))
}

/** Build the SyncContext API injected into scripts */
function buildSyncContext(groupName: string, adapterConfig: Record<string, unknown>): {
  ctx: Record<string, unknown>
  getStats: () => { added: number }
  getAddedItems: () => CollectedItem[]
  abort: AbortController
} {
  const abort = new AbortController()
  let itemsAdded = 0
  const addedItems: CollectedItem[] = []
  const allowedPaths = (adapterConfig.allowedPaths as string[]) || []

  const ctx = {
    groupName,
    adapterConfig,
    signal: abort.signal,

    addItem: async (input: { type: string; title: string; url?: string; note?: string; meta?: Record<string, unknown> }) => {
      if (abort.signal.aborted) throw new Error('Sync cancelled')
      try {
        const item = addCollectedItem({
          ...input,
          group: groupName,
          source: 'sync',
        } as CollectorAddInput)
        itemsAdded++
        addedItems.push(item)
        // Emit event so wiki + UI know about the new item
        emitAppEvent({
          type: 'collector:item-added',
          itemId: item.id,
          itemType: item.type,
          title: item.title,
          group: groupName,
        })
        return { id: item.id, added: true }
      } catch (e: any) {
        if (e.message?.includes('UNIQUE constraint') || e.message?.includes('duplicate')) {
          return { id: null, added: false }
        }
        throw e
      }
    },

    checkDuplicate: async (url: string) => {
      return !!findDuplicateByUrl(url)
    },

    fetch: async (url: string, opts?: { headers?: Record<string, string>; timeout?: number }) => {
      if (abort.signal.aborted) throw new Error('Sync cancelled')
      const timeout = Math.min(opts?.timeout || 15000, 60000)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const res = await globalThis.fetch(url, {
          headers: opts?.headers,
          signal: controller.signal,
        })
        return {
          ok: res.ok,
          status: res.status,
          text: () => res.text(),
          json: () => res.json(),
        }
      } finally {
        clearTimeout(timer)
      }
    },

    readFile: async (filePath: string) => {
      const resolved = path.resolve(filePath.replace(/^~/, os.homedir()))
      if (!isPathAllowed(resolved, allowedPaths)) {
        throw new Error(`Access denied: ${filePath}`)
      }
      return fs.readFileSync(resolved, 'utf-8')
    },

    readJsonLines: async (filePath: string) => {
      const resolved = path.resolve(filePath.replace(/^~/, os.homedir()))
      if (!isPathAllowed(resolved, allowedPaths)) {
        throw new Error(`Access denied: ${filePath}`)
      }
      const content = fs.readFileSync(resolved, 'utf-8')
      return content.split('\n').filter(Boolean).map(line => JSON.parse(line))
    },

    progress: (message: string, current?: number, total?: number) => {
      emitEvent({ groupName, status: 'progress', timestamp: Date.now(), message, current, total, itemsAdded })
    },

    log: (msg: string) => console.log(`[Sync:${groupName}]`, msg),
    warn: (msg: string) => console.warn(`[Sync:${groupName}]`, msg),
    error: (msg: string) => console.error(`[Sync:${groupName}]`, msg),
  }

  return { ctx, getStats: () => ({ added: itemsAdded }), getAddedItems: () => addedItems, abort }
}

/** Run a sync for a group */
export async function runSync(groupName: string): Promise<{ success: boolean; itemsAdded: number; error?: string }> {
  const config = getSyncConfig(groupName)
  if (!config) return { success: false, itemsAdded: 0, error: 'No sync config found' }

  // Prevent concurrent runs
  if (activeAborts.has(groupName)) {
    return { success: false, itemsAdded: 0, error: 'Sync already running' }
  }

  // Resolve script source:
  //   1. User-installed script file (script_path on the config row)
  //   2. Fallback: built-in adapter template (auto-heal configs created
  //      without a script, e.g. from the broken Setup Sync flow)
  let scriptSource = getScriptSource(groupName)
  if (!scriptSource && config.adapter && config.adapter !== 'custom') {
    const { getAdapterTemplate } = await import('./collector-sync-adapters')
    const template = getAdapterTemplate(config.adapter)
    if (template?.script) {
      scriptSource = template.script
      // Persist so next run uses the proper path
      const { setScriptSource } = await import('./collector-sync-store')
      try { setScriptSource(groupName, template.script) } catch { /* non-fatal */ }
    }
  }
  if (!scriptSource) {
    return {
      success: false,
      itemsAdded: 0,
      error: `No sync script configured for "${groupName}". Open Setup Sync and pick an adapter.`,
    }
  }

  const { ctx, getStats, getAddedItems, abort } = buildSyncContext(groupName, config.adapterConfig)
  activeAborts.set(groupName, abort)

  emitEvent({ groupName, status: 'started', timestamp: Date.now(), message: 'Starting sync...' })

  try {
    // Run script in vm sandbox
    const sandbox = {
      exports: {} as Record<string, unknown>,
      module: { exports: {} as Record<string, unknown> },
      console: { log: ctx.log, warn: ctx.warn, error: ctx.error },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      Promise: globalThis.Promise,
    }

    vm.createContext(sandbox)

    // Wrap script to extract sync function and call it
    const wrappedCode = `
      ${scriptSource}
      ;(async function(__ctx) {
        if (typeof sync === 'function') return sync(__ctx);
        if (module.exports.sync) return module.exports.sync(__ctx);
        if (exports.sync) return exports.sync(__ctx);
        throw new Error('Script must export a sync(ctx) function');
      })
    `

    const script = new vm.Script(wrappedCode, { timeout: 300_000 })
    const syncFn = script.runInContext(sandbox)
    await syncFn(ctx)

    const stats = getStats()
    updateSyncResult(groupName, { status: 'success', itemsAdded: stats.added })
    emitEvent({ groupName, status: 'completed', timestamp: Date.now(), message: `Sync complete. ${stats.added} items added.`, itemsAdded: stats.added })

    // Post-sync: trigger enrichment for newly added items (background, non-blocking)
    const added = getAddedItems()
    if (added.length > 0) {
      postSyncEnrich(added).catch(e => console.warn('[Sync] post-enrich error:', e))
    }

    return { success: true, itemsAdded: stats.added }
  } catch (e: any) {
    const error = e.message || String(e)
    updateSyncResult(groupName, { status: 'error', error })
    emitEvent({ groupName, status: 'error', timestamp: Date.now(), message: error })
    return { success: false, itemsAdded: getStats().added, error }
  } finally {
    activeAborts.delete(groupName)
  }
}

/** Cancel a running sync */
export function cancelSync(groupName: string): boolean {
  const abort = activeAborts.get(groupName)
  if (abort) {
    abort.abort()
    emitEvent({ groupName, status: 'cancelled', timestamp: Date.now(), message: 'Sync cancelled by user' })
    return true
  }
  return false
}

/** Check if a sync is currently running */
export function isSyncRunning(groupName: string): boolean {
  return activeAborts.has(groupName)
}

/**
 * Post-sync enrichment: fetch markdown for link/tweet items, then emit readiness.
 * Runs sequentially to avoid overwhelming the network. Capped to first 50 items.
 */
async function postSyncEnrich(items: CollectedItem[]): Promise<void> {
  const linkItems = items.filter(i => i.type === 'link' || i.type === 'tweet')
  const textItems = items.filter(i => i.type === 'text' || i.type === 'video')

  // Text/video items are immediately ready
  for (const item of textItems) {
    emitItemReadyIfReady(item)
  }

  // Link/tweet items need markdown fetch first (cap at 50 to avoid overload)
  const toFetch = linkItems.slice(0, 50)
  console.log(`[Sync] Post-enrich: ${toFetch.length} items to fetch markdown, ${textItems.length} text items ready`)

  for (const item of toFetch) {
    if (!item.url) continue
    try {
      await fetchAndSaveMarkdown(item.id, item.url)
    } catch (e) {
      console.warn(`[Sync] markdown fetch failed for ${item.id}:`, e)
    }
    // Reload item from DB (meta updated by fetchAndSaveMarkdown) and check readiness
    const [fresh] = getItemsByIds([item.id])
    if (fresh) emitItemReadyIfReady(fresh)
  }
}
