import { PageTitle, ProfileCard } from '@/shared'
import { SignatureCard } from '@/shared/profile/SignatureSheet'

/* ─── Profile ───────────────────────────────────────────────────────── */
export function ProfileTab() {
  return (
    <div className="flex flex-col gap-0">
      <PageTitle title="Profile" />
      <div className="mt-3"><ProfileCard><SignatureCard /></ProfileCard></div>
    </div>
  )
}
