import { useState } from 'react'
import { usePatient } from './usePatient'
import { AddButton, BottomSheet, SheetButton, Field, inputCls, Pill, Toggle } from '@/shared'

/* ─── Emergency contacts ─────────────────────────────────────────── */
export function EmergencyContacts() {
  const { patient, saveEmergencyContact, removeEmergencyContact } = usePatient()
  const contacts = patient.emergencyContacts ?? []
  const [open, setOpen] = useState(false)
  const hasKin = contacts.some(c => c.nextOfKin)
  const [f, setF] = useState({ name: '', relationship: '', phone: '', nextOfKin: false })
  const ok = f.name.trim() && f.phone.replace(/\D/g, '').length >= 9
  const openAdd = () => { setF({ name: '', relationship: '', phone: '', nextOfKin: !hasKin }); setOpen(true) }
  const save = () => {
    if (!ok) return
    saveEmergencyContact({ name: f.name.trim(), relationship: f.relationship.trim() || 'Contact', phone: f.phone.trim(), nextOfKin: f.nextOfKin })
    setOpen(false)
  }
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-900">Emergency Contacts</p>
        <AddButton onClick={openAdd} />
      </div>
      {contacts.length === 0 && <p className="text-xs text-orange-600">Add at least one person we can call if you send an SOS.</p>}
      {contacts.map(c => (
        <div key={c.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">
              {c.name} <span className="text-xs text-gray-400 font-normal">· {c.relationship}</span>
              {c.nextOfKin && <span className="ml-1.5 align-middle"><Pill color="teal">Next of kin</Pill></span>}
            </p>
            <p className="text-xs text-gray-500">{c.phone}</p>
          </div>
          <button onClick={() => removeEmergencyContact(c.id)}
            className="text-[11px] text-red-500 font-bold">Remove</button>
        </div>
      ))}
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add Emergency Contact"
        footer={<><SheetButton tone="ghost" onClick={() => setOpen(false)}>Cancel</SheetButton><SheetButton disabled={!ok} onClick={save}>Save</SheetButton></>}>
        <Field label="Name *"><input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} className={inputCls} /></Field>
        <Field label="Relationship"><input value={f.relationship} placeholder="e.g. Spouse, Parent" onChange={e => setF(x => ({ ...x, relationship: e.target.value }))} className={inputCls} /></Field>
        <Field label="Phone *"><input type="tel" value={f.phone} placeholder="+254 7XX XXX XXX" onChange={e => setF(x => ({ ...x, phone: e.target.value }))} className={inputCls} /></Field>
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-semibold text-gray-800">Next of kin</p>
            <p className="text-[10px] text-gray-400">{hasKin ? 'Replaces your current next of kin' : 'The first person we call'}</p>
          </div>
          <Toggle on={f.nextOfKin} onChange={() => setF(x => ({ ...x, nextOfKin: !x.nextOfKin }))} />
        </div>
      </BottomSheet>
    </div>
  )
}
