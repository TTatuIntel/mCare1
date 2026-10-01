/**
 * Shared UI kit — the single import point for every portal:
 *   import { PageTitle, Pill, BottomSheet } from '@/shared'
 * State and domain logic are imported directly:
 *   '@/shared/state/AppContext', '@/shared/lib/types', '@/shared/lib/vitals', '@/shared/documents/*'
 */
export * from './ui/primitives'
export * from './ui/BottomSheet'
export * from './ui/Page'
export * from './ui/alerts'
export * from './ui/vitals'
export * from './ui/VitalHistory'
export * from './ui/ChatThread'
export * from './ui/NotificationBell'
export * from './ui/home'
export * from './ui/HealthSummary'
export * from './ui/SignaturePad'
export { Loading, useLoader } from './ui/Loader'
export * from './layout/NavBar'
export * from './layout/PortalShell'
export * from './profile/ProfileCard'
