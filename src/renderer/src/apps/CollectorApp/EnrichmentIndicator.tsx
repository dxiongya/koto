/**
 * Floating enrichment status indicator — appears in the bottom-right of the
 * collector when items are being processed (OCR, markdown fetch, embedding).
 */
import React, { useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react'
import { useEnrichmentStore, type EnrichmentTask } from './enrichment-store'

const STEP_LABELS: Record<string, string> = {
  markdown: 'Fetching article',
  ocr: 'Analyzing image',
  embedding: 'Embedding',
}

function TaskRow({ task }: { task: EnrichmentTask }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      {task.status === 'processing' && (
        <Loader2 size={12} className="animate-spin text-teal-400 shrink-0" />
      )}
      {task.status === 'done' && (
        <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
      )}
      {task.status === 'error' && (
        <span title={task.error}>
          <AlertCircle size={12} className="text-red-400 shrink-0" />
        </span>
      )}
      <span className="text-[#999] truncate max-w-[180px]">
        {STEP_LABELS[task.step] || task.step}
      </span>
      <span className="text-[#ccc] truncate max-w-[140px]">
        {task.title}
      </span>
    </div>
  )
}

export function EnrichmentIndicator(): React.ReactElement | null {
  const tasks = useEnrichmentStore((s) => s.tasks)
  const [expanded, setExpanded] = useState(false)

  const taskList = Array.from(tasks.values())
  if (taskList.length === 0) return null

  const processing = taskList.filter((t) => t.status === 'processing')
  const errors = taskList.filter((t) => t.status === 'error')

  return (
    <div className="absolute bottom-3 right-3 z-50">
      {/* Expanded task list */}
      {expanded && taskList.length > 0 && (
        <div className="mb-1 bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden shadow-xl max-h-[200px] overflow-y-auto">
          {taskList.map((t) => (
            <TaskRow key={t.itemId} task={t} />
          ))}
        </div>
      )}

      {/* Pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#333] text-xs cursor-pointer hover:border-[#555] transition-colors shadow-lg"
      >
        {processing.length > 0 ? (
          <>
            <Loader2 size={12} className="animate-spin text-teal-400" />
            <span className="text-[#ccc]">
              Processing {processing.length} item{processing.length > 1 ? 's' : ''}
            </span>
          </>
        ) : errors.length > 0 ? (
          <>
            <AlertCircle size={12} className="text-red-400" />
            <span className="text-[#ccc]">
              {errors.length} error{errors.length > 1 ? 's' : ''}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-[#ccc]">Done</span>
          </>
        )}
        {expanded ? <ChevronDown size={12} className="text-[#666]" /> : <ChevronUp size={12} className="text-[#666]" />}
      </button>
    </div>
  )
}
