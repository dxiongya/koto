/**
 * Global toast — single mount-point at the App root. Components dispatch
 * via `useUIStore.getState().setAppToast({ message, status })`. Auto-clears
 * 2s after the latest set.
 */
import { useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

export function AppToast(): React.ReactElement | null {
  const toast = useUIStore((s) => s.appToast)
  const setToast = useUIStore((s) => s.setAppToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast, setToast])

  if (!toast) return null

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2.5 px-4 py-2.5 bg-bg-popover border border-border-strong rounded-lg shadow-xl"
      style={{ animation: 'toast-in 0.2s ease' }}
      role="status"
    >
      {toast.status === 'success'
        ? <Check size={14} className="text-status-success" />
        : <X size={14} className="text-status-error" />}
      <span className="text-[12px] text-tx-main">{toast.message}</span>
    </div>
  )
}
