import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/shared/state/AppContext'
import type { MedicalDocument } from '@/shared/lib/types'
import { DOC_CATEGORIES, isOfficial, formatBytes } from './documents'
import { formatOf } from './fileFormats'
import { FilePreview } from './FilePreview'
import { DocBodyView, docDate } from './DocKit'
import { reportHtml } from './exporters'

const ZOOMS = [0.75, 1, 1.25, 1.5, 2]

/**
 * Full-screen, read-only reader. Opening it never saves anything to the
 * device — closing (✕, Esc) simply returns to the document page. Keeping a
 * copy is always an explicit "Save" that goes through the download sheet.
 */
export function DocumentReader({ doc, open, onClose, onSave }: {
  doc: MedicalDocument
  open: boolean
  onClose: () => void
  /** Omit to hide the Save button (e.g. no permission to download). */
  onSave?: () => void
}) {
  const { users } = useApp()
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => { setRoot(document.getElementById('sheet-root')) }, [])
  useEffect(() => { if (open) setZoom(1) }, [open, doc.id])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const fmt = doc.file ? formatOf(doc.file.mime, doc.file.name) : undefined
  const isPdf = !!doc.file?.dataUrl && fmt?.family === 'pdf'
  // Generated reports show the real report — the same design the patient prints or downloads.
  // A patient's own upload is never wrapped in mCare's report design.
  const isReport = isOfficial(doc) && !doc.file?.dataUrl && !!doc.body && doc.body.type !== 'text'
  const name = (id?: string) => users.find(u => u.id === id)?.name ?? '—'
  const kind = doc.file ? `${fmt?.label ?? 'File'} · ${formatBytes(doc.file.size)}` : 'Report'

  const strip = !isOfficial(doc)
    ? { cls: 'bg-gray-100 text-gray-600', text: 'Personal upload — not reviewed by a clinician' }
    : doc.supersededBy ? { cls: 'bg-gray-200 text-gray-700', text: `Superseded version ${doc.version} — a corrected version exists` }
    : doc.status === 'released' ? { cls: 'bg-emerald-50 text-emerald-800', text: `✓ Official · signed by ${name(doc.signedBy)}` }
    : doc.status === 'signed' ? { cls: 'bg-blue-50 text-blue-800', text: 'Signed · not yet released to the patient' }
    : { cls: 'bg-red-50 text-red-700', text: 'DRAFT · not signed · not for clinical use' }

  const reader = (
    <div className="absolute inset-0 pointer-events-auto flex flex-col bg-gray-100 sheet-up" role="dialog" aria-modal="true" aria-label={`Viewing ${doc.title}`}>
      {/* Top bar: close · title · save */}
      <div className="flex items-center gap-2 px-3 pt-12 pb-2 bg-white/95 backdrop-blur border-b border-gray-100 flex-shrink-0">
        <button onClick={onClose} aria-label="Close viewer"
          className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 text-base font-bold flex-shrink-0 active:bg-gray-200">✕</button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{doc.title}</p>
          <p className="text-[10px] text-gray-400 truncate">{DOC_CATEGORIES[doc.category].icon} {DOC_CATEGORIES[doc.category].label} · {docDate(doc.documentDate)} · {kind}</p>
        </div>
        {onSave && (
          <button onClick={onSave} className="h-9 px-3 rounded-full bg-teal-700 text-white text-xs font-bold flex items-center gap-1 flex-shrink-0 shadow-sm active:bg-teal-800">
            ⬇ Save
          </button>
        )}
      </div>
      <div className={`px-3 py-1.5 text-[10px] font-semibold flex-shrink-0 ${strip.cls}`}>{strip.text}</div>

      {/* Content — the reader scrolls; PDFs use their own viewer */}
      {isPdf ? (
        <div className="flex-1 min-h-0"><FilePreview file={doc.file!} title={doc.title} variant="full" /></div>
      ) : isReport ? (
        <div className="flex-1 min-h-0">
          {/* Sandboxed: static report markup only — no scripts can run inside. */}
          <iframe title={doc.title} sandbox="" data-no-invert className="w-full h-full bg-white border-0"
            srcDoc={reportHtml(doc, users, { embedded: true, zoom })} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
          <div style={{ zoom }}>
            <DocBodyView doc={doc} variant="full" />
          </div>
          <div className="h-16" />
        </div>
      )}

      {/* Bottom: zoom + reassurance that viewing keeps nothing */}
      <div className="flex-shrink-0 bg-white border-t border-gray-100 px-3 pt-2 pb-7 flex items-center gap-2">
        {!isPdf ? (
          <div className="flex items-center bg-gray-100 rounded-full p-0.5">
            <button onClick={() => setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])} disabled={zoom === ZOOMS[0]} aria-label="Zoom out"
              className="w-8 h-8 rounded-full text-gray-700 font-bold disabled:text-gray-300">−</button>
            <button onClick={() => setZoom(1)} className="px-1.5 text-[11px] font-bold text-gray-600 w-12" aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in"
              className="w-8 h-8 rounded-full text-gray-700 font-bold disabled:text-gray-300">+</button>
          </div>
        ) : <span className="text-[10px] text-gray-400">Use the PDF controls to zoom and page</span>}
        <p className="flex-1 text-[9px] text-gray-400 text-right leading-tight">View only — nothing is saved to this device{onSave ? ' unless you tap Save' : ''}.</p>
        <button onClick={onClose} className="h-8 px-3 rounded-full bg-gray-100 text-gray-700 text-xs font-bold active:bg-gray-200">Close</button>
      </div>
    </div>
  )
  return root ? createPortal(reader, root) : reader
}
