import React, { useCallback, useEffect, useState, useRef } from 'react'
import { ChevronRight, ChevronDown, Loader2, Chrome, FileText, Terminal, FileCode, FileJson, FileType, Palette, FileImage, File, LayoutTemplate, Globe, Plus, Moon, Sun } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import type { AppType, FileNode } from '../../../shared/types'

// ── Helpers ──

function getParentPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx > 0 ? filePath.slice(0, idx) : filePath
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx':
    case 'ts':
    case 'jsx':
    case 'js':
      return FileCode
    case 'json':
      return FileJson
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return Palette
    case 'md':
    case 'txt':
      return FileText
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
      return FileImage
    case 'html':
    case 'htm':
      return FileType
    default:
      return File
  }
}

// Render name with dimmed extension
const SplitName: React.FC<{ name: string; isActive?: boolean }> = ({ name, isActive }) => {
  const lastDot = name.lastIndexOf('.')
  if (lastDot > 0 && lastDot < name.length - 1) {
    const base = name.slice(0, lastDot)
    const ext = name.slice(lastDot)
    return (
      <span className="truncate" style={{ fontSize: '13.5px' }}>
        <span className={isActive ? 'text-accent-main font-medium' : 'text-tx-main'}>{base}</span>
        <span className={isActive ? 'text-accent-main/70' : 'text-tx-muted'}>{ext}</span>
      </span>
    )
  }
  return <span className={`truncate ${isActive ? 'text-accent-main font-medium' : 'text-tx-main'}`} style={{ fontSize: '13.5px' }}>{name}</span>
}

// ── File Tree Node ──

