import { useState } from 'react'
import { inputCls, EmptyState, Pill, Segmented, ChipFilter, BottomSheet, SheetButton, Field, useSave, SaveError, useToast } from '@/shared'
import { NOTE_TYPE_LABELS } from '@/shared/lib/types'
import type { ClinicalNote, NoteType, NoteVisibility, PatientUser } from '@/shared/lib/types'
import { useDoctor } from './useDoctor'

const VISIBILITY: { id: NoteVisibility; label: string }[] = [{ id: 'shared', label: 'Shared with patient' }, { id: 'internal', label: 'Internal' }]
const TYPES = (Object.keys(NOTE_TYPE_LABELS) as NoteType[]).map(id => ({ id, label: NOTE_TYPE_LABELS[id] }))
type Show = 'current' | 'shared' | 'internal' | 'all'
const SHOW: { id: Show; label: string }[] = [{ id: 'current', label: 'Current' }, { id: 'shared', label: 'Shared' }, { id: 'internal', label: 'Internal' }, { id: 'all', label: 'With corrected' }]

/* ─── Clinical notes ──────────────────────────────────────────────────
   Each note is its own record. A shared note is also the patient's to
   read; an internal note stays with the treating doctor. A note is never
   rewritten: to correct one, write the correction, and it replaces the
   original, which stays in the record marked as corrected. */
export function PatientNotes({ patient }: { patient: PatientUser }) {
  const { notesFor, nameOf, addNote } = useDoctor()
  const notes = notesFor(patient.id)
  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<NoteVisibility>('shared')
  const [type, setType] = useState<NoteType>('progress')
  const [show, setShow] = useState<Show>('current')
  const save = useSave()
  const toast = useToast()
  const submit = async () => {
    if (!text.trim()) return
    if (!(await save.run(() => addNote(patient.id, { content: text, visibility, noteType: type, ref: save.ref }))).ok) return
    setText('')
    toast.show(visibility === 'shared' ? 'Note saved · the patient has been told' : 'Internal note saved')
  }

  /* correcting a note */
  const [amending, setAmending] = useState<ClinicalNote | null>(null)
  const [correction, setCorrection] = useState('')
  const amendSave = useSave()
  const amend = async () => {
    if (!amending || !correction.trim()) return
    const saved = await amendSave.run(() => addNote(patient.id, { content: correction, visibility: amending.visibility, noteType: amending.noteType, amends: amending.id, ref: amendSave.ref }))
    if (!saved.ok) return
    setAmending(null)
    toast.show('Correction saved · it replaces the earlier note')
  }

  const list = notes.filter(n => show === 'all' || (!n.amendedBy && (show === 'current' || n.visibility === show)))

  return (
    <>
      {toast.node && <div className="span-all">{toast.node}</div>}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900 mb-2">New Clinical Note</p>
        <Segmented label="Who can read it" options={VISIBILITY} value={visibility} onChange={setVisibility} />
        <p className="text-[10px] text-gray-400 mt-1.5 mb-2">
          {visibility === 'shared' ? `${patient.name.split(' ')[0]} is told and can read this note.` : 'Only the doctor treating this patient can read this note.'}
        </p>
        <select value={type} onChange={e => setType(e.target.value as NoteType)} aria-label="Kind of note" className={`${inputCls} mb-2`}>
          {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000} aria-label="Clinical note"
          placeholder={visibility === 'shared' ? 'Observations and instructions for the patient.' : 'Working notes: differential, things to check, concerns.'}
          className={`${inputCls} resize-none`} />
        <SaveError message={save.error} className="mt-2" />
        <button onClick={submit} disabled={!text.trim() || save.busy}
          className={`w-full mt-2 py-2.5 rounded-xl text-sm font-bold ${text.trim() && !save.busy ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-400'}`}>{save.busy ? 'Saving…' : 'Save Note'}</button>
      </div>

      {notes.length === 0
        ? <EmptyState icon="📝" title="No notes yet" text="Notes written for this patient are kept here, newest first." />
        : (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">History ({notes.filter(n => !n.amendedBy).length})</p>
            <ChipFilter label="Which notes" tone="gray" options={SHOW} value={show} onChange={setShow} />
            {list.length === 0 && <p className="text-xs text-gray-400 mt-3">No notes of that kind.</p>}
            {list.map(n => (
              <div key={n.id} className={`py-2.5 border-b border-gray-50 last:border-0 ${n.amendedBy ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Pill color={n.visibility === 'shared' ? 'teal' : 'purple'}>{n.visibility === 'shared' ? 'Shared' : 'Internal'}</Pill>
                  <Pill color="gray">{NOTE_TYPE_LABELS[n.noteType]}</Pill>
                  {n.amends && <Pill color="blue">Correction</Pill>}
                  {n.amendedBy && <Pill color="amber">Corrected since</Pill>}
                </div>
                <p className={`text-xs text-gray-800 leading-relaxed whitespace-pre-wrap ${n.amendedBy ? 'line-through' : ''}`}>{n.content}</p>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p className="text-[10px] text-gray-400">{nameOf(n.authorId, 'A previous doctor')} · {n.createdAt}</p>
                  {!n.amendedBy && (
                    <button onClick={() => { amendSave.clear(); setCorrection(n.content); setAmending(n) }} className="text-[10px] font-bold text-teal-700 flex-shrink-0">Correct</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      <BottomSheet open={!!amending} onClose={() => setAmending(null)} title="Correct this note"
        subtitle="The correction replaces the note. The original stays in the record, marked as corrected."
        footer={<><SheetButton tone="ghost" onClick={() => setAmending(null)}>Cancel</SheetButton>
          <SheetButton disabled={!correction.trim() || correction.trim() === amending?.content || amendSave.busy} onClick={amend}>{amendSave.busy ? 'Saving…' : 'Save correction'}</SheetButton></>}>
        <Field label="Corrected note *">
          <textarea value={correction} onChange={e => setCorrection(e.target.value)} rows={5} maxLength={4000} className={`${inputCls} resize-none`} />
        </Field>
        {amending?.visibility === 'shared' && <p className="text-[10px] text-gray-400 mb-2">{patient.name.split(' ')[0]} is told that the note was corrected.</p>}
        <SaveError message={amendSave.error} />
      </BottomSheet>
    </>
  )
}
