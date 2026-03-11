import fs from 'fs'
import path from 'path'

export interface SearchMatch {
  filePath: string
  fileName: string
  line: number
  content: string
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss',
  '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.zsh', '.py', '.rb', '.go', '.rs', '.java', '.c',
  '.cpp', '.h', '.hpp', '.swift', '.kt', '.vue', '.svelte', '.astro',
  '.env', '.gitignore', '.editorconfig', '.prettierrc',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache',
  '.turbo', '.vscode', '.idea', '__pycache__', '.DS_Store',
])

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  // No extension — check if it's small enough to be a text file
  if (!ext) {
    try {
      const stat = fs.statSync(filePath)
      return stat.size < 100_000
    } catch {
      return false
    }
  }
  return false
}

function collectFiles(dir: string, files: string[], limit: number): void {
  if (files.length >= limit) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (files.length >= limit) return
    if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, files, limit)
    } else if (entry.isFile() && isTextFile(full)) {
      files.push(full)
    }
  }
}

export function searchFilesContent(
  query: string,
  dirs: string[],
  maxResults: number,
): SearchMatch[] {
  if (!query || query.length < 2) return []

  const lowerQuery = query.toLowerCase()
  const results: SearchMatch[] = []

  // Collect all searchable files
  const files: string[] = []
  for (const dir of dirs) {
    collectFiles(dir, files, 5000)
  }

  for (const filePath of files) {
    if (results.length >= maxResults) break
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      // Skip binary-looking files
      if (content.includes('\0')) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            filePath,
            fileName: path.basename(filePath),
            line: i + 1,
            content: lines[i].trim().slice(0, 200),
          })
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results
}
