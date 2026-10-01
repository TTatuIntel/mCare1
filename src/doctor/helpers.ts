import type { Appointment } from '@/shared/lib/types'

export function statusColor(s: Appointment['status']) {
  return s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'rescheduled' ? 'blue' : s === 'completed' ? 'gray' : 'amber'
}

export const fmtDate = (iso: string) => iso ? new Date(iso + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export const fmtTime = (hm: string) => {
  if (!hm) return ''
  const [h, m] = hm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
