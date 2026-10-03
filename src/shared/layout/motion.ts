/**
 * How much the app moves on this device.
 *
 * Phones often ask apps to reduce motion without the person choosing it: iOS "Reduce Motion", Android
 * "Remove animations", and several power-saving modes switch it on. That made mCare on a phone look
 * static next to the same app on a laptop. So the device's setting is the default, and the person can
 * override it here, per device (Profile → Theme & Font → Animations).
 *
 * The result is one attribute on <html>: `data-motion="reduce"` or `"full"`. Everything reads that, never
 * the media query directly:
 *   CSS        `:where(:root[data-motion='reduce']) .thing { … }` (index.css)
 *   Tailwind   `motion-safe:` / `motion-reduce:` (redefined in index.css to follow the attribute)
 *   scripts    `reducedMotion()`
 * index.html sets the same attribute before the first paint, so the boot splash agrees.
 */
import { useSyncExternalStore } from 'react'

export type MotionPref = 'device' | 'full' | 'reduced'

/** Also read by the inline script in index.html. */
const KEY = 'mcare-motion'
const QUERY = '(prefers-reduced-motion: reduce)'

const listeners = new Set<() => void>()
const media = () => (typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined)

function readPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'full' || v === 'reduced' ? v : 'device'
  } catch { return 'device' }
}
let current: MotionPref = readPref()

/** True when this device asks apps to reduce motion. */
export const deviceReducesMotion = () => !!media()?.matches

const resolve = (pref: MotionPref) => pref === 'reduced' || (pref === 'device' && deviceReducesMotion())

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.motion = resolve(readPref()) ? 'reduce' : 'full'
  listeners.forEach(l => l())
}

/** True when the app should keep still: decorative loops off, arrivals fade instead of moving. */
export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return false
  const set = document.documentElement.dataset.motion
  return set ? set === 'reduce' : resolve(readPref())
}

export function setMotionPref(pref: MotionPref) {
  try {
    if (pref === 'device') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch { /* private mode: the choice lasts until the page is closed */ }
  current = pref
  apply()
}

/** Called once at start-up (main.tsx); follows the device setting when it changes. */
export function startMotion() {
  apply()
  media()?.addEventListener?.('change', apply)
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => `${current}|${deviceReducesMotion()}`

/** The person's choice on this device, and whether the device itself asks for less motion. */
export function useMotionPref(): { pref: MotionPref; deviceReduces: boolean; setPref: (p: MotionPref) => void } {
  const [pref, reduces] = useSyncExternalStore(subscribe, snapshot, () => 'device|false').split('|')
  return { pref: pref as MotionPref, deviceReduces: reduces === 'true', setPref: setMotionPref }
}
