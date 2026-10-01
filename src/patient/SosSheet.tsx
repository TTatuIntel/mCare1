import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, inputCls } from '@/shared'
import { usePatient } from './usePatient'

/* ─── SOS ───────────────────────────────────────────────────────────── */
export function SosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { raiseSOS } = useApp()
  const { patient, doctor } = usePatient()
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)
  const close = () => { setSent(false); setMsg(''); onClose() }
  return (
    <BottomSheet open={open} onClose={close} title={sent ? 'Help is on the way' : '🚨 Send SOS?'}
      subtitle={sent ? undefined : 'Your doctor and the mCare care team are alerted immediately.'}
      footer={sent
        ? <SheetButton onClick={close}>Close</SheetButton>
        : <><SheetButton tone="ghost" onClick={close}>Cancel</SheetButton><SheetButton tone="danger" onClick={() => { raiseSOS(patient.id, msg.trim()); setSent(true) }}>Send SOS</SheetButton></>}>
      {sent ? (
        <div className="text-center py-4">
          <p className="text-4xl mb-2">✅</p>
          <p className="text-sm text-gray-700">{doctor ? `${doctor.name} and the care team` : 'The care team'} have been alerted.</p>
          <p className="text-xs text-red-600 font-semibold mt-3">If you are in immediate danger, call 999 or 112 now.</p>
          <div className="flex gap-2 mt-4">
            <a href="tel:999" className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-bold">📞 Call 999</a>
            {(patient.emergencyContacts ?? [])[0] && (
              <a href={`tel:${patient.emergencyContacts![0].phone}`} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-800 text-sm font-bold">📞 {patient.emergencyContacts![0].name.split(' ')[0]}</a>
            )}
          </div>
        </div>
      ) : (
        <>
          <Field label="What's happening? (optional)">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['Chest pain', 'Difficulty breathing', 'Feeling faint', 'Fell down'].map(q => (
                <button key={q} onClick={() => setMsg(q)} className={`text-[11px] px-2.5 py-1 rounded-full border ${msg === q ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600'}`}>{q}</button>
              ))}
            </div>
            <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Describe briefly" className={inputCls} />
          </Field>
          <p className="text-xs text-red-600 font-semibold">In a life-threatening emergency, call 999 or 112 first.</p>
        </>
      )}
    </BottomSheet>
  )
}
