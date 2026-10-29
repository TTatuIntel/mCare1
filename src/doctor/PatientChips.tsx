import { useDoctor } from './useDoctor'
import type { PatientUser } from '@/shared/lib/types'
import { levelOf, latestValid } from '@/shared/lib/vitals'
import { conditionGaps } from '@/shared/lib/health'
import { useApp } from '@/shared/state/AppContext'

export function PatientChips({ p }: { p: PatientUser }) {
  const { vitalDefs } = useDoctor()
  const { conditionDefs } = useApp()
  // Vitals the patient's conditions call for that they do not record: worth a look on the patient's Vitals.
  const gaps = conditionGaps(p, vitalDefs.filter(v => v.active).map(v => v.id), conditionDefs)
  return (
    <div className="flex gap-1.5 mt-2 flex-wrap">
      {p.trackedVitalIds.slice(0, 4).map(id => {
        const def = vitalDefs.find(v => v.id === id)
        const r = latestValid(p, id)
        if (!def || !r) return null
        const l = levelOf(p, def, r)
        return (
          <span key={id} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${l === 'critical' ? 'bg-red-50 text-red-600' : l === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
            {def.icon} {r.value}
          </span>
        )
      })}
      {gaps.length > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700"
          title={gaps.map(g => `${g.conditions.join(', ')}: ${vitalDefs.find(v => v.id === g.vitalId)?.name} not tracked`).join(' · ')}>
          ⚑ {gaps.length} not tracked
        </span>
      )}
    </div>
  )
}
