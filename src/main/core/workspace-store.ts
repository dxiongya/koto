import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AppType, WorkspaceState } from '../../shared/types'

const STATE_FILE = path.join(app.getPath('userData'), 'workspace-state.json')
const MAX_RECENT = 10

const DEFAULT_STATE: WorkspaceState = {
  recentWorkspaces: [],
  lastWorkspacePath: null,
  lastApp: 'code.app' as AppType,
  lastActiveFilePath: null,
  windowBounds: null,
  sidebarExpandedPaths: [],
}

export function loadState(): WorkspaceState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveState(patch: Partial<WorkspaceState>): void {
  const current = loadState()
  const merged = { ...current, ...patch }

  // Cap recent workspaces
  if (merged.recentWorkspaces.length > MAX_RECENT) {
    merged.recentWorkspaces = merged.recentWorkspaces.slice(0, MAX_RECENT)
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf-8')
}

export function addRecentWorkspace(wsPath: string): void {
  const current = loadState()
  const filtered = current.recentWorkspaces.filter((p) => p !== wsPath)
  filtered.unshift(wsPath)
  saveState({ recentWorkspaces: filtered })
}
