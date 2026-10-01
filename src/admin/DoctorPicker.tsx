import { useApp } from '@/shared/state/AppContext'
import { Avatar, BottomSheet, SheetButton } from '@/shared'

/* ─── Patient Assignment Detail ─────────────────────────────────────── */
export default function DoctorPicker({ open, title, excludeId, currentId, onPick, onClose }: {
  open: boolean; title: string; excludeId?: string; currentId?: string; onPick: (id: string) => void; onClose: () => void
}) {
  const { getDoctors } = useApp()
  const docs = getDoctors().filter(d => d.approvalStatus === 'approved' && d.status === 'active' && d.id !== excludeId)
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle="Approved, active doctors · sorted by current load"
      footer={<SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>}>
      <div className="flex flex-col gap-2">
        {[...docs].sort((a, b) => a.assignedPatientIds.length - b.assignedPatientIds.length).map(d => (
          <button key={d.id} onClick={() => onPick(d.id)}
            className={`flex items-center gap-3 p-3 rounded-xl text-left ${d.id === currentId ? 'bg-teal-50 border-2 border-teal-400' : 'bg-gray-50 border-2 border-transparent'}`}>
            <Avatar name={d.name} avatar={d.avatar} size="xs" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{d.name}</p>
              <p className="text-xs text-gray-500 truncate">{d.specialty} · {d.hospital}</p>
              <p className="text-[10px] text-gray-400">{d.assignedPatientIds.length} patients assigned</p>
            </div>
            {d.id === currentId && <span className="text-xs text-teal-600 font-bold flex-shrink-0">Current</span>}
          </button>
        ))}
        {docs.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No other approved doctors available.</p>}
      </div>
    </BottomSheet>
  )
}
