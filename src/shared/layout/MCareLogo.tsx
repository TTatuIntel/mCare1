/**
 * mCare brand mark: wordmark + EKG pulse line animated like a hospital
 * monitor — a glowing sweep head travels the trace left to right, drawing
 * the waveform behind it and fading the tail out, while the color flips to
 * a random dark monitor hue on every beat, in sync with the QRS spike.
 * Only the "m" pulses and takes that color; "Care" keeps its fixed brand
 * violet.
 *
 * One shared pulse clock drives every logo on screen (splash, login,
 * loading popup) for every role, so they always show the same hue and
 * beat in phase.
 *
 * `size="xl"` is the boot splash hero; `size="sm"` is the compact variant
 * used in the in-app loading popup.
 */
import { useState, useSyncExternalStore } from 'react'
import { EKG_PATH, BRAND_VIOLET } from './brand'

/** One beat — must match the 2.4s keyframes in index.css. */
const BEAT_MS = 2400
/** Where the QRS spike sits in the beat; the hue flips here. */
const QRS_MS = 0.42 * BEAT_MS

/**
 * Dark, saturated monitor hues (Tailwind 700–800 range): legible as text
 * on white and clinical rather than neon.
 */
const PALETTE = [
  '#047857', // emerald
  '#0f766e', // teal
  '#155e75', // deep cyan
  '#1e40af', // clinical blue
  '#3730a3', // indigo
  '#5b21b6', // violet
  '#7e22ce', // purple
  '#9d174d', // deep magenta
  '#9f1239', // crimson
  '#9a3412', // burnt orange
  '#854d0e', // dark amber
  '#3f6212', // olive
]

/* ─── Shared pulse clock ─────────────────────────────────────────────
   Colors come from a shuffle bag: every hue shows once per round in a
   random order, then the bag is reshuffled. That keeps it random while
   still showing the whole palette, and the same hue never lands twice
   in a row, even across a reshuffle. */
let bag: string[] = []
function draw(prev?: string): string {
  if (!bag.length) {
    bag = [...PALETTE]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[bag[i], bag[j]] = [bag[j], bag[i]]
    }
    // pop() takes from the end; don't repeat the hue that just showed
    if (bag[bag.length - 1] === prev) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]
  }
  return bag.pop()!
}

let pulseColor = draw()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

/** Wait until the next QRS spike on the global beat grid (see beatDelay). */
function scheduleBeat() {
  let wait = QRS_MS - (performance.now() % BEAT_MS)
  if (wait < 20) wait += BEAT_MS
  timer = setTimeout(() => {
    pulseColor = draw(pulseColor)
    listeners.forEach(l => l())
    scheduleBeat()
  }, wait)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (listeners.size === 1 && !reduced) scheduleBeat()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) clearTimeout(timer)
  }
}
const getPulseColor = () => pulseColor

/**
 * Negative animation delay that puts a freshly mounted logo on the global
 * beat grid (performance.now() % BEAT_MS), so its sweep and heartbeat line
 * up with the clock's color flips and with any other logo on screen.
 */
const beatDelay = () => `${-(performance.now() % BEAT_MS)}ms`


/** Path length in viewBox units — used for the dash sweep. Approximate is fine. */
const EKG_LEN = 232

function MCareMark({ pulseWidth, dotR }: { pulseWidth: number; dotR: number }) {
  return (
    <svg
      viewBox="0 0 200 40"
      width="100%"
      height="100%"
      fill="none"
      className="mcare-trace"
      style={{ overflow: 'visible' }}
    >
      {/* Ghost baseline — the un-swept grid trace sitting under the live one */}
      <path
        d={EKG_PATH}
        stroke="currentColor"
        strokeWidth={pulseWidth * 0.55}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.12}
      />

      {/* Live trace, drawn in behind the sweep head */}
      <path
        className="mcare-trace-path"
        d={EKG_PATH}
        stroke="currentColor"
        strokeWidth={pulseWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ ['--mcare-len' as string]: EKG_LEN }}
      />

      {/* Glowing sweep head riding the same path. Wrapped in a <g> because
          offset-path on a bare <circle> is unreliable in WebKit. */}
      <g
        className="mcare-sweep-dot"
        style={{ ['--mcare-path' as string]: `path('${EKG_PATH}')` }}
      >
        <circle r={dotR * 2.4} fill="currentColor" opacity={0.25} />
        <circle r={dotR} fill="currentColor" />
      </g>
    </svg>
  )
}

/**
 * A design px value as a length that follows the device and the user's font
 * size (see deviceScale.ts and the font scale in index.css), so the logo
 * always stays in proportion to the text around it.
 */
const scaled = (px: number) => `calc(${px / 16}rem * var(--mcare-font-scale, 1))`

const SIZES = {
  sm: { font: 22, gap: 'gap-1', traceW: 72, traceH: 14, pulseWidth: 2.6, dotR: 2.2 },
  md: { font: 38, gap: 'gap-1', traceW: 132, traceH: 24, pulseWidth: 3.1, dotR: 2.7 },
  lg: { font: 48, gap: 'gap-1.5', traceW: 168, traceH: 30, pulseWidth: 3.4, dotR: 3 },
  xl: { font: 64, gap: 'gap-2.5', traceW: 220, traceH: 40, pulseWidth: 3.6, dotR: 3.2 },
} as const

export function MCareLogo({ size = 'lg' }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size]
  const color = useSyncExternalStore(subscribe, getPulseColor, getPulseColor)
  // Fixed at mount: animations start then, so the offset must too.
  const [delay] = useState(beatDelay)
  return (
    <div
      className={`flex flex-col items-center ${s.gap}`}
      style={{ ['--mcare-pulse-color' as string]: color, ['--mcare-beat-delay' as string]: delay }}
    >
      <div
        className="font-display font-black tracking-tight leading-none"
        style={{ fontSize: scaled(s.font) }}
      >
        {/* only the "m" beats + changes color */}
        <span className="mcare-heartbeat mcare-pulse-text inline-block">m</span>
        <span style={{ color: BRAND_VIOLET }}>Care</span>
      </div>
      <div style={{ width: scaled(s.traceW), height: scaled(s.traceH) }}>
        <MCareMark pulseWidth={s.pulseWidth} dotR={s.dotR} />
      </div>
    </div>
  )
}

export default MCareLogo
