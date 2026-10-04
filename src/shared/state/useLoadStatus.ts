/**
 * Where the record on screen stands, for `Page`'s `status`, `error` and `onRetry`.
 *
 * The record is loaded before a portal opens (the sign-in screen waits for it)
 * and is then kept fresh in the background, so a screen is 'ready' as long as
 * one load has succeeded: if the backend later becomes unreachable the banner
 * at the top of the portal says so and the last load stays on screen. It is
 * 'loading' or 'error' only when there is nothing to show yet, so an empty
 * list always means "no records", never "could not load".
 */
import { useApp } from './AppContext'
import type { LoadStatus } from '@/shared/ui/Page'

export function useLoadStatus() {
  const { live, sync, online, refresh } = useApp()
  const status: LoadStatus = !live || sync.at !== null ? 'ready' : sync.error ? 'error' : 'loading'
  return {
    status,
    error: status === 'error' ? sync.error : undefined,
    reload: () => { void refresh() },
    /** What is shown may be out of date: the device is offline, or the last check did not get an answer. */
    stale: live && (!online || !!sync.error),
  }
}
