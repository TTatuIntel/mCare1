import { useState } from 'react'
import { Page, Inbox, EmptyState } from '@/shared'
import type { InboxPerson } from '@/shared'
import { usePatient } from './usePatient'

/* ─── Messages ────────────────────────────────────────────────────────
   One private conversation with the treating doctor and one with each
   current consulting doctor; only the two people in a thread can read it.
   Threads with doctors no longer on the care team stay here to read, and
   nothing more can be sent to them. */
export function MessagesTab({ go, target }: { go: (t: string) => void; /** The conversation a notification points at. */ target?: string }) {
  const { patient, doctor, consultingDoctors, doctorById, messagePartners, status, error, reload } = usePatient()
  const [openId, setOpenId] = useState<string | null>(target ?? null)
  const currentDoctorIds = new Set([doctor?.id, ...consultingDoctors.map(d => d.id)].filter((id): id is string => !!id))
  const people: InboxPerson[] = [
    ...(doctor ? [{ id: doctor.id, name: doctor.name, avatar: doctor.avatar, subtitle: `${doctor.specialty || 'Treating doctor'} · private chat` }] : []),
    ...consultingDoctors.map(d => ({ id: d.id, name: d.name, avatar: d.avatar, subtitle: `${d.specialty || 'Consulting doctor'} · private chat` })),
    ...messagePartners.filter(id => !currentDoctorIds.has(id)).map(id => {
      const d = doctorById(id)
      return { id, name: d?.name ?? 'A previous doctor', avatar: d?.avatar, subtitle: 'Previous doctor · private history', closed: 'This doctor is no longer on your care team. The private conversation is kept for you to read.' }
    }),
  ]
  return (
    <Page title="Messages" fill status={status} error={error} onRetry={reload}>
      <Inbox meId={patient.id} people={people} openId={openId} onOpen={setOpenId} quickReplies
        notice="Private one-to-one chat · Only you and this doctor can read it · Not monitored 24/7. For emergencies use SOS or call 999."
        empty={<EmptyState icon="💬" title="No doctor on your care team yet" text="Choose a doctor to start a private conversation."
          action="Go to Care Team" onAction={() => go('care')} />} />
    </Page>
  )
}
