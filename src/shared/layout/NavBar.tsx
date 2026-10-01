import { Fragment } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar } from '@/shared/ui/primitives'

/** Main navigation — identical in every portal: a bottom tab bar on mobile, an icon rail on tablet, a labelled sidebar on web. */

/* ─── NavBar ────────────────────────────────────────────────────────── */
export function NavBar({ items, active, onSelect, onHome }: {
  items: { id: string; label: string; icon: string; badge?: number; group?: string; webOnly?: boolean }[]
  active: string
  onSelect: (id: string) => void
  /** The brand at the top of the rail and sidebar takes the user home. */
  onHome: () => void
}) {
  const { currentUser, setCurrentUser } = useApp()
  return (
    <nav aria-label="Main"
      className="absolute bottom-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-sm border-t border-gray-100 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] px-1
        @2xl:static @2xl:order-first @2xl:flex-shrink-0 @2xl:w-20 @2xl:h-full @2xl:flex @2xl:flex-col @2xl:border-t-0 @2xl:border-r @2xl:px-2 @2xl:py-4 @2xl:overflow-y-auto
        @5xl:w-56 @5xl:px-3">
      {/* brand — rail shows the mark, sidebar the full name */}
      <button type="button" onClick={onHome} aria-label="mCare: go to home"
        className="hidden @2xl:block w-full rounded-xl text-center @5xl:text-left @5xl:px-3 mb-4 text-xl font-black text-teal-700 font-display transition-transform hover:scale-105 active:scale-95 @5xl:origin-left">
        m<span className="hidden @5xl:inline">Care</span>
      </button>
      <div className="flex justify-around items-center @2xl:flex-col @2xl:justify-start @2xl:items-stretch @2xl:gap-1">
        {items.map(({ id, label, icon, badge, group, webOnly }, i) => {
          const on = active === id
          const heading = group && group !== items[i - 1]?.group ? group : null
          return (
            <Fragment key={id}>
            {heading && <p className="hidden @5xl:block px-3 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{heading}</p>}
            <button
              onClick={() => onSelect(id)}
              aria-current={on ? 'page' : undefined}
              className={`${webOnly ? 'hidden @5xl:flex' : 'flex'} flex-col items-center gap-[3px] px-2 py-1 relative rounded-xl transition-colors
                @2xl:py-2 @5xl:flex-row @5xl:gap-3 @5xl:px-3 @5xl:py-2.5
                ${on ? '@2xl:bg-teal-50' : '@2xl:hover:bg-gray-50'}`}
            >
              <span className={`relative text-[22px] transition-transform @5xl:text-lg ${on ? 'scale-110 @5xl:scale-100' : ''}`}>
                {icon}
                {badge !== undefined && badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              {/* two sizes of the same label: tiny under the icon, full-size beside it in the sidebar */}
              <span className={`text-[9px] font-bold transition-colors @5xl:hidden ${on ? 'text-teal-700' : 'text-gray-400'}`}>{label}</span>
              <span className={`hidden @5xl:inline text-sm font-semibold ${on ? 'text-teal-700' : 'text-gray-600'}`}>{label}</span>
              {on && <div className="w-1 h-1 rounded-full bg-teal-600 @2xl:hidden" />}
            </button>
            </Fragment>
          )
        })}
      </div>

      {/* web sidebar: who is signed in, their profile and the way out */}
      {currentUser && (
        <div className="hidden @5xl:flex items-center gap-2.5 mt-auto pt-3 border-t border-gray-100">
          <button onClick={() => onSelect('profile')} className="flex items-center gap-2.5 flex-1 min-w-0 text-left rounded-xl px-1 py-1 hover:bg-gray-50">
            <Avatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-gray-900 truncate">{currentUser.name}</span>
              <span className="block text-[10px] text-gray-400 capitalize">{currentUser.role} · Profile</span>
            </span>
          </button>
          <button onClick={() => setCurrentUser(null)} className="text-[11px] font-semibold text-gray-500 hover:text-red-600 flex-shrink-0 px-1">Sign out</button>
        </div>
      )}
    </nav>
  )
}
