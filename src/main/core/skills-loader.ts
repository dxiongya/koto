/**
 * Skills Loader
 * Scans {liteHome}/skills/*.md, parses frontmatter, returns skill definitions.
 */
import fs from 'fs'
import path from 'path'
import { getLiteHome } from './lite-home'
import type { Skill } from '../../shared/types'

/** Parse a skill markdown file with YAML-like frontmatter */
function parseSkillFile(filePath: string): Skill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')

    // Extract frontmatter between --- delimiters
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!fmMatch) {
      // No frontmatter — use filename as name
      const name = path.basename(filePath, '.md')
      return {
        name,
        description: '',
        content: raw.trim(),
        enabled: true,
        filePath,
      }
    }

    const frontmatter = fmMatch[1]
    const content = fmMatch[2].trim()

    // Simple YAML parsing for our known fields
    const getValue = (key: string): string => {
      const re = new RegExp(`^${key}:\\s*(.+)$`, 'm')
      return re.exec(frontmatter)?.[1]?.trim() || ''
    }

    const name = getValue('name') || path.basename(filePath, '.md')
    const description = getValue('description')
    const enabledStr = getValue('enabled')
    const enabled = enabledStr === '' || enabledStr === 'true'

    return { name, description, content, enabled, filePath }
  } catch {
    return null
  }
}

/** Load all skills from {liteHome}/skills/ */
export function loadSkills(): Skill[] {
  const home = getLiteHome()
  if (!home) return []

  const skillsDir = path.join(home, 'skills')
  if (!fs.existsSync(skillsDir)) return []

  try {
    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.md'))
    const skills: Skill[] = []

    for (const file of files) {
      const skill = parseSkillFile(path.join(skillsDir, file))
      if (skill) skills.push(skill)
    }

    return skills
  } catch {
    return []
  }
}

/** Toggle a skill's enabled state by rewriting its frontmatter */
export function toggleSkill(name: string, enabled: boolean): boolean {
  const skills = loadSkills()
  const skill = skills.find((s) => s.name === name)
  if (!skill) return false

  try {
    const raw = fs.readFileSync(skill.filePath, 'utf-8')
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)

    if (fmMatch) {
      let frontmatter = fmMatch[1]
      const body = fmMatch[2]

      if (/^enabled:/m.test(frontmatter)) {
        frontmatter = frontmatter.replace(/^enabled:\s*.+$/m, `enabled: ${enabled}`)
      } else {
        frontmatter += `\nenabled: ${enabled}`
      }

      fs.writeFileSync(skill.filePath, `---\n${frontmatter}\n---\n${body}`, 'utf-8')
    }

    return true
  } catch {
    return false
  }
}

/** Create a new skill from provided data */
export function createSkill(name: string, description: string, content: string): boolean {
  const home = getLiteHome()
  if (!home) return false

  const skillsDir = path.join(home, 'skills')
  fs.mkdirSync(skillsDir, { recursive: true })

  // Sanitize filename
  const filename = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-') + '.md'
  const filePath = path.join(skillsDir, filename)

  const fileContent = `---\nname: ${name}\ndescription: ${description}\nenabled: true\n---\n\n${content.trim()}\n`
  fs.writeFileSync(filePath, fileContent, 'utf-8')
  return true
}

/** Delete a skill by name */
export function deleteSkill(name: string): boolean {
  const skills = loadSkills()
  const skill = skills.find((s) => s.name === name)
  if (!skill) return false

  try {
    fs.unlinkSync(skill.filePath)
    return true
  } catch {
    return false
  }
}

/** Import a skill from a URL (fetches raw markdown) */
export async function importSkillFromUrl(url: string): Promise<{ ok: true; data: Skill } | { ok: false; error: string }> {
  const home = getLiteHome()
  if (!home) return { ok: false, error: 'Lite Home not initialized' }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiteBot/1.0)', Accept: 'text/plain, text/markdown, */*' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }

    const text = await response.text()
    if (!text.trim()) return { ok: false, error: 'Empty response' }

    // Try to parse as skill with frontmatter
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    let name: string
    let description = ''
    let content: string

    if (fmMatch) {
      const fm = fmMatch[1]
      content = fmMatch[2].trim()
      const getVal = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm)?.[1]?.trim() || ''
      name = getVal('name') || new URL(url).pathname.split('/').pop()?.replace(/\.md$/, '') || 'imported-skill'
      description = getVal('description')
    } else {
      // Plain markdown — derive name from URL
      name = new URL(url).pathname.split('/').pop()?.replace(/\.md$/, '') || 'imported-skill'
      content = text.trim()
    }

    const skillsDir = path.join(home, 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    const filename = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-') + '.md'
    const filePath = path.join(skillsDir, filename)

    // Write with source URL in frontmatter
    const fileContent = `---\nname: ${name}\ndescription: ${description}\nenabled: true\nsource: ${url}\n---\n\n${content}\n`
    fs.writeFileSync(filePath, fileContent, 'utf-8')

    return { ok: true, data: { name, description, content, enabled: true, filePath } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Build a system prompt fragment from enabled skills */
export function buildSkillsPrompt(skills: Skill[]): string {
  const enabled = skills.filter((s) => s.enabled)
  if (enabled.length === 0) return ''

  return '\n\n## Active Skills\n' +
    enabled.map((s) => `### ${s.name}\n${s.content}`).join('\n\n')
}
