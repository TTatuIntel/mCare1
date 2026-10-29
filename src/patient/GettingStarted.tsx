import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BottomSheet, CloseButton } from '@/shared/ui/BottomSheet'
import { healthGaps } from '@/shared/lib/health'
import type { PatientUser } from '@/shared/lib/types'

/** One step of a new patient's start: done or not, and where a tap takes them. */
export interface StartStep { key: string; icon: string; title: string; sub: string; done: boolean; onOpen: () => void }

/**
 * What a patient without a treating doctor can do while they wait: finish the health details,
 * log a first reading, add a next of kin and ask for a doctor. Built only from the record already loaded.
 */
export function startSteps(patient: PatientUser, open: { setup: () => void; log: () => void; profile: () => void; care: () => void }): StartStep[] {
  const gaps = healthGaps(patient).filter(g => g !== 'Next of kin')
  const req = patient.doctorRequest
  const kin = (patient.emergencyContacts ?? []).length > 0
  return [
    { key: 'profile', icon: '📝', title: 'Finish your health details', done: gaps.length === 0,
      sub: gaps.length ? `Still to add: ${gaps.join(', ').toLowerCase()}` : 'Done', onOpen: gaps.length ? open.setup : open.profile },
    { key: 'reading', icon: '🩺', title: 'Log your first reading', done: patient.readings.length > 0,
      sub: patient.readings.length ? 'Done' : 'Your doctor will see it as soon as they take you on', onOpen: open.log },
    { key: 'kin', icon: '👪', title: 'Add a next of kin', done: kin, sub: kin ? 'Done' : 'Who we reach in an emergency', onOpen: open.profile },
    { key: 'doctor', icon: '👩‍⚕️', title: 'Ask for a doctor', done: req?.status === 'pending',
      sub: req?.status === 'pending' ? 'Request sent: being reviewed'
        : req?.status === 'rejected' ? 'Your last request was not approved: choose again'
        : 'Pick one, or the care team will assign you one', onOpen: open.care },
  ]
}

/* Closing the reminder hides it for the rest of the day on this device (a convenience only: nothing clinical). */
const today = () => new Date().toISOString().slice(0, 10)
const keyOf = (id: string) => `mcare.gettingStarted.closed.${id}`
const closedToday = (id: string) => { try { return localStorage.getItem(keyOf(id)) === today() } catch { return false } }
const rememberClosed = (id: string) => { try { localStorage.setItem(keyOf(id), today()) } catch { /* private window: just close */ } }

/**
 * A small reminder that floats over the home screen for a patient with no treating doctor yet: it takes no
 * room in the page, shows the next step, opens every step in a sheet, and can be closed (until tomorrow).
 */
export function GettingStarted({ patientId, steps, waiting }: { patientId: string; steps: StartStep[]; waiting: boolean }) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => { setRoot(document.getElementById('sheet-root')) }, [])
  const [closed, setClosed] = useState(() => closedToday(patientId))
  const [showAll, setShowAll] = useState(false)
  const done = steps.filter(s => s.done).length
  const next = steps.find(s => !s.done)
  const close = () => { rememberClosed(patientId); setClosed(true) }

  const popup = !closed && (
    <section aria-label="Getting started" role="region"
      className="absolute z-10 pointer-events-auto top-24 left-4 right-4 @2xl:left-auto @2xl:right-6 @2xl:w-80
        bg-white/70 backdrop-blur-md backdrop-saturate-150 rounded-2xl shadow-lg ring-1 ring-white/60 border border-teal-100/60 p-3 motion-safe:animate-[rise-in_.45s_ease-out_both]">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-lg flex-shrink-0">
          {next?.icon ?? '⏳'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider">Getting started · {done}/{steps.length}</p>
          <p className="text-sm font-bold text-gray-900 leading-snug">
            {next ? `Next: ${next.title}` : waiting ? 'Waiting for your doctor' : 'All set'}
          </p>
          <p className="text-[11px] text-gray-500 leading-snug mt-0.5">
            Your medicines and meal plan start once a doctor is caring for you.
          </p>
        </div>
        <CloseButton onClick={close} label="Close getting started" className="-mt-1 -mr-1" />
      </div>
      <div className="mt-2 bg-teal-900/10 rounded-full h-1" aria-hidden="true">
        <div className="bg-teal-600 rounded-full h-1 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2">
        <button type="button" onClick={() => setShowAll(true)}
          className="py-1.5 px-3 rounded-full bg-white/70 text-teal-700 text-[11px] font-bold hover:bg-white transition-colors">
          All steps
        </button>
        {next && (
          <button type="button" onClick={next.onOpen} aria-label={next.title}
            className="py-1.5 px-3 rounded-full bg-teal-700 text-white text-[11px] font-bold active:scale-[.97] transition-transform">
            {next.key === 'reading' ? 'Log now' : next.key === 'doctor' ? 'Find one' : 'Do it'} →
          </button>
        )}
      </div>
    </section>
  )

  return (
    <>
      {popup && (root ? createPortal(popup, root) : popup)}
      <BottomSheet open={showAll} onClose={() => setShowAll(false)} title={`Getting started · ${done}/${steps.length}`}
        subtitle={waiting ? 'Your request for a doctor is being reviewed.' : 'Your medicines and meal plan start once a doctor is caring for you.'}>
        <ul className="flex flex-col gap-1.5 pb-4">
          {steps.map(s => (
            <li key={s.key}>
              <button type="button" onClick={() => { setShowAll(false); s.onOpen() }}
                className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-gray-50">
                <span aria-hidden="true"
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm ${s.done ? 'bg-emerald-500 text-white' : 'bg-teal-50'}`}>
                  {s.done ? '✓' : s.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-medium truncate ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.title}</span>
                  <span className="block text-[11px] text-gray-400 truncate">{s.sub}</span>
                </span>
                <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  )
}
