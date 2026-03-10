import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { LiteConfig } from '../../shared/types'
import { DEFAULT_LITE_CONFIG } from '../../shared/types'

let liteHome: string

/** Initialize Lite Home directory and ensure required subdirs exist */
export function initLiteHome(): string {
  liteHome = app.getPath('userData')

  // Ensure core directories
  const dirs = [
    path.join(liteHome, 'notes'),
    path.join(liteHome, 'images'),
    path.join(liteHome, 'collected'),
    path.join(liteHome, 'browser'),
    path.join(liteHome, 'terminals'),
  ]

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return liteHome
}

export function getLiteHome(): string {
  return liteHome
}

// ── Config persistence ──

function configPath(): string {
  return path.join(liteHome, 'config.json')
}

export function loadConfig(): LiteConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    // Merge with defaults to handle new fields added in future versions
    return {
      ...DEFAULT_LITE_CONFIG,
      ...parsed,
      appStates: {
        ...DEFAULT_LITE_CONFIG.appStates,
        ...(parsed.appStates || {}),
      },
    }
  } catch {
    return { ...DEFAULT_LITE_CONFIG }
  }
}

export function saveConfig(patch: Partial<LiteConfig>): void {
  const current = loadConfig()
  const merged = { ...current, ...patch }

  // Deep merge appStates if provided
  if (patch.appStates) {
    merged.appStates = {
      ...current.appStates,
      ...patch.appStates,
    }
  }

  // Cap recent projects
  if (merged.recentProjects.length > 10) {
    merged.recentProjects = merged.recentProjects.slice(0, 10)
  }

  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf-8')
}

export function addRecentProject(projectPath: string): void {
  const current = loadConfig()
  const filtered = current.recentProjects.filter((p) => p !== projectPath)
  filtered.unshift(projectPath)
  saveConfig({ recentProjects: filtered })
}
