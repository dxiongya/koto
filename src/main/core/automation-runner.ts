/**
 * Automation Runner — extracts target content, calls AI, writes result back
 * Includes self-learning: successful runs are stored as experience for future runs.
 */
import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import { aiChat } from './ai-service'
import { appendSnapshot, readSnapshots } from './automation-snapshots'
import { updateRunStatus } from './automation-store'
import { getLiteHome } from './lite-home'
import { mcpManager } from './mcp-manager'
import { IpcChannels } from '../../shared/types'
import type { Automation, AutomationRunEvent, AutomationSnapshot } from '../../shared/types'

// ── Per-file write lock to prevent concurrent writes ──

const fileLocks = new Map<string, Promise<void>>()

function withFileLock(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  fileLocks.set(filePath, next)
  return next
}

// ── Push events to renderer ──

function emitRunEvent(event: AutomationRunEvent): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    win.webContents.send(IpcChannels.AUTOMATION_RUN_EVENT, event)
  }
}

// ── Self-learning: experience store ──

export interface AutomationToolCall {
  name: string
  input: Record<string, unknown>
  output: string       // truncated result
  durationMs: number
}

export interface AutomationExperience {
  automationId: string
  timestamp: number
  prompt: string
  toolCalls: AutomationToolCall[]   // full chain of tool calls in order
  toolsUsed: string[]               // unique tool names (quick reference)
  workflow: string                  // concise workflow summary (AI-readable recipe)
  contentBefore: string
  contentAfter: string
  runCount: number                  // how many successful runs contributed
}

function experiencePath(automationId: string): string {
  return path.join(getLiteHome(), 'automations', 'learnings', `${automationId}.json`)
}

export function loadExperience(automationId: string): AutomationExperience | null {
  try {
    const fp = experiencePath(automationId)
    if (!fs.existsSync(fp)) return null
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Build a concise, annotated workflow summary from tool calls.
 * This is the "recipe" that future runs follow — captures the pattern
 * (which tools, key params, notes) without actual data values.
 */
function buildWorkflow(toolCalls: AutomationToolCall[], prompt: string): string {
  if (toolCalls.length === 0) return 'Direct generation — no tool calls needed.'

  const steps: string[] = []
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    // Summarize input: key names + short identifier values (not data)
    const paramParts = Object.entries(tc.input).slice(0, 4).map(([k, v]) => {
      const vs = String(v)
      return vs.length > 50 ? k : `${k}=${vs}`
    })
    const paramStr = paramParts.length > 0 ? `(${paramParts.join(', ')})` : '()'

    // Auto-annotate based on position and tool name
    let note = ''
    if (i === 0 && tc.name.toLowerCase().includes('search')) {
      note = ' // initial lookup'
    } else if (i > 0 && toolCalls[i - 1].name.toLowerCase().includes('search')) {
      note = ' // fetch with ID from previous step'
    }

    steps.push(`${i + 1}. ${tc.name}${paramStr}${note}`)
  }

  return steps.join('\n')
}

/**
 * Check whether the tool call chain has meaningfully changed
 * compared to the previous experience. If unchanged, no need to overwrite.
 */
function workflowChanged(prev: AutomationExperience, toolCalls: AutomationToolCall[]): boolean {
  // Different number of tool calls
  if (!prev.toolCalls || prev.toolCalls.length !== toolCalls.length) return true
  // Different tool names or order
  for (let i = 0; i < toolCalls.length; i++) {
    if (prev.toolCalls[i].name !== toolCalls[i].name) return true
  }
  return false
}

// ── Fake data detection patterns ──

const FAKE_DATA_PATTERNS = [
  /示例/,        // "示例推文内容"
  /模拟/,        // "模拟数据"
  /placeholder/i,
  /example\s*(content|data|text|tweet|post)/i,
  /sample\s*(content|data|text)/i,
  /test\s*(content|data|text)/i,
  /lorem\s*ipsum/i,
  /fake\s*(data|content)/i,
  /dummy/i,
  /以上内容为.*示例/,        // "以上内容为模拟示例"
  /以.*真实数据为准/,        // "以最新拉取的真实数据为准"
  /请注意.*实际/,           // "请注意，实际..."
]

/**
 * Detect whether AI output contains fake/placeholder/simulated data.
 * Returns the matched pattern description if fake, or null if looks real.
 */
function detectFakeData(content: string): string | null {
  for (const pattern of FAKE_DATA_PATTERNS) {
    if (pattern.test(content)) {
      return `Content matches fake data pattern: ${pattern.source}`
    }
  }

  // For tables: check if data rows are suspiciously repetitive/sequential
  const lines = content.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length > 4) {
    // Skip header + separator (first 2 lines)
    const dataLines = lines.slice(2)
    // Check if cells are too uniform (e.g. "推文内容1", "推文内容2", ...)
    const numberedCellPattern = /[\u4e00-\u9fff]+\d+/  // Chinese + number like 推文内容1
    let numberedCount = 0
    for (const line of dataLines) {
      if (numberedCellPattern.test(line)) numberedCount++
    }
    if (numberedCount > dataLines.length * 0.5) {
      return 'Table data appears to be numbered placeholders (e.g. 推文内容1, 推文内容2...)'
    }

    // Check if numeric columns are all zeros — sign of fabricated data
    let zeroRowCount = 0
    for (const line of dataLines) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c)
      const numericCells = cells.filter(c => /^\d[\d,]*$/.test(c))
      if (numericCells.length >= 3 && numericCells.every(c => c === '0')) {
        zeroRowCount++
      }
    }
    if (zeroRowCount > dataLines.length * 0.5) {
      return 'Table has mostly zero-value numeric columns — likely fabricated data'
    }
  }

  return null
}

