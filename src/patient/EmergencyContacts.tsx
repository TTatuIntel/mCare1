import { useState } from 'react'
import { usePatient } from './usePatient'
import { AddButton, BottomSheet, SheetButton, Field, inputCls, Pill, Toggle, SaveError, useSave } from '@/shared'
import type { EmergencyContact } from '@/shared/lib/types'
import { RELATIONSHIPS } from '@/shared/lib/health'

const MAX_CONTACTS = 5
const EMPTY = { id: undefined as string | undefined, name: '', relationship: '', phone: '', nextOfKin: false }

/* ─── Emergency contacts ───────────────────────────────────────────
   The people mCare offers to call when the patient sends an SOS. One of
   them is the next of kin and is listed first. Contacts can be added,
   changed and removed. */
export function EmergencyContacts() {
  const { patient, saveEmergencyContact, removeEmergencyContact } = usePatient()
  const contacts = patient.emergencyContacts ?? []
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState<EmergencyContact | null>(null)
  const hasKin = contacts.some(c => c.nextOfKin)
  const [f, setF] = useState(EMPTY)
  const save = useSave()
  const ok = !!f.name.trim() && f.phone.replace(/\D/g, '').length >= 7

  const openAdd = () => { setF({ ...EMPTY, nextOfKin: !hasKin }); save.clear(); setOpen(true) }
  const openEdit = (c: EmergencyContact) => { setF({ id: c.id, name: c.name, relationship: c.relationship, phone: c.phone, nextOfKin: !!c.nextOfKin }); save.clear(); setOpen(true) }
  const submit = async () => {
    if (!ok) return
    const res = await save.run(() => saveEmergencyContact({ id: f.id, name: f.name.trim(), relationship: f.relationship.trim() || 'Contact', phone: f.phone.trim(), nextOfKin: f.nextOfKin }))
    if (res.ok) setOpen(false)
  }
  const remove = async () => {
    if (!removing) return
    if ((await save.run(() => removeEmergencyContact(removing.id))).ok) setRemoving(null)
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-900">Emergency Contacts</p>
        {contacts.length < MAX_CONTACTS && <AddButton onClick={openAdd} />}
      </div>
      {contacts.length === 0 && <p className="text-xs text-orange-600">Add at least one person we can call if you send an SOS.</p>}
      {contacts.map(c => (
        <div key={c.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* "Next of kin" is said once: by the pill, not again as the relationship. */}
              {c.nextOfKin && <Pill color="teal">Next of kin</Pill>}
              {!(c.nextOfKin && /^next of kin$/i.test(c.relationship)) && <span className="text-xs text-gray-400">{c.relationship}</span>}
            </div>
            <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="text-xs text-teal-700 font-mono">{c.phone}</a>
          </div>
          <button onClick={() => openEdit(c)} className="text-[11px] text-teal-700 font-bold px-1">Edit</button>
          <button onClick={() => { save.clear(); setRemoving(c) }} className="text-[11px] text-red-500 font-bold px-1">Remove</button>
        </div>
      ))}

      <BottomSheet open={open} onClose={() => setOpen(false)} title={f.id ? 'Edit emergency contact' : 'Add emergency contact'}
        footer={<><SheetButton tone="ghost" onClick={() => setOpen(false)}>Cancel</SheetButton>
          <SheetButton disabled={!ok || save.busy} onClick={submit}>{save.busy ? 'Saving…' : 'Save'}</SheetButton></>}>
        <Field label="Name *"><input value={f.name} maxLength={80} autoComplete="off" onChange={e => setF(x => ({ ...x, name: e.target.value }))} className={inputCls} /></Field>
        <Field label="Relationship">
          <input value={f.relationship} list="mcare-relationships" maxLength={40} placeholder="e.g. Spouse, Parent" onChange={e => setF(x => ({ ...x, relationship: e.target.value }))} className={inputCls} />
          <datalist id="mcare-relationships">{RELATIONSHIPS.map(r => <option key={r} value={r} />)}</datalist>
        </Field>
        <Field label="Phone *">
          <input type="tel" inputMode="tel" value={f.phone} maxLength={24} placeholder="+254 7XX XXX XXX" onChange={e => setF(x => ({ ...x, phone: e.target.value }))} className={inputCls} />
          {f.phone.trim() !== '' && !ok && f.name.trim() !== '' && <p className="text-[11px] text-red-500 mt-1">Enter the full phone number.</p>}
        </Field>
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-semibold text-gray-800">Next of kin</p>
            <p className="text-[10px] text-gray-400">{hasKin && !contacts.find(c => c.id === f.id)?.nextOfKin ? 'Replaces your current next of kin' : 'The first person we call'}</p>
          </div>
          <Toggle on={f.nextOfKin} onChange={() => setF(x => ({ ...x, nextOfKin: !x.nextOfKin }))} />
        </div>
        <SaveError message={save.error} className="mt-2" />
      </BottomSheet>

      <BottomSheet open={!!removing} onClose={() => setRemoving(null)} title="Remove this contact?" subtitle={removing ? `${removing.name} · ${removing.phone}` : undefined}
        footer={<><SheetButton tone="ghost" onClick={() => setRemoving(null)}>Keep</SheetButton>
          <SheetButton tone="danger" disabled={save.busy} onClick={remove}>{save.busy ? 'Removing…' : 'Remove'}</SheetButton></>}>
        <p className="text-sm text-gray-600">They will no longer be offered when you send an SOS.</p>
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>
    </div>
  )
}
