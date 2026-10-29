/**
 * A number that counts to its value: from 0 when it first appears, then from the old value to the new
 * one when it changes, over about half a second. With reduced motion it is simply the value.
 *
 * The text is always one number (no hidden copy), so what is read or copied is what is shown; a screen
 * reader is not told about the frames in between.
 */
import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '@/shared/layout/motion'

const DURATION = 520

export function CountUp({ value, className }: { value: number; className?: string }) {
  const decimals = Number.isInteger(value) ? 0 : Math.min(2, (String(value).split('.')[1] ?? '').length)
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0))
  const from = useRef(shown)
  useEffect(() => {
    if (reducedMotion() || from.current === value) { from.current = value; setShown(value); return }
    const start = performance.now(), a = from.current
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / DURATION)
      const eased = 1 - Math.pow(1 - k, 3)
      const v = a + (value - a) * eased
      from.current = v
      setShown(k < 1 ? v : value)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className={`tabular-nums ${className ?? ''}`}>{shown.toFixed(decimals)}</span>
}

/** A figure passed as a node: a plain number counts up, anything else is shown as it is. */
export const countable = (v: React.ReactNode) => (typeof v === 'number' && Number.isFinite(v) ? <CountUp value={v} /> : v)
