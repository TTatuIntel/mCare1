import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import type { DoctorUser } from '@/shared/lib/types'
import { riskScore, riskBand } from '@/shared/lib/vitals'

/** Shared hook: my patients with live risk, sorted most urgent first. */
export function useBoard(doctor: DoctorUser) {
  const { getPatients, alerts, vitalDefs, messages, now } = useApp()
  return getPatients()
    .filter(p => doctor.assignedPatientIds.includes(p.id))
    .map(p => {
      const open = alerts.filter(a => a.patientId === p.id && isActiveAlert(a))
      const score = riskScore(p, vitalDefs, open, now)
      const lastAt = p.readings.find(r => r.at)?.at
      const unread = messages.filter(m => m.fromId === p.id && m.toId === doctor.id && !m.read).length
      return { p, open, score, band: riskBand(score), lastAt, unread }
    })
    .sort((a, b) => b.score - a.score)
}
