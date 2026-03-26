import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight, ChevronDown, Loader2, Chrome, FileText, Terminal,
  FileCode, FileJson, FileType, Palette, FileImage, File, LayoutTemplate, Plus, Moon, Sun, FolderOpen, FolderPlus, X,
  Pencil, Trash2, FilePlus, FolderInput, Settings, Zap, Archive, Layers, Folder,
  Link, Image, Video, Twitter, Monitor, Type
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { useContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import type { AppType, FileNode, CollectedItem } from '../../../shared/types'

// ── Helpers ──

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx': case 'ts': case 'jsx': case 'js': return FileCode
    case 'json': return FileJson
    case 'css': case 'scss': case 'sass': case 'less': return Palette
    case 'md': case 'txt': return FileText
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': case 'webp': return FileImage
    case 'html': case 'htm': return FileType
    default: return File
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
        <span className={isActive ? 'text-tx-active font-medium' : 'text-tx-main'}>{base}</span>
        <span className={isActive ? 'text-tx-active/70' : 'text-tx-muted'}>{ext}</span>
      </span>
    )
  }
  return <span className={`truncate ${isActive ? 'text-tx-active font-medium' : 'text-tx-main'}`} style={{ fontSize: '13.5px' }}>{name}</span>
}

// ── File Tree Node (for code.app) ──

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
  const pl = 20 + depth * 16
  const Icon = node.isDirectory ? null : getFileIcon(node.name)

  return (
    <>
      <div
        role="treeitem"
        tabIndex={0}
        aria-selected={isActive}
        aria-expanded={node.isDirectory ? expanded : undefined}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.path)
          e.dataTransfer.setData('application/x-lite-file', node.path)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        style={{ paddingLeft: pl }}
        className={`flex items-center gap-1.5 py-[4px] pr-4 cursor-pointer text-[13px] tracking-wide relative group
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
          ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
      >
        {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
        {node.isDirectory ? (
          expanded ? <ChevronDown size={14} className="shrink-0 text-tx-muted" /> : <ChevronRight size={14} className="shrink-0 text-tx-muted" />
        ) : (
          <span className={`shrink-0 flex items-center justify-center ${isActive ? 'text-tx-active' : 'text-tx-muted'}`}>
            {node.name === 'loading.tsx' || node.name === 'loading.js' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              Icon && <Icon size={14} />
            )}
          </span>
        )}
        <SplitName name={node.name} isActive={isActive} />
      </div>
      {expanded && children.map((child) => (
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

// ── App Section Header ──

const AppSectionHeader: React.FC<{
  appId: AppType
  icon: React.ReactNode
  currentApp: AppType
  expanded: boolean
  onClick: () => void
  actions?: React.ReactNode
}> = ({ appId, icon, currentApp, expanded, onClick, actions }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={expanded}
    className={`w-full px-4 py-[6px] flex items-center gap-2 cursor-pointer tracking-wide relative group
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
      ${currentApp === appId ? 'bg-bg-active text-tx-active' : 'hover:bg-bg-hover text-tx-main'}`}
  >
    {currentApp === appId && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
    <div className="flex items-center justify-center w-4 h-4 shrink-0 text-tx-muted">{icon}</div>
    <SplitName name={appId} isActive={currentApp === appId} />
    <div className="ml-auto flex items-center gap-1">
      {actions}
      {expanded ? <ChevronDown size={14} className="text-tx-faint" /> : <ChevronRight size={14} className="text-tx-faint" />}
    </div>
  </button>
)

// ── Notes App Section ──

const NotesAppSection: React.FC<{
  currentApp: AppType
  expanded: boolean
  onHeaderClick: () => void
  liteHome: string | null
  onFileClick: (path: string) => void
  renameTrigger: number
  selectedGroup: string | null
  onGroupSelect: (path: string | null) => void
}> = ({ currentApp, expanded, onHeaderClick, liteHome, onFileClick, renameTrigger, selectedGroup, onGroupSelect }) => {
  const activeFilePath = useUIStore((s) => s.appStates['notes.app'].activeFilePath)
  const notesExpandedGroups = useUIStore((s) => s.notesExpandedGroups)
  const toggleNotesGroup = useUIStore((s) => s.toggleNotesGroup)
  const openContextMenu = useContextMenu()
  const [groups, setGroups] = useState<FileNode[]>([])
  const [rootNotes, setRootNotes] = useState<FileNode[]>([])
  const [groupNotes, setGroupNotes] = useState<Record<string, FileNode[]>>({})
  const [refreshCounter, setRefreshCounter] = useState(0)

  // Inline input state
  const [inlineInput, setInlineInput] = useState<{
    type: 'note' | 'group' | 'noteInGroup' | 'rename'
    parentPath?: string   // group path for noteInGroup
    renamePath?: string   // full path of item being renamed
    renameIsDir?: boolean
  } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Drag state
  const [dragNotePath, setDragNotePath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  // Automation: track which files have automations
  const [automationFiles, setAutomationFiles] = useState<Set<string>>(new Set())

  const notesDir = liteHome ? liteHome + '/notes' : null

  // Enter key rename trigger
  useEffect(() => {
    if (renameTrigger === 0 || currentApp !== 'notes.app' || !activeFilePath || inlineInput) return
    // Determine if the active item is a dir (group) or file
    const allGroupPaths = groups.map((g) => g.path)
    const isDir = allGroupPaths.includes(activeFilePath)
    // For notes.app, activeFilePath is always a file; groups are not "active" in the same way
    // So we rename the active note file
    showInput('rename', { renamePath: activeFilePath, renameIsDir: isDir })
  }, [renameTrigger])

  // ── Data loading ──

  useEffect(() => {
    if (!expanded || !notesDir) {
      setGroups([])
      setRootNotes([])
      return
    }
    window.api.fs.readDir(notesDir).then((res) => {
      if (!res.ok) return
      setGroups(res.data.filter((f) => f.isDirectory))
      setRootNotes(res.data.filter((f) => !f.isDirectory && f.name.endsWith('.md')))
    })
  }, [expanded, notesDir, refreshCounter])

  useEffect(() => {
    if (!expanded) return
    const expandedGroupPaths = groups.filter((g) => notesExpandedGroups.includes(g.path))
    const loadGroup = async (groupPath: string) => {
      const res = await window.api.fs.readDir(groupPath)
      return { path: groupPath, notes: res.ok ? res.data.filter((f) => !f.isDirectory && f.name.endsWith('.md')) : [] }
    }
    Promise.all(expandedGroupPaths.map((g) => loadGroup(g.path))).then((results) => {
      const map: Record<string, FileNode[]> = {}
      for (const r of results) map[r.path] = r.notes
      setGroupNotes(map)
    })
  }, [expanded, groups, notesExpandedGroups, refreshCounter])

  useEffect(() => {
    if (!notesDir) return
    const unsub = window.api.fs.onWatchEvent((event) => {
      if (event.path.startsWith(notesDir)) setRefreshCounter((c) => c + 1)
    })
    return unsub
  }, [notesDir])

  // Load automation file paths
  useEffect(() => {
    if (!expanded) return
    const loadAutomations = (): void => {
      window.api.automation.list().then(res => {
        if (res.ok) {
          setAutomationFiles(new Set(res.data.filter(a => a.enabled).map(a => a.target.filePath)))
        }
      })
    }
    loadAutomations()
    const unsub = window.api.automation.onRunEvent(() => loadAutomations())
    return unsub
  }, [expanded])

  // ── Inline input helpers ──

  const showInput = useCallback((type: typeof inlineInput extends null ? never : NonNullable<typeof inlineInput>['type'], extra?: Partial<NonNullable<typeof inlineInput>>) => {
    setInlineInput({ type, ...extra })
    setInputValue(type === 'rename' && extra?.renamePath
      ? extra.renamePath.split('/').pop()?.replace(/\.md$/, '') || ''
      : '')
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 50)
  }, [])

  const cancelInput = useCallback(() => { setInlineInput(null); setInputValue('') }, [])

  // ── CRUD operations ──

  const nextUntitledName = useCallback(async (parentDir: string): Promise<string> => {
    const res = await window.api.fs.readDir(parentDir)
    const existing = res.ok ? res.data.map((f) => f.name) : []
    if (!existing.includes('Untitled.md')) return 'Untitled'
    let i = 2
    while (existing.includes(`Untitled ${i}.md`)) i++
    return `Untitled ${i}`
  }, [])

  const createNote = useCallback(async (parentDir: string, name?: string) => {
    const noteName = name || await nextUntitledName(parentDir)
    const fileName = noteName.endsWith('.md') ? noteName : `${noteName}.md`
    const filePath = `${parentDir}/${fileName}`
    const res = await window.api.fs.createFile(filePath)
    if (res.ok) {
      await window.api.fs.writeFile(filePath, `# ${noteName.replace(/\.md$/, '')}\n\n`)
      setRefreshCounter((c) => c + 1)
      onFileClick(filePath)
    }
  }, [onFileClick, nextUntitledName])

  const createGroup = useCallback(async (name: string) => {
    if (!notesDir) return
    const groupPath = `${notesDir}/${name}`
    await window.api.fs.createDir(groupPath)
    setRefreshCounter((c) => c + 1)
    toggleNotesGroup(groupPath)
  }, [notesDir, toggleNotesGroup])

  const renameItem = useCallback(async (oldPath: string, newName: string, isDir: boolean) => {
    const parent = oldPath.substring(0, oldPath.lastIndexOf('/'))
    const newPath = isDir ? `${parent}/${newName}` : `${parent}/${newName.endsWith('.md') ? newName : newName + '.md'}`
    if (oldPath === newPath) return
    const res = await window.api.fs.rename(oldPath, newPath)
    if (res.ok) {
      setRefreshCounter((c) => c + 1)
      // If renamed file was active, update active path in-place (no navigation side effects)
      if (oldPath === activeFilePath) {
        const store = useUIStore.getState()
        const updated = { ...store.appStates, 'notes.app': { ...store.appStates['notes.app'], activeFilePath: newPath } }
        useUIStore.setState({ appStates: updated })
      }
    }
  }, [activeFilePath])

  const deleteItem = useCallback(async (itemPath: string) => {
    const res = await window.api.fs.delete(itemPath)
    if (res.ok) {
      setRefreshCounter((c) => c + 1)
      if (itemPath === activeFilePath) {
        const store = useUIStore.getState()
        const updated = { ...store.appStates, 'notes.app': { ...store.appStates['notes.app'], activeFilePath: null } }
        useUIStore.setState({ appStates: updated })
      }
    }
  }, [activeFilePath])

  const moveNote = useCallback(async (notePath: string, targetDir: string) => {
    const fileName = notePath.split('/').pop()!
    const newPath = `${targetDir}/${fileName}`
    if (notePath === newPath) return
    const res = await window.api.fs.rename(notePath, newPath)
    if (res.ok) {
      setRefreshCounter((c) => c + 1)
      if (notePath === activeFilePath) onFileClick(newPath)
    }
  }, [activeFilePath, onFileClick])

  // ── Submit inline input ──

  const handleInputSubmit = useCallback(async () => {
    if (!inlineInput) return
    const val = inputValue.trim()
    if (!val) { cancelInput(); return }
    switch (inlineInput.type) {
      case 'note':
        if (notesDir) await createNote(notesDir, val)
        break
      case 'group':
        await createGroup(val)
        break
      case 'noteInGroup':
        if (inlineInput.parentPath) await createNote(inlineInput.parentPath, val)
        break
      case 'rename':
        if (inlineInput.renamePath) await renameItem(inlineInput.renamePath, val, !!inlineInput.renameIsDir)
        break
    }
    cancelInput()
  }, [inlineInput, inputValue, notesDir, createNote, createGroup, renameItem, cancelInput])

  // ── Context menu builders ──

  const groupContextItems = useCallback((group: FileNode): ContextMenuItem[] => [
    { label: 'New Note', icon: <FilePlus size={14} />, onClick: async () => {
      if (!notesExpandedGroups.includes(group.path)) toggleNotesGroup(group.path)
      await createNote(group.path)
    } },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => showInput('rename', { renamePath: group.path, renameIsDir: true }) },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteItem(group.path) },
  ], [showInput, deleteItem])

  const noteContextItems = useCallback((note: FileNode): ContextMenuItem[] => {
    const moveToItems: ContextMenuItem[] = []
    const noteParent = note.path.substring(0, note.path.lastIndexOf('/'))
    // "Move to root" if inside a group
    if (notesDir && noteParent !== notesDir) {
      moveToItems.push({ label: 'Move to Root', icon: <FolderInput size={14} />, onClick: () => moveNote(note.path, notesDir) })
    }
    // Move to each group (except current parent)
    for (const g of groups) {
      if (g.path !== noteParent) {
        moveToItems.push({ label: `Move to ${g.name}`, icon: <FolderInput size={14} />, onClick: () => moveNote(note.path, g.path) })
      }
    }
    return [
      { label: 'Rename', icon: <Pencil size={14} />, onClick: () => showInput('rename', { renamePath: note.path, renameIsDir: false }) },
      ...(moveToItems.length > 0 ? [{ label: '', separator: true, onClick: () => {} } as ContextMenuItem, ...moveToItems] : []),
      { label: '', separator: true, onClick: () => {} },
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteItem(note.path) },
    ]
  }, [notesDir, groups, showInput, moveNote, deleteItem])

  // ── Drag handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, notePath: string) => {
    e.dataTransfer.setData('text/plain', notePath)
    e.dataTransfer.setData('application/x-lite-file', notePath)
    e.dataTransfer.effectAllowed = 'move'
    setDragNotePath(notePath)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragNotePath(null)
    setDropTargetPath(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, targetPath: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetPath(targetPath)
  }, [])

  const handleDragLeave = useCallback(() => setDropTargetPath(null), [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault()
    setDropTargetPath(null)
    setDragNotePath(null)

    // Handle external file drops
    if (e.dataTransfer.files.length > 0) {
      for (const file of Array.from(e.dataTransfer.files)) {
        if (file.name.endsWith('.md')) {
          // Read external file content and create copy
          const reader = new FileReader()
          reader.onload = async () => {
            const content = reader.result as string
            const filePath = `${targetDir}/${file.name}`
            await window.api.fs.createFile(filePath)
            await window.api.fs.writeFile(filePath, content)
            setRefreshCounter((c) => c + 1)
          }
          reader.readAsText(file)
        }
      }
      return
    }

    // Handle internal note move
    const sourcePath = e.dataTransfer.getData('text/plain')
    if (sourcePath) await moveNote(sourcePath, targetDir)
  }, [moveNote])

  // ── Inline input component ──

  const renderInput = (pl: number, icon: React.ReactNode) => (
    <div className={`pr-3 py-1 flex items-center gap-1.5`} style={{ paddingLeft: pl }}>
      <span className="text-tx-muted shrink-0">{icon}</span>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleInputSubmit() }
          if (e.key === 'Escape') cancelInput()
        }}
        onBlur={() => { if (inputValue.trim()) handleInputSubmit(); else cancelInput() }}
        placeholder={inlineInput?.type === 'group' ? 'group name...' : 'note name...'}
        className="flex-1 bg-transparent text-[13px] text-tx-main outline-none border-b border-border-strong placeholder-tx-muted py-0.5"
      />
    </div>
  )

  // ── Header actions ──

  const startCreating = useCallback(async () => {
    if (!liteHome || !notesDir) return
    if (!expanded) onHeaderClick()
    // Determine target dir: group of active file, or root
    let targetDir = notesDir
    if (activeFilePath) {
      const parentDir = activeFilePath.substring(0, activeFilePath.lastIndexOf('/'))
      if (parentDir !== notesDir && parentDir.startsWith(notesDir + '/')) {
        targetDir = parentDir
        if (!notesExpandedGroups.includes(parentDir)) toggleNotesGroup(parentDir)
      }
    }
    await createNote(targetDir)
  }, [liteHome, notesDir, expanded, onHeaderClick, activeFilePath, notesExpandedGroups, toggleNotesGroup, createNote])

  const startCreatingGroup = useCallback(() => {
    if (!liteHome) return
    if (!expanded) onHeaderClick()
    showInput('group')
  }, [liteHome, expanded, onHeaderClick, showInput])

  return (
    <>
      <AppSectionHeader
        appId="notes.app"
        icon={<FileText size={14} strokeWidth={2.5} />}
        currentApp={currentApp}
        expanded={expanded}
        onClick={onHeaderClick}
        actions={
          liteHome ? (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startCreatingGroup() }}
                className="p-0.5 rounded text-tx-muted hover:text-tx-main hover:bg-border-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
                aria-label="New group"
                title="New group"
              >
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startCreating() }}
                className="p-0.5 rounded text-tx-muted hover:text-tx-main hover:bg-border-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
                aria-label="New note"
                title="New note"
              >
                <Plus size={14} />
              </button>
            </>
          ) : undefined
        }
      />
      {expanded && (
        <div className="mb-3 mt-1">
          {!liteHome ? (
            <div className="pl-[20px] py-1 text-[13px] text-tx-faint">Loading...</div>
          ) : (
            <>
              {/* Top-level inline inputs */}
              {inlineInput && (inlineInput.type === 'note' || inlineInput.type === 'group') &&
                renderInput(20, inlineInput.type === 'group' ? <FolderPlus size={13} /> : <FileText size={13} />)
              }

              {/* Groups */}
              {groups.map((group) => {
                const isExpanded = notesExpandedGroups.includes(group.path)
                const notes = groupNotes[group.path] || []
                const isDropTarget = dropTargetPath === group.path
                const isBeingRenamed = inlineInput?.type === 'rename' && inlineInput.renamePath === group.path
                const isSelected = selectedGroup === group.path

                if (isBeingRenamed) return (
                  <React.Fragment key={group.path}>
                    {renderInput(20, <FolderPlus size={13} />)}
                  </React.Fragment>
                )

                return (
                  <React.Fragment key={group.path}>
                    <div
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-expanded={isExpanded}
                      onClick={() => { toggleNotesGroup(group.path); onGroupSelect(group.path) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNotesGroup(group.path); onGroupSelect(group.path) } }}
                      onContextMenu={(e) => openContextMenu(e, groupContextItems(group))}
                      onDragOver={(e) => handleDragOver(e, group.path)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, group.path)}
                      className={`pl-[20px] py-[4px] pr-4 flex items-center gap-1.5 cursor-pointer text-[13px] tracking-wide relative
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
                        ${isDropTarget ? 'bg-accent-main/10 outline outline-1 outline-accent-main/30' : isSelected ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
                    >
                      {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-tx-faint" />}
                      {isExpanded ? <ChevronDown size={13} className="shrink-0 text-tx-muted" /> : <ChevronRight size={13} className="shrink-0 text-tx-muted" />}
                      <FolderOpen size={13} className="shrink-0 text-tx-muted" />
                      <span className="text-tx-main truncate">{group.name}</span>
                      {notes.length > 0 && <span className="ml-auto text-[11px] text-tx-faint">{notes.length}</span>}
                    </div>

                    {isExpanded && (
                      <>
                        {/* Inline input inside group */}
                        {inlineInput && inlineInput.type === 'noteInGroup' && inlineInput.parentPath === group.path &&
                          renderInput(36, <FileText size={13} />)
                        }

                        {notes.map((note) => {
                          const isActive = note.path === activeFilePath
                          const isDragging = dragNotePath === note.path
                          const isNoteRenamed = inlineInput?.type === 'rename' && inlineInput.renamePath === note.path

                          if (isNoteRenamed) return renderInput(36, <FileText size={13} />)

                          return (
                            <div
                              key={note.path}
                              role="treeitem"
                              tabIndex={0}
                              aria-selected={isActive}
                              onClick={() => onFileClick(note.path)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFileClick(note.path) } }}
                              onContextMenu={(e) => openContextMenu(e, noteContextItems(note))}
                              draggable
                              onDragStart={(e) => handleDragStart(e, note.path)}
                              onDragEnd={handleDragEnd}
                              className={`pl-[36px] py-[4px] pr-4 flex items-center gap-1.5 cursor-pointer text-[13px] tracking-wide relative
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
                                ${isDragging ? 'opacity-40' : ''}
                                ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
                            >
                              {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
                              <FileText size={13} className={`${isActive ? 'text-tx-active' : 'text-tx-muted'} shrink-0`} />
                              <SplitName name={note.name} isActive={isActive} />
                              {automationFiles.has(note.path) && (
                                <span className="ml-auto shrink-0 text-status-warning/70" title="Has automation"><Zap size={10} /></span>
                              )}
                            </div>
                          )
                        })}
                      </>
                    )}
                  </React.Fragment>
                )
              })}

              {/* Root-level notes drop zone */}
              <div
                onDragOver={notesDir ? (e) => handleDragOver(e, notesDir) : undefined}
                onDragLeave={handleDragLeave}
                onDrop={notesDir ? (e) => handleDrop(e, notesDir) : undefined}
                className={dropTargetPath === notesDir && dragNotePath ? 'bg-accent-main/5 outline outline-1 outline-accent-main/20 rounded mx-2' : ''}
              >
                {rootNotes.map((note) => {
                  const isActive = note.path === activeFilePath
                  const isDragging = dragNotePath === note.path
                  const isNoteRenamed = inlineInput?.type === 'rename' && inlineInput.renamePath === note.path

                  if (isNoteRenamed) return (
                    <React.Fragment key={note.path}>
                      {renderInput(20, <FileText size={13} />)}
                    </React.Fragment>
                  )

                  return (
                    <div
                      key={note.path}
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={isActive}
                      onClick={() => onFileClick(note.path)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFileClick(note.path) } }}
                      onContextMenu={(e) => openContextMenu(e, noteContextItems(note))}
                      draggable
                      onDragStart={(e) => handleDragStart(e, note.path)}
                      onDragEnd={handleDragEnd}
                      className={`pl-[20px] py-[4px] pr-4 flex items-center gap-1.5 cursor-pointer text-[13px] tracking-wide relative
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
                        ${isDragging ? 'opacity-40' : ''}
                        ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
                    >
                      {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
                      <FileText size={13} className={`${isActive ? 'text-tx-active' : 'text-tx-muted'} shrink-0`} />
                      <SplitName name={note.name} isActive={isActive} />
                      {automationFiles.has(note.path) && (
                        <span className="ml-auto shrink-0 text-status-warning/70" title="Has automation"><Zap size={10} /></span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Empty state */}
              {groups.length === 0 && rootNotes.length === 0 && !inlineInput && (
                <button type="button" onClick={startCreating} className="w-full text-left pl-[20px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset">
                  New note...
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

// ── Code App Section ──

const CodeAppSection: React.FC<{
  currentApp: AppType
  expanded: boolean
  onHeaderClick: () => void
  codeProjectPath: string | null
}> = ({ currentApp, expanded, onHeaderClick, codeProjectPath }) => {
  const activeFilePath = useUIStore((s) => s.appStates['code.app'].activeFilePath)
  const expandedPaths = useUIStore((s) => s.appStates['code.app'].expandedPaths)
  const toggleExpandedPath = useUIStore((s) => s.toggleExpandedPath)
  const [rootNodes, setRootNodes] = useState<FileNode[]>([])
  const [refreshCounter, setRefreshCounter] = useState(0)

  useEffect(() => {
    if (!expanded || !codeProjectPath) {
      setRootNodes([])
      return
    }
    const projectName = codeProjectPath.split('/').pop() || 'project'
    setRootNodes([{ name: projectName, path: codeProjectPath, isDirectory: true }])
    // Auto-expand root
    const currentExpanded = useUIStore.getState().appStates['code.app'].expandedPaths
    if (!currentExpanded.includes(codeProjectPath)) {
      // We need to set it for code.app specifically
      const saved = useUIStore.getState().currentApp
      useUIStore.setState({ currentApp: 'code.app' })
      toggleExpandedPath(codeProjectPath)
      useUIStore.setState({ currentApp: saved })
    }
  }, [expanded, codeProjectPath])

  // File watcher for project
  useEffect(() => {
    if (!codeProjectPath) return
    const unsub = window.api.fs.onWatchEvent((event) => {
      if (event.path.startsWith(codeProjectPath)) {
        setRefreshCounter((c) => c + 1)
      }
    })
    return unsub
  }, [codeProjectPath])

  const handleOpenFolder = useCallback(async () => {
    const res = await window.api.project.open()
    if (res.ok) {
      useUIStore.getState().addRecentProject(res.data)
    }
  }, [])

  const handleFileClick = useCallback((path: string) => {
    useUIStore.getState().setCurrentApp('code.app')
    useUIStore.getState().setActiveFilePath(path)
  }, [])

  const handleToggleDir = useCallback((path: string) => {
    // Toggle for code.app specifically
    const store = useUIStore.getState()
    const current = store.appStates['code.app'].expandedPaths
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path]
    const updated = {
      ...store.appStates,
      'code.app': { ...store.appStates['code.app'], expandedPaths: next },
    }
    useUIStore.setState({ appStates: updated })
  }, [])

  return (
    <>
      <AppSectionHeader
        appId="code.app"
        icon={<LayoutTemplate size={14} strokeWidth={2.5} />}
        currentApp={currentApp}
        expanded={expanded}
        onClick={onHeaderClick}
      />
      {expanded && (
        <div className="mb-3 mt-1">
          {!codeProjectPath ? (
            <button type="button" onClick={handleOpenFolder} className="w-full text-left pl-[20px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset">
              Open a folder...
            </button>
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
                onToggleDir={handleToggleDir}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

// ── Terminal App Section ──

const TerminalAppSection: React.FC<{
  currentApp: AppType
  expanded: boolean
  onHeaderClick: () => void
  renameTrigger: number
  onFocusSidebar?: () => void
}> = ({ currentApp, expanded, onHeaderClick, renameTrigger, onFocusSidebar }) => {
  const sessions = useUIStore((s) => s.terminalSessions)
  const activeTerminalId = useUIStore((s) => s.activeTerminalId)
  const addSession = useUIStore((s) => s.addTerminalSession)
  const removeSession = useUIStore((s) => s.removeTerminalSession)
  const setActiveId = useUIStore((s) => s.setActiveTerminalId)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const setCurrentApp = useUIStore((s) => s.setCurrentApp)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Enter key rename trigger
  useEffect(() => {
    if (renameTrigger === 0 || currentApp !== 'terminal.app' || !activeTerminalId || renamingId) return
    const session = sessions.find((s) => s.id === activeTerminalId)
    if (session) {
      setRenamingId(session.id)
      setRenameValue(session.title)
      setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 50)
    }
  }, [renameTrigger])

  const handleRenameSubmit = useCallback(() => {
    if (!renamingId) return
    const val = renameValue.trim()
    if (val) {
      const next = useUIStore.getState().terminalSessions.map((t) => t.id === renamingId ? { ...t, title: val } : t)
      useUIStore.setState({ terminalSessions: next })
      window.api.state.update({ terminalSessions: next.map((t) => ({ title: t.title })) })
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue])

  const handleCreate = useCallback(async () => {
    const cwd = codeProjectPath ?? undefined
    const res = await window.api.terminal.create(cwd)
    if (res.ok) {
      addSession({ id: res.data, title: `Terminal ${sessions.length + 1}`, cwd: cwd })
      setCurrentApp('terminal.app')
    }
  }, [codeProjectPath, sessions.length, addSession, setCurrentApp])

  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    window.api.terminal.close(id)
    removeSession(id)
  }, [removeSession])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
    setCurrentApp('terminal.app')
    onFocusSidebar?.()
  }, [setActiveId, setCurrentApp, onFocusSidebar])

  return (
    <>
      <AppSectionHeader
        appId="terminal.app"
        icon={<Terminal size={14} strokeWidth={2.5} />}
        currentApp={currentApp}
        expanded={expanded}
        onClick={onHeaderClick}
        actions={
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!expanded) onHeaderClick(); handleCreate() }}
            className="p-0.5 rounded text-tx-muted hover:text-tx-main hover:bg-border-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
            aria-label="New terminal"
            title="New terminal"
          >
            <Plus size={14} />
          </button>
        }
      />
      {expanded && (
        <div className="mb-3 mt-1">
          {sessions.length === 0 ? (
            <button type="button" onClick={handleCreate} className="w-full text-left pl-[20px] py-1 text-[13px] text-tx-faint hover:text-tx-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset">
              New terminal...
            </button>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeTerminalId && currentApp === 'terminal.app'
              const isRenaming = renamingId === session.id
              return (
                <div
                  key={session.id}
                  role="treeitem"
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => handleSelect(session.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(session.id) } }}
                  className={`pl-[20px] py-[4px] pr-4 flex items-center gap-1.5 cursor-pointer text-[13px] tracking-wide relative group
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
                    ${isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
                >
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-border-strong" />}
                  <Terminal size={13} className={`${isActive ? 'text-tx-active' : 'text-tx-muted'} shrink-0`} />
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit() }
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
                      }}
                      onBlur={() => { if (renameValue.trim()) handleRenameSubmit(); else { setRenamingId(null); setRenameValue('') } }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent text-[13px] text-tx-main outline-none border-b border-border-strong py-0.5"
                    />
                  ) : (
                    <span className={`truncate ${isActive ? 'text-tx-active font-medium' : 'text-tx-main'}`}>{session.title}</span>
                  )}
                  {!isRenaming && (
                    <button
                      onClick={(e) => handleClose(e, session.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-tx-faint hover:text-tx-main transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </>
  )
}

// ── Collector App Section ──

const COLLECTOR_ITEM_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  link: Link, image: Image, video: Video, tweet: Twitter, screenshot: Monitor, text: Type,
}

const CollectorAppSection: React.FC<{
  currentApp: AppType
  expanded: boolean
  onHeaderClick: () => void
}> = ({ currentApp, expanded, onHeaderClick }) => {
  const activeFilter = useUIStore((s) => s.appStates['collector.app'].activeFilePath) || 'all'
  const [items, setItems] = useState<CollectedItem[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const groupInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const openContextMenu = useContextMenu()

  const loadData = useCallback(() => {
    Promise.all([
      window.api.collector.list(),
      window.api.collector.groups(),
    ]).then(([itemsRes, groupsRes]) => {
      if (itemsRes.ok) setItems(itemsRes.data)
      if (groupsRes.ok) setGroups(groupsRes.data)
    })
  }, [])

  useEffect(() => {
    if (!expanded) return
    loadData()
  }, [expanded, loadData])

  // Items by group
  const ungroupedItems = items.filter((i) => !i.group || i.group === 'all')
  const itemsByGroup: Record<string, CollectedItem[]> = {}
  for (const g of groups) itemsByGroup[g] = []
  for (const item of items) {
    if (item.group && item.group !== 'all' && itemsByGroup[item.group]) {
      itemsByGroup[item.group].push(item)
    }
  }

  const setActiveItem = useCallback((filter: string) => {
    useUIStore.getState().setCurrentApp('collector.app')
    const store = useUIStore.getState()
    useUIStore.setState({
      appStates: { ...store.appStates, 'collector.app': { ...store.appStates['collector.app'], activeFilePath: filter } },
    })
  }, [])

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group])
  }, [])

  const startCreatingGroup = useCallback(() => {
    setCreatingGroup(true)
    setGroupName('')
    setTimeout(() => groupInputRef.current?.focus(), 50)
  }, [])

  const handleGroupSubmit = useCallback(async () => {
    const name = groupName.trim()
    if (!name) { setCreatingGroup(false); return }
    setCreatingGroup(false)
    setGroupName('')
    const res = await window.api.collector.addGroup(name)
    if (res.ok) setGroups(res.data)
    setExpandedGroups((prev) => [...prev, name])
    setActiveItem(name)
  }, [groupName, setActiveItem])

  // Drag & drop: move item to group (works from sidebar items AND main grid cards)
  const handleDragOver = useCallback((e: React.DragEvent, group: string) => {
    if (!e.dataTransfer.types.includes('application/x-collector-item')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(group)
  }, [])

  const handleDragLeave = useCallback(() => setDropTarget(null), [])

  const handleDrop = useCallback(async (e: React.DragEvent, group: string) => {
    e.preventDefault()
    setDropTarget(null)
    const itemId = e.dataTransfer.getData('application/x-collector-item')
    if (!itemId) return
    await window.api.collector.update(itemId, { group })
    loadData()
  }, [loadData])

  // Context menu for groups
  const startRenameGroup = useCallback((group: string) => {
    setRenamingGroup(group)
    setRenameValue(group)
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 50)
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingGroup) return
    const newName = renameValue.trim()
    if (!newName || newName === renamingGroup) { setRenamingGroup(null); return }
    const res = await window.api.collector.renameGroup(renamingGroup, newName)
    if (res.ok) {
      setGroups(res.data)
      if (activeFilter === renamingGroup) setActiveItem(newName)
      loadData()
    }
    setRenamingGroup(null)
  }, [renamingGroup, renameValue, activeFilter, setActiveItem, loadData])

  const groupContextItems = useCallback((group: string): ContextMenuItem[] => [
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => startRenameGroup(group) },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Delete Group', icon: <Trash2 size={14} />, danger: true, onClick: async () => {
      const res = await window.api.collector.deleteGroup(group)
      if (res.ok) {
        setGroups(res.data)
        if (activeFilter === group) setActiveItem('all')
        loadData()
      }
    } },
  ], [activeFilter, setActiveItem, loadData, startRenameGroup])

  const isActive = (filter: string) => currentApp === 'collector.app' && activeFilter === filter

  // Render a single collected item row in sidebar
  const renderItem = (item: CollectedItem) => {
    const selected = selectedItemId === item.id
    const ItemIcon = COLLECTOR_ITEM_ICONS[item.type] || Link
    return (
      <div
        key={item.id}
        role="treeitem"
        tabIndex={0}
        aria-selected={selected}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-collector-item', item.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={(e) => { e.stopPropagation(); setSelectedItemId(selected ? null : item.id) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItemId(selected ? null : item.id) } }}
        className={`pl-[40px] py-[3px] pr-4 flex items-center gap-2 text-[12px] cursor-grab active:cursor-grabbing
          hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
          ${selected ? 'bg-bg-active' : ''}`}
      >
        <ItemIcon size={12} className={`shrink-0 ${selected ? 'text-tx-active' : 'text-tx-faint'}`} />
        <span className={`truncate ${selected ? 'text-tx-active font-medium' : 'text-tx-muted'}`}>
          {item.title}
        </span>
      </div>
    )
  }

  return (
    <>
      <AppSectionHeader
        appId="collector.app"
        icon={<Archive size={14} strokeWidth={2.5} />}
        currentApp={currentApp}
        expanded={expanded}
        onClick={onHeaderClick}
        actions={
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!expanded) onHeaderClick(); startCreatingGroup() }}
            className="p-0.5 rounded text-tx-muted hover:text-tx-main hover:bg-border-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
            aria-label="New group"
            title="New group"
          >
            <FolderPlus size={14} />
          </button>
        }
      />
      {expanded && (
        <div className="mb-3 mt-1">
          {/* All */}
          <button
            type="button"
            onClick={() => setActiveItem('all')}
            onDragOver={(e) => handleDragOver(e, 'all')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'all')}
            className={`w-full text-left pl-[28px] py-[3px] pr-4 flex items-center gap-2 text-[12px] hover:bg-bg-hover
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
              ${isActive('all') ? 'bg-bg-active' : ''} ${dropTarget === 'all' ? 'bg-accent-main/10' : ''}`}
          >
            <Layers size={12} className={isActive('all') ? 'text-tx-active' : 'text-tx-faint'} />
            <span className={isActive('all') ? 'text-tx-active font-medium' : 'text-tx-muted'}>All</span>
            <span className="text-tx-faint text-[10px] ml-auto">{items.length}</span>
          </button>

          {/* Groups with expandable items */}
          {groups.map((group) => {
            const active = isActive(group)
            const isDrop = dropTarget === group
            const isExpanded = expandedGroups.includes(group)
            const groupItems = itemsByGroup[group] || []

            return (
              <React.Fragment key={group}>
                <div
                  role="treeitem"
                  tabIndex={0}
                  aria-selected={active}
                  aria-expanded={isExpanded}
                  onClick={() => { toggleGroup(group); setActiveItem(group) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group); setActiveItem(group) } }}
                  onContextMenu={(e) => openContextMenu(e, groupContextItems(group))}
                  onDragOver={(e) => handleDragOver(e, group)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, group)}
                  className={`w-full text-left pl-[28px] py-[3px] pr-4 flex items-center gap-1.5 text-[12px] cursor-pointer
                    hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 focus-visible:ring-inset
                    ${active ? 'bg-bg-active' : ''} ${isDrop ? 'bg-accent-main/10 outline outline-1 outline-accent-main/30' : ''}`}
                >
                  {isExpanded
                    ? <ChevronDown size={12} className="shrink-0 text-tx-faint" />
                    : <ChevronRight size={12} className="shrink-0 text-tx-faint" />
                  }
                  <FolderOpen size={12} className={`shrink-0 ${active ? 'text-tx-active' : isDrop ? 'text-accent-main' : 'text-tx-faint'}`} />
                  {renamingGroup === group ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit() }
                        if (e.key === 'Escape') setRenamingGroup(null)
                      }}
                      onBlur={() => { if (renameValue.trim()) handleRenameSubmit(); else setRenamingGroup(null) }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent text-[12px] text-tx-main outline-none border-b border-border-strong py-0.5 min-w-0"
                    />
                  ) : (
                    <>
                      <span className={`truncate ${active ? 'text-tx-active font-medium' : isDrop ? 'text-accent-main' : 'text-tx-muted'}`}>{group}</span>
                      {groupItems.length > 0 && <span className="text-tx-faint text-[10px] ml-auto">{groupItems.length}</span>}
                    </>
                  )}
                </div>
                {/* Expanded: show items under group */}
                {isExpanded && groupItems.map(renderItem)}
              </React.Fragment>
            )
          })}

          {/* Ungrouped items under All */}
          {ungroupedItems.map(renderItem)}

          {/* Create group inline input */}
          {creatingGroup && (
            <div className="pl-[28px] pr-3 py-1 flex items-center gap-2">
              <FolderPlus size={12} className="text-tx-muted shrink-0" />
              <input
                ref={groupInputRef}
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleGroupSubmit() }
                  if (e.key === 'Escape') { setCreatingGroup(false); setGroupName('') }
                }}
                onBlur={() => { if (groupName.trim()) handleGroupSubmit(); else { setCreatingGroup(false); setGroupName('') } }}
                placeholder="group name..."
                className="flex-1 bg-transparent text-[12px] text-tx-main outline-none border-b border-border-strong placeholder-tx-faint py-0.5"
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Sidebar ──

