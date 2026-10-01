import { NavBar } from './NavBar'

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
export function PortalShell({ screen, animKey, nav, onSelect, homeId, fill, hideBack, narrow, children }: {
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
  /** Keep a single reading-width column on tablet and web (forms, profile). Screens that `fill` are always narrow. */
  narrow?: boolean
  children: React.ReactNode
}) {
  const inNav = nav.some(n => n.id === screen)
  return (
    <div className="flex flex-col h-full @2xl:flex-row">
      <div
        key={animKey ?? screen}
        className={`flex-1 min-h-0 min-w-0 px-4 pt-1 screen-in @2xl:px-8 @2xl:pt-5 ${
          fill ? 'flex flex-col overflow-hidden pb-24 @2xl:pb-6' : 'overflow-y-auto pb-28 @2xl:pb-10'}`}
        style={{ scrollbarWidth: 'none' }}
      >
        <div className={`mx-auto w-full ${narrow || fill ? 'max-w-2xl' : 'max-w-5xl'} ${fill ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          {!inNav && !hideBack && (
            <button onClick={() => onSelect(homeId)} className="text-xs text-teal-700 font-semibold mb-1">← Home</button>
          )}
          {children}
        </div>
      </div>
      <NavBar items={nav.map(n => ({ ...n, badge: n.badge || undefined }))} active={inNav ? screen : homeId} onSelect={onSelect} onHome={() => onSelect(homeId)} />
    </div>
  )
}
