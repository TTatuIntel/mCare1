import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import MCareLogo from '@/shared/layout/MCareLogo'
import { useSplashDone } from '@/shared/layout/splashSignal'
import { AuthIcon, AuthRights, BrandCluster, type AuthIconName } from './authKit'

/** How long each feature stays on stage before the next one takes over. */
const AUTO_MS = 3000
/** Horizontal drag (px) on the stage that counts as a swipe. */
const SWIPE_PX = 40
/** How long the outgoing feature takes to leave (matches `auth-leave-*` in index.css). */
const LEAVE_MS = 320

/* ─── Stage scenes: a small moving preview of each feature ──────────── */

/** Staggers the `auth-item-in` entrance of the pieces of a scene. */
const after = (delayMs: number) => ({ animationDelay: `${delayMs}ms` })

function WelcomeScene() {
  return (
    <>
      <span className="auth-ring absolute w-12 h-12 rounded-full bg-teal-400" />
      <span className="auth-ring absolute w-12 h-12 rounded-full bg-teal-400" style={{ animationDelay: '-1s' }} />
      <span className="auth-pop relative w-12 h-12 rounded-full bg-teal-700 text-white flex items-center justify-center shadow-lg shadow-teal-700/40">
        <svg viewBox="0 0 24 24" className="auth-icon-vitals w-6 h-6" fill="currentColor" aria-hidden="true">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.500l7 7Z" />
        </svg>
      </span>
    </>
  )
}

function VitalsScene() {
  return (
    <div className="w-full px-3">
      <p style={after(0)} className="auth-item-in flex items-center gap-1 text-[9px] font-semibold text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" /> Heart rate
      </p>
      <p style={after(120)} className="auth-item-in font-mono text-2xl font-bold text-gray-900 leading-none mt-1">
        72 <span className="font-sans text-[9px] font-medium text-gray-400">bpm</span>
      </p>
      <svg viewBox="0 0 100 30" className="w-full h-6 mt-1 text-teal-600" fill="none" stroke="currentColor"
        strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path className="auth-ekg" pathLength={100} d="M0 18h20l5-6 5 6h8l4-14 6 24 5-10h12l5-5 5 5h25" />
      </svg>
      <p style={after(360)} className="auth-item-in mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
        ✓ In range
      </p>
    </div>
  )
}

