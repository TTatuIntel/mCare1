import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, Toggle, inputCls, useLoader } from '@/shared'
import type { DocCategory, MedicalDocument, PatientUser } from '@/shared/lib/types'
import {
  ACCEPT_ATTR, ALLOWED_LABEL, DOC_CATEGORIES, PATIENT_UPLOAD_CATEGORIES, CLINICIAN_UPLOAD_CATEGORIES,
  inspectFile, formatBytes,
} from './documents'
import { FAMILY_META, formatByExt, extOf } from './fileFormats'
import { dayKey } from '@/shared/lib/vitals'

/**
 * One upload sheet for every role. Patients add personal documents; the
 * treating doctor attaches clinical files (optionally releasing them at
 * once) or uploads a corrected version of a released file.
 *
 * The file is checked here for fast feedback and checked again by the store
 * before anything is saved — the sheet's check is a convenience, not the gate.
 */
export function UploadSheet({ open, onClose, patientId, correcting, onDone, onOpenExisting }: {
  open: boolean
  onClose: () => void
  patientId: string
  correcting?: MedicalDocument
  onDone?: (docId: string) => void
  onOpenExisting?: (docId: string) => void
}) {
  const { currentUser, users, appointments, uploadDocument } = useApp()
  const clinician = currentUser?.role === 'doctor'
  const patient = users.find(u => u.id === patientId) as PatientUser | undefined
  const fileRef = useRef<HTMLInputElement>(null)
  const loader = useLoader()

  const [file, setFile] = useState<File | null>(null)
  const [fileIssue, setFileIssue] = useState('')
  const [checking, setChecking] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocCategory>('lab')
  const [date, setDate] = useState(dayKey())
  const [description, setDescription] = useState('')
  const [share, setShare] = useState(true)
  const [releaseNow, setReleaseNow] = useState(true)
  const [appointmentId, setAppointmentId] = useState('')
  const [reason, setReason] = useState('')
  const [simulateDrop, setSimulateDrop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicateOf, setDuplicateOf] = useState<string | undefined>()

  useEffect(() => {
    if (!open) return
    setFile(null); setFileIssue(''); setTitle(''); setDescription(''); setDate(dayKey()); setReason('')
    setCategory(correcting?.category ?? 'lab'); setShare(!patient?.docPrefs?.privateByDefault)
    setReleaseNow(true); setAppointmentId(''); setSimulateDrop(false); setBusy(false); setError(''); setDuplicateOf(undefined)
  }, [open])

  const pick = async (f: File | undefined) => {
    setError(''); setDuplicateOf(undefined)
    if (!f) return
    setChecking(true)
    const res = await loader.track(inspectFile(f), 'Checking file…')
    setChecking(false)
    if (!res.ok) { setFile(null); setFileIssue(res.reason); return }
    setFileIssue(''); setFile(f)
    if (!title) setTitle(res.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))
  }

  const submit = async () => {
    if (!file) return
    setBusy(true); setError(''); setDuplicateOf(undefined)
    const res = await loader.track(uploadDocument({
      patientId, file, title, category, documentDate: date, description,
      visibility: share ? 'care_team' : 'private', releaseNow, appointmentId: appointmentId || undefined,
      supersedes: correcting?.id, correctionReason: reason, simulateDrop,
    }), 'Uploading…')
    setBusy(false)
    if (!res.ok) { setError(res.error); setDuplicateOf(res.duplicateOf); return }
    onDone?.(res.docId)
    onClose()
  }

  const cats = clinician ? CLINICIAN_UPLOAD_CATEGORIES : PATIENT_UPLOAD_CATEGORIES
  const myAppts = appointments.filter(a => a.patientId === patientId && a.doctorId === currentUser?.id && a.status !== 'rejected' && a.status !== 'cancelled')
  const ready = !!file && !checking && !busy && (!!correcting ? reason.trim().length >= 5 : title.trim().length > 0)

  return (
    <BottomSheet open={open} onClose={onClose}
      title={correcting ? `Correct: ${correcting.title}` : clinician ? `Add document for ${patient?.name ?? 'patient'}` : 'Upload a document'}
      subtitle={correcting
        ? `Creates version ${correcting.version + 1}. Version ${correcting.version} stays visible until you release the correction.`
        : clinician ? 'Clinical documents are drafts until you sign and release them.' : 'Personal uploads are labelled as yours — they are not clinical reports.'}
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton disabled={!ready} onClick={submit}>{busy ? 'Checking…' : correcting ? 'Upload correction' : 'Upload'}</SheetButton></>}>

      <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="hidden"
        onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <button onClick={() => fileRef.current?.click()}
        className={`w-full border-2 border-dashed rounded-2xl p-5 flex flex-col items-center gap-1.5 mb-3 ${fileIssue ? 'border-red-200 bg-red-50' : file ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-gray-50'}`}>
        <span className="text-2xl">{fileIssue ? '⛔' : file ? '📎' : '📤'}</span>
        {checking ? <p className="text-sm font-semibold text-gray-600">Checking file…</p>
          : file ? (
            <>
              <p className="text-sm font-semibold text-teal-800 break-all text-center">{file.name}</p>
              <p className="text-[10px] text-teal-600">{formatByExt(extOf(file.name))?.label ?? 'File'} · {formatBytes(file.size)} · verified · tap to change</p>
            </>
          ) : <p className="text-sm font-semibold text-gray-700">Tap to choose a file</p>}
        {!file && (
          <div className="flex flex-wrap justify-center gap-1 mt-1">
            {(['pdf', 'word', 'sheet', 'slides', 'image', 'text', 'medical'] as const).map(f => (
              <span key={f} className="text-[9px] font-semibold bg-white border border-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">{FAMILY_META[f].icon} {FAMILY_META[f].label}</span>
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 text-center">{ALLOWED_LABEL}</p>
        {!file && <p className="text-[9px] text-gray-400 text-center">Files with macros or embedded scripts are blocked for safety.</p>}
      </button>
      {fileIssue && <p className="text-[11px] text-red-600 font-semibold -mt-1 mb-3">{fileIssue}</p>}

      {correcting ? (
        <Field label="Reason for correction *">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={`${inputCls} resize-none`}
            placeholder="e.g. Lab re-issued the report with a corrected potassium value." />
        </Field>
      ) : (
        <>
          <Field label="Title *">
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Blood test results — Sep 2026" maxLength={100} />
          </Field>
          <Field label="Category">
            <div className="flex flex-wrap gap-1.5">
              {cats.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-2.5 py-1.5 rounded-full text-[10px] font-semibold ${category === c ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {DOC_CATEGORIES[c].icon} {DOC_CATEGORIES[c].label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Document date">
            <input type="date" value={date} max={dayKey()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Note (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)} className={inputCls} placeholder="Where it's from, anything your doctor should know" maxLength={200} />
          </Field>
          {clinician && myAppts.length > 0 && (
            <Field label="Related appointment (optional)">
              <select value={appointmentId} onChange={e => setAppointmentId(e.target.value)} className={inputCls}>
                <option value="">None</option>
                {myAppts.map(a => <option key={a.id} value={a.id}>{a.title} · {a.rescheduledTo ?? a.preferredDate}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      {!clinician && (
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-800">Share with my care team</p>
            <p className="text-[10px] text-gray-400">{share ? 'Your doctor can open this file.' : 'Private — only you can open it. Enforced on every request.'}</p>
          </div>
          <Toggle on={share} onChange={() => setShare(s => !s)} />
        </div>
      )}
      {clinician && (
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-800">Sign & release when upload completes</p>
            <p className="text-[10px] text-gray-400">{releaseNow ? 'The patient is notified once the file is stored and checked.' : 'Stays a draft — only you can see it until released.'}</p>
          </div>
          <Toggle on={releaseNow} onChange={() => setReleaseNow(s => !s)} />
        </div>
      )}

      <label className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
        <input type="checkbox" checked={simulateDrop} onChange={e => setSimulateDrop(e.target.checked)} />
        Demo: drop the connection mid-upload (to try Retry)
      </label>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-[11px] text-red-600 font-semibold">{error}</p>
          {duplicateOf && onOpenExisting && (
            <button onClick={() => { onOpenExisting(duplicateOf); onClose() }} className="text-[11px] font-bold text-teal-700 mt-1">Open existing document →</button>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
