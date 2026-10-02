import { useSyncExternalStore } from 'react'

/*
 * Tells screens when the boot splash starts to fade, so their entrance
 * animations play as it clears instead of hidden underneath it, and tells
 * the splash whether start-up work is still running. Kept apart from
 * SplashScreen.tsx so that file only exports a component (fast refresh).
 */
let leaving = false
let busy = false
const listeners = new Set<() => void>()

export function markSplashLeaving() {
  if (leaving) return
  leaving = true
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** False while the boot splash covers the app; true from the moment it starts fading. */
export const useSplashDone = () => useSyncExternalStore(subscribe, () => leaving, () => true)

/** Set by the Loader: work is running that would show the loading popup. The splash stays up for it. */
export function setBootBusy(on: boolean) { busy = on }
export const isBootBusy = () => busy
