import { useState } from 'react'
import { NoticeCard } from '@/shared'
import { usePatient } from './usePatient'

/** Remembered per patient and per message, on this device: closing "no doctor yet" does not hide "waiting for your doctor". */
const closedKey = (id: string, awaiting: boolean) => `mcare.planNotice.${id}.${awaiting ? 'awaiting' : 'none'}`
const wasClosed = (key: string) => { try { return localStorage.getItem(key) === '1' } catch { return false } }

/**
 * Floating notice on Home while no doctor treats the patient: why there are no medicines or meals yet.
 * It floats over the screen (PortalShell `notice`) and can be closed.
 */
export function PlanNotice({ go }: { go: (t: string) => void }) {
  const { patient, enrolled } = usePatient()
  const awaiting = patient.doctorRequest?.status === 'pending'
  const key = closedKey(patient.id, awaiting)
  const [closed, setClosed] = useState<string[]>([])
  if (enrolled || closed.includes(key) || wasClosed(key)) return null
  const close = () => {
    try { localStorage.setItem(key, '1') } catch { /* private window: closed for this visit only */ }
    setClosed(c => [...c, key])
  }
  return (
    <div role="status" className="alert-pop rounded-2xl shadow-lg shadow-teal-900/10">
      <NoticeCard tone="teal" pulse={false} onClose={close}
        title={awaiting ? 'Waiting for your doctor' : 'Your daily plan starts with your doctor'}
        action={awaiting ? 'Care team →' : 'Find a doctor →'} onAction={() => go('care')}>
        <p className="text-[11px] text-teal-800">
          {awaiting ? 'Your request is being reviewed. ' : ''}Once a doctor is caring for you, your medicines and meal plan will appear here. Until then you can log your vitals.
        </p>
      </NoticeCard>
    </div>
  )
}
