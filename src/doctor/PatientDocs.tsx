import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, Field, inputCls, useToast } from '@/shared'
import type { DocSourceLink, PatientUser, ReportRequest } from '@/shared/lib/types'
import { isOfficial } from '@/shared/documents/documents'
import { DocRow, DocList, useDocFilters } from '@/shared/documents/DocKit'
import { DocumentViewer } from '@/shared/documents/DocumentViewer'
import { UploadSheet } from '@/shared/documents/UploadSheet'
import { ReportBuilderSheet } from './ReportBuilderSheet'

/**
 * The patient's library as the treating doctor sees it: official documents
 * in every state, plus the patient's uploads they chose to share. Private
 * uploads never reach this screen — the store filters them out.
 */
export function PatientDocs({ patient, openId, setOpenId, onLink, buildOpen, setBuildOpen }: {
  patient: PatientUser
  openId: string | null
  setOpenId: (id: string | null) => void
  onLink: (l: DocSourceLink) => void
  /** The report builder can be opened from elsewhere on the patient page. */
  buildOpen: boolean
  setBuildOpen: (open: boolean) => void
}) {
  const { users, documentsFor, retryUpload, discardUpload, reportRequests, declineReportRequest } = useApp()
  const [upload, setUpload] = useState(false)
  const [forRequest, setForRequest] = useState<ReportRequest | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const toast = useToast()
  const requests = reportRequests.filter(r => r.patientId === patient.id && r.status === 'pending')

  const entries = documentsFor(patient.id)
  const deleted = documentsFor(patient.id, { deleted: true })
  const { filtered, controls, sort } = useDocFilters(entries, users)

  const builder = (
    <ReportBuilderSheet patient={patient} open={buildOpen} request={forRequest}
      onClose={() => { setBuildOpen(false); setForRequest(null) }}
      onCreated={id => { toast.show('Draft saved — review, sign and release'); setOpenId(id) }} />
  )

  if (openId) return <>{toast.node}<DocumentViewer docId={openId} onBack={() => setOpenId(null)} onOpenDoc={setOpenId} onLink={onLink} /></>

  const awaiting = entries.filter(e => isOfficial(e.doc) && e.doc.status !== 'released' && (!e.doc.upload || e.doc.upload.state === 'ready'))
  const inFlight = entries.filter(e => e.doc.upload && e.doc.upload.state !== 'ready')
  const rest = filtered.filter(e => !awaiting.includes(e) && !inFlight.includes(e))

  return (
    <>
      {toast.node}
      {builder}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => { setForRequest(null); setBuildOpen(true) }} className="py-3 rounded-2xl bg-teal-700 text-white text-xs font-bold shadow">📊 Build vitals report</button>
        <button onClick={() => setUpload(true)} className="py-3 rounded-2xl bg-white text-teal-700 text-xs font-bold shadow-sm">📎 Add document</button>
      </div>

      {/* Patient-requested reports */}
      {requests.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 border-blue-400">
          <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider px-4 pt-3">Requested by patient ({requests.length})</p>
          {requests.map(r => (
            <div key={r.id} className="px-4 py-3 border-b border-gray-50 last:border-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-900">📊 Vitals report · last {r.periodDays} days</p>
                <span className="text-[10px] text-gray-400">{r.createdAt}</span>
              </div>
              {r.reason && <p className="text-[11px] text-gray-500 mt-0.5 italic">“{r.reason}”</p>}
              <div className="flex gap-2 mt-2">
                <button onClick={() => { setForRequest(r); setBuildOpen(true) }}
                  className="flex-1 py-2 rounded-xl bg-teal-700 text-white text-[11px] font-bold">Prepare report</button>
                <button onClick={() => { setDeclining(r.id); setDeclineReason('') }}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-[11px] font-bold">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {awaiting.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 border-amber-400">
          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider px-4 pt-3">Awaiting your signature ({awaiting.length})</p>
          {awaiting.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} last={i === awaiting.length - 1} />)}
        </div>
      )}

      {inFlight.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-3">Uploads</p>
          {inFlight.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} onRetry={retryUpload} onDiscard={discardUpload} last={i === inFlight.length - 1} />)}
        </div>
      )}

      {controls}

      <DocList entries={rest} onOpen={setOpenId} grouped={sort !== 'az'} empty={<p className="text-xs text-gray-400">No documents match.</p>} />
      <p className="text-[10px] text-gray-400 px-1">Uploads the patient keeps private are not shown to you.</p>

      {deleted.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-3">Deleted drafts</p>
          {deleted.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} last={i === deleted.length - 1} />)}
        </div>
      )}

      <UploadSheet open={upload} onClose={() => setUpload(false)} patientId={patient.id} onOpenExisting={setOpenId}
        onDone={() => toast.show('Uploading — you can keep working')} />

      <BottomSheet open={!!declining} onClose={() => setDeclining(null)} title="Decline report request"
        subtitle="The patient is notified with your reason."
        footer={<><SheetButton tone="ghost" onClick={() => setDeclining(null)}>Cancel</SheetButton>
          <SheetButton tone="danger" disabled={declineReason.trim().length < 5} onClick={() => { declineReportRequest(declining!, declineReason); setDeclining(null); toast.show('Request declined') }}>Decline</SheetButton></>}>
        <Field label="Reason *">
          <textarea rows={3} value={declineReason} onChange={e => setDeclineReason(e.target.value)} className={`${inputCls} resize-none`}
            placeholder="e.g. Not enough readings yet — please log for 7 more days." />
        </Field>
      </BottomSheet>
    </>
  )
}
