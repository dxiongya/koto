/**
 * Wiki Chat — ask questions about your wiki content.
 *
 * Retrieval pipeline:
 *   1. User asks a question
 *   2. Load all wiki pages (lightweight — they're small markdown files)
 *   3. Build context from relevant pages (keyword match + frontmatter)
 *   4. Send to LLM with wiki context as system prompt
 *   5. Display answer with source page references
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Send, Loader2, BookOpen, FileText } from 'lucide-react'
import { useUIStore } from '../../store/useUIStore'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[] // wiki page relPaths used as context
  timestamp: number
}

/** Pick the LLM provider for wiki chat (reuses wiki or chat route). */
function getWikiProvider(): { providerId: string; model: string } | null {
  const store = useUIStore.getState()
  const routed = store.getAIProviderForFeature('wiki')
  if (routed) return { providerId: routed.provider.id, model: routed.model }
  const chatRoute = store.getAIProviderForFeature('chat')
  if (chatRoute) return { providerId: chatRoute.provider.id, model: chatRoute.model }
  return null
}

export const WikiChat: React.FC<{
  onNavigateToPage?: (relPath: string) => void
}> = ({ onNavigateToPage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || loading) return

    const provider = getWikiProvider()
    if (!provider) {
      setMessages(prev => [...prev, {
        id: String(Date.now()),
        role: 'assistant',
        content: 'No AI provider configured. Go to Settings → AI → Feature Routing to set up a wiki or chat provider.',
        timestamp: Date.now(),
      }])
      return
    }

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // 1. Hybrid search (BM25 + semantic + graph)
      const searchRes = await window.api.wiki.search(query)
      const results = searchRes.ok && searchRes.data ? searchRes.data as Array<{
        relPath: string; title: string; content: string; score: number;
        confidence: number; supersededBy: string | null; source: string
      }> : []

      if (results.length === 0) {
        // Fallback: check if wiki has any pages at all
        const pagesRes = await window.api.wiki.listPages()
        const hasPages = pagesRes.ok && pagesRes.data && (pagesRes.data as unknown[]).length > 5
        setMessages(prev => [...prev, {
          id: String(Date.now()),
          role: 'assistant',
          content: hasPages
            ? 'No relevant wiki pages found for your question. Try rephrasing or ask about a different topic.'
            : 'Wiki is empty. Add items to Collector first — they\'ll be ingested into wiki pages automatically.',
          timestamp: Date.now(),
        }])
        setLoading(false)
        return
      }

      // 2. Build context with score-based budget allocation
      const maxContext = 10000
      let budget = maxContext
      const contextParts: string[] = []
      const sourcePaths: string[] = []

      for (const r of results) {
        if (budget <= 0) break
        const charLimit = r.score > 0.02 ? 2000 : 800
        const snippet = r.content.slice(0, Math.min(charLimit, budget))
        const staleNote = r.supersededBy ? ' [SUPERSEDED]' : r.confidence < 0.3 ? ' [LOW CONFIDENCE]' : ''
        contextParts.push(`### ${r.title} (${r.relPath})${staleNote}\n${snippet}`)
        sourcePaths.push(r.relPath)
        budget -= snippet.length
      }

      const wikiContext = contextParts.join('\n\n---\n\n')

      const systemPrompt = [
        'You are a helpful assistant answering questions about the user\'s personal wiki.',
        'Use ONLY the wiki content provided below to answer. If the answer is not in the wiki, say so.',
        'When referencing wiki pages, mention them by title.',
        'Pages marked [SUPERSEDED] contain outdated information — prefer newer sources.',
        'Pages marked [LOW CONFIDENCE] may be unreliable — note this if relevant.',
        'Be concise and direct.',
        '',
        '## Wiki Content',
        '',
        wikiContext,
      ].join('\n')

      // 3. Call LLM
      const result = await window.api.ai.chat(
        provider.providerId,
        [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-6).map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user', content: query },
        ],
        0.3,
        2048,
        false,
        provider.model,
      )

      if (!result.ok) throw new Error(result.error || 'AI call failed')

      const assistantMsg: ChatMessage = {
        id: String(Date.now()),
        role: 'assistant',
        content: result.data.content,
        sources: sourcePaths.slice(0, 5),
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const msg = raw.includes('AI call failed') || raw.includes('provider')
        ? 'AI provider error — check Settings → AI to configure a provider.'
        : `Error: ${raw}`
      setMessages(prev => [...prev, {
        id: String(Date.now()),
        role: 'assistant',
        content: msg,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages])

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-tx-faint gap-2">
            <BookOpen size={24} />
            <div className="text-[13px]">Ask anything about your wiki</div>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-accent-main/15 text-tx-main'
                : 'bg-bg-hover text-tx-main border border-border-subtle'
            }`}>
              <pre className="whitespace-pre-wrap font-[inherit]">{msg.content}</pre>
              {/* Source references */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border-subtle">
                  {msg.sources.map(src => (
                    <button
                      key={src}
                      onClick={() => onNavigateToPage?.(src)}
                      className="flex items-center gap-1 text-[10px] text-accent-main hover:underline"
                    >
                      <FileText size={9} />
                      {src.replace(/\.md$/, '').split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-bg-hover rounded-lg px-3 py-2 border border-border-subtle">
              <Loader2 size={14} className="animate-spin text-accent-main" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border-subtle p-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-app border border-border-subtle focus-within:border-accent-main/40 transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask the wiki..."
            disabled={loading}
            className="flex-1 bg-transparent text-[13px] text-tx-main outline-none placeholder-tx-faint disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="p-1 rounded text-tx-faint hover:text-accent-main disabled:opacity-30 transition-colors"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
