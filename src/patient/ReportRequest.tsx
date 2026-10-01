import { useEffect, useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls, useToast } from '@/shared'
import { usePatient } from './usePatient'

/** The periods a vitals report can cover, in days. */
export const REPORT_PERIODS = [7, 30, 90]

/* ─── Asking the care team for a signed vitals report ─────────────────
   The sheet is the one way to ask, used from Documents and from Vitals.
   The card is the Vitals page's section for it: ask, and follow a request
   until the report is ready in Documents. */

export function ReportRequestSheet({ open, onClose, days = 30, onSent }: {
  open: boolean
  onClose: () => void
  /** The period picked when the sheet opens. */
  days?: number
  onSent?: () => void
}) {
  const { reportRequests, requestReport } = usePatient()
  const [period, setPeriod] = useState(days)
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setPeriod(days) }, [open, days])

  const submit = () => {
    if (!requestReport(period, reason)) return
    setReason('')
    onClose()
    onSent?.()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="📊 Request a vitals report"
      subtitle="Your care team builds it from your readings, signs it, and it appears in Documents as an official document."
      footer={<><SheetButton tone="ghost" onClick={onClose}>Cancel</SheetButton><SheetButton onClick={submit}>Send request</SheetButton></>}>
      <Field label="Period">
        <div className="grid grid-cols-3 gap-2">
          {REPORT_PERIODS.map(d => (
            <button key={d} onClick={() => setPeriod(d)}
              className={`py-3 rounded-xl text-xs font-semibold border-2 ${period === d ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
              Last {d} days
            </button>
          ))}
        </div>
      </Field>
      <Field label="What is it for? (optional)">
        <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className={`${inputCls} resize-none`}
          placeholder="e.g. insurance claim, second opinion, employer" />
      </Field>
      {reportRequests.some(r => r.status === 'pending') && (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">You already have a request waiting — you can still send another.</p>
      )}
    </BottomSheet>
  )
}

export function ReportRequestCard({ days, onOpenDocs }: {
  /** The period offered first, e.g. the window the Trends view is showing. */
  days?: number
  /** Opens Documents, where a finished report is read. */
  onOpenDocs?: () => void
}) {
  const { patient, reportRequests } = usePatient()
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const hasDoctor = !!patient.assignedDoctorId

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="p-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-lg flex-shrink-0">📊</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">Vitals report</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {hasDoctor ? 'A signed summary of your readings from your care team.' : 'Choose a care team first to request a report.'}
          </p>
        </div>
        <button onClick={() => setOpen(true)} disabled={!hasDoctor}
          className="flex-shrink-0 text-xs bg-teal-700 text-white px-3.5 py-2 rounded-full font-bold transition-all active:scale-95 disabled:opacity-40">
          Request
        </button>
      </div>

      {toast.node && <div className="px-3.5 pb-3">{toast.node}</div>}

      {reportRequests.length > 0 && (
        <div className="border-t border-gray-100 px-3.5 py-1">
          {reportRequests.slice(0, 3).map(r => {
            const step = r.status === 'declined' ? -1 : r.status === 'pending' ? 1 : r.ready ? 3 : 2
            const label = step === -1 ? 'Declined' : step === 1 ? 'Requested' : step === 2 ? 'Being prepared' : 'Ready'
            return (
              <div key={r.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">
                    Last <span className="font-mono">{r.periodDays}</span> days <span className="font-normal text-gray-400">· {r.createdAt}</span>
                  </p>
                  {step === -1
                    ? <p className="text-[10px] text-red-600 truncate">{r.declineReason || 'Declined by your doctor'}</p>
                    : <div className="flex gap-0.5 mt-1 w-24">{[1, 2, 3].map(i => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-teal-500' : 'bg-gray-100'}`} />)}</div>}
                </div>
                {r.ready && onOpenDocs
                  ? <button onClick={onOpenDocs} className="text-[11px] font-bold text-white bg-teal-700 rounded-full px-2.5 py-1">Open</button>
                  : <span className={`text-[10px] font-semibold ${step === -1 ? 'text-red-500' : 'text-teal-700'}`}>{label}</span>}
              </div>
            )
          })}
        </div>
      )}

      {onOpenDocs && (
        <button onClick={onOpenDocs} className="w-full border-t border-gray-100 px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-teal-700">
          All reports and documents <span aria-hidden="true">›</span>
        </button>
      )}

      <ReportRequestSheet open={open} onClose={() => setOpen(false)} days={days}
        onSent={() => toast.show('Request sent to your care team')} />
    </div>
  )
}
