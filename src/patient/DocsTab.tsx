import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Page, AddButton, Toggle, Chevron, useLoader, useToast } from '@/shared'
import type { DocSourceLink, PatientUser } from '@/shared/lib/types'
import { isOfficial, DOC_RETENTION_DAYS } from '@/shared/documents/documents'
import { DocRow, DocList, useDocFilters } from '@/shared/documents/DocKit'
import { DocumentViewer } from '@/shared/documents/DocumentViewer'
import { UploadSheet } from '@/shared/documents/UploadSheet'
import { ShareSheet } from '@/shared/documents/ShareSheet'
import { buildLibraryZip, downloadBlob } from '@/shared/documents/exporters'
import { SUPPORTED_SUMMARY } from '@/shared/documents/fileFormats'
import { dayKey } from '@/shared/lib/vitals'
import { ReportRequestSheet } from './ReportRequest'

/* ─── Documents & Reports ────────────────────────────────────────────── */
export function DocsTab({ go }: { go: (t: string) => void }) {
  const {
    currentUser, users, documentsFor, retryUpload, discardUpload, markDocsSeen, setDocPrivacyDefault, shareLinksFor, recordDownload, now,
    getDocument, reportRequests, loadDocumentFile,
  } = useApp()
  const patient = currentUser as PatientUser
  const [openId, setOpenId] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const toast = useToast()
  const [upload, setUpload] = useState(false)
  const [share, setShare] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [zipping, setZipping] = useState(false)
  const loader = useLoader()

  const entries = documentsFor(patient.id)
  const deleted = documentsFor(patient.id, { deleted: true })
  // Remember what was new when the library opened, then mark it seen.
  const [fresh] = useState(() => new Set(entries.filter(e => isOfficial(e.doc) && e.doc.seenByPatient === false).map(e => e.doc.id)))
  useEffect(() => { markDocsSeen(patient.id) }, [entries.length])

  const { filtered, controls, active, sort } = useDocFilters(entries, users)
  const inFlight = entries.filter(e => e.doc.upload && e.doc.upload.state !== 'ready')
  const settled = filtered.filter(e => !e.doc.upload || e.doc.upload.state === 'ready')
  const liveShares = shareLinksFor(patient.id).filter(s => !s.revokedAt && now < s.expiresAt && !(s.oneTime && s.usedAt))

  const followLink = (l: DocSourceLink) => {
    const tab = { reading: 'vitals', alert: 'alerts', prescription: 'medicine', appointment: 'appts', note: 'home' }[l.kind]
    go(tab)
  }

  /** Everything currently listed, as one zip: original files plus reports as printable pages. */
  const downloadAll = async () => {
    const docs = settled.filter(e => e.level === 'content').map(e => e.doc).filter(d => recordDownload(d.id))
    if (!docs.length) return
    setZipping(true)
    try {
      const zip = async () => {
        // Stored files are fetched first, so the zip holds the originals and not just their names.
        const withFiles = await Promise.all(docs.map(async d => {
          if (!d.file || d.file.dataUrl) return d
          const dataUrl = await loadDocumentFile(d.id)
          return dataUrl ? { ...d, file: { ...d.file, dataUrl } } : d
        }))
        const missing = withFiles.filter(d => d.file && !d.file.dataUrl && !d.body).length
        if (missing) toast.show(`${missing} file${missing > 1 ? 's' : ''} could not be fetched`)
        return buildLibraryZip(withFiles, users, patient.name)
      }
      downloadBlob(await loader.track(zip(), 'Preparing your documents…'), `mcare-documents-${dayKey()}.zip`)
    }
    catch { toast.show('The zip could not be prepared. Try again.') }
    finally { setZipping(false) }
  }

  if (openId) {
    return <DocumentViewer docId={openId} onBack={() => setOpenId(null)} onOpenDoc={setOpenId} onLink={followLink} />
  }

  const official = entries.filter(e => isOfficial(e.doc)).length
  // Newest official vitals report, featured at the top
  const latestReport = entries
    .filter(e => isOfficial(e.doc) && e.doc.body?.type === 'vitals' && !e.doc.supersededBy && e.level === 'content')
    .sort((a, b) => b.doc.documentDate.localeCompare(a.doc.documentDate))[0]
  const myRequests = reportRequests.filter(r => r.patientId === patient.id)

  return (
    <Page title="Documents"
      actions={<>
        <button onClick={() => setShare(true)} aria-label="Share with an outside doctor"
          className="h-8 px-3 rounded-full bg-white shadow-sm text-[11px] font-bold text-teal-700">🔗 Share{liveShares.length ? ` · ${liveShares.length}` : ''}</button>
        <AddButton onClick={() => setUpload(true)} />
      </>}>
      {toast.node}

      {/* Records summary + request, one compact card */}
      <div className="rounded-2xl shadow-md text-white overflow-hidden" style={{ background: 'linear-gradient(135deg,#064f4f 0%,#0a6e6e 55%,#0d9e82 100%)' }}>
        <div className="px-3.5 py-2.5 flex items-center">
          {[
            { label: 'Official', value: official },
            { label: 'Uploads', value: entries.length - official },
            { label: 'New', value: fresh.size },
          ].map((s, i) => (
            <div key={s.label} className={`flex-1 ${i ? 'pl-3 border-l border-white/15' : ''}`}>
              <p className="text-xl font-black leading-none">{s.value}</p>
              <p className="text-[9px] text-teal-200 mt-0.5 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
        <button onClick={() => setRequesting(true)} disabled={!patient.assignedDoctorId}
          className="w-full bg-black/15 px-3.5 py-2 flex items-center gap-2 text-left disabled:opacity-60">
          <span>📊</span>
          <span className="flex-1 text-[11px] font-bold">Request a vitals report{!patient.assignedDoctorId && <span className="font-normal text-teal-200"> · choose a care team first</span>}</span>
          <span className="text-white/70">›</span>
        </button>
      </div>

      {/* Report requests — one line each */}
      {myRequests.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm px-3 py-1">
          {myRequests.slice(0, 3).map(r => {
            const ready = r.docId ? getDocument(r.docId) : null
            const step = r.status === 'declined' ? -1 : r.status === 'pending' ? 1 : ready ? 3 : 2
            const label = step === -1 ? 'Declined' : step === 1 ? 'Requested' : step === 2 ? 'Being prepared' : 'Ready'
            return (
              <div key={r.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm">📊</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">Vitals report · {r.periodDays} days</p>
                  {step === -1
                    ? <p className="text-[10px] text-red-600 truncate">{r.declineReason || 'Declined by your doctor'}</p>
                    : <div className="flex gap-0.5 mt-1 w-24">{[1, 2, 3].map(i => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-teal-500' : 'bg-gray-100'}`} />)}</div>}
                </div>
                {ready
                  ? <button onClick={() => setOpenId(ready.doc.id)} className="text-[11px] font-bold text-white bg-teal-700 rounded-full px-2.5 py-1">Open</button>
                  : <span className={`text-[10px] font-semibold ${step === -1 ? 'text-red-500' : 'text-teal-700'}`}>{label}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Latest official report, one line */}
      {latestReport && !active && latestReport.doc.body?.type === 'vitals' && (() => {
        const b = latestReport.doc.body
        const off = b.rows.filter(r => r.level === 'warning' || r.level === 'critical').length
        return (
          <button onClick={() => setOpenId(latestReport.doc.id)} className="bg-white rounded-2xl shadow-sm px-3 py-2.5 flex items-center gap-2.5 text-left border-l-4 border-teal-500">
            <span className="text-lg">📈</span>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-teal-700 uppercase tracking-wider">Latest vitals report{fresh.has(latestReport.doc.id) ? ' · New' : ''}</p>
              <p className="text-xs font-semibold text-gray-900 truncate">{latestReport.doc.title}</p>
            </div>
            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${off ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{off ? `${off} to watch` : '✓ On target'}</span>
          </button>
        )
      })()}

      {inFlight.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {inFlight.map((e, i) => (
            <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} onRetry={retryUpload} onDiscard={discardUpload} last={i === inFlight.length - 1} />
          ))}
        </div>
      )}

      {/* Library: filters + contained scrolling list */}
      <div className="flex items-center justify-between px-1 mt-1">
        <p className="text-xs font-bold text-gray-700">All documents</p>
        {settled.length > 0 && (
          <button onClick={downloadAll} disabled={zipping} className="text-[11px] font-bold text-teal-700 disabled:opacity-50">
            {zipping ? 'Preparing zip…' : `⬇ ${active ? `These ${settled.length}` : 'All'} as .zip`}
          </button>
        )}
      </div>
      {controls}
      <DocList entries={settled} onOpen={setOpenId} isNew={id => fresh.has(id)} grouped={sort !== 'az'} maxHeight={440}
        empty={<>
          <p className="text-2xl mb-1">📂</p>
          <p className="text-sm text-gray-500">{active ? 'No documents match these filters.' : 'No documents yet.'}</p>
          {!active && <p className="text-[11px] text-gray-400 mt-1">Reports your doctor releases appear here automatically. Tap + to add your own — {SUPPORTED_SUMMARY}.</p>}
        </>} />

      {/* Library settings */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-3 py-2.5 flex items-center gap-2.5">
          <span>🔒</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900">Keep new uploads private</p>
            <p className="text-[10px] text-gray-400 truncate">{patient.docPrefs?.privateByDefault ? 'Only you see new uploads until you share them' : 'New uploads are shared with your care team'}</p>
          </div>
          <Toggle on={!!patient.docPrefs?.privateByDefault} onChange={() => setDocPrivacyDefault(patient.id, !patient.docPrefs?.privateByDefault)} />
        </div>
        {deleted.length > 0 && (
          <>
            <button onClick={() => setShowDeleted(s => !s)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-t border-gray-50">
              <span>🗑</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-900">Recently deleted ({deleted.length})</p>
                <p className="text-[10px] text-gray-400">Restorable for {DOC_RETENTION_DAYS} days</p>
              </div>
              <Chevron />
            </button>
            {showDeleted && deleted.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} last={i === deleted.length - 1} />)}
          </>
        )}
      </div>

      <UploadSheet open={upload} onClose={() => setUpload(false)} patientId={patient.id} onOpenExisting={setOpenId} />
      <ShareSheet open={share} onClose={() => setShare(false)} patientId={patient.id} />

      <ReportRequestSheet open={requesting} onClose={() => setRequesting(false)}
        onSent={() => toast.show('Request sent to your care team')} />
    </Page>
  )
}