function MedicationScene() {
  const rows = [
    { time: '08:00', name: 'Metformin', done: true },
    { time: '12:45', name: 'Amlodipine', done: true },
    { time: '19:00', name: 'Dinner', done: false },
  ]
  return (
    <div className="w-full px-2.5 flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={r.time} style={after(i * 220)} className="auth-item-in flex items-center gap-1.5 px-1.5 py-0.5">
          <span className={`w-3.5 h-3.5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-black text-white ${r.done ? 'bg-emerald-500' : 'ring-2 ring-inset ring-teal-600'}`}>
            {r.done && '✓'}
          </span>
          <span className={`text-[10px] font-semibold truncate ${r.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{r.name}</span>
        </div>
      ))}
    </div>
  )
}

function CareTeamScene() {
  return (
    <div className="w-full px-2.5 flex flex-col gap-1.5">
      <p style={after(0)} className="auth-item-in self-start rounded-xl rounded-tl-sm bg-teal-50 px-2 py-1 text-[10px] text-teal-900">BP is steadier 👏</p>
      <p style={after(500)} className="auth-item-in self-end rounded-xl rounded-tr-sm bg-teal-700 px-2 py-1 text-[10px] text-white">Thank you!</p>
      <p style={after(1000)} className="auth-item-in self-start flex gap-1 rounded-xl rounded-tl-sm bg-teal-50 px-2 py-1.5">
        {[0, 150, 300].map(d => (
          <span key={d} className="w-1 h-1 rounded-full bg-gray-400 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </p>
    </div>
  )
}

function AppointmentScene() {
  return (
    <div className="w-full px-3 flex flex-col items-center gap-1.5">
      <div style={after(0)} className="auth-item-in w-14 overflow-hidden rounded-xl border-2 border-teal-700 text-center">
        <p className="bg-teal-700 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">Thu</p>
        <p className="py-1 font-mono text-xl font-bold leading-none text-gray-900">14</p>
      </div>
      <p style={after(350)} className="auth-item-in flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-gray-800">
        <span className="font-mono">10:30</span>
        <span className="auth-pop flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-black text-white" style={after(800)}>✓</span>
      </p>
    </div>
  )
}

function RecordsScene() {
  // Three sheets fan out one after another; the front one is ticked as shared.
  const sheets = [
    { pos: '-translate-x-4 -rotate-12', delay: 0 },
    { pos: 'translate-x-4 rotate-12', delay: 180 },
    { pos: '', delay: 360 },
  ]
  return (
    <>
      {sheets.map((sh, i) => (
        <span key={i} style={after(sh.delay)}
          className={`auth-item-in absolute flex h-16 w-12 flex-col gap-1 rounded-lg border-2 border-teal-700/60 p-1.5 ${sh.pos}`}>
          <span className="h-1 w-5 rounded-full bg-teal-600" />
          <span className="h-1 w-full rounded-full bg-gray-200" />
          <span className="h-1 w-full rounded-full bg-gray-200" />
          <span className="h-1 w-6 rounded-full bg-gray-200" />
        </span>
      ))}
      <span style={after(800)} className="auth-pop absolute translate-x-6 translate-y-7 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-white shadow">✓</span>
    </>
  )
}

function EmergencyScene() {
  return (
    <>
      <span className="auth-ring absolute w-12 h-12 rounded-full bg-red-400" />
      <span className="auth-ring absolute w-12 h-12 rounded-full bg-red-400" style={{ animationDelay: '-1s' }} />
      <span className="auth-pop relative w-12 h-12 rounded-full bg-red-500 text-white text-xs font-black flex items-center justify-center shadow-lg shadow-red-500/40">SOS</span>
    </>
  )
}

/**
 * The tour: one whole message per slide (label, headline, preview, what you get).
 * Wrap the words of `head` to highlight in asterisks.
 */
const SLIDES: { icon: AuthIconName; name: string; head: string; body: string; points: string[]; Scene: () => React.ReactNode }[] = [
  { icon: 'shield', name: 'Welcome to mCare', head: 'Your health, and *everyone helping* you with it.', Scene: WelcomeScene,
    body: 'Your health, our priority. One app for you and your care team.',
    points: ['Vitals, medicines and meals', 'Doctors and appointments', 'Records and emergency help'] },
  { icon: 'vitals', name: 'Vitals', head: 'Know your *numbers* every day.', Scene: VitalsScene,
    body: 'Log a reading in seconds and see how you are trending.',
    points: ['Blood pressure, glucose and more', 'Trends you can read at a glance', 'Out-of-range alerts to your care team'] },
  { icon: 'pill', name: 'Medicines & meals', head: 'Never miss a *dose* or a meal.', Scene: MedicationScene,
    body: 'Your day laid out in order, so you know what comes next.',
    points: ['Today’s medicines and meals', 'Reminders you set yourself', 'Prescriptions from your doctor'] },
  { icon: 'history', name: 'Appointments', head: 'Every *visit* in one place.', Scene: AppointmentScene,
    body: 'See what is coming up and look back at past visits.',
    points: ['Upcoming and past visits', 'Your doctor’s details', 'Follow-ups you won’t lose track of'] },
  { icon: 'chat', name: 'Care team', head: 'Your *doctor* is one message away.', Scene: CareTeamScene,
    body: 'Message the people looking after you, right from the app.',
    points: ['Chat with your doctor', 'See who is on your care team', 'Alerts they can act on'] },
  { icon: 'lock', name: 'Records', head: 'Your *records* in one safe place.', Scene: RecordsScene,
    body: 'Keep your medical documents together and share them when needed.',
    points: ['Lab results and reports', 'Upload from your phone', 'Share with your care team'] },
  { icon: 'bell', name: 'Emergency', head: '*Help* when it matters most.', Scene: EmergencyScene,
    body: 'Send an SOS in one tap when you need help fast.',
    points: ['One-tap SOS', 'Emergency contacts saved', 'There whenever you need it'] },
]

/* ─── The one logo, which travels between the tour and the card ─────── */

/** How long the logo takes to cross the page (the icons wait for most of it). */
const FLY_MS = 750
/** A resting place only counts as "where it just was" for this long. */
const FLY_FROM_MAX_AGE_MS = 200

/** Where the logo last stood on screen, so the next one mounted flies in from there. */
let lastLogoSpot: { x: number; y: number; at: number } | undefined

/**
 * The logo, wherever it is mounted. Mounting it in a new place while removing
 * it from the old one makes it fly across: sideways and vertical motion run on
 * different curves so the path bends, and it lifts slightly mid-flight. The
 * logo's own pulse stays in phase through the move (see MCareLogo's beat clock).
 */
function FlyingLogo() {
  const xRef = useRef<HTMLDivElement>(null)
  const yRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const outer = xRef.current, inner = yRef.current
    if (!outer || !inner) return
    const from = lastLogoSpot
    lastLogoSpot = undefined
    const to = outer.getBoundingClientRect()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // to.width is 0 while this size's layout is hidden (mobile and tablet).
    if (from && to.width && !reducedMotion && performance.now() - from.at < FLY_FROM_MAX_AGE_MS) {
      const dx = from.x - to.left, dy = from.y - to.top
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        outer.animate({ translate: [`${dx}px 0`, '0 0'] }, { duration: FLY_MS, easing: 'cubic-bezier(.65,0,.35,1)' })
        inner.animate({ translate: [`0 ${dy}px`, '0 0'], scale: [1, 1.12, 1] }, { duration: FLY_MS, easing: 'cubic-bezier(.3,0,.2,1)' })
      }
    }
    // Still in the page here, so a logo caught mid-flight hands on where it had got to.
    return () => {
      const r = inner.getBoundingClientRect()
      if (r.width) lastLogoSpot = { x: r.left, y: r.top, at: performance.now() }
    }
  }, [])

  return (
    <div ref={xRef} className="relative z-10">
      <div ref={yRef}><MCareLogo size="lg" /></div>
    </div>
  )
}

/* ─── Hero: the logo, then the tour ─────────────────────────────────── */

function AuthHero({ className, playing, rise, logoHere, onUse }: {
  className: string
  /** Web: false while the logo is over in the welcome card. */
  logoHere: boolean
  /** The user has come back to the tour. */
  onUse: () => void
  /** False until the boot splash clears, so the tour doesn't advance unseen. */
  playing: boolean
  rise: (delayMs: number) => { cls: string; style?: React.CSSProperties }
}) {
  const [active, setActive] = useState(0)
  /** The slide on its way out, drawn underneath for a moment so the two cross over. */
  const [leaving, setLeaving] = useState<number | null>(null)
  /** Which way the tour last moved, so content leaves and arrives on the right sides. */
  const [dir, setDir] = useState<1 | -1>(1)
  // Hovering with a mouse holds the current slide so it can be read.
  const [held, setHeld] = useState(false)
  const [reducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const drag = useRef<{ x: number; swiped: boolean } | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The tour keeps turning under reduced motion; its slides then fade instead of sliding (see index.css).
  const auto = playing && !held

  const go = (to: number, d: 1 | -1) => {
    const next = (to + SLIDES.length) % SLIDES.length
    if (next === active) return
    clearTimeout(leaveTimer.current)
    setLeaving(active); setDir(d); setActive(next)
    leaveTimer.current = setTimeout(() => setLeaving(null), LEAVE_MS)
  }
  useEffect(() => () => clearTimeout(leaveTimer.current), [])

  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => go(active + 1, 1), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, auto]) // eslint-disable-line react-hooks/exhaustive-deps

  const r0 = rise(0)
  // The tour opens once the page is on screen; hidden until then.
  const stageIn = playing ? { className: 'auth-stage-open', style: { animationDelay: '260ms' } } : { className: 'opacity-0' }

  /** One slide: everything under the logo arrives, and later leaves, together. */
  const renderSlide = (s: typeof SLIDES[number], mode: 'in' | 'out') => {
    const on = (cls: string) => (mode === 'in' ? cls : '')
    // The headline rises a word at a time; the starred words carry the brand shimmer.
    const words = s.head.split('*').flatMap((part, i) => part.trim().split(/\s+/).filter(Boolean).map(w => ({ w, accent: i % 2 === 1 })))
    const wordsDone = 160 + words.length * 60
    return (
      <div key={`${s.name}-${mode}`} aria-hidden={mode === 'out'}
        className={`col-start-1 row-start-1 w-full flex flex-col items-center gap-4 @5xl:items-start @5xl:gap-5 ${mode === 'out' ? (dir > 0 ? 'auth-leave-next' : 'auth-leave-prev') : ''}`}>
        <p className={`${on('auth-item-in')} flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-teal-700`}>
          <span className={`flex ${on(`auth-icon-${s.icon}`)}`}><AuthIcon name={s.icon} className="w-5 h-5" /></span>
          {s.name}
        </p>

        {/* Two sizes, because font sizes can't switch on one element here. */}
        {(['@5xl:hidden text-xl', 'hidden @5xl:block text-4xl'] as const).map(size => (
          <h1 key={size} className={`${size} max-w-xl font-display font-black text-gray-900 leading-tight`}>
            {words.map(({ w, accent }, i) => (
              <span key={i} className="inline-block overflow-hidden align-bottom pb-1">
                <span style={after(160 + i * 60)} className={`inline-block ${on('auth-word-up')}`}>
                  {accent ? <span className="auth-shimmer">{w}</span> : w}
                </span>
              </span>
            )).flatMap((el, i) => (i ? [' ', el] : [el]))}
          </h1>
        ))}

        <div className="mt-2 w-full flex items-center justify-center gap-5 text-left @5xl:mt-0 @5xl:justify-start @5xl:gap-7">
          {/* A soft preview surface adds definition on mobile and tablet. */}
          <div aria-hidden className={`relative w-28 h-22 shrink-0 flex items-center justify-center rounded-2xl bg-teal-50/70 shadow-sm ring-1 ring-teal-100 @5xl:bg-transparent @5xl:shadow-none @5xl:ring-0 @5xl:w-36 @5xl:h-36 ${on('auth-scene-in')}`}>
            <div className={`relative w-full h-full flex items-center justify-center ${on('auth-float')}`}><s.Scene /></div>
          </div>
          {/* Mobile and tablet: one sentence, so the actions below stay the focus. Web has room for the list. */}
          {([['flex @5xl:hidden text-sm leading-relaxed', false], ['hidden @5xl:flex text-[15px] gap-2', true]] as const).map(([size, withPoints]) => (
            <div key={size} className={`${size} min-w-0 max-w-[13rem] flex-col @5xl:max-w-sm`}>
              <p style={after(wordsDone)} className={`${on('auth-item-in')} text-gray-600 leading-snug`}>{s.body}</p>
              {withPoints && (
                <ul className="mt-0.5 flex flex-col gap-1.5">
                  {s.points.map((pt, i) => (
                    <li key={pt} style={after(wordsDone + 140 + i * 140)} className={`${on('auth-item-in')} flex items-center gap-1.5 font-semibold text-gray-800`}>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      </span>
                      {pt}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section aria-label="What you can do with mCare" onFocus={onUse}
      onPointerEnter={e => { if (e.pointerType === 'mouse') onUse() }}
      className={`${className} flex-col justify-center items-center text-center gap-10 @5xl:items-start @5xl:text-left @5xl:gap-8`}>
      {/* Mobile and tablet: the logo stays put with the icons around it. Web: it
          rests here (its place is kept) until the user turns to the welcome card. */}
      <div className={r0.cls} style={r0.style}>
        {/* Mobile: the compact cluster, so the tour and the way in fit the screen. Tablet has room for the large one. */}
        <BrandCluster compact className="@2xl:hidden mt-6" active={SLIDES[active].icon}><MCareLogo size="md" /></BrandCluster>
        <BrandCluster className="hidden @2xl:flex @5xl:hidden" active={SLIDES[active].icon}><MCareLogo size="lg" /></BrandCluster>
        <div className="hidden @5xl:block h-[4.5rem]">{logoHere && <FlyingLogo />}</div>
      </div>

      <div className="w-full max-w-2xl flex flex-col gap-1 @5xl:gap-2">
        {/* One message at a time, straight on the page. It moves on by itself; tap or swipe to change it.
            The stage keeps the height of the tallest slide (so the actions below never jump) and
            centres shorter ones in it, which splits the spare room evenly above and below. */}
        <div role="button" tabIndex={0} aria-label="Show the next feature" aria-roledescription="carousel" style={stageIn.style}
          className={`${stageIn.className} grid items-center @5xl:items-start min-h-[10rem] cursor-pointer touch-pan-y select-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 @5xl:min-h-[19rem]`}
          onPointerEnter={e => { if (e.pointerType === 'mouse') setHeld(true) }}
          onPointerLeave={() => { setHeld(false); drag.current = null }}
          onPointerDown={e => { drag.current = { x: e.clientX, swiped: false } }}
          onPointerUp={e => {
            if (!drag.current) return
            const dx = e.clientX - drag.current.x
            if (Math.abs(dx) >= SWIPE_PX) { drag.current.swiped = true; go(active + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1) }
          }}
          onPointerCancel={() => { drag.current = null }}
          onClick={() => { const swiped = drag.current?.swiped; drag.current = null; if (!swiped) go(active + 1, 1) }}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(active + 1, 1) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1, -1) }
          }}>
          {leaving !== null && renderSlide(SLIDES[leaving], 'out')}
          <div aria-live="polite" className="col-start-1 row-start-1 grid">{renderSlide(SLIDES[active], 'in')}</div>
        </div>
      </div>
    </section>
  )
}

/* ─── Shell ─────────────────────────────────────────────────────────── */

/**
 * The brand over a form step, where the welcome page has it: the logo with the
 * feature icons around it on mobile and tablet, the small logo on web (the big
 * one is beside it, over the tour). With `onHome` the logo is the way back to
 * the welcome page.
 */
function StepBrand({ onHome }: { onHome?: () => void }) {
  const logo = (size: 'sm' | 'md' | 'lg') => onHome ? (
    <button type="button" onClick={onHome} aria-label="mCare: back to the welcome page"
      className="relative z-10 rounded-2xl outline-none transition-transform duration-300 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-teal-500/60">
      <MCareLogo size={size} />
    </button>
  ) : <MCareLogo size={size} />
  return (
    <>
      {/* The same cluster as the welcome page at each size: compact on mobile, large on tablet. */}
      <BrandCluster compact className="@2xl:hidden mt-6 mb-4">{logo('md')}</BrandCluster>
      <BrandCluster className="hidden @2xl:flex @5xl:hidden mb-6">{logo('lg')}</BrandCluster>
      <div className="hidden @5xl:flex justify-center mb-5">{logo('sm')}</div>
    </>
  )
}

/**
 * The one page every signed-out step renders on: brand and feature tour on
 * one side, the step on the other, straight on the page with no card behind
 * it. Welcome, sign in, create account and verification only swap the step.
 *
 * Web: two columns that fit the window. Tablet: a centred column. Mobile: the
 * welcome step (`welcome`) shows the tour above its actions; form steps get
 * the whole screen, under the same brand. Nothing scrolls unless the screen
 * is too short to fit.
 */
export function AuthShell({ children, welcome = false, entrance = false, onHome }: {
  children: React.ReactNode
  welcome?: boolean
  /** Stagger the sections in as the boot splash clears (first screen only). */
  entrance?: boolean
  /** Form steps: where the logo takes the user (the welcome page). */
  onHome?: () => void
}) {
  const splashDone = useSplashDone()
  const rise = (delayMs: number) => !entrance ? { cls: '' }
    : splashDone ? { cls: 'rise-in', style: { animationDelay: `${delayMs}ms` } }
    : { cls: 'opacity-0' }
  const card = rise(300)
  // Web welcome step: the logo follows the user, from the tour to the card and back.
  const [usingCard, setUsingCard] = useState(false)
  const logoInCard = welcome && usingCard

  return (
    <div className="relative h-full overflow-hidden bg-white">
      {/* Decorative blobs only on web */}
      <div aria-hidden className="hidden @5xl:block auth-drift pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-teal-200/40 blur-3xl" />
      <div aria-hidden className="hidden @5xl:block auth-drift pointer-events-none absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full bg-emerald-200/40 blur-3xl" style={{ animationDelay: '-9s' }} />

      <div className="absolute inset-0 overflow-y-auto overscroll-none scrollbar-hide">
        <div className="mx-auto min-h-full w-full max-w-md flex flex-col gap-4 px-4 py-3 @2xl:justify-center @2xl:py-8 @5xl:max-w-6xl @5xl:flex-row @5xl:items-center @5xl:gap-14 @5xl:px-10">
          <AuthHero playing={splashDone} rise={rise} logoHere={!logoInCard} onUse={() => setUsingCard(false)}
            className={`${welcome ? 'flex' : 'hidden @5xl:flex'} flex-none min-w-0 @5xl:flex-1`} />

          <main onFocus={() => setUsingCard(true)} onPointerDown={() => setUsingCard(true)}
            onPointerEnter={e => { if (e.pointerType === 'mouse') setUsingCard(true) }}
            className={`w-full flex flex-col @2xl:flex-none @5xl:w-[27rem] @5xl:shrink-0 flex-1 ${!welcome ? card.cls : ''}`} style={!welcome ? card.style : undefined}>
            <div className="flex flex-1 flex-col px-3 py-2.5 @2xl:px-4 @2xl:py-3 @5xl:p-8">
              {/* Web: where the logo lands; the icons spring out around it as it arrives. */}
              {welcome ? <>
                <BrandCluster className="hidden @5xl:flex mb-3" open={logoInCard} openDelayMs={FLY_MS * 0.55}>
                  {logoInCard && <FlyingLogo />}
                </BrandCluster>
                {children}
              </> : <>
                {/* Mobile: the step sits in the middle of the screen, the rights line at its foot. */}
                <div className="my-auto">
                  <StepBrand onHome={onHome} />
                  {children}
                </div>
                <AuthRights className="pt-4" />
              </>}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
