import { Page, Inbox, EmptyState } from '@/shared'
import type { InboxPerson } from '@/shared'
import { useDoctor } from './useDoctor'

/* ─── Messages ────────────────────────────────────────────────────────
   One private conversation per treated or consulted patient, unread first,
   then the most recent. These are the same messages the patient sees in
   their Chat tab. A conversation with a patient no longer under this
   doctor's care stays readable, and nothing more can be sent to them. */
export function MessagesTab({ openId, onOpen, openRecord }: {
  openId: string | null
  onOpen: (patientId: string | null) => void
  openRecord: (patientId: string) => void
}) {
  const { doctor, patients, consulting, patient, messagePartners, nameOf, status, error, reload } = useDoctor()
  const currentPatients = new Map(patients.map(p => [p.id, { person: p, consulting: false }]))
  consulting.forEach(({ patient: p }) => currentPatients.set(p.id, { person: p, consulting: true }))
  const people: InboxPerson[] = [
    ...[...currentPatients.values()].map(({ person: p, consulting: isConsulting }) => ({
      id: p.id, name: p.name, avatar: p.avatar,
      subtitle: isConsulting ? 'Consulting patient · private chat' : 'Your patient · private chat',
    })),
    ...messagePartners.filter(id => !currentPatients.has(id)).map(id => ({
      id, name: nameOf(id, 'A former patient'), subtitle: 'Former patient',
      closed: 'This patient is no longer under your care. The private conversation is kept for you to read.',
    })),
  ]
  return (
    <Page title="Messages" fill status={status} error={error} onRetry={reload}>
      <Inbox meId={doctor.id} people={people} openId={openId} onOpen={onOpen}
        action={p => patient(p.id) && (
          <button onClick={() => openRecord(p.id)} className="text-[11px] font-bold text-teal-700 border border-teal-200 px-2.5 py-1 rounded-full flex-shrink-0">Open record</button>
        )}
        empty={<EmptyState icon="💬" title="No conversations yet" text="You can message patients assigned to you or on your consulting care team." />} />
    </Page>
  )
}
