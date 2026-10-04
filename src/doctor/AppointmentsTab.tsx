import { Page, EmptyState, AddButton } from '@/shared'
import { splitAppts } from '@/shared/lib/schedule'
import type { PatientSection } from './DoctorApp'
import { useVisits } from './useVisits'
import { useDoctor } from './useDoctor'

const head = 'span-all text-[10px] font-semibold uppercase tracking-wider px-1 -mb-2'

/* ─── Appointments ────────────────────────────────────────────────────
   Requests to answer first, then the visits ahead (soonest on top), then
   history. Each card opens its patient, the alert it follows up and the
   documents filed against it. The doctor can also book a visit directly. */
export function AppointmentsTab({ focusId, openPatient }: {
  /** The appointment a link landed on. */
  focusId?: string
  openPatient: (id: string, section?: PatientSection, docId?: string) => void
}) {
  const { patients, status, error, reload } = useDoctor()
  const visits = useVisits({
    focusId,
    onPatient: id => openPatient(id, 'visits'),
    onAlert: a => openPatient(a.patientId),
    onDoc: (docId, patientId) => openPatient(patientId, 'docs', docId),
  })
  const { upcoming, history } = splitAppts(visits.mine)
  const requests = upcoming.filter(a => a.status === 'requested')
  const ahead = upcoming.filter(a => a.status !== 'requested')
  const canBook = patients.length > 0

  return (
    <Page title="Appointments" actions={canBook ? <AddButton onClick={() => visits.book()} label="Book a visit" /> : undefined}
      status={status} error={error} onRetry={reload}>
      {visits.toast && <div className="span-all">{visits.toast}</div>}

      {visits.mine.length === 0 && (
        <div className="span-all">
          <EmptyState icon="📅" title="No appointments yet"
            text={canBook ? 'Requests from your patients appear here. You can also book a visit yourself.' : 'Requests from your patients appear here.'}
            action={canBook ? 'Book a visit' : undefined} onAction={() => visits.book()} />
        </div>
      )}

      {requests.length > 0 && <p className={`${head} text-amber-600`}>Requests to answer · {requests.length}</p>}
      {requests.map(visits.card)}

      {ahead.length > 0 && <p className={`${head} text-gray-400`}>Upcoming · {ahead.length}</p>}
      {ahead.map(visits.card)}

      {history.length > 0 && <p className={`${head} text-gray-400`}>History · {history.length}</p>}
      {history.map(visits.card)}

      {visits.sheets}
    </Page>
  )
}
