import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BottomSheet, SheetButton, useLoader } from '@/shared'
import type { MedicalDocument } from '@/shared/lib/types'
import { formatBytes, isOfficial } from './documents'
import { formatOf } from './fileFormats'
import { downloadBlob, exportName, fileBlob, openInNewTab, printReport, reportDocx, reportHtml } from './exporters'

type Option = { key: string; icon: string; label: string; hint: string; run: () => Promise<void> | void }

/**
 * Every way to take a document out of mCare, in one place. Each option asks
 * the store first — that is both the access check and the access-history entry.
 */
export function DownloadSheet({ doc, open, onClose }: { doc: MedicalDocument; open: boolean; onClose: () => void }) {
  const { users, recordDownload } = useApp()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const loader = useLoader()
  const fmt = doc.file ? formatOf(doc.file.mime, doc.file.name) : undefined
  const draft = isOfficial(doc) && doc.status !== 'released'
  // Only mCare's own reports are rendered into PDF/Word/web copies. A patient's
  // upload is theirs: it only ever leaves exactly as it came in.
  const hasReport = isOfficial(doc) && !!doc.body && !doc.file?.dataUrl

  const guarded = (key: string, fn: () => Promise<void> | void) => async () => {
    setError('')
    if (!recordDownload(doc.id)) { setError('You no longer have access to this document.'); return }
    setBusy(key)
    try { await loader.track(Promise.resolve().then(fn), 'Preparing your file…') } catch { setError('Something went wrong preparing the file. Try again.') }
    setBusy('')
  }

  const options: Option[] = []
  if (doc.file?.dataUrl) {
    options.push({
      key: 'orig', icon: '⬇️', label: `Original file (${fmt?.label ?? 'file'})`, hint: `${doc.file.name} · ${formatBytes(doc.file.size)}`,
      run: async () => { const b = await fileBlob(doc); if (b) downloadBlob(b, doc.file!.name) },
    })
    if (fmt && (fmt.family === 'pdf' || fmt.family === 'image')) {
      options.push({ key: 'tab', icon: '↗️', label: 'Open in new tab', hint: 'Full-screen view with your browser’s zoom and print', run: async () => { if (!(await openInNewTab(doc))) setError('Your browser blocked the new tab — use Download instead.') } })
    }
  }
  if (hasReport) {
    options.push(
      { key: 'pdf', icon: '📕', label: 'PDF', hint: 'Opens the print dialog — choose “Save as PDF”', run: () => printReport(doc, users) },
      { key: 'docx', icon: '📝', label: 'Word document (.docx)', hint: 'Editable copy for Word, Google Docs or Pages', run: () => downloadBlob(reportDocx(doc, users), exportName(doc, 'docx')) },
      { key: 'html', icon: '🌐', label: 'Web page (.html)', hint: 'Opens in any browser, on any device', run: () => downloadBlob(new Blob([reportHtml(doc, users)], { type: 'text/html' }), exportName(doc, 'html')) },
    )
  }
  if (!doc.file?.dataUrl && doc.file && !hasReport) {
    options.push({ key: 'none', icon: '🗄️', label: 'Original file', hint: 'Held in secure storage — not available in this demo', run: () => setError('The original file is not available in this demo.') })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Download" subtitle={doc.title}
      footer={<SheetButton tone="ghost" onClick={onClose}>Close</SheetButton>}>
      {draft && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3">
          <p className="text-[11px] text-red-700 font-semibold">Draft — exports are watermarked “NOT SIGNED” and must not be used clinically.</p>
        </div>
      )}
      {doc.supersededBy && (
        <div className="bg-gray-100 rounded-xl px-3 py-2 mb-3">
          <p className="text-[11px] text-gray-600 font-semibold">This is a superseded version. Download the current version unless you need the history.</p>
        </div>
      )}
      {!isOfficial(doc) && (
        <p className="text-[11px] text-gray-500 mb-3">Your uploaded file downloads exactly as you added it — same format, same content.</p>
      )}
      <div className="flex flex-col gap-2">
        {options.map(o => (
          <button key={o.key} onClick={guarded(o.key, o.run)} disabled={!!busy}
            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-gray-100 bg-white text-left active:bg-gray-50 disabled:opacity-60">
            <span className="text-xl">{o.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{busy === o.key ? 'Preparing…' : o.label}</p>
              <p className="text-[10px] text-gray-400 truncate">{o.hint}</p>
            </div>
          </button>
        ))}
      </div>
      {error && <p className="text-[11px] text-red-600 font-semibold mt-2">{error}</p>}
      <p className="text-[9px] text-gray-400 mt-3">Downloads are recorded in the document’s access history.</p>
    </BottomSheet>
  )
}
