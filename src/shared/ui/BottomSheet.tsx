/** Bottom sheet + the form controls that live inside it. Pinned to the bottom of the screen on mobile; a centred dialog on tablet and web (see `.sheet-up` in index.css). */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/* ─── BottomSheet: always pinned to the bottom of the phone screen ─── */
export function BottomSheet({ open, onClose, title, subtitle, children, footer }: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => { setRoot(document.getElementById('sheet-root')) }, [])
  // Keyboard: Esc closes, Tab stays inside the sheet, and focus moves in when it opens and back to where it was when it closes.
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    if (!panel.current?.contains(before)) panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return }
      if (e.key !== 'Tab' || !panel.current) return
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (stops.length === 0) { e.preventDefault(); return }
      const first = stops[0], last = stops[stops.length - 1], at = document.activeElement
      if (!panel.current.contains(at)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [open, root])
  if (!open) return null
  const sheet = (
    <div className="absolute inset-0 pointer-events-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 sheet-fade" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className="absolute bottom-0 left-0 right-0 bg-white flex flex-col sheet-up outline-none"
        style={{ borderRadius: '24px 24px 0 0', maxHeight: '86%' }}>
        <div className="px-5 pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-3 @2xl:hidden" />
          {title && <p className="text-base font-bold text-gray-900">{title}</p>}
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="px-5 overflow-y-auto flex-1 pb-3" style={{ scrollbarWidth: 'none' }}>{children}</div>
        {footer && <div className="px-5 pt-2 pb-8 flex gap-2 flex-shrink-0 border-t border-gray-50">{footer}</div>}
      </div>
    </div>
  )
  return root ? createPortal(sheet, root) : sheet
}

export function SheetButton({ children, onClick, tone = 'primary', disabled }: {
  children: React.ReactNode; onClick: () => void; tone?: 'primary' | 'ghost' | 'danger' | 'success'; disabled?: boolean
}) {
  // Teal is the only action colour; green/red are reserved for approve/destructive outcomes.
  const tones = {
    primary: 'bg-teal-700 text-white', ghost: 'bg-gray-100 text-gray-600', danger: 'bg-red-500 text-white',
    success: 'bg-emerald-600 text-white',
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors ${disabled ? 'bg-gray-200 text-gray-400' : tones[tone]}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
      {children}
    </div>
  )
}
export const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-teal-400'

/* ─── Toast ─── */
export function useToast() {
  const [msg, setMsg] = useState('')
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = (m: string) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 3000) }
  const node = msg ? (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-center sheet-fade">
      <p className="text-xs font-semibold text-emerald-700">✓ {msg}</p>
    </div>
  ) : null
  return { show, node }
}