/**
 * Validate experience is worth saving:
 * - Must have used tools
 * - Content must not contain fake data
 */
function isValidExperience(toolCalls: AutomationToolCall[], contentAfter: string): boolean {
  if (toolCalls.length === 0) return false
  if (contentAfter.trim().length < 20) return false
  if (detectFakeData(contentAfter)) return false
  return true
}

function saveExperience(
  prev: AutomationExperience | null,
  exp: Omit<AutomationExperience, 'runCount' | 'workflow'>
): void {
  try {
    // Skip if experience is not valid (no tools used, too short, etc.)
    if (!isValidExperience(exp.toolCalls, exp.contentAfter)) return

    // If we already have a valid experience and the workflow hasn't changed,
    // just bump runCount — don't overwrite the workflow text
    if (prev?.workflow && !workflowChanged(prev, exp.toolCalls)) {
      const updated = { ...prev, runCount: prev.runCount + 1, timestamp: exp.timestamp }
      const dir = path.join(getLiteHome(), 'automations', 'learnings')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(experiencePath(exp.automationId), JSON.stringify(updated, null, 2), 'utf-8')
      return
    }

    // New or changed workflow — build fresh summary
    const dir = path.join(getLiteHome(), 'automations', 'learnings')
    fs.mkdirSync(dir, { recursive: true })

    const full: AutomationExperience = {
      ...exp,
      workflow: buildWorkflow(exp.toolCalls, exp.prompt),
      runCount: (prev?.runCount ?? 0) + 1,
    }
    fs.writeFileSync(experiencePath(exp.automationId), JSON.stringify(full, null, 2), 'utf-8')
  } catch {
    // Ignore save errors
  }
}

// ── Content extraction ──

interface ContentRange {
  start: number
  end: number
  content: string
}

/** Extract a heading section (## Title → next same-level heading or EOF) */
function extractSection(markdown: string, heading: string): ContentRange | null {
  const lines = markdown.split('\n')
  const normalizedHeading = heading.trim().replace(/^#+\s*/, '')

  let sectionStart = -1
  let sectionLevel = 0
  let startOffset = 0

  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      if (text === normalizedHeading && sectionStart === -1) {
        sectionStart = i
        sectionLevel = level
        startOffset = offset
      } else if (sectionStart !== -1 && level <= sectionLevel) {
        return {
          start: startOffset,
          end: offset,
          content: markdown.slice(startOffset, offset),
        }
      }
    }
    offset += line.length + 1
  }

  if (sectionStart !== -1) {
    return {
      start: startOffset,
      end: markdown.length,
      content: markdown.slice(startOffset),
    }
  }

  return null
}

/** Extract a markdown table by matching its header row */
function extractTable(markdown: string, identifier: string): ContentRange | null {
  const targetHeaders = identifier.split('|').map((h) => h.trim().toLowerCase())
  const lines = markdown.split('\n')

  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim().toLowerCase())

      const matches = targetHeaders.every((th) => cells.some((c) => c.includes(th)))
      if (matches) {
        const tableStart = offset
        let j = i
        while (j < lines.length) {
          const tl = lines[j].trim()
          if (tl === '' && j > i) break
          if (!tl.startsWith('|') && j > i) break
          j++
        }
        let endOffset = offset
        for (let k = i; k < j; k++) {
          endOffset += lines[k].length + 1
        }
        return {
          start: tableStart,
          end: endOffset,
          content: lines.slice(i, j).join('\n'),
        }
      }
    }
    offset += lines[i].length + 1
  }

  return null
}

/** Extract content based on automation target type */
function extractTargetContent(
  markdown: string,
  automation: Automation
): ContentRange | null {
  const { target } = automation
  switch (target.type) {
    case 'file':
      return { start: 0, end: markdown.length, content: markdown }
    case 'section':
      if (!target.sectionHeading) return null
      return extractSection(markdown, target.sectionHeading)
    case 'table':
      if (!target.tableIdentifier) return null
      return extractTable(markdown, target.tableIdentifier)
    default:
      return null
  }
}

