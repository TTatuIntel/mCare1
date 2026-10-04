import { Page, ProfileCard } from '@/shared'
import { SignatureCard } from '@/shared/profile/SignatureSheet'
import { useDoctor } from './useDoctor'
import { AvailabilityCard } from './AvailabilityCard'

/* ─── Profile ───────────────────────────────────────────────────────── */
export function ProfileTab() {
  const { status, error, reload } = useDoctor()
  return (
    <Page title="Profile" flow={false} status={status} error={error} onRetry={reload}>
      <ProfileCard><AvailabilityCard /><SignatureCard /></ProfileCard>
    </Page>
  )
}