const FileTreeNode: React.FC<{
  node: FileNode
  depth: number
  activeFilePath: string | null
  expandedPaths: string[]
  refreshCounter: number
  onFileClick: (path: string) => void
  onToggleDir: (path: string) => void
}> = ({ node, depth, activeFilePath, expandedPaths, refreshCounter, onFileClick, onToggleDir }) => {
  const expanded = expandedPaths.includes(node.path)
  const [children, setChildren] = useState<FileNode[]>([])

  // Load/reload children when expanded or when refreshCounter changes
  useEffect(() => {
    if (expanded && node.isDirectory) {
      window.api.fs.readDir(node.path).then((res) => {
        if (res.ok) setChildren(res.data)
      })
    }
  }, [expanded, node.isDirectory, node.path, refreshCounter])

  const toggle = useCallback(() => {
    if (!node.isDirectory) {
      onFileClick(node.path)
      return
    }
    onToggleDir(node.path)
  }, [node, onFileClick, onToggleDir])

  const isActive = node.path === activeFilePath
  // Start indent at 32 for children, +16 per depth
  const pl = 32 + depth * 16
  
  const Icon = node.isDirectory ? null : getFileIcon(node.name)

  return (
    <>
      <div
        onClick={toggle}
        style={{ paddingLeft: pl }}
        className={`flex items-center gap-1.5 py-[4px] pr-4 cursor-pointer text-[13px] tracking-wide relative group
          ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />
        )}
        {node.isDirectory ? (
          expanded ? (
            <ChevronDown size={14} className="shrink-0 text-tx-muted" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-tx-muted" />
          )
        ) : (
          <span className={`shrink-0 flex items-center justify-center ${isActive ? 'text-accent-main' : 'text-tx-muted'}`}>
            {node.name === 'loading.tsx' || node.name === 'loading.js' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              Icon && <Icon size={14} />
            )}
          </span>
        )}
        <SplitName name={node.name} isActive={isActive} />
      </div>
      {expanded &&
        children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            expandedPaths={expandedPaths}
            refreshCounter={refreshCounter}
            onFileClick={onFileClick}
            onToggleDir={onToggleDir}
          />
        ))}
    </>
  )
}

// ── Sidebar ──

export const Sidebar: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const setCurrentApp = useUIStore((s) => s.setCurrentApp)
  const workspacePath = useUIStore((s) => s.workspacePath)
  const setWorkspacePath = useUIStore((s) => s.setWorkspacePath)
  const activeFilePath = useUIStore((s) => s.activeFilePath)
  const setActiveFilePath = useUIStore((s) => s.setActiveFilePath)
  const expandedPaths = useUIStore((s) => s.sidebarExpandedPaths)
  const toggleSidebarPath = useUIStore((s) => s.toggleSidebarPath)

  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [expandedSections, setExpandedSections] = useState<string[]>(['code.app'])
  const workspacePathRef = useRef(workspacePath)
  workspacePathRef.current = workspacePath

  const handleAppClick = (appId: AppType) => {
    setCurrentApp(appId)
    setExpandedSections((prev) =>
      prev.includes(appId) ? prev.filter((s) => s !== appId) : [...prev, appId]
    )
  }

  const handleFileClick = useCallback(
    (path: string) => {
      setActiveFilePath(path)
      // If it's a .md file and we're in notes.app, stay there; otherwise go to code.app
      if (path.endsWith('.md') && currentApp === 'notes.app') {
        // stay in notes.app
      } else {
        setCurrentApp('code.app')
      }
    },
    [setActiveFilePath, setCurrentApp, currentApp]
  )

  const handleNoteFileClick = useCallback(
    (path: string) => {
      setActiveFilePath(path)
      setCurrentApp('notes.app')
    },
    [setActiveFilePath, setCurrentApp]
  )

  // Load root directory when workspace changes
  useEffect(() => {
    if (!workspacePath) {
      setRootNodes([])
      return
    }
    
    // Instead of reading the dir and flattening, treat the workspace itself as the root node
    const workspaceName = workspacePath.split('/').pop() || 'workspace'
    const rootNode: FileNode = {
      name: workspaceName,
      path: workspacePath,
      isDirectory: true
    }
    
    setRootNodes([rootNode])
    
    // We should probably auto-expand this new root node
    if (!expandedPaths.includes(workspacePath)) {
      toggleSidebarPath(workspacePath)
    }
  }, [workspacePath, refreshCounter])

  // Subscribe to file watcher events
  useEffect(() => {
    const unsub = window.api.fs.onWatchEvent((event) => {
      const parentDir = getParentPath(event.path)

      // Refresh if change is in workspace root, expanded directory, or notes directory
      const notesDir = workspacePathRef.current ? workspacePathRef.current + '/notes' : null
      if (
        parentDir === workspacePathRef.current ||
        expandedPaths.includes(parentDir) ||
        (notesDir && parentDir === notesDir)
      ) {
        setRefreshCounter((c) => c + 1)
      }
    })
    return unsub
  }, [expandedPaths])

  const handleOpenFolder = useCallback(async () => {
    const res = await window.api.workspace.open()
    if (res.ok) {
      setWorkspacePath(res.data)
      setActiveFilePath(null)
    }
  }, [setWorkspacePath, setActiveFilePath])

  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  return (
    <div className="w-[260px] flex flex-col bg-bg-app text-[14px] overflow-hidden shrink-0">
      {/* Top drag area for macOS */}
      <div className="h-8 w-full shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* File Tree / Apps List */}
      <div className="flex-1 overflow-y-auto pb-4 pt-2">
        {/* code.app */}
        <div 
          onClick={() => handleAppClick('code.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'code.app' ? 'bg-bg-active text-accent-main' : 'hover:bg-bg-hover text-tx-main'}`}
        >
          {currentApp === 'code.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-tx-muted">
            <LayoutTemplate size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="code.app" isActive={currentApp === 'code.app'} />
          <div className="ml-auto">
            {expandedSections.includes('code.app') ? <ChevronDown size={14} className="text-tx-faint" /> : <ChevronRight size={14} className="text-tx-faint" />}
          </div>
        </div>
        
        {expandedSections.includes('code.app') && (
          <div className="mb-3 mt-1">
            {rootNodes.length === 0 && !workspacePath ? (
              <div 
                onClick={handleOpenFolder}
                className="pl-[32px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer"
              >
                Open a folder...
              </div>
            ) : (
              rootNodes.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  activeFilePath={activeFilePath}
                  expandedPaths={expandedPaths}
                  refreshCounter={refreshCounter}
                  onFileClick={handleFileClick}
                  onToggleDir={toggleSidebarPath}
                />
              ))
            )}
          </div>
        )}

        {/* browser.app */}
        <div 
          onClick={() => handleAppClick('browser.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'browser.app' ? 'bg-bg-active text-accent-main' : 'hover:bg-bg-hover text-tx-main'}`}
        >
          {currentApp === 'browser.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-tx-muted">
            <Chrome size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="browser.app" isActive={currentApp === 'browser.app'} />
          <div className="ml-auto">
            {expandedSections.includes('browser.app') ? <ChevronDown size={14} className="text-tx-faint" /> : <ChevronRight size={14} className="text-tx-faint" />}
          </div>
        </div>
        {expandedSections.includes('browser.app') && (
          <div className="mb-3 mt-1">
            <div className="pl-[32px] py-1 flex items-center gap-2 text-[13px] cursor-pointer hover:bg-bg-hover">
              <Globe size={13} className="text-tx-muted" />
              <SplitName name="my-store.com" />
            </div>
          </div>
        )}

        {/* notes.app */}
        <NotesAppSection
          currentApp={currentApp}
          expanded={expandedSections.includes('notes.app')}
          onHeaderClick={() => handleAppClick('notes.app')}
          workspacePath={workspacePath}
          activeFilePath={activeFilePath}
          onFileClick={handleNoteFileClick}
          refreshCounter={refreshCounter}
        />

        {/* terminal.app */}
        <div 
          onClick={() => handleAppClick('terminal.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'terminal.app' ? 'bg-bg-active text-accent-main' : 'hover:bg-bg-hover text-tx-main'}`}
        >
          {currentApp === 'terminal.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-tx-muted">
            <Terminal size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="terminal.app" isActive={currentApp === 'terminal.app'} />
          <div className="ml-auto">
            {expandedSections.includes('terminal.app') ? <ChevronDown size={14} className="text-tx-faint" /> : <ChevronRight size={14} className="text-tx-faint" />}
          </div>
        </div>
        {expandedSections.includes('terminal.app') && (
          <div className="mb-3 mt-1">
            <div className="pl-[32px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer">
              New terminal...
            </div>
          </div>
        )}
      </div>
      
      {/* Bottom Actions */}
      <div className="shrink-0 p-3 flex justify-between items-center border-t border-border-subtle">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </div>
  )
}

// ── Notes App Sidebar Section ──

const NotesAppSection: React.FC<{
  currentApp: AppType
  expanded: boolean
  onHeaderClick: () => void
  workspacePath: string | null
  activeFilePath: string | null
  onFileClick: (path: string) => void
  refreshCounter: number
}> = ({ currentApp, expanded, onHeaderClick, workspacePath, activeFilePath, onFileClick, refreshCounter }) => {
  const [noteFiles, setNoteFiles] = useState<FileNode[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newNoteName, setNewNoteName] = useState('')
  const [localRefresh, setLocalRefresh] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const notesDir = workspacePath ? workspacePath + '/notes' : null

  const reloadNotes = useCallback(() => {
    if (!notesDir) return
    window.api.fs.createDir(notesDir).then(() => {
      window.api.fs.readDir(notesDir).then((res) => {
        if (res.ok) {
          setNoteFiles(
            res.data.filter((f) => !f.isDirectory && f.name.endsWith('.md'))
          )
        }
      })
    })
  }, [notesDir])

  // Load notes from workspace/notes/ directory
  useEffect(() => {
    if (!expanded || !notesDir) {
      setNoteFiles([])
      return
    }
    reloadNotes()
  }, [expanded, notesDir, refreshCounter, localRefresh, reloadNotes])

  const handleCreateNote = useCallback(async () => {
    if (!notesDir) return
    const name = newNoteName.trim() || `untitled-${Date.now()}`
    const fileName = name.endsWith('.md') ? name : `${name}.md`
    const filePath = `${notesDir}/${fileName}`

    await window.api.fs.createDir(notesDir)
    const res = await window.api.fs.createFile(filePath)
    if (res.ok) {
      await window.api.fs.writeFile(filePath, `# ${name.replace('.md', '')}\n\n`)
      // Refresh the list immediately, then open the file
      setLocalRefresh((c) => c + 1)
      onFileClick(filePath)
    }
    setIsCreating(false)
    setNewNoteName('')
  }, [notesDir, newNoteName, onFileClick])

  const startCreating = useCallback(() => {
    if (!workspacePath) return
    setIsCreating(true)
    setNewNoteName('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [workspacePath])

  return (
    <>
      <div
        onClick={onHeaderClick}
        className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
          ${currentApp === 'notes.app' ? 'bg-bg-active text-accent-main' : 'hover:bg-bg-hover text-tx-main'}`}
      >
        {currentApp === 'notes.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
        <div className="flex items-center justify-center w-4 h-4 shrink-0 text-tx-muted">
          <FileText size={14} strokeWidth={2.5} />
        </div>
        <SplitName name="notes.app" isActive={currentApp === 'notes.app'} />
        <div className="ml-auto flex items-center gap-1">
          {workspacePath && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                if (!expanded) onHeaderClick()
                startCreating()
              }}
              className="p-0.5 rounded text-tx-muted hover:text-tx-main hover:bg-border-subtle transition-colors"
              title="New note"
            >
              <Plus size={14} />
            </div>
          )}
          {expanded ? <ChevronDown size={14} className="text-tx-faint" /> : <ChevronRight size={14} className="text-tx-faint" />}
        </div>
      </div>
      {expanded && (
        <div className="mb-3 mt-1">
          {!workspacePath ? (
            <div className="pl-[32px] py-1 text-[13px] text-tx-faint">
              Open a workspace first
            </div>
          ) : (
            <>
              {/* New note input */}
              {isCreating && (
                <div className="pl-[32px] pr-3 py-1 flex items-center gap-1.5">
                  <FileText size={13} className="text-tx-muted shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={newNoteName}
                    onChange={(e) => setNewNoteName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleCreateNote()
                      }
                      if (e.key === 'Escape') {
                        setIsCreating(false)
                        setNewNoteName('')
                      }
                    }}
                    onBlur={() => {
                      if (newNoteName.trim()) {
                        handleCreateNote()
                      } else {
                        setIsCreating(false)
                      }
                    }}
                    placeholder="note name..."
                    className="flex-1 bg-transparent text-[13px] text-tx-main outline-none border-b border-border-strong placeholder-tx-muted py-0.5"
                  />
                </div>
              )}

              {/* Note files list */}
              {noteFiles.map((note) => {
                const isActive = note.path === activeFilePath
                return (
                  <div
                    key={note.path}
                    onClick={() => onFileClick(note.path)}
                    className={`pl-[32px] py-[4px] pr-4 flex items-center gap-1.5 cursor-pointer text-[13px] tracking-wide relative
                      ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
                    <FileText size={13} className={`${isActive ? 'text-accent-main' : 'text-tx-muted'} shrink-0`} />
                    <SplitName name={note.name} isActive={isActive} />
                  </div>
                )
              })}

              {/* Empty state with create action */}
              {noteFiles.length === 0 && !isCreating && (
                <div
                  onClick={startCreating}
                  className="pl-[32px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer"
                >
                  New note...
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
