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
          fill quickReplies
        />
      ) : (
        <EmptyState icon="💬" title="No doctor assigned yet" text="Choose a doctor to start a secure conversation."
          action="Go to Care Team" onAction={() => go('care')} />
      )}
      <p className="text-[10px] text-gray-400 text-center flex items-center justify-center gap-1 flex-shrink-0">
        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Not monitored 24/7 · For emergencies use SOS or call 999
      </p>
    </Page>
  )
}
