import { isActiveAlert } from '@/shared/state/AppContext'
import { riskScore, riskBand } from '@/shared/lib/vitals'
import { useDoctor } from './useDoctor'

/** My patients with live risk, sorted most urgent first. */
export function useBoard() {
  const { patients, alerts, vitalDefs, unreadFrom, now } = useDoctor()
  return patients
    .map(p => {
      const open = alerts.filter(a => a.patientId === p.id && isActiveAlert(a))
      const score = riskScore(p, vitalDefs, open, now)
      const lastAt = p.readings.find(r => r.at)?.at
      return { p, open, score, band: riskBand(score), lastAt, unread: unreadFrom(p.id) }
    })
    .sort((a, b) => b.score - a.score)
}
