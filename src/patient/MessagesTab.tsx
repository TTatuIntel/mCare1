import { Page, ChatThread, EmptyState } from '@/shared'
import { usePatient } from './usePatient'

/* ─── Messages ──────────────────────────────────────────────────────── */
export function MessagesTab({ go }: { go: (t: string) => void }) {
  const { patient, doctor, status, error, reload } = usePatient()
  return (
    <Page title="Messages" fill status={status} error={error} onRetry={reload}>
      {doctor ? (
        <ChatThread
          meId={patient.id} otherId={doctor.id} otherName={doctor.name}
          subtitle={`${doctor.specialty} · replies within working hours`}
          fill quickReplies notice="Not monitored 24/7 · For emergencies use SOS or call 999"
        />
      ) : (
        <EmptyState icon="💬" title="No doctor assigned yet" text="Choose a doctor to start a secure conversation."
          action="Go to Care Team" onAction={() => go('care')} />
      )}
    </Page>
  )
}
