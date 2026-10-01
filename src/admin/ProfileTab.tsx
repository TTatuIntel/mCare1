import { PageTitle, ProfileCard } from '@/shared'

/* ─── Profile Tab ───────────────────────────────────────────────────── */
export default function ProfileTab() {
  return (
    <div className="flex flex-col gap-0">
      <PageTitle title="Profile" />
      <div className="mt-3">
        <ProfileCard />
      </div>
    </div>
  )
}
