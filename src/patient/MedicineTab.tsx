import { useApp } from '@/shared/state/AppContext'
import { Page, EmptyState } from '@/shared'
import { usePatient } from './usePatient'
import { ANYTIME_SLOT, clock, countdown, isDoseTaken } from '@/shared/lib/schedule'
import { useDaySchedule } from './useDaySchedule'

const CHIP: Record<string, string> = {
  done:     'bg-emerald-500 text-white border-emerald-500',
  late:     'bg-red-50 text-red-600 border-red-200',
  soon:     'bg-amber-50 text-amber-700 border-amber-200',
  upcoming: 'bg-white text-gray-600 border-gray-200',
}

/* ─── Medicine ──────────────────────────────────────────────────────── */
export function MedicineTab() {
  const { doses, toggleDose } = useApp()
  const { patient, nameOf, status, error, reload } = usePatient()
  const day = useDaySchedule()
  const activePrescriptions = patient.prescriptions.filter(rx => rx.active)

  const getDoctorName = (doctorId: string) => nameOf(doctorId, 'Your Doctor')

  return (
    <Page title="Medications" status={status} error={error} onRetry={reload}>

      {activePrescriptions.length === 0 ? (
        <EmptyState icon="💊" title="No active prescriptions" text="Your doctor will prescribe medications here." />
      ) : (
        <>
          {/* next dose — same countdown as the Home reminders */}
          {day.nextMed ? (
            <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${day.nextMed.tone === 'late' ? 'bg-red-50' : day.nextMed.tone === 'soon' ? 'bg-amber-50' : 'bg-teal-50'}`}>
              <span className="text-xl">⏰</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Next dose · {clock(day.nextMed.slot)}</p>
                <p className="text-sm font-bold text-gray-900 truncate">{day.nextMed.title}</p>
              </div>
              <span className={`text-sm font-black ${day.nextMed.tone === 'late' ? 'text-red-600' : day.nextMed.tone === 'soon' ? 'text-amber-700' : 'text-teal-700'}`}>{countdown(day.nextMed.inMin)}</span>
            </div>
          ) : day.doses.total > 0 && (
            <div className="bg-emerald-50 rounded-2xl px-4 py-3 flex items-center gap-2">
              <span className="text-base">✅</span>
              <p className="text-xs text-emerald-700 font-medium">All of today's doses are taken. Nice work!</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[
              { v: day.doses.taken,                   l: 'Doses taken', c: 'text-emerald-600' },
              { v: day.doses.total - day.doses.taken, l: 'Pending',     c: 'text-amber-500'  },
              { v: day.doses.total,                   l: 'Doses today', c: 'text-gray-700'   },
            ].map(({ v, l, c }) => (
              <div key={l} className="bg-white rounded-2xl py-3 text-center shadow-sm">
                <p className={`text-2xl font-black ${c}`}>{v}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{l}</p>
              </div>
            ))}
          </div>

          {activePrescriptions.map(rx => {
            const slots = day.items.filter(x => x.kind === 'med' && x.refId === rx.id)
            const allTaken = slots.length > 0 && slots.every(x => x.done)
            const anytimeTaken = isDoseTaken(doses, patient.id, rx.id, ANYTIME_SLOT)
            return (
              <div key={rx.id} className="bg-white rounded-2xl px-4 py-3.5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${allTaken ? 'bg-emerald-50' : 'bg-teal-50'}`}>💊</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${allTaken ? 'line-through text-gray-400' : 'text-gray-900'}`}>{rx.medication}</p>
                    <p className="text-xs text-gray-500">{rx.purpose} · {rx.frequency}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Prescribed by {getDoctorName(rx.doctorId)} · {rx.prescribedAt}</p>
                  </div>
                </div>
                {/* one chip per scheduled dose; tap to mark taken */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {slots.length > 0 ? slots.map(x => (
                    <button key={x.key} onClick={() => day.toggle(x)} aria-pressed={x.done}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-all active:scale-95 ${CHIP[x.tone]}`}>
                      {x.done ? '✓ ' : ''}{clock(x.slot)}{!x.done && (x.tone === 'late' || x.tone === 'soon') ? ` · ${countdown(x.inMin)}` : ''}
                    </button>
                  )) : (
                    <button onClick={() => toggleDose(patient.id, rx.id, ANYTIME_SLOT)} aria-pressed={anytimeTaken}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-all active:scale-95 ${anytimeTaken ? CHIP.done : CHIP.upcoming}`}>
                      {anytimeTaken ? '✓ Taken today' : 'Log a dose'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Inactive prescriptions */}
          {patient.prescriptions.some(rx => !rx.active) && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">Discontinued</p>
              {patient.prescriptions.filter(rx => !rx.active).map(rx => (
                <div key={rx.id} className="bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3 mb-1.5 opacity-60">
                  <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center text-base flex-shrink-0">💊</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-500 line-through">{rx.medication}</p>
                    <p className="text-xs text-gray-400">{rx.purpose} · {rx.frequency}</p>
                  </div>
                  <span className="text-[9px] bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">Stopped</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  )
}
