import { useApp } from '@/shared/state/AppContext'
import type { AdminUser } from '@/shared/lib/types'
import { AdminPortal } from '@/admin/AdminApp'
import { canOpenTab } from './permissions'

/**
 * mCare Assistant portal: the admin screens, limited to the permissions
 * an administrator has granted this assistant.
 */
export default function AssistantApp() {
  const { currentUser } = useApp()
  const me = currentUser as AdminUser
  return <AdminPortal allowed={tab => canOpenTab(me, tab)} />
}
