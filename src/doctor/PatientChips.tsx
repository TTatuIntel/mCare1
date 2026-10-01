import { useApp } from '@/shared/state/AppContext'
import type { PatientUser } from '@/shared/lib/types'
import { evaluate, latestValid } from '@/shared/lib/vitals'

export function PatientChips({ p }: { p: PatientUser }) {
  const { vitalDefs } = useApp()
  return (
    <div className="flex gap-1.5 mt-2 flex-wrap">
      {p.trackedVitalIds.slice(0, 4).map(id => {
        const def = vitalDefs.find(v => v.id === id)
        const r = latestValid(p, id)
        if (!def || !r) return null
        const l = evaluate(p, def, r.value)
        return (
          <span key={id} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${l === 'critical' ? 'bg-red-50 text-red-600' : l === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
            {def.icon} {r.value}
          </span>
        )
      })}
    </div>
  )
}
