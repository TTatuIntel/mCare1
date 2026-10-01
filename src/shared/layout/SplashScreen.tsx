import { useEffect, useState } from 'react'
import MCareLogo from './MCareLogo'
import { markSplashLeaving } from './splashSignal'

/** Longest we hold the logo back for the brand font; after this it shows in the fallback. */
const FONT_WAIT_MS = 800
/** Time on screen after the logo appears: entrance animation plus a beat to read it. */
const HOLD_MS = 1500
const FADE_MS = 350

/**
 * The one boot splash, shown once when the app starts. Its background is up
 * on the first frame; the logo and tagline animate in as soon as the brand
 * fonts are ready, so there's no flash of the fallback font. Then it fades
 * out and unmounts. In-app loading uses the Loader popup (@/shared/ui/Loader).
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<'wait' | 'show' | 'leave' | 'done'>('wait')

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const wait = (ms: number) => new Promise<void>(r => { timers.push(setTimeout(r, ms)) })
    // load() starts the download now instead of waiting for layout to ask for it.
    const fonts = document.fonts
      ? Promise.all([
          document.fonts.load('900 64px Fraunces'),
          document.fonts.load('500 16px "DM Sans"'),
        ]).catch(() => undefined)
      : Promise.resolve()
    Promise.race([fonts, wait(FONT_WAIT_MS)])
      .then(() => { if (!cancelled) setPhase('show') })
      .then(() => wait(HOLD_MS))
      .then(() => { if (!cancelled) setPhase('leave') })
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [])

  useEffect(() => {
    if (phase !== 'leave') return
    markSplashLeaving()
    const t = setTimeout(() => setPhase('done'), FADE_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'done') return null
  const revealed = phase !== 'wait'
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="mCare is starting"
      className={`absolute inset-0 z-[60] flex flex-col items-center justify-center transition-opacity ease-out ${phase === 'leave' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{
        transitionDuration: `${FADE_MS}ms`,
        background: 'radial-gradient(120% 70% at 50% 42%, #ffffff 0%, #f6f8fb 60%, #eef3f6 100%)',
      }}
    >
      {/* Laid out from the first frame (so nothing shifts), hidden until revealed. */}
      <div className={revealed ? 'splash-logo-in' : 'opacity-0'}>
        <MCareLogo size="xl" />
      </div>
      <p className={`mt-8 text-base font-medium text-gray-500 tracking-wide ${revealed ? 'splash-tag-in' : 'opacity-0'}`}>
        Better Health Together
      </p>
    </div>
  )
}

export default SplashScreen
