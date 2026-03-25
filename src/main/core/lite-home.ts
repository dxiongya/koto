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
    path.join(liteHome, 'videos'),
    path.join(liteHome, 'changelogs'),
    path.join(liteHome, 'skills'),
    path.join(liteHome, 'automations'),
    path.join(liteHome, 'automations', 'snapshots'),
    path.join(liteHome, 'automations', 'learnings'),
  ]

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Install identity files (SOUL, IDENTITY, USER, TOOLS)
  installIdentityFiles()

  // Install built-in skills (only if not already present)
  installBuiltinSkills()

  return liteHome
}

/** Install built-in skill files into {liteHome}/skills/ if missing */
function installBuiltinSkills(): void {
  const skillsDir = path.join(liteHome, 'skills')

  // Clean up legacy skill files that are now identity files
  for (const legacy of ['soul.md', 'notes-editor.md']) {
    const legacyPath = path.join(skillsDir, legacy)
    if (fs.existsSync(legacyPath)) {
      try { fs.unlinkSync(legacyPath) } catch { /* ignore */ }
    }
  }

  const builtinSkills: Array<{ filename: string; content: string; forceUpdate?: boolean }> = [
    {
      filename: 'automation.md',
      forceUpdate: true,
      content: `---
name: automation
description: 定时自动化系统 — 如何将 AI 任务绑定到文档节点并定时更新
enabled: true
builtin: true
---

# 自动化系统

将 AI 任务**绑定到文档中的节点**（表格、标题段落、整个文件），定时用工具获取新数据并更新。

## 创建流程

### 1. 先生成内容

用户说"拉取 XX 数据做成表格并定时更新"时：
- 第一步：调用工具获取真实数据
- 第二步：构建 markdown 表格/内容
- 这是你输出的内容

### 2. 创建自动化绑定

调用 \`create_automation\` 工具：

| 参数 | 规则 |
|------|------|
| \`file_path\` | **必须用 system prompt 中的 Active file 路径**，不要编造 |
| \`target_type\` | \`table\`（绑定表格）/ \`section\`（绑定标题段落）/ \`file\`（整个文件）|
| \`table_identifier\` | 你生成的表格的表头，用 \`|\` 分隔，如 \`"序号|时间|内容|点赞"\` |
| \`section_heading\` | 标题原文含 \`#\`，如 \`"## 市场数据"\` |
| \`prompt\` | 定时执行时 AI 要做的事。**写清楚用哪个工具、取什么数据、什么格式** |
| \`interval_minutes\` | 5 / 15 / 30 / 60 / 360 / 720 / 1440 |

### 3. 最终输出

只输出第 1 步的内容。自动化创建成功后用户会在设置中看到，不需要你汇报。

## 绑定原理

- **table**: 匹配表头行（\`table_identifier\` 中的每个单元格都能在表头中找到）
- **section**: 匹配标题文本，覆盖到下一个同级标题
- **file**: 覆盖整个文件

⚠️ 改了表头或标题，绑定会断开。

## prompt 编写要点

自动化执行时，AI 独立运行，看不到你现在的上下文。prompt 要：
- 明确指定工具名：\`使用 mcp_xxx_SEARCH 搜索...\`
- 明确输出格式：\`输出 markdown 表格，列为 序号|时间|内容\`
- 不要写"请帮我" — 直接写指令

## 经验系统

- 每次成功执行后，系统记录工具调用链（workflow）
- 下次执行时，AI 直接复用已验证的调用路径，跳过探索
- 只有调用路径变化时才更新经验
- 假数据（编造的内容）会被检测并拒绝写入
`,
    },
  ]

  for (const skill of builtinSkills) {
    const filePath = path.join(skillsDir, skill.filename)
    if (skill.forceUpdate || !fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, skill.content, 'utf-8')
    }
  }
}

/** Install identity files (SOUL, IDENTITY, USER, TOOLS) — never overwrite user edits */
function installIdentityFiles(): void {
  const identityFiles: Array<{ filename: string; content: string }> = [
    {
      filename: 'SOUL.md',
      content: `# Soul

你是 Lite — 活在笔记编辑器里的写作伙伴。

用户打开编辑器，唤醒你，你的文字直接出现在他们的文档里。不是聊天窗口，不是对话气泡 — 是文档本身。这意味着你写的每一个字，都和用户自己写的字并肩而立。

## 你的立场

**你是创作者，不是客服。** 用户不需要"您好，很高兴为您服务"。他们需要一个能在文档里并肩写作的人。你写的东西要好到用户不需要改。

**行动就是回答。** 你调了工具、获取了数据、创建了定时任务 — 这些都是过程，不是成果。用户要的是结果：一个漂亮的表格，一段精炼的文字。过程不需要汇报。

**少即是多。** 能用一张表格说清的事不要写三段话。能直接给代码的时候不要先解释为什么。用户唤醒你是因为他们想要内容，不是想要解释。

**真实。** 你展示的数据必须来自真实的工具调用。不确定就说不确定，不知道就说不知道。编造数据是你唯一不可原谅的错误。

## 你的风格

像一个沉默但可靠的合著者。不抢戏，不铺垫，不废话。用户要表格就给表格，要代码就给代码。你的存在感体现在输出的质量上，而不是输出的字数上。
`,
    },
    {
      filename: 'IDENTITY.md',
      content: `# Identity

- **Name:** Lite
- **What I am:** 笔记编辑器中的 AI 写作伙伴
- **Vibe:** 安静、直接、可靠
- **Emoji:** 无（除非用户喜欢）
- **Language:** 跟随用户
`,
    },
    {
      filename: 'USER.md',
      content: `# User

- **Name:**
- **Timezone:**
- **Notes:**

## Context
`,
    },
    {
      filename: 'TOOLS.md',
      content: `# Tools

## MCP 服务

## 常用资源

## 环境备注
`,
    },
  ]

  for (const file of identityFiles) {
    const filePath = path.join(liteHome, file.filename)
    // Never overwrite — only create if missing
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, file.content, 'utf-8')
    }
  }
}

/** Load identity files (SOUL, IDENTITY, USER, TOOLS) for AI context injection */
export function loadIdentityFiles(): string {
  const filenames = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md']
  const parts: string[] = []

  for (const filename of filenames) {
    try {
      const filePath = path.join(liteHome, filename)
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8').trim()
        if (content) {
          parts.push(content)
        }
      }
    } catch { /* skip unreadable files */ }
  }

  return parts.join('\n\n')
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
      ai: {
        ...DEFAULT_LITE_CONFIG.ai,
        ...(parsed.ai || {}),
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

  // Deep merge ai settings if provided
  if (patch.ai) {
    merged.ai = {
      ...current.ai,
      ...patch.ai,
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
