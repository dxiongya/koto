import React, { useCallback, useEffect, useState, useRef } from 'react'
import { ChevronRight, ChevronDown, Loader2, Code, Chrome, FileText, Terminal, FileCode, FileJson, FileType, Palette, FileImage, File, LayoutTemplate, Globe } from 'lucide-react'
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
        <span className={isActive ? 'text-[#e5e5e5]' : 'text-[#c0c0c0]'}>{base}</span>
        <span className={isActive ? 'text-[#888]' : 'text-[#666]'}>{ext}</span>
      </span>
    )
  }
  return <span className={`truncate ${isActive ? 'text-[#e5e5e5]' : 'text-[#c0c0c0]'}`} style={{ fontSize: '13.5px' }}>{name}</span>
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
          ${isActive ? 'bg-[#222222]' : 'hover:bg-[#1a1a1a]'}`}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />
        )}
        {node.isDirectory ? (
          expanded ? (
            <ChevronDown size={14} className="shrink-0 text-[#888]" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-[#888]" />
          )
        ) : (
          <span className="shrink-0 flex items-center justify-center text-[#888]">
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
      setCurrentApp('code.app')
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

      // If the change is in the workspace root or in an expanded directory, refresh
      if (parentDir === workspacePathRef.current || expandedPaths.includes(parentDir)) {
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

  return (
    <div className="w-[260px] flex flex-col bg-[#111111] text-[14px] overflow-hidden shrink-0">
      {/* Top drag area for macOS */}
      <div className="h-8 w-full shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* File Tree / Apps List */}
      <div className="flex-1 overflow-y-auto pb-4 pt-2">
        {/* code.app */}
        <div 
          onClick={() => handleAppClick('code.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'code.app' ? 'bg-[#222222]' : 'hover:bg-[#1a1a1a]'}`}
        >
          {currentApp === 'code.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-[#888]">
            <LayoutTemplate size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="code.app" isActive={currentApp === 'code.app'} />
          <div className="ml-auto">
            {expandedSections.includes('code.app') ? <ChevronDown size={14} className="text-[#666]" /> : <ChevronRight size={14} className="text-[#666]" />}
          </div>
        </div>
        
        {expandedSections.includes('code.app') && (
          <div className="mb-3 mt-1">
            {rootNodes.length === 0 && !workspacePath ? (
              <div 
                onClick={handleOpenFolder}
                className="pl-[32px] py-1 text-[13px] text-[#666] hover:text-[#b0b0b0] cursor-pointer"
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
            ${currentApp === 'browser.app' ? 'bg-[#222222]' : 'hover:bg-[#1a1a1a]'}`}
        >
          {currentApp === 'browser.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-[#888]">
            <Chrome size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="browser.app" isActive={currentApp === 'browser.app'} />
          <div className="ml-auto">
            {expandedSections.includes('browser.app') ? <ChevronDown size={14} className="text-[#666]" /> : <ChevronRight size={14} className="text-[#666]" />}
          </div>
        </div>
        {expandedSections.includes('browser.app') && (
          <div className="mb-3 mt-1">
            <div className="pl-[32px] py-1 flex items-center gap-2 text-[13px] cursor-pointer hover:bg-[#1a1a1a]">
              <Globe size={13} className="text-[#888]" />
              <SplitName name="my-store.com" />
            </div>
          </div>
        )}

        {/* notes.app */}
        <div 
          onClick={() => handleAppClick('notes.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'notes.app' ? 'bg-[#222222]' : 'hover:bg-[#1a1a1a]'}`}
        >
          {currentApp === 'notes.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-[#888]">
            <FileText size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="notes.app" isActive={currentApp === 'notes.app'} />
          <div className="ml-auto">
            {expandedSections.includes('notes.app') ? <ChevronDown size={14} className="text-[#666]" /> : <ChevronRight size={14} className="text-[#666]" />}
          </div>
        </div>
        {expandedSections.includes('notes.app') && (
          <div className="mb-3 mt-1">
            <div className="pl-[32px] py-1 text-[13px] text-[#666] hover:text-[#b0b0b0] cursor-pointer">
              New note...
            </div>
          </div>
        )}

        {/* terminal.app */}
        <div 
          onClick={() => handleAppClick('terminal.app')}
          className={`px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
            ${currentApp === 'terminal.app' ? 'bg-[#222222]' : 'hover:bg-[#1a1a1a]'}`}
        >
          {currentApp === 'terminal.app' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />}
          <div className="flex items-center justify-center w-4 h-4 shrink-0 text-[#888]">
            <Terminal size={14} strokeWidth={2.5} />
          </div>
          <SplitName name="terminal.app" isActive={currentApp === 'terminal.app'} />
          <div className="ml-auto">
            {expandedSections.includes('terminal.app') ? <ChevronDown size={14} className="text-[#666]" /> : <ChevronRight size={14} className="text-[#666]" />}
          </div>
        </div>
        {expandedSections.includes('terminal.app') && (
          <div className="mb-3 mt-1">
            <div className="pl-[32px] py-1 text-[13px] text-[#666] hover:text-[#b0b0b0] cursor-pointer">
              New terminal...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
