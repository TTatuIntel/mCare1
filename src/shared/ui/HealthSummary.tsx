import type { PatientUser } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { COMMON_CONDITIONS, healthOf, sexLabel, type HealthSection } from '@/shared/lib/health'
import { useApp } from '@/shared/state/AppContext'

const SEVERITY_CLS = {
  severe: 'bg-red-100 text-red-700',
  moderate: 'bg-amber-100 text-amber-800',
  mild: 'bg-gray-100 text-gray-600',
}

function Block({ title, section, onEdit, children }: {
  title: string; section: HealthSection; onEdit?: (s: HealthSection) => void; children: React.ReactNode
}) {
  return (
    <div className="py-3 border-b border-gray-50 last:border-0 last:pb-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{title}</p>
        {onEdit && <button onClick={() => onEdit(section)} className="text-[11px] font-bold text-teal-700">Edit</button>}
      </div>
      {children}
    </div>
  )
}

const NotRecorded = ({ what }: { what: string }) => <p className="text-xs text-gray-400 italic">{what} not recorded</p>

/**
 * The patient's health profile at a glance: allergies first (safety), then
 * conditions and basics. Read-only for the care team; pass `onEdit` to show
 * per-section Edit links for the patient.
 */
export function HealthSummary({ patient, onEdit }: { patient: PatientUser; onEdit?: (s: HealthSection) => void }) {
  const { conditionDefs } = useApp()
  const h = healthOf(patient)
  const age = patient.dob ? calcAge(patient.dob) : null
  const severe = h.allergies.some(a => a.severity === 'severe')

  return (
    <div className="bg-white rounded-2xl px-4 pt-3 pb-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">Health Profile</p>
        {severe && <span className="text-[10px] font-bold text-red-600">⚠ Severe allergy</span>}
      </div>

      <Block title="Allergies" section="allergies" onEdit={onEdit}>
        {h.allergies.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {h.allergies.map(a => (
              <div key={a.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${a.severity === 'severe' ? 'bg-red-50' : 'bg-gray-50'}`}>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900">{a.substance}</p>
                  {a.reaction && <p className="text-[10px] text-gray-500 truncate">{a.reaction}</p>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${SEVERITY_CLS[a.severity]}`}>{a.severity}</span>
              </div>
            ))}
          </div>
        ) : h.noKnownAllergies
          ? <p className="text-xs font-semibold text-emerald-700">✓ No known allergies</p>
          : <NotRecorded what="Allergies" />}
      </Block>

      <Block title="Long-term conditions" section="conditions" onEdit={onEdit}>
        {h.conditions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {h.conditions.map(c => (
              <span key={c} className="text-[11px] font-semibold text-gray-700 bg-gray-100 rounded-full px-2.5 py-1">
                {(conditionDefs.length ? conditionDefs : COMMON_CONDITIONS).find(x => x.name.toLowerCase() === c.toLowerCase())?.icon ?? '🩺'} {c}
              </span>
            ))}
          </div>
        ) : h.noConditions
          ? <p className="text-xs font-semibold text-emerald-700">✓ No long-term conditions</p>
          : <NotRecorded what="Conditions" />}
        {h.otherMedicines && (
          <p className="text-[11px] text-gray-500 mt-2"><span className="font-semibold text-gray-700">Also takes:</span> {h.otherMedicines}</p>
        )}
      </Block>

      <Block title="About" section="about" onEdit={onEdit}>
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Age', v: age !== null ? `${age}` : '—' },
            { l: 'Sex', v: sexLabel(h.sex) ?? '—' },
            { l: 'Blood type', v: h.bloodType ?? '—' },
          ].map(x => (
            <div key={x.l} className="bg-gray-50 rounded-xl py-2 text-center">
              <p className="text-sm font-black text-gray-900 font-mono">{x.v}</p>
              <p className="text-[10px] text-gray-400">{x.l}</p>
            </div>
          ))}
        </div>
      </Block>
    </div>
  )
}

/** One-line allergy warning for places where a clinician acts (e.g. prescribing). Renders nothing if none are recorded. */
export function AllergyBanner({ patient }: { patient: PatientUser }) {
  const h = healthOf(patient)
  if (h.allergies.length === 0) {
    return h.noKnownAllergies ? null : (
      <p className="text-[11px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mb-3">Allergies not recorded. Check with the patient before prescribing.</p>
    )
  }
  return (
    <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3">
      <p className="text-[11px] font-bold text-red-700">⚠ Allergies</p>
      <p className="text-[11px] text-red-700">{h.allergies.map(a => `${a.substance} (${a.severity})`).join(' · ')}</p>
    </div>
  )
}
