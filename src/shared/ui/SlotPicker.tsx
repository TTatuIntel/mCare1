import { useEffect, useState } from 'react'
import type { DayAvailability, Outcome } from '@/shared/lib/types'
import { inputCls } from './BottomSheet'

const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

/**
 * The time field of a booking form. For a doctor who keeps a timetable it
 * offers that day's open times; otherwise it is a plain time field. The
 * database checks the choice again when the booking is saved.
 *
 * `load` asks for one doctor's day (the portal's `availabilityFor`).
 * `onBlocked` tells the form the day cannot be booked at all.
 */
export function SlotPicker({ doctorId, day, value, onChange, load, optional, onBlocked }: {
  doctorId: string
  /** YYYY-MM-DD, or '' while no day is chosen. */
  day: string
  /** HH:MM, or '' */
  value: string
  onChange: (time: string) => void
  load: (doctorId: string, day: string) => Promise<Outcome<DayAvailability>>
  /** The person may leave the time open ("any time that day"). */
  optional?: boolean
  onBlocked?: (blocked: boolean) => void
}) {
  const [state, setState] = useState<{ key: string; a?: DayAvailability; error?: string } | null>(null)
  const key = doctorId && day ? `${doctorId}:${day}` : ''
  useEffect(() => {
    if (!key) { setState(null); onBlocked?.(false); return }
    let stale = false
    setState({ key })
    load(doctorId, day).then(r => {
      if (stale) return
      setState(r.ok ? { key, a: r.value } : { key, error: r.error })
      const blocked = r.ok && (r.value.away || (r.value.managed && r.value.slots.length === 0))
      onBlocked?.(blocked)
      // A time picked for another day or doctor may not be open on this one.
      if (r.ok && r.value.managed && value && !r.value.slots.includes(value)) onChange('')
    })
    return () => { stale = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const plain = <input type="time" value={value} onChange={e => onChange(e.target.value)} className={inputCls} aria-label="Time" />
  if (!key) return plain
  if (!state?.a && !state?.error) return <p className="text-xs text-gray-400 py-2.5">Checking open times…</p>
  // Could not ask: let the person choose, and the save will say if the time is not open.
  if (!state.a) return plain
  const a = state.a
  if (a.away) return <p role="status" className="text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl px-3 py-2.5">The doctor is away that day. Choose another day.</p>
  if (!a.managed) return plain
  if (a.slots.length === 0) return <p role="status" className="text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl px-3 py-2.5">No open times that day. Choose another day.</p>
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Open times">
      {optional && (
        <button type="button" role="radio" aria-checked={value === ''} onClick={() => onChange('')}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border-2 ${value === '' ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>Any time</button>
      )}
      {a.slots.map(s => (
        <button type="button" key={s} role="radio" aria-checked={value === s} onClick={() => onChange(s)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold font-mono border-2 ${value === s ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>{clock(s)}</button>
      ))}
    </div>
  )
}
