import { useState } from 'react'
import { Page, Inbox, EmptyState } from '@/shared'
import type { InboxPerson } from '@/shared'
import { usePatient } from './usePatient'

/* ─── Messages ────────────────────────────────────────────────────────
   The conversation with the doctor who treats this patient. If the doctor
   has changed, the earlier conversations stay here to read; a message can
   only be sent to the doctor who treats them now. */
export function MessagesTab({ go, target }: { go: (t: string) => void; /** The conversation a notification points at. */ target?: string }) {
  const { patient, doctor, doctorById, messagePartners, status, error, reload } = usePatient()
  const [openId, setOpenId] = useState<string | null>(target ?? null)
  const people: InboxPerson[] = [
    ...(doctor ? [{ id: doctor.id, name: doctor.name, avatar: doctor.avatar, subtitle: `${doctor.specialty || 'Your doctor'} · replies within working hours` }] : []),
    ...messagePartners.filter(id => id !== doctor?.id).map(id => {
      const d = doctorById(id)
      return { id, name: d?.name ?? 'A previous doctor', avatar: d?.avatar, subtitle: 'Previous doctor', closed: 'This doctor no longer treats you. The conversation is kept for you to read.' }
    }),
  ]
  return (
    <Page title="Messages" fill status={status} error={error} onRetry={reload}>
      <Inbox meId={patient.id} people={people} openId={openId} onOpen={setOpenId} quickReplies
        notice="Not monitored 24/7 · For emergencies use SOS or call 999"
        empty={<EmptyState icon="💬" title="No doctor assigned yet" text="Choose a doctor to start a private conversation."
          action="Go to Care Team" onAction={() => go('care')} />} />
    </Page>
  )
}
