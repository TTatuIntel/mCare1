import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, inputCls, Toggle } from '@/shared'
import type { DoctorUser, MedicalDocument, PatientUser, ReportRequest, VitalsReportInclude } from '@/shared/lib/types'
import { buildVitalsReport, DEFAULT_REPORT_INCLUDE } from '@/shared/documents/documents'
import { DocumentReader } from '@/shared/documents/DocumentReader'
import { SignatureSheet } from '@/shared/profile/SignatureSheet'

const PERIODS = [7, 14, 30, 90]

type SectionKey = Exclude<keyof VitalsReportInclude, 'vitalIds'>
const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'findings', label: 'Summary of findings', hint: 'Key points generated from the readings' },
  { key: 'trends', label: 'Trend charts & notes', hint: 'Off: a compact results table instead' },
  { key: 'alerts', label: 'Alerts & events', hint: 'Alerts for the chosen vitals, plus any SOS' },
  { key: 'medications', label: 'Current medications', hint: 'Active prescriptions' },
  { key: 'healthProfile', label: 'Allergies & conditions', hint: 'Blood type, allergies, long-term conditions' },
  { key: 'readingsLog', label: 'Readings log (appendix)', hint: 'Every reading in the period, on its own page' },
]

/**
 * The doctor chooses what goes into a vitals report — period, which vitals,
 * which sections — previews it, then saves it as a draft to sign and release.
 */
export function ReportBuilderSheet({ patient, open, onClose, onCreated, request }: {
  patient: PatientUser
  open: boolean
  onClose: () => void
  onCreated: (docId: string) => void
  /** Drafting in answer to a patient's request. */
  request?: ReportRequest | null
}) {
  const { currentUser, vitalDefs, alerts, generateVitalsReport, fulfillReportRequest } = useApp()
  const tracked = vitalDefs.filter(d => patient.trackedVitalIds.includes(d.id))
  const [days, setDays] = useState(30)
  const [picked, setPicked] = useState<string[]>([])
  const [inc, setInc] = useState(DEFAULT_REPORT_INCLUDE)
  const [interp, setInterp] = useState('')
  const [preview, setPreview] = useState(false)
  const [sigOpen, setSigOpen] = useState(false)
  const doctor = currentUser?.role === 'doctor' ? currentUser as DoctorUser : null

  useEffect(() => {
    if (!open) return
    setDays(request?.periodDays ?? 30); setPicked(tracked.map(d => d.id)); setInc(DEFAULT_REPORT_INCLUDE); setInterp(''); setPreview(false)
  }, [open, request?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const include: VitalsReportInclude = { ...inc, vitalIds: picked.length === tracked.length ? undefined : picked }
  const toggleVital = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const previewDoc = useMemo<MedicalDocument | null>(() => {
    if (!preview || !currentUser) return null
    const t = Date.now()
    const { body, links } = buildVitalsReport(patient, vitalDefs, alerts, days, t, interp, include)
    return {
      id: 'doc_preview', patientId: patient.id, title: `Vitals Report — last ${days} days`, category: 'vitals_report', origin: 'system_generated',
      documentDate: new Date(t).toISOString().slice(0, 10), createdAt: body.type === 'vitals' ? body.generatedAt : '', at: t, createdBy: currentUser.id,
      status: 'draft', seriesId: 'doc_preview', version: 1, body, links, visibility: 'care_team',
    }
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const id = request
      ? await fulfillReportRequest(request.id, { days, interpretation: interp, include })
      : await generateVitalsReport(patient.id, days, interp, include)
    if (id) { onClose(); onCreated(id) }
  }

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={request ? 'Prepare requested report' : 'Build vitals report'}
        subtitle="Choose what to include. It is saved as a draft — nothing reaches the patient until you sign and release it."
        footer={<><SheetButton tone="ghost" onClick={() => setPreview(true)} disabled={!picked.length}>👁 Preview</SheetButton>
          <SheetButton onClick={create} disabled={!picked.length}>Save draft</SheetButton></>}>
        {request && (
          <div className="bg-blue-50 rounded-xl px-3 py-2 mb-3">
            <p className="text-[11px] text-blue-800"><b>{patient.name.split(' ')[0]} asked for the last {request.periodDays} days.</b>{request.reason ? ` “${request.reason}”` : ''}</p>
          </div>
        )}

        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Period</p>
        <div className="grid grid-cols-4 gap-1.5">
          {PERIODS.map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`py-2.5 rounded-xl text-xs font-semibold border-2 ${days === d ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
              {d} days
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4 mb-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Vitals ({picked.length}/{tracked.length})</p>
          <button onClick={() => setPicked(picked.length === tracked.length ? [] : tracked.map(d => d.id))} className="text-[10px] font-bold text-teal-700">
            {picked.length === tracked.length ? 'Clear' : 'Select all'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tracked.map(d => {
            const on = picked.includes(d.id)
            return (
              <button key={d.id} onClick={() => toggleVital(d.id)} aria-pressed={on}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border ${on ? 'bg-teal-700 border-teal-700 text-white' : 'bg-white border-gray-200 text-gray-500'}`}>
                {d.icon} {d.name}
              </button>
            )
          })}
        </div>
        {!picked.length && <p className="text-[10px] text-red-600 font-semibold mt-1">Choose at least one vital.</p>}

        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-4 mb-1">Sections</p>
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
          {SECTIONS.map(s => (
            <div key={s.key} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800">{s.label}</p>
                <p className="text-[10px] text-gray-400">{s.hint}</p>
              </div>
              <Toggle on={inc[s.key]} onChange={() => setInc(v => ({ ...v, [s.key]: !v[s.key] }))} />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Always included: letterhead, patient details, latest readings against target, and your signature.</p>

        <div className="mt-3">
          <Field label="Clinical interpretation & plan (optional)">
            <textarea value={interp} onChange={e => setInterp(e.target.value)} rows={3} className={`${inputCls} resize-none`}
              placeholder="e.g. BP remains above target despite lisinopril. Increase to 20 mg daily, reduce sodium, re-check in 2 weeks." />
          </Field>
        </div>

        {doctor && !doctor.signature && (
          <button onClick={() => setSigOpen(true)} className="w-full text-left bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            <p className="text-[11px] text-amber-800"><b>✍️ Add your handwritten signature</b> — it’s placed on this report when you sign. Without one, your typed name is used.</p>
          </button>
        )}
      </BottomSheet>

      <SignatureSheet open={sigOpen} onClose={() => setSigOpen(false)} />
      {previewDoc && <DocumentReader doc={previewDoc} open onClose={() => setPreview(false)} />}
    </>
  )
}
