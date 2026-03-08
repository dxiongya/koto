/**
 * LinkPreviewPlugin — Hover over a link to show a preview card.
 * Simple implementation using a positioned div (no radix dependency).
 *
 * Caching: stale-while-revalidate with 5-minute TTL.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNearestNodeFromDOMNode } from 'lexical'
import { $isLinkNode } from '@lexical/link'
interface UrlMeta {
  title: string
  description: string
  image: string
}

const HOVER_DELAY_MS = 350
const CLOSE_GRACE_MS = 200
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  meta: UrlMeta
  fetchedAt: number
}

const urlMetaCache = new Map<string, CacheEntry>()

interface CardState {
  url: string
  linkText: string | null
  rect: DOMRect
  meta: UrlMeta | null
  loading: boolean
}

export function LinkPreviewPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [card, setCard] = useState<CardState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeUrlRef = useRef<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    clearTimer()
    activeUrlRef.current = null
    setCard(null)
  }, [clearTimer])

  useEffect(() => {
    const show = (el: HTMLElement, url: string): void => {
      activeUrlRef.current = url
      const rect = el.getBoundingClientRect()
      const linkText = el.textContent?.trim() || null

      const cached = urlMetaCache.get(url)
      const now = Date.now()

      if (cached) {
        setCard({ url, linkText, rect, meta: cached.meta, loading: false })
        if (now - cached.fetchedAt > CACHE_TTL_MS) {
          void window.api.url.fetchMeta(url).then((result) => {
            if (!result.ok) return
            urlMetaCache.set(url, { meta: result.data, fetchedAt: Date.now() })
            setCard((prev) => (prev?.url === url ? { ...prev, meta: result.data } : prev))
          })
        }
      } else {
        setCard({ url, linkText, rect, meta: null, loading: true })
        void window.api.url.fetchMeta(url).then((result) => {
          if (!result.ok) return
          urlMetaCache.set(url, { meta: result.data, fetchedAt: Date.now() })
          if (activeUrlRef.current !== url) return
          setCard((prev) =>
            prev?.url === url ? { ...prev, meta: result.data, loading: false } : prev
          )
        })
      }
    }

    const onOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      const href = anchor?.getAttribute('href') || anchor?.href
      if (!anchor || !href || href.startsWith('lite-asset:')) return
      if (activeUrlRef.current === href && card) return

      clearTimer()
      timerRef.current = setTimeout(() => {
        let resolvedUrl = href
        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(anchor)
          if (node && $isLinkNode(node)) resolvedUrl = node.getURL()
        })
        if (resolvedUrl) show(anchor, resolvedUrl)
      }, HOVER_DELAY_MS)
    }

    const onOut = (e: MouseEvent): void => {
      const related = e.relatedTarget as Node | null
      const anchor = (e.target as HTMLElement).closest('a[href]')
      if (anchor?.contains(related)) return
      // Don't close if mouse moved to the card
      if (cardRef.current?.contains(related)) return

      clearTimer()
      timerRef.current = setTimeout(close, CLOSE_GRACE_MS)
    }

    return editor.registerRootListener((next, prev) => {
      prev?.removeEventListener('mouseover', onOver as EventListener)
      prev?.removeEventListener('mouseout', onOut as EventListener)
      next?.addEventListener('mouseover', onOver as EventListener)
      next?.addEventListener('mouseout', onOut as EventListener)
    })
  }, [editor, card, clearTimer, close])

  if (!card) return null

  const title = card.meta?.title || card.linkText || card.url
  const hasTitle = card.meta?.title || (card.linkText && card.linkText !== card.url)

  let domain = ''
  try {
    if (card.url) domain = new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    domain = card.url
  }

  const top = card.rect.bottom + 8
  const left = Math.max(12, Math.min(card.rect.left, window.innerWidth - 352))

  return (
    <div
      ref={cardRef}
      className="fixed z-[100] w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-[#1a1a1a] overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
      style={{ top, left }}
      onMouseEnter={clearTimer}
      onMouseLeave={close}
    >
      <div
        className="flex flex-col cursor-pointer group"
        onMouseDown={(e) => {
          e.preventDefault()
          if (card.url) window.open(card.url, '_blank', 'noopener')
        }}
      >
        {card.meta?.image && (
          <div className="w-full aspect-[1.91/1] bg-[#111] overflow-hidden shrink-0 border-b border-white/5 relative">
            <img
              src={card.meta.image}
              alt=""
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
          </div>
        )}
        <div className="p-3.5 flex flex-col gap-1.5">
          {card.loading && !hasTitle && (
            <div className="flex items-center gap-2 text-[#555] text-xs">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-[#5eead4]/30 border-t-[#5eead4] animate-spin" />
              <span>Fetching page info…</span>
            </div>
          )}
          {hasTitle && (
            <p
              className="text-[14px] font-semibold text-[#ccc] line-clamp-2 leading-snug group-hover:text-[#5eead4] transition-colors duration-200"
              title={typeof title === 'string' ? title : undefined}
            >
              {title}
            </p>
          )}
          {card.meta?.description && (
            <p className="text-[12px] text-[#888] line-clamp-2 leading-relaxed">
              {card.meta.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#555] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="truncate">{domain}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
