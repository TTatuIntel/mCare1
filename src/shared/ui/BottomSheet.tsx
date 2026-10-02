/** Bottom sheet + the form controls that live inside it. Pinned to the bottom of the screen on mobile; a centred dialog on tablet and web (see `.sheet-up` in index.css). */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Outcome } from '@/shared/lib/types'

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
          {/* Every sheet can be closed from its corner, as well as by Esc or a tap outside. */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {title && <p className="text-base font-bold text-gray-900">{title}</p>}
              {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
            <CloseButton onClick={onClose} />
          </div>
        </div>
        <div className="px-5 overflow-y-auto flex-1 pb-3" style={{ scrollbarWidth: 'none' }}>{children}</div>
        {footer && <div className="px-5 pt-2 pb-8 flex gap-2 flex-shrink-0 border-t border-gray-50">{footer}</div>}
      </div>
    </div>
  )
  return root ? createPortal(sheet, root) : sheet
}

/** The round "x" that closes a sheet, popup or dismissible card. */
export function CloseButton({ onClick, label = 'Close', className = '' }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-all hover:bg-gray-200 hover:text-gray-800 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${className}`}>
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12" /><path d="M18 6 6 18" />
      </svg>
    </button>
  )
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

/* ─── Saving ─── */
/**
 * Runs a form's save: `busy` while it is on its way, `error` if it was refused.
 * A second tap while busy does nothing, so a slow connection cannot save twice.
 *
 *   const save = useSave()
 *   const submit = async () => { if ((await save.run(() => requestAppointment(form))).ok) onClose() }
 *   <SaveError message={save.error} />
 *   <SheetButton disabled={save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Save'}</SheetButton>
 */
export function useSave() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const run = async <T,>(job: () => Promise<Outcome<T>>): Promise<Outcome<T>> => {
    if (running.current) return { ok: false, error: '' }
    running.current = true
    setBusy(true); setError('')
    const result = await job()
    running.current = false
    setBusy(false)
    if (!result.ok) setError(result.error)
    return result
  }
  return { busy, error, run, clear: () => setError('') }
}

/** Why a save did not go through, shown beside the form that tried it. */
export function SaveError({ message, className = '' }: { message?: string; className?: string }) {
  if (!message) return null
  return <p role="alert" className={`text-xs font-semibold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 ${className}`}>{message}</p>
}

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
