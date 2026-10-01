import { Loading } from './Loader'

/** Where a screen's data is in its life: fetching, usable, or failed. */
export type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * The frame every tab screen uses, so all pages line up: the same title row,
 * the same spacing between cards, and the same loading / error behaviour.
 *
 *   <Page title="Appointments" actions={<AddButton … />} status={status} error={error} onRetry={reload}>
 *     …cards…
 *   </Page>
 *
 * Detail views keep using `BackHeader`; home screens keep `PortalHeader`.
 */
export function Page({ title, meta, actions, status = 'ready', error, onRetry, loadingLabel, fill, flow = !fill, rootRef, children }: {
  title: string
  /** Small grey note on the right, e.g. "3 pending". Ignored when `actions` is given. */
  meta?: string
  /** Buttons on the right of the title row. */
  actions?: React.ReactNode
  status?: LoadStatus
  /** Shown with a Retry button when `status` is 'error'. */
  error?: string
  onRetry?: () => void
  loadingLabel?: string
  /** Fill the height instead of scrolling (e.g. a chat thread). */
  fill?: boolean
  /** Let the cards flow into two columns on tablet and web (default). Turn off for screens that lay out their own grid. */
  flow?: boolean
  rootRef?: React.Ref<HTMLDivElement>
  children?: React.ReactNode
}) {
  return (
    <div ref={rootRef} className={`flex flex-col gap-4 ${fill ? 'h-full min-h-0' : ''} ${flow ? 'card-flow' : ''}`}>
      {/* Fixed height, so the title sits in the same place whether or not the page has header buttons. */}
      <div className="flex items-center justify-between gap-2 h-9 mt-1 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-900 font-display">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : meta && <span className="text-xs text-gray-400">{meta}</span>}
      </div>
      <Loading when={status === 'loading'} label={loadingLabel} />
      {status === 'error' ? <ErrorState message={error} onRetry={onRetry} /> : status === 'ready' && children}
    </div>
  )
}

/** "Nothing here yet" — one look for every empty list. */
export function EmptyState({ icon, title, text, action, onAction }: {
  icon?: string; title: string; text?: string; action?: string; onAction?: () => void
}) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
      {icon && <p className="text-2xl mb-2">{icon}</p>}
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {text && <p className="text-xs text-gray-400 mt-1">{text}</p>}
      {action && <button onClick={onAction} className="mt-3 text-xs bg-teal-700 text-white px-5 py-2 rounded-full font-bold">{action}</button>}
    </div>
  )
}

/** Something failed to load or save. Always says what to do next. */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center">
      <p className="text-sm font-bold text-red-700">Couldn’t load this page</p>
      <p className="text-xs text-red-600 mt-1">{message || 'Check your connection and try again.'}</p>
      {onRetry && <button onClick={onRetry} className="mt-3 text-xs bg-teal-700 text-white px-5 py-2 rounded-full font-bold">Try again</button>}
    </div>
  )
}
