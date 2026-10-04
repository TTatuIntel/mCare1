import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, inputCls, Toggle, useSave, SaveError, AlertStatusPill, ResolveAlertSheet } from '@/shared'
import type { AppAlert, DoctorUser, MedicalDocument, Outcome, PatientUser, ReportNote, ReportRequest, VitalsReportInclude } from '@/shared/lib/types'
import { buildVitalsReport, DEFAULT_REPORT_INCLUDE } from '@/shared/documents/documents'
import { suggestInterpretation } from '@/shared/documents/analysis'
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

/** What happens to the report when the doctor saves it. */
export type ReportOutcome = 'draft' | 'signed' | 'released'
const OUTCOMES: { key: ReportOutcome; label: string; hint: string; button: string }[] = [
  { key: 'draft', label: 'Keep as draft', hint: 'Saved unsigned. The patient cannot see it.', button: 'Save draft' },
  { key: 'signed', label: 'Sign', hint: 'Signed now, released later. The patient cannot see it yet.', button: 'Sign report' },
  { key: 'released', label: 'Sign & release', hint: 'Signed and sent to the patient’s library now.', button: 'Sign & release' },
]

/**
 * The doctor chooses what goes into a vitals report — period, which vitals,
 * which sections, which notes — previews it, then saves it as a draft or
 * signs it there and then.
 */
