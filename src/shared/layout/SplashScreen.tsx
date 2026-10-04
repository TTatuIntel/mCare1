import { useEffect } from 'react'
import { isBootBusy, markSplashLeaving } from './splashSignal'

/** Shortest time the logo is on screen once it has appeared: its entrance plus a beat to read it. */
const HOLD_MS = 1500
/** Longest the splash waits for start-up work; after this it clears and the loading popup takes over. */
const MAX_WAIT_MS = 30000
const FADE_MS = 350
const TICK_MS = 100

/**
 * Takes down the boot splash. The splash itself is plain HTML in index.html
 * (`#boot-splash`), so it is on screen before the app's code has downloaded.
 * It stays up while start-up work is running (a saved session being resumed,
 * the record loading, a screen's code arriving), so the person sees one logo
 * and then the ready page: never a loading popup before or after the splash.
 * In-app loading uses the Loader popup (@/shared/ui/Loader).
 */
export function SplashScreen() {
  useEffect(() => {
    const splash = document.getElementById('boot-splash')
    if (!splash) { markSplashLeaving(); return }
    const startedAt = Date.now()
    let quietTicks = 0
    let remove: ReturnType<typeof setTimeout> | undefined
    const tick = setInterval(() => {
      const shownAt = Number(splash.dataset.shownAt)
      const held = shownAt > 0 && Date.now() - shownAt >= HOLD_MS
      // Two quiet checks in a row: one piece of start-up work often hands over to the next.
      quietTicks = isBootBusy() ? 0 : quietTicks + 1
      if (!(held && quietTicks >= 2) && Date.now() - startedAt < MAX_WAIT_MS) return
      clearInterval(tick)
      markSplashLeaving()
      splash.classList.add('boot-leave')
      remove = setTimeout(() => splash.remove(), FADE_MS)
    }, TICK_MS)
    return () => { clearInterval(tick); clearTimeout(remove) }
  }, [])
  return null
}

export default SplashScreen
