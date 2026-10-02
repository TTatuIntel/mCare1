/** The doctor's handwritten signature: set once in Profile, stamped onto every report they sign. */
import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { DoctorUser } from '@/shared/lib/types'
import { BottomSheet, SheetButton, SaveError, useSave } from '@/shared/ui/BottomSheet'
import { SignaturePad } from '@/shared/ui/SignaturePad'

export function SignatureSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { setMySignature } = useApp()
  const [drawn, setDrawn] = useState<string | null>(null)
  const save = useSave()
  // The sheet closes once the signature is saved; until then it stays, with the reason if it could not be.
  const submit = async () => { if (drawn && (await save.run(() => setMySignature(drawn))).ok) { onClose(); onSaved?.() } }
  return (
    <BottomSheet open={open} onClose={onClose} title="Your signature"
      subtitle="Placed on every report you sign, with your name, licence number and a verification code. Reports already signed keep the signature they were signed with."
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton>
        <SheetButton disabled={!drawn || save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Save signature'}</SheetButton></>}>
      {open && <SignaturePad key={String(open)} onChange={setDrawn} />}
      <SaveError message={save.error} className="mt-3" />
    </BottomSheet>
  )
}

/** Profile card: shows the saved signature, or asks the doctor to add one. */
export function SignatureCard() {
  const { currentUser, setMySignature } = useApp()
  const [open, setOpen] = useState(false)
  const removing = useSave()
  if (currentUser?.role !== 'doctor') return null
  const sig = (currentUser as DoctorUser).signature
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Report signature</p>
        {sig && <button disabled={removing.busy} onClick={() => removing.run(() => setMySignature(undefined))} className="text-[10px] font-bold text-gray-400 disabled:opacity-50">{removing.busy ? 'Removing…' : 'Remove'}</button>}
      </div>
      <SaveError message={removing.error} className="mb-2" />
      {sig ? (
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
          <img src={sig} alt="Your signature" className="h-14 max-w-full object-contain" />
          <div className="border-t border-gray-300 mt-1 pt-1 text-[10px] text-gray-500">{currentUser.name}</div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Add your handwritten signature so the reports you sign carry it. Until then, reports show your typed name.</p>
      )}
      <button onClick={() => setOpen(true)} className="w-full mt-3 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold">
        {sig ? '✍️ Replace signature' : '✍️ Add signature'}
      </button>
      <SignatureSheet open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
