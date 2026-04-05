/**
 * Lite App Interface — all apps (built-in or third-party) conform to this.
 */

// ── App Manifest ──

export interface AppManifest {
  id: string
  name: string
  icon: string                    // lucide icon name
  version: string
  description: string
  permissions: AppPermission[]
  builtin: boolean
}

export type AppPermission = 'fs' | 'network' | 'state' | 'ai' | 'shell'

// ── App Sidebar ──

export interface AppSidebarConfig {
  /** Does the sidebar section expand to show children? */
  expandable: boolean
  /** Render custom sidebar content (tree, list, etc.) */
  sidebarComponent?: React.FC<{ api: LiteAppAPI }>
  /** Action buttons in the section header */
  actions?: React.FC<{ api: LiteAppAPI }>
}

// ── App Definition ──

export interface AppDefinition {
  manifest: AppManifest
  /** Main content component — built-in apps may omit the api prop */
  component: React.FC<{ api?: LiteAppAPI }>
  /** Sidebar configuration */
  sidebar?: AppSidebarConfig
  /** Called when app is registered — use to provide bus capabilities */
  onRegister?: (api: LiteAppAPI) => void
  /** Called when app is unregistered */
  onUnregister?: () => void
}

// ── Search Result (standard interface for app-provided search) ──

export interface AppSearchResult {
  /** Unique ID */
  id: string
  /** Display title */
  title: string
  /** Secondary info (path, domain, etc.) */
  subtitle?: string
  /** Content preview / matched snippet */
  snippet?: string
  /** Relevance score (0-100, higher = more relevant) */
  score: number
  /** Source app ID */
  source: string
  /** Icon name (lucide) */
  icon?: string
  /** Action data — file path, URL, etc. */
  action: { type: 'open-file'; path: string; line?: number }
    | { type: 'open-url'; url: string }
    | { type: 'navigate'; app: string; state?: Record<string, unknown> }
}

// ── App Bus ──

export interface AppBus {
  /** Register a capability that other apps can request */
  provide(capability: string, handler: (params?: unknown) => unknown | Promise<unknown>): void
  /** Remove a provided capability */
  unprovide(capability: string): void
  /** Request a capability from any app that provides it */
  request<T = unknown>(capability: string, params?: unknown): Promise<T | null>
  /** Check if a capability is available */
  has(capability: string): boolean
  /** Broadcast an event to all listeners */
  emit(event: string, data?: unknown): void
  /** Listen for events */
  on(event: string, callback: (data?: unknown) => void): () => void
}

// ── App API ──

export interface LiteAppAPI {
  /** This app's id */
  id: string
  /** This app's data directory */
  dataDir: string
  /** Inter-app communication */
  bus: AppBus
  /** File system (scoped to app's data dir) */
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    readDir(path: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>
    delete(path: string): Promise<void>
  }
  /** Persistent key-value state */
  state: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  /** Theme info */
  theme: {
    id: string
    isDark: boolean
    tokens: Record<string, string>
  }
  /** Shell actions */
  shell: {
    openExternal(url: string): void
    showToast(message: string, type?: 'success' | 'error' | 'loading'): void
  }
  /** Register commands in ⌘K palette */
  commands: {
    register(id: string, label: string, action: () => void): void
    unregister(id: string): void
  }
}
