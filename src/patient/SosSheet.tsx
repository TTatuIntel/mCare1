import { useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls } from '@/shared'
import { usePatient } from './usePatient'

/** Never changes, whatever the state of the app or the network. */
const EMERGENCY_NUMBER = '999'

/* ─── SOS ─────────────────────────────────────────────────────────────
   Alerts the patient's doctor and the mCare care team. It needs the
   network, so the phone numbers are always on the sheet: if the alert
   cannot be sent, the patient is told plainly and can still call. */
export function SosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patient, doctor, raiseSos } = usePatient()
  const [msg, setMsg] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [failure, setFailure] = useState('')
  const close = () => { setState('idle'); setMsg(''); setFailure(''); onClose() }
  const kin = (patient.emergencyContacts ?? [])[0]

  const send = async () => {
    if (state === 'sending') return
    setState('sending')
    const res = await raiseSos(msg.trim())
    if (res.ok) setState('sent')
    else { setFailure(res.error); setState('failed') }
  }

  const calls = (
    <div className="flex gap-2 mt-4">
      <a href={`tel:${EMERGENCY_NUMBER}`} className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-bold text-center">📞 Call {EMERGENCY_NUMBER}</a>
      {kin && (
        <a href={`tel:${kin.phone.replace(/\s/g, '')}`} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-800 text-sm font-bold text-center truncate px-2">📞 {kin.name.split(' ')[0]}</a>
      )}
    </div>
  )

  return (
    <BottomSheet open={open} onClose={close}
      title={state === 'sent' ? 'Your care team has been alerted' : state === 'failed' ? 'The SOS was not sent' : '🚨 Send SOS?'}
      subtitle={state === 'idle' || state === 'sending' ? 'Your doctor and the mCare care team are alerted immediately.' : undefined}
      footer={state === 'sent'
        ? <SheetButton onClick={close}>Close</SheetButton>
        : <><SheetButton tone="ghost" onClick={close}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={state === 'sending'} onClick={send}>{state === 'sending' ? 'Sending…' : state === 'failed' ? 'Try again' : 'Send SOS'}</SheetButton></>}>
      {state === 'sent' ? (
        <div className="text-center py-4">
          <p className="text-4xl mb-2">✅</p>
          <p className="text-sm text-gray-700">{doctor ? `${doctor.name} and the care team` : 'The care team'} can see your SOS.</p>
          <p className="text-xs text-gray-500 mt-1">You can mark yourself safe under My Alerts.</p>
          <p className="text-xs text-red-600 font-semibold mt-3">If you are in immediate danger, call {EMERGENCY_NUMBER} or 112 now.</p>
          {calls}
        </div>
      ) : state === 'failed' ? (
        <div role="alert" className="py-2">
          <p className="text-sm font-bold text-red-700">{failure}</p>
          <p className="text-sm text-gray-700 mt-2">Nobody has been alerted. Call for help directly:</p>
          {calls}
        </div>
      ) : (
        <>
          <Field label="What's happening? (optional)">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {['Chest pain', 'Difficulty breathing', 'Feeling faint', 'Fell down'].map(q => (
                <button key={q} onClick={() => setMsg(q)} className={`text-[11px] px-2.5 py-1 rounded-full border ${msg === q ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600'}`}>{q}</button>
              ))}
            </div>
            <input value={msg} onChange={e => setMsg(e.target.value)} maxLength={200} placeholder="Describe briefly" className={inputCls} />
          </Field>
          <p className="text-xs text-red-600 font-semibold">In a life-threatening emergency, call {EMERGENCY_NUMBER} or 112 first.</p>
          {calls}
        </>
      )}
    </BottomSheet>
  )
}
