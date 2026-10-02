import { Avatar, BottomSheet, SheetButton, EmptyState } from '@/shared'
import { useAdmin } from './useAdmin'

/* ─── Choosing a doctor for a patient ───────────────────────────────── */
export default function DoctorPicker({ open, title, excludeId, currentId, busy, error, onPick, onClose }: {
  open: boolean; title: string; excludeId?: string; currentId?: string
  /** A save is on its way: the list waits for it. */
  busy?: boolean
  /** Why the last choice could not be saved. */
  error?: React.ReactNode
  onPick: (id: string) => void; onClose: () => void
}) {
  const { assignableDoctors } = useAdmin()
  const docs = assignableDoctors.filter(d => d.id !== excludeId)
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle="Approved, active doctors · fewest patients first"
      footer={<SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>}>
      <div className="flex flex-col gap-2">
        {error}
        {docs.map(d => (
          <button key={d.id} onClick={() => onPick(d.id)} disabled={busy || d.id === currentId}
            className={`flex items-center gap-3 p-3 rounded-xl text-left disabled:opacity-60 ${d.id === currentId ? 'bg-teal-50 border-2 border-teal-400' : 'bg-gray-50 border-2 border-transparent'}`}>
            <Avatar name={d.name} avatar={d.avatar} size="xs" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{d.name}</p>
              <p className="text-xs text-gray-500 truncate">{d.specialty || 'No specialty given'} · {d.hospital || 'No facility given'}</p>
              <p className="text-[10px] text-gray-400">{d.assignedPatientIds.length} patient{d.assignedPatientIds.length === 1 ? '' : 's'} assigned</p>
            </div>
            {d.id === currentId && <span className="text-xs text-teal-600 font-bold flex-shrink-0">Current</span>}
          </button>
        ))}
        {docs.length === 0 && <EmptyState icon="🩺" title="No doctor available" text="A doctor can be assigned once their application is approved and their account is active." />}
      </div>
    </BottomSheet>
  )
}