/** Replace a range in the original markdown */
function replaceRange(markdown: string, start: number, end: number, replacement: string): string {
  return markdown.slice(0, start) + replacement + markdown.slice(end)
}

/** Try to extract a markdown table from mixed AI response content */
function extractTableFromResponse(text: string): string | null {
  const lines = text.split('\n')
  let tableStart = -1
  let tableEnd = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      if (tableStart === -1) tableStart = i
      tableEnd = i
    } else if (tableStart !== -1 && line !== '') {
      // Non-table, non-empty line after table started — stop
      break
    }
  }

  if (tableStart !== -1 && tableEnd > tableStart) {
    // Must have at least header + separator + one data row
    const tableLines = lines.slice(tableStart, tableEnd + 1).filter(l => l.trim() !== '')
    if (tableLines.length >= 3) {
      return tableLines.join('\n')
    }
  }

  return null
}

// ── Main execution ──

/** Run a single automation */
export async function runAutomation(automation: Automation): Promise<void> {
  const { id, target } = automation

  emitRunEvent({ automationId: id, status: 'started', timestamp: Date.now() })

  // Track tool usage for learning
  const toolsUsed: string[] = []
  const toolCalls: AutomationToolCall[] = []
  let currentToolStart: { name: string; input: Record<string, unknown>; startTime: number } | null = null

  await withFileLock(target.filePath, async () => {
    let aiResponseRaw = '' // Capture for error snapshots

    try {
      // 1. Read the file
      if (!fs.existsSync(target.filePath)) {
        throw new Error(`File not found: ${target.filePath}`)
      }
      const fullContent = fs.readFileSync(target.filePath, 'utf-8')

      // 2. Extract target content
      const range = extractTargetContent(fullContent, automation)
      if (!range) {
        throw new Error(
          `Could not find target ${target.type}${target.sectionHeading ? ` "${target.sectionHeading}"` : ''}${target.tableIdentifier ? ` "${target.tableIdentifier}"` : ''} in file`
        )
      }

      emitRunEvent({ automationId: id, status: 'snapshot_taken', timestamp: Date.now() })

      // 3. Load experience from previous successful runs
      const experience = loadExperience(id)
      let experienceHint = ''
      if (experience?.workflow) {
        experienceHint = `

## Learned workflow (${experience.runCount ?? 1} successful runs)
${experience.workflow}

Follow this workflow to fetch fresh data. Skip exploration — go straight to these tool calls.`
      }

      // 4. Build available tools hint
      const mcpTools = mcpManager.getAllTools()
      let toolsHint = ''
      if (automation.enableTools && mcpTools.length > 0) {
        const toolList = mcpTools.map(t => `  - mcp_${t.serverId}_${t.name}: ${t.description || t.name}`).join('\n')
        toolsHint = `

## Available tools you MUST use
You have ${mcpTools.length} MCP tools + web_fetch available. Here are the MCP tools:
${toolList}

IMPORTANT: You MUST call these tools to fetch real data. Do NOT say "I cannot access" or "I don't have permission".
Call tools by their full name (e.g. mcp_xapi_search_tweets). The tools are already authorized and connected.`
      }

      // 5. Build AI messages — identity (SOUL etc.) is auto-injected by ai-service
      const systemPrompt = `## Automation Task
You are running as a scheduled automation agent. Your output REPLACES the target content directly.
${toolsHint}
${experienceHint}

## Target
Type: ${target.type}${target.tableIdentifier ? ` (columns: ${target.tableIdentifier.split('|').join(' | ')})` : ''}${target.sectionHeading ? ` (heading: ${target.sectionHeading})` : ''}

Current content:
\`\`\`markdown
${range.content}
\`\`\`

Instructions: ${automation.promptTemplate}

## Output rules
- Output ONLY the replacement content. Zero explanation, zero commentary.
- Use MCP tools (mcp_*) or web_fetch to fetch real data. All values must come from tool results.
- Fake/placeholder data will be detected and rejected (the run will fail).
- If tools return nothing, output the original content unchanged.
${target.type === 'table' ? `- Output a valid markdown table: starts with |, includes | --- | separator, same columns.` : ''}
${target.type === 'section' ? `- Include the heading line as the first line.` : ''}
- No wrapping in \`\`\`markdown fences. No "以下是", "请注意", "我已经". Just the content.`

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: `Execute now: ${automation.promptTemplate}` },
      ]

      emitRunEvent({ automationId: id, status: 'ai_running', timestamp: Date.now() })

      // 5. Resolve provider — use automation's own setting, fallback to chat routing
      let resolvedProviderId = automation.providerId
      if (!resolvedProviderId || resolvedProviderId === 'default') {
        try {
          const { loadConfig } = await import('./lite-home')
          const config = loadConfig()
          const enabled = config.ai.providers.filter(p => p.enabled)
          const chatRouted = config.ai.featureRouting?.chat
          if (chatRouted && enabled.some(p => p.id === chatRouted)) {
            resolvedProviderId = chatRouted
          } else if (enabled.length > 0) {
            resolvedProviderId = enabled[0].id
          }
        } catch { /* use original */ }
      }

      // 6. Call AI with tool event tracking
      const result = await aiChat(
        resolvedProviderId,
        messages,
        0.7,
        8192,
        automation.enableTools,
        (event) => {
          if (event.type === 'tool_start') {
            toolsUsed.push(event.toolName)
            currentToolStart = { name: event.toolName, input: event.toolInput ?? {}, startTime: Date.now() }
          } else if (event.type === 'tool_result' && currentToolStart) {
            toolCalls.push({
              name: currentToolStart.name,
              input: currentToolStart.input,
              output: (event.result ?? '').slice(0, 500),
              durationMs: event.durationMs ?? (Date.now() - currentToolStart.startTime),
            })
            currentToolStart = null
          }
        }
      )

      if (!result.ok) {
        throw new Error(result.error)
      }

      aiResponseRaw = result.data.content
      let newContent = result.data.content.trim()

      // Strip markdown code fences if AI wrapped the output
      if (newContent.startsWith('```')) {
        const firstNewline = newContent.indexOf('\n')
        const lastFence = newContent.lastIndexOf('```')
        if (lastFence > firstNewline) {
          newContent = newContent.slice(firstNewline + 1, lastFence).trim()
        }
      }

      // 6. Validate and extract for table targets
      if (target.type === 'table') {
        // Always extract pure table from response — AI often includes explanatory text
        const extracted = extractTableFromResponse(newContent)
        if (extracted) {
          newContent = extracted
        } else {
          // Fallback: try from raw response (before code fence stripping)
          const extractedRaw = extractTableFromResponse(result.data.content)
          if (extractedRaw) {
            newContent = extractedRaw
          } else {
            throw new Error(
              `AI response does not contain a valid markdown table.\nAI response (first 500 chars): ${result.data.content.slice(0, 500)}`
            )
          }
        }
      }

      // Ensure we have non-empty content
      if (!newContent.trim()) {
        throw new Error('AI returned empty content')
      }

      // Reject fake/placeholder data — do NOT write to file
      const fakeReason = detectFakeData(newContent)
      if (fakeReason) {
        throw new Error(`AI returned fake/simulated data, refusing to write.\n${fakeReason}\nAI response (first 300 chars): ${result.data.content.slice(0, 300)}`)
      }

      emitRunEvent({ automationId: id, status: 'writing', timestamp: Date.now() })

      // 7. Write back to file
      const updatedContent = replaceRange(fullContent, range.start, range.end, newContent)
      fs.writeFileSync(target.filePath, updatedContent, 'utf-8')

      // 8. Record snapshot
      const snapshot: AutomationSnapshot = {
        automationId: id,
        timestamp: Date.now(),
        filePath: target.filePath,
        targetType: target.type,
        contentBefore: range.content,
        contentAfter: newContent,
        prompt: automation.promptTemplate,
        aiResponse: result.data.content,
        model: result.data.model,
        status: 'success',
      }
      appendSnapshot(snapshot)

      // 9. Save experience for self-learning
      saveExperience(experience, {
        automationId: id,
        timestamp: Date.now(),
        prompt: automation.promptTemplate,
        toolCalls: [...toolCalls],
        toolsUsed: [...new Set(toolsUsed)],
        aiResponse: result.data.content,
        contentBefore: range.content,
        contentAfter: newContent,
      })

      // 10. Update status
      updateRunStatus(id, 'success')
      emitRunEvent({
        automationId: id,
        status: 'completed',
        timestamp: Date.now(),
        message: `Updated ${target.type} successfully (tools: ${toolsUsed.join(', ') || 'none'})`,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Record error snapshot — include actual AI response for debugging
      const snapshot: AutomationSnapshot = {
        automationId: id,
        timestamp: Date.now(),
        filePath: target.filePath,
        targetType: target.type,
        contentBefore: '',
        contentAfter: '',
        prompt: automation.promptTemplate,
        aiResponse: aiResponseRaw || '(no response)',
        model: '',
        status: 'error',
        error: errorMsg,
      }
      appendSnapshot(snapshot)

      updateRunStatus(id, 'error', errorMsg)
      emitRunEvent({
        automationId: id,
        status: 'error',
        timestamp: Date.now(),
        message: errorMsg,
      })
    }
  })
}
