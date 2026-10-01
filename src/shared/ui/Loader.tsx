import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import MCareLogo from '@/shared/layout/MCareLogo'

/**
 * Global loading popup: the mCare logo alone on a frosted, see-through blur.
 * It never replaces a screen: the page that is already up stays where it
 * is, blurred and locked underneath, until the work finishes.
 *
 *   <Loading when={saving} label="Saving…" />      declarative, while mounted
 *   const loader = useLoader()
 *   await loader.track(fetchThing(), 'Loading…')    wraps a promise
 *   const done = loader.start('Working…'); done()   manual
 *
 * It is for real delays only (uploads, exports, slow loads). Work that
 * finishes within SHOW_DELAY never shows it, so normal taps and saves stay
 * instant. Once up it stays long enough to read (MIN_VISIBLE), and a long
 * wait says so instead of looking frozen.
 */
const SHOW_DELAY = 500
const MIN_VISIBLE = 600
const SLOW_AFTER = 8000
const FADE_MS = 180

type Stop = () => void
interface LoaderApi {
  start: (label?: string) => Stop
  track: <T>(work: Promise<T>, label?: string) => Promise<T>
}

const LoaderContext = createContext<LoaderApi | null>(null)
const BusyContext = createContext(false)

export function useLoader(): LoaderApi {
  const api = useContext(LoaderContext)
  if (!api) throw new Error('useLoader must be used inside LoaderProvider')
  return api
}

/** True while the popup is up; the shell uses it to lock the page underneath. */
export const useLoaderBusy = () => useContext(BusyContext)

/** Shows the loading popup for as long as it is mounted (and `when` holds). */
export function Loading({ label, when = true }: { label?: string; when?: boolean }) {
  const { start } = useLoader()
  useEffect(() => (when ? start(label) : undefined), [when, label, start])
  return null
}

export function LoaderProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Map<number, string>>(() => new Map())
  const nextId = useRef(0)

  const start = useCallback((label = 'Loading…') => {
    const id = nextId.current++
    setTasks(t => new Map(t).set(id, label))
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      setTasks(t => { const n = new Map(t); n.delete(id); return n })
    }
  }, [])

  const track = useCallback(<T,>(work: Promise<T>, label?: string) => {
    const stop = start(label)
    return work.finally(stop)
  }, [start])

  const [api] = useState<LoaderApi>(() => ({ start, track }))

  const active = tasks.size > 0
  // The most recent task names the wait.
  const label = Array.from(tasks.values()).pop() ?? ''
  const { phase, slow } = usePopupPhase(active)
  const online = useOnline()

  // Hold the last label through the fade-out so the text doesn't blank early.
  const lastLabel = useRef(label)
  if (label) lastLabel.current = label

  const hint = !online
    ? "You're offline. We'll carry on when you're back."
    : slow ? 'Slow connection. Still working on it…' : ''

  return (
    <LoaderContext.Provider value={api}>
      <BusyContext.Provider value={phase !== 'hidden'}>
        {children}
        {phase !== 'hidden' && (
          <LoaderPopup label={lastLabel.current} hint={hint} leaving={phase === 'leaving'} />
        )}
      </BusyContext.Provider>
    </LoaderContext.Provider>
  )
}

function LoaderPopup({ label, hint, leaving }: { label: string; hint: string; leaving: boolean }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={label}
      className={`absolute inset-0 z-50 flex items-center justify-center bg-white/45 backdrop-blur-md transition-opacity ease-out sheet-fade ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ borderRadius: 50, transitionDuration: `${FADE_MS}ms` }}
    >
      {/* No card: just the logo floating on the frosted page. */}
      <div className={`flex flex-col items-center gap-3 transition-transform ease-out ${leaving ? 'scale-95' : 'scale-100 loader-pop'}`}
        style={{ transitionDuration: `${FADE_MS}ms` }}>
        <MCareLogo size="lg" />
        {/* The label is for screen readers; sighted users get the logo alone. */}
        <p role="status" aria-live="polite" className="sr-only">{label}</p>
        {/* Only surfaces when something is wrong (offline / very slow), so a long wait never looks frozen. */}
        {hint && <p className="max-w-[240px] text-[11px] font-medium text-amber-800 text-center leading-snug sheet-fade">{hint}</p>}
      </div>
    </div>
  )
}

/** Delayed show, minimum on-screen time, fade-out, and the "slow" flag. */
function usePopupPhase(active: boolean) {
  const [phase, setPhase] = useState<'hidden' | 'shown' | 'leaving'>('hidden')
  const [slow, setSlow] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (active) {
      if (phase === 'shown') return
      if (phase === 'leaving') { setPhase('shown'); return }
      const t = setTimeout(() => { shownAt.current = Date.now(); setPhase('shown') }, SHOW_DELAY)
      return () => clearTimeout(t)
    }
    if (phase === 'shown') {
      const wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt.current))
      const t = setTimeout(() => setPhase('leaving'), wait)
      return () => clearTimeout(t)
    }
    if (phase === 'leaving') {
      const t = setTimeout(() => setPhase('hidden'), FADE_MS)
      return () => clearTimeout(t)
    }
  }, [active, phase])

  useEffect(() => {
    if (phase !== 'shown' || !active) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), SLOW_AFTER)
    return () => clearTimeout(t)
  }, [phase, active])

  return { phase, slow }
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}
