import { useEffect } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { ToastState } from './shared'

export const CollectToast: React.FC<{ toast: ToastState; onDone: () => void }> = ({ toast, onDone }) => {
  useEffect(() => {
    if (toast.status !== 'loading') {
      const t = setTimeout(onDone, 2000)
      return () => clearTimeout(t)
    }
  }, [toast.status, onDone])

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-2.5 bg-bg-popover border border-border-strong rounded-lg shadow-xl"
      style={{ animation: 'toast-in 0.2s ease' }}>
      {toast.status === 'loading' && <Loader2 size={14} className="text-accent-main animate-spin" />}
      {toast.status === 'success' && <Check size={14} className="text-status-success" />}
      {toast.status === 'error' && <X size={14} className="text-status-error" />}
      <span className="text-[12px] text-tx-main">{toast.message}</span>
    </div>
  )
}
