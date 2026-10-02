import { Page, Inbox, EmptyState } from '@/shared'
import type { InboxPerson } from '@/shared'
import { useDoctor } from './useDoctor'

/* ─── Messages ────────────────────────────────────────────────────────
   One conversation per patient, unread first, then the most recent. These
   are the same messages the patient sees in their Chat tab. A conversation
   with a patient who has moved to another doctor stays readable, and
   nothing more can be sent to them. */
export function MessagesTab({ openId, onOpen, openRecord }: {
  openId: string | null
  onOpen: (patientId: string | null) => void
  openRecord: (patientId: string) => void
}) {
  const { doctor, patients, patient, messagePartners, nameOf, status, error, reload } = useDoctor()
  const people: InboxPerson[] = [
    ...patients.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, subtitle: p.phone || 'Your patient' })),
    ...messagePartners.filter(id => !patient(id)).map(id => ({
      id, name: nameOf(id, 'A former patient'), subtitle: 'Former patient',
      closed: 'This patient is no longer under your care. The conversation is kept for you to read.',
    })),
  ]
  return (
    <Page title="Messages" fill status={status} error={error} onRetry={reload}>
      <Inbox meId={doctor.id} people={people} openId={openId} onOpen={onOpen}
        action={p => patient(p.id) && (
          <button onClick={() => openRecord(p.id)} className="text-[11px] font-bold text-teal-700 border border-teal-200 px-2.5 py-1 rounded-full flex-shrink-0">Open record</button>
        )}
        empty={<EmptyState icon="💬" title="No conversations yet" text="You can message a patient once they are assigned to you." />} />
    </Page>
  )
}