export function ReportBuilderSheet({ patient, open, onClose, onCreated, request }: {
  patient: PatientUser
  open: boolean
  onClose: () => void
  /** `outcome` is what actually happened: a report that could not be signed is still saved as a draft. */
  onCreated: (docId: string, outcome: ReportOutcome) => void
  /** Drafting in answer to a patient's request. */
  request?: ReportRequest | null
}) {
  const { currentUser, users, vitalDefs, alerts, clinicalNotes, generateVitalsReport, fulfillReportRequest, signDocument, releaseDocument } = useApp()
  const tracked = vitalDefs.filter(d => patient.trackedVitalIds.includes(d.id))
  const patientNotes = clinicalNotes.filter(n => n.patientId === patient.id)
  const [days, setDays] = useState(30)
  const [picked, setPicked] = useState<string[]>([])
  const [inc, setInc] = useState(DEFAULT_REPORT_INCLUDE)
  const [interp, setInterp] = useState('')
  const [suggested, setSuggested] = useState(false)
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [allNotes, setAllNotes] = useState(false)
  const [outcome, setOutcome] = useState<ReportOutcome>('draft')
  const [preview, setPreview] = useState(false)
  const [sigOpen, setSigOpen] = useState(false)
  const save = useSave()
  const doctor = currentUser?.role === 'doctor' ? currentUser as DoctorUser : null
  const personName = (id: string) => users.find(u => u.id === id)?.name
  /** The abnormal event being commented on or resolved from here, before it goes on the report. */
  const [event, setEvent] = useState<AppAlert | null>(null)
  // The alerts this report will list: the chosen vitals in the chosen period, plus any SOS.
  const events = !inc.alerts ? [] : alerts.filter(a => a.patientId === patient.id && a.at >= Date.now() - days * 86_400_000
    && (a.type === 'sos' || tracked.some(d => picked.includes(d.id) && d.name === a.vitalName)))

  useEffect(() => {
    if (!open) return
    setDays(request?.periodDays ?? 30); setPicked(tracked.map(d => d.id)); setInc(DEFAULT_REPORT_INCLUDE); setInterp(''); setPreview(false)
    setSuggested(false); setNoteIds([]); setAllNotes(false); setOutcome('draft'); save.clear()
  }, [open, request?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const include: VitalsReportInclude = { ...inc, vitalIds: picked.length === tracked.length ? undefined : picked }
  const toggleVital = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleNote = (id: string) => setNoteIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const notes: ReportNote[] = patientNotes.filter(n => noteIds.includes(n.id))
    .map(n => ({ id: n.id, at: n.createdAt, author: users.find(u => u.id === n.authorId)?.name ?? 'Care team', content: n.content }))

  /** Drafts the interpretation from the same figures the report will show. The doctor edits it before signing. */
  const suggest = () => {
    const { body } = buildVitalsReport(patient, vitalDefs, alerts, days, Date.now(), '', include, [], personName)
    if (body.type !== 'vitals') return
    setInterp(suggestInterpretation(body, patient)); setSuggested(true)
  }

  const previewDoc = useMemo<MedicalDocument | null>(() => {
    if (!preview || !currentUser) return null
    const t = Date.now()
    const { body, links } = buildVitalsReport(patient, vitalDefs, alerts, days, t, interp, include, notes, personName)
    return {
      id: 'doc_preview', patientId: patient.id, title: `Vitals Report — last ${days} days`, category: 'vitals_report', origin: 'system_generated',
      documentDate: new Date(t).toISOString().slice(0, 10), createdAt: body.type === 'vitals' ? body.generatedAt : '', at: t, createdBy: currentUser.id,
      status: 'draft', seriesId: 'doc_preview', version: 1, body, links, visibility: 'care_team',
    }
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const saved = await save.run(async (): Promise<Outcome<{ id: string; outcome: ReportOutcome }>> => {
      const drafted = request
        ? await fulfillReportRequest(request.id, { days, interpretation: interp, include, notes })
        : await generateVitalsReport(patient.id, days, interp, include, notes)
      if (!drafted.ok) return drafted
      const id = drafted.value
      // The draft is saved either way; if signing does not go through it stays a draft to sign from the document.
      const done = outcome === 'draft' ? true : (outcome === 'signed' ? await signDocument(id) : await releaseDocument(id)).ok
      return { ok: true, value: { id, outcome: done ? outcome : 'draft' } }
    })
    if (saved.ok) { onClose(); onCreated(saved.value.id, saved.value.outcome) }
  }

  const chosen = OUTCOMES.find(o => o.key === outcome)!
  const shownNotes = allNotes ? patientNotes : patientNotes.slice(0, 3)

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={request ? 'Prepare requested report' : 'Build vitals report'}
        subtitle="Choose what to include, add your notes, then save it as a draft or sign it now."
        footer={<><SheetButton tone="ghost" onClick={() => setPreview(true)} disabled={!picked.length}>👁 Preview</SheetButton>
          <SheetButton onClick={create} disabled={!picked.length || save.busy}>{save.busy ? 'Saving…' : chosen.button}</SheetButton></>}>
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

        {/* Abnormal readings in the period: comment on one, or resolve it, before it is printed */}
        {inc.alerts && (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-4 mb-1">Abnormal readings & resolutions ({events.length})</p>
            {events.length === 0 ? (
              <p className="text-[11px] text-gray-400">No alerts were raised for these vitals in this period.</p>
            ) : (
              <>
                <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
                  {events.map(a => (
                    <button key={a.id} onClick={() => setEvent(a)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-gray-800 truncate">{a.type === 'sos' ? 'SOS' : `${a.vitalName}: ${a.value} ${a.unit}`}</span>
                        <span className="block text-[10px] text-gray-400 truncate">
                          {a.loggedAt} · {a.remeasureIds?.length ?? 0} re-measured · {a.comments?.length ?? 0} comment{a.comments?.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <AlertStatusPill alert={a} />
                      <span className="text-[10px] font-bold text-teal-700 flex-shrink-0">{a.status === 'resolved' ? 'View' : 'Comment / resolve'}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Each is printed with its re-measurements, your comments and how it was resolved. What you add here is saved to the patient's record.</p>
              </>
            )}
          </>
        )}

        {/* Doctor's notes: existing clinical notes to attach, then the interpretation written for this report */}
        <div className="flex items-center justify-between mt-4 mb-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clinical notes to attach ({noteIds.length}/{patientNotes.length})</p>
          {patientNotes.length > 3 && (
            <button onClick={() => setAllNotes(a => !a)} className="text-[10px] font-bold text-teal-700">{allNotes ? 'Show fewer' : `Show all ${patientNotes.length}`}</button>
          )}
        </div>
        {patientNotes.length === 0 ? (
          <p className="text-[11px] text-gray-400">No clinical notes for {patient.name.split(' ')[0]} yet. Write them under Notes, or use the box below.</p>
        ) : (
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {shownNotes.map(n => {
              const on = noteIds.includes(n.id)
              return (
                <button key={n.id} onClick={() => toggleNote(n.id)} aria-pressed={on} className="w-full flex items-start gap-3 px-3 py-2 text-left">
                  <span className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center text-[10px] font-bold ${on ? 'bg-teal-700 border-teal-700 text-white' : 'border-gray-300 text-transparent'}`}>✓</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[10px] text-gray-400">{n.createdAt}</span>
                    <span className="block text-xs text-gray-800 line-clamp-2">{n.content}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Clinical interpretation & plan (optional)</p>
            <button onClick={suggest} disabled={!picked.length} className="text-[10px] font-bold text-teal-700">✨ {interp.trim() ? 'Re-suggest' : 'Suggest analysis'}</button>
          </div>
          <textarea value={interp} onChange={e => setInterp(e.target.value)} rows={interp ? 9 : 3} className={`${inputCls} resize-none`}
            placeholder="e.g. BP remains above target despite lisinopril. Increase to 20 mg daily, reduce sodium, re-check in 2 weeks." />
          {suggested && interp.trim() && (
            <p className="text-[10px] text-amber-700 mt-1">Drafted by mCare from this patient’s readings, alerts and medications. Read and edit it — it goes on the report in your name.</p>
          )}
        </div>

        {/* Signing */}
        {doctor && (
          <div className="mt-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Signature</p>
            <div className="grid grid-cols-3 gap-1.5">
              {OUTCOMES.map(o => (
                <button key={o.key} onClick={() => setOutcome(o.key)} aria-pressed={outcome === o.key}
                  className={`py-2.5 rounded-xl text-[11px] font-semibold border-2 ${outcome === o.key ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{chosen.hint}</p>
            {outcome !== 'draft' && (
              <div className="mt-2 rounded-xl border border-gray-100 px-3 py-2.5">
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  I, {doctor.name}, confirm I have reviewed this report for {patient.name} and that it is accurate to the best of my knowledge.
                </p>
                <div className="flex items-end justify-between gap-3 mt-2">
                  {doctor.signature
                    ? <img src={doctor.signature} alt="Your signature" className="h-12 max-w-[60%] object-contain object-left" />
                    : <p className="text-[11px] text-gray-500">No handwritten signature yet — your typed name is used.</p>}
                  <button onClick={() => setSigOpen(true)} className="text-[10px] font-bold text-teal-700 flex-shrink-0">{doctor.signature ? 'Change' : '✍️ Add signature'}</button>
                </div>
              </div>
            )}
          </div>
        )}
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>

      <SignatureSheet open={sigOpen} onClose={() => setSigOpen(false)} />
      <ResolveAlertSheet alert={event} patientName={patient.name} onClose={() => setEvent(null)} />
      {previewDoc && <DocumentReader doc={previewDoc} open onClose={() => setPreview(false)} />}
    </>
  )
}
