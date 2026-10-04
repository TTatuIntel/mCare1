import type { AdminUser, AssistantPerm } from '@/shared/lib/types'
import type { ATab } from '@/admin/AdminApp'

/** Full admins can do everything; an mCare Assistant only what an admin has granted. */
export const can = (user: AdminUser, ...anyOf: AssistantPerm[]) =>
  !user.isAssistant || anyOf.some(p => user.permissions.includes(p))

/** Admin-only actions that are never delegated to assistants. */
export const isFullAdmin = (user: AdminUser) => !user.isAssistant

/** Which permission(s) unlock each staff screen. Screens not listed are open to all staff. */
const TAB_PERMS: Partial<Record<ATab, AssistantPerm[]>> = {
  approvals: ['approve_doctors'],
  alerts:    ['monitor_patients'],
  vitals:    ['monitor_patients'],
  assign:    ['assign_healthworkers', 'approve_patient_requests'],
  users:     ['create_users', 'assign_healthworkers'],
  audit:     ['view_logs'],
  documents: ['document_support'],
  appointments: ['monitor_patients', 'handle_support'],
  support:   ['handle_support'],
  reports:   ['view_logs'],
}

export const canOpenTab = (user: AdminUser, tab: ATab) => {
  // Security and retention settings are never delegated.
  if (tab === 'settings') return isFullAdmin(user)
  const need = TAB_PERMS[tab]
  return !need || can(user, ...need)
}
