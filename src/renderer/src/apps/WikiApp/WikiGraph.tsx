/**
 * Wiki Graph — sigma.js + graphology force-directed visualization of wiki
 * pages and their [[wikilink]] / source-ref relationships.
 *
 * Node colors by type, edges by relationship type.
 * Click a node → select the page in the parent wiki view.
 */
import React, { useEffect, useRef, useState } from 'react'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2Layout from 'graphology-layout-forceatlas2/worker'
import { Loader2 } from 'lucide-react'

interface GraphNode {
  id: string
  relPath: string
  title: string
  type: string
  resourceType?: string
}

interface GraphEdge {
  source: string
  target: string
  type: string
}

interface WikiGraphProps {
  onSelectPage: (relPath: string) => void
}

// Colors per node type — matches the dark theme
const TYPE_COLORS: Record<string, string> = {
  entity: '#5eead4',    // teal (accent)
  concept: '#a78bfa',   // purple
  source: '#fbbf24',    // amber
  query: '#60a5fa',     // blue
  synthesis: '#f472b6', // pink
  comparison: '#34d399',// emerald
  page: '#888888',      // gray
}

// Sub-colors for source resource types
const RESOURCE_COLORS: Record<string, string> = {
  link: '#fb923c',   // orange
  image: '#a3e635',  // lime
  video: '#f87171',  // red
  text: '#fbbf24',   // amber (default source)
}

function getNodeColor(node: GraphNode): string {
  if (node.type === 'source' && node.resourceType) {
    return RESOURCE_COLORS[node.resourceType] || TYPE_COLORS.source
  }
  return TYPE_COLORS[node.type] || TYPE_COLORS.page
}

export const WikiGraph: React.FC<WikiGraphProps> = ({ onSelectPage }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const layoutRef = useRef<FA2Layout | null>(null)
  const [loading, setLoading] = useState(true)
  const [nodeCount, setNodeCount] = useState(0)

  // Stable ref for callback — prevents effect re-running when parent re-renders
  const onSelectPageRef = useRef(onSelectPage)
  onSelectPageRef.current = onSelectPage

  useEffect(() => {
    let cancelled = false

    let layoutTimeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (layoutTimeoutId) { clearTimeout(layoutTimeoutId); layoutTimeoutId = null }
      if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null }
      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null }
      // Remove leftover canvas elements (HMR / strict mode residue)
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild)
        }
      }
    }

    const load = async () => {
      if (!containerRef.current) return
      setLoading(true)
      cleanup()

      try {
        const res = await window.api.wiki.graph()
        if (cancelled || !containerRef.current) return
        if (!res.ok || !res.data) { setLoading(false); return }

        const { nodes, edges } = res.data as { nodes: GraphNode[]; edges: GraphEdge[] }
        if (nodes.length === 0) { setNodeCount(0); setLoading(false); return }

        const graph = new Graph()

        for (const n of nodes) {
          if (graph.hasNode(n.id)) continue
          graph.addNode(n.id, {
            label: n.title,
            x: Math.random() * 10 - 5,
            y: Math.random() * 10 - 5,
            size: n.type === 'entity' ? 8 : n.type === 'concept' ? 7 : 5,
            color: getNodeColor(n),
            relPath: n.relPath,
            nodeType: n.type,
          })
        }

        // One edge per node pair (graphology default graph forbids multi-edges)
        const seenPairs = new Set<string>()
        for (const e of edges) {
          if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue
          const [a, b] = [e.source, e.target].sort()
          const pairKey = `${a}↔${b}`
          if (seenPairs.has(pairKey)) continue
          seenPairs.add(pairKey)
          graph.addEdgeWithKey(pairKey, e.source, e.target, {
            color: e.type === 'wikilink' ? '#3b9b8f' : '#b8860b',
            size: e.type === 'wikilink' ? 2.5 : 2,
          })
        }

        if (cancelled) return
        setNodeCount(nodes.length)

        // Wait for container to have dimensions
        if (!containerRef.current.offsetWidth || !containerRef.current.offsetHeight) {
          await new Promise(r => setTimeout(r, 150))
          if (cancelled || !containerRef.current?.offsetWidth) { setLoading(false); return }
        }

        // Pre-position with a synchronous FA2 pass so the graph appears
        // already-settled at first paint. Without this the user sees the
        // worker animating from random positions for a couple seconds —
        // 600 iterations is enough for typical wiki sizes (<300 nodes) to
        // converge into a stable shape.
        const fa2Settings = {
          gravity: 5,
          scalingRatio: 2,
          barnesHutOptimize: nodes.length > 50,
          slowDown: 3,
          strongGravityMode: true,
        }
        forceAtlas2.assign(graph, { iterations: 600, settings: fa2Settings })

        if (cancelled) return

        // Create sigma renderer
        const sigma = new Sigma(graph, containerRef.current, {
          renderLabels: true,
          labelColor: { color: '#999999' },
          labelSize: 12,
          labelFont: 'GeistMono, SF Mono, monospace',
          labelRenderedSizeThreshold: 2,
          defaultEdgeType: 'line',
          stagePadding: 40,
          defaultEdgeColor: '#5eead4',
          edgeLabelSize: 10,
          allowInvalidContainer: true,
        })

        if (cancelled) { sigma.kill(); return }
        sigmaRef.current = sigma

        const handleClickNode = ({ node }: { node: string }): void => {
          const attrs = graph.getNodeAttributes(node)
          if (attrs.relPath) onSelectPageRef.current(attrs.relPath as string)
        }
        const handleEnterNode = (): void => {
          if (containerRef.current) containerRef.current.style.cursor = 'pointer'
        }
        const handleLeaveNode = (): void => {
          if (containerRef.current) containerRef.current.style.cursor = 'default'
        }
        sigma.on('clickNode', handleClickNode)
        sigma.on('enterNode', handleEnterNode)
        sigma.on('leaveNode', handleLeaveNode)

        // After the synchronous pre-pass the graph is already in a good
        // shape. A short worker run polishes overlapping nodes — 1.2s is
        // enough for visible refinement without the long "settling" effect.
        const layout = new FA2Layout(graph, { settings: fa2Settings })

        if (cancelled) { sigma.kill(); return }
        layoutRef.current = layout
        layout.start()

        layoutTimeoutId = setTimeout(() => { if (layoutRef.current === layout && !cancelled) layout.stop() }, 1200)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
      cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, only run on mount
  }, [])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-app/60">
          <Loader2 size={20} className="animate-spin text-accent-main" />
        </div>
      )}

      {!loading && nodeCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-tx-faint text-[13px]">
          No pages to visualize yet.
        </div>
      )}

      {/* Legend */}
      {nodeCount > 0 && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-tx-faint bg-bg-app/80 px-2.5 py-2 rounded-md border border-border-subtle">
          {Object.entries(TYPE_COLORS).filter(([k]) => k !== 'page').map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
              {type}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
