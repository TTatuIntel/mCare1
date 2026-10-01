import { useSyncExternalStore } from 'react'

/*
 * Tells screens when the boot splash starts to fade, so their entrance
 * animations play as it clears instead of hidden underneath it. Kept apart
 * from SplashScreen.tsx so that file only exports a component (fast refresh).
 */
let leaving = false
const listeners = new Set<() => void>()

export function markSplashLeaving() {
  if (leaving) return
  leaving = true
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** False while the boot splash covers the app; true from the moment it starts fading. */
export const useSplashDone = () => useSyncExternalStore(subscribe, () => leaving, () => true)