export const Sidebar: React.FC = () => {
  const currentApp = useUIStore((s) => s.currentApp)
  const setCurrentApp = useUIStore((s) => s.setCurrentApp)
  const liteHome = useUIStore((s) => s.liteHome)
  const codeProjectPath = useUIStore((s) => s.codeProjectPath)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  // Self-heal liteHome if lost (e.g. HMR store reset)
  useEffect(() => {
    if (!liteHome) {
      window.api.lite.getHome().then((res) => {
        if (res.ok) useUIStore.getState().setLiteHome(res.data)
      })
    }
  }, [liteHome])

  const [expandedSections, setExpandedSections] = useState<string[]>(['notes.app'])
  const [renameTrigger, setRenameTrigger] = useState(0)
  const [notesSelectedGroup, setNotesSelectedGroup] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; name: string } | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return
    const res = await window.api.fs.delete(confirmDelete.path)
    if (res.ok) {
      setNotesSelectedGroup(null)
      const store = useUIStore.getState()
      const active = store.appStates['notes.app'].activeFilePath
      if (active && active.startsWith(confirmDelete.path + '/')) {
        useUIStore.setState({
          appStates: { ...store.appStates, 'notes.app': { ...store.appStates['notes.app'], activeFilePath: null } },
        })
      }
    }
    setConfirmDelete(null)
    sidebarRef.current?.focus()
  }, [confirmDelete])

  const handleSidebarKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    // Enter → confirm delete dialog if open, otherwise rename
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      if (confirmDelete) {
        handleConfirmDelete()
        return
      }
      setRenameTrigger((c) => c + 1)
    }

    // Escape → close confirm dialog
    if (e.key === 'Escape' && confirmDelete) {
      e.preventDefault()
      setConfirmDelete(null)
      return
    }

    // Cmd+Delete / Cmd+Backspace → delete active item
    if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const store = useUIStore.getState()
      const app = store.currentApp
      if (app === 'notes.app') {
        // Group selected → confirm delete
        if (notesSelectedGroup) {
          const name = notesSelectedGroup.split('/').pop() || ''
          setConfirmDelete({ path: notesSelectedGroup, name })
          return
        }
        // File selected → delete directly
        const filePath = store.appStates['notes.app'].activeFilePath
        if (filePath) window.api.fs.delete(filePath).then((res) => {
          if (res.ok) {
            useUIStore.setState({
              appStates: { ...store.appStates, 'notes.app': { ...store.appStates['notes.app'], activeFilePath: null } },
            })
          }
        })
      } else if (app === 'terminal.app') {
        const id = store.activeTerminalId
        if (id) {
          window.api.terminal.close(id)
          store.removeTerminalSession(id)
        }
      }
    }
  }, [confirmDelete, handleConfirmDelete, notesSelectedGroup])

  const handleAppClick = (appId: AppType) => {
    setCurrentApp(appId)
    setExpandedSections((prev) =>
      prev.includes(appId) ? prev.filter((s) => s !== appId) : [...prev, appId]
    )
    sidebarRef.current?.focus()
  }

  const handleNoteFileClick = useCallback((path: string) => {
    useUIStore.getState().setCurrentApp('notes.app')
    useUIStore.getState().setActiveFilePath(path)
    setNotesSelectedGroup(null)
    sidebarRef.current?.focus()
  }, [])

  return (
    <div
      ref={sidebarRef}
      tabIndex={-1}
      onKeyDown={handleSidebarKeyDown}
      className="w-full flex flex-col bg-bg-app text-[14px] overflow-hidden outline-none"
    >
      {/* Top drag area for macOS */}
      <div className="h-8 w-full shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* App Sections */}
      <div className="flex-1 overflow-y-auto pb-4 pt-2">
        {/* notes.app */}
        <NotesAppSection
          currentApp={currentApp}
          expanded={expandedSections.includes('notes.app')}
          onHeaderClick={() => handleAppClick('notes.app')}
          liteHome={liteHome}
          onFileClick={handleNoteFileClick}
          renameTrigger={renameTrigger}
          selectedGroup={notesSelectedGroup}
          onGroupSelect={setNotesSelectedGroup}
        />

        {/* code.app */}
        <CodeAppSection
          currentApp={currentApp}
          expanded={expandedSections.includes('code.app')}
          onHeaderClick={() => handleAppClick('code.app')}
          codeProjectPath={codeProjectPath}
        />

        {/* collector.app */}
        <CollectorAppSection
          currentApp={currentApp}
          expanded={expandedSections.includes('collector.app')}
          onHeaderClick={() => handleAppClick('collector.app')}
        />

        {/* browser.app */}
        <AppSectionHeader
          appId="browser.app"
          icon={<Chrome size={14} strokeWidth={2.5} />}
          currentApp={currentApp}
          expanded={expandedSections.includes('browser.app')}
          onClick={() => handleAppClick('browser.app')}
        />

        {/* terminal.app */}
        <TerminalAppSection
          currentApp={currentApp}
          expanded={expandedSections.includes('terminal.app')}
          onHeaderClick={() => handleAppClick('terminal.app')}
          renameTrigger={renameTrigger}
          onFocusSidebar={() => sidebarRef.current?.focus()}
        />
      </div>

      {/* Bottom Actions */}
      <div className="shrink-0 p-3 flex justify-between items-center border-t border-border-subtle">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md hover:bg-bg-hover text-tx-faint hover:text-tx-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={() => setCurrentApp('settings.app')}
          className={`p-1.5 rounded-md hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-main/50 ${
            currentApp === 'settings.app' ? 'text-tx-active' : 'text-tx-faint hover:text-tx-main'
          }`}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* Delete confirmation — portal to app root */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50">
          <div className="p-5 bg-bg-sidebar border border-border-subtle rounded-xl shadow-2xl w-[320px]">
            <p className="text-[14px] text-tx-main font-medium mb-2">Delete folder?</p>
            <p className="text-[13px] text-tx-muted mb-5 leading-relaxed">
              <span className="font-medium text-tx-main">{confirmDelete.name}</span> and all its contents will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConfirmDelete(null); sidebarRef.current?.focus() }}
                className="px-4 py-1.5 text-[13px] text-tx-muted rounded-md hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 text-[13px] text-status-error bg-status-error/10 rounded-md hover:bg-status-error/20 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
