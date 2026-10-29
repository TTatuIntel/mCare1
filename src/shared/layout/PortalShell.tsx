import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { NavBar } from './NavBar'
import { IdleSignOut } from './IdleSignOut'

/** Scroll movement (px) smaller than this is ignored, so the floating button doesn't flicker. */
const SCROLL_JITTER = 6
/** The floating button stays open until the screen has scrolled this far (px). */
const COMPACT_AFTER = 32

/** How long a "could not save" message stays up before it clears itself. */
const SAVE_ERROR_MS = 8000

/**
 * What the person must know about the connection, above every screen:
 * a save that was refused, being offline, or the backend not answering.
 * Nothing is shown while everything is working.
 */
function ConnectionBanner() {
  const { live, online, sync, saveError, clearSaveError, refresh } = useApp()
  useEffect(() => {
    if (!saveError) return
    const t = setTimeout(clearSaveError, SAVE_ERROR_MS)
    return () => clearTimeout(t)
  }, [saveError]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadedAt = sync.at ? new Date(sync.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null
  const stale = live && (!online || !!sync.error)
  if (!saveError && !stale) return null
  return (
    <div className="flex flex-col gap-1.5 mb-2" aria-live="polite">
      {saveError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="flex-1"><span className="font-bold">Not saved.</span> {saveError}</p>
          <button onClick={clearSaveError} aria-label="Dismiss" className="font-bold text-red-700 px-1">✕</button>
        </div>
      )}
      {stale && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex-1">
            <span className="font-bold">{online ? 'mCare cannot be reached.' : 'You are offline.'}</span>{' '}
            {loadedAt ? `Showing what was loaded at ${loadedAt}.` : ''} Changes cannot be saved until the connection is back.
          </p>
          {online && <button onClick={() => { void refresh() }} disabled={sync.refreshing} className="font-bold text-teal-700 flex-shrink-0 disabled:opacity-50">{sync.refreshing ? 'Trying…' : 'Retry'}</button>}
        </div>
      )}
    </div>
  )
}

export type NavItem = {
  id: string; label: string; icon: string; badge?: number
  /** Heading this item sits under in the web sidebar. Items of one group must be listed together. */
  group?: string
  /** Listed only in the web sidebar; on mobile and tablet the screen is reached from inside another screen. */
  webOnly?: boolean
}

/**
 * Screen frame shared by every portal: the navigation (bottom bar on mobile,
 * side rail on tablet, sidebar on web), a scrolling content area kept to a
 * readable width, and a "← Home" link on screens that aren't in the nav.
 */
export function PortalShell({ screen, animKey, nav, onSelect, homeId, fill, hideBack, narrow, floating, children }: {
  /** Current screen id. */
  screen: string
  /** Replays the enter animation when it changes; defaults to `screen`. */
  animKey?: string
  nav: NavItem[]
  onSelect: (id: string) => void
  /** The tab that "← Home" returns to and that stays highlighted on off-nav screens. */
  homeId: string
  /** Let the child fill the height (e.g. a chat thread) instead of scrolling. */
  fill?: boolean
  /** The screen draws its own BackHeader, so skip the "← Home" link. */
  hideBack?: boolean
  /** Keep a single reading-width column on tablet and web (forms, profile). */
  narrow?: boolean
  /**
   * A floating action button for this screen (e.g. the patient's "Log vitals"). Its wrapper is a
   * `group/fab` with `data-compact`, true while the screen scrolls down, so the button can fold to its icon.
   */
  floating?: React.ReactNode
  children: React.ReactNode
}) {
  const inNav = nav.some(n => n.id === screen)
  // The floating button folds to its icon on the way down the screen and opens again on the way up.
  const [compact, setCompact] = useState(false)
  const lastTop = useRef(0)
  const screenKey = animKey ?? screen
  useEffect(() => { setCompact(false); lastTop.current = 0 }, [screenKey])
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    const moved = top - lastTop.current
    if (Math.abs(moved) < SCROLL_JITTER) return
    lastTop.current = top
    setCompact(moved > 0 && top > COMPACT_AFTER)
  }
  return (
    <div className="flex flex-col h-full @2xl:flex-row">
      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
        <div
          key={screenKey}
          onScroll={floating ? onScroll : undefined}
          className={`flex-1 min-h-0 min-w-0 px-4 pt-1 screen-in @2xl:px-8 @2xl:pt-5 ${
            fill ? 'flex flex-col overflow-hidden pb-24 @2xl:pb-6'
              : `overflow-y-auto ${floating ? 'pb-44 @2xl:pb-24' : 'pb-28 @2xl:pb-10'}`}`}
          style={{ scrollbarWidth: 'none' }}
        >
          <div className={`mx-auto w-full ${narrow ? 'max-w-2xl' : 'max-w-5xl'} ${fill ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
            <ConnectionBanner />
            {!inNav && !hideBack && (
              <button onClick={() => onSelect(homeId)} className="text-xs text-teal-700 font-semibold mb-1">← Home</button>
            )}
            {children}
          </div>
        </div>
        {/* Stays put while the screen scrolls: above the tab bar on mobile, in the corner on tablet and web. */}
        {floating && <div data-compact={compact} className="group/fab absolute z-[5] right-4 bottom-24 @2xl:right-8 @2xl:bottom-8">{floating}</div>}
      </div>
      <NavBar items={nav.map(n => ({ ...n, badge: n.badge || undefined }))} active={inNav ? screen : homeId} onSelect={onSelect} onHome={() => onSelect(homeId)} />
      <IdleSignOut />
    </div>
  )
}
