import { Page, ProfileCard } from '@/shared'
import { useAdmin } from './useAdmin'

/* ─── Profile ───────────────────────────────────────────────────────── */
export default function ProfileTab() {
  const { status, error, reload } = useAdmin()
  return (
    <Page title="Profile" flow={false} status={status} error={error} onRetry={reload}>
      <ProfileCard />
    </Page>
  )
}
