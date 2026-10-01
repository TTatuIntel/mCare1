import { useEffect, useState } from 'react'
import type { DocFile } from '@/shared/lib/types'
import { formatBytes } from './documents'
import { FAMILY_META, buildPreview, dataUrlToBytes, formatOf, type Preview, type Run } from './fileFormats'

/** PDFs render through a blob: URL — browsers refuse data: URLs in frames. */
function PdfFrame({ dataUrl, title, fill }: { dataUrl: string; title: string; fill?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoke: string | null = null
    fetch(dataUrl).then(r => r.blob()).then(b => { revoke = URL.createObjectURL(new Blob([b], { type: 'application/pdf' })); setUrl(revoke) }).catch(() => setUrl(null))
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [dataUrl])
  return url
    ? <iframe src={url} title={title} data-no-invert className={`w-full bg-white ${fill ? 'h-full' : 'h-[420px] rounded-xl border border-gray-100'}`} />
    : <p className="text-xs text-gray-400 text-center py-8">Loading preview…</p>
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <span key={i} className={`${r.b ? 'font-bold' : ''} ${r.i ? 'italic' : ''} ${r.u ? 'underline' : ''} whitespace-pre-wrap`}>{r.text}</span>)}</>
}

function Table({ rows, header }: { rows: string[][]; header?: boolean }) {
  const width = Math.max(1, ...rows.map(r => r.length))
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 my-2" style={{ scrollbarWidth: 'thin' }}>
      <table className="text-[11px] border-collapse min-w-full">
        {header && (
          <thead>
            <tr>
              <th className="bg-gray-100 text-gray-400 font-semibold px-1.5 py-1 border border-gray-100 sticky left-0" />
              {Array.from({ length: width }, (_, i) => <th key={i} className="bg-gray-100 text-gray-400 font-semibold px-2 py-1 border border-gray-100">{String.fromCharCode(65 + i)}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 ? 'bg-gray-50/60' : ''}>
              {header && <td className="bg-gray-100 text-gray-400 text-center px-1.5 border border-gray-100 sticky left-0">{i + 1}</td>}
              {Array.from({ length: width }, (_, j) => (
                <td key={j} className={`px-2 py-1 border border-gray-100 align-top whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis ${!header && i === 0 ? 'font-bold' : 'text-gray-700'}`}>{r[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Variant = 'thumb' | 'full'

function ParsedView({ p, variant }: { p: Preview; variant: Variant }) {
  const [sheet, setSheet] = useState(0)
  const thumb = variant === 'thumb'
  if (p.kind === 'none') return <NoPreview text={p.reason} />
  if (p.kind === 'text') return (
    <>
      <pre className="text-[11px] text-gray-800 whitespace-pre-wrap break-words font-mono">{thumb ? p.text.slice(0, 600) : p.text}</pre>
      {p.truncated && !thumb && <p className="text-[10px] text-gray-400 mt-1">Showing the beginning — download for the full file.</p>}
    </>
  )
  if (p.kind === 'doc') return (
    <div>
      {(thumb ? p.blocks.slice(0, 12) : p.blocks).map((b, i) =>
        b.t === 'h' ? <p key={i} className={`font-bold text-gray-900 mt-3 mb-1 ${b.level <= 1 ? 'text-base' : b.level === 2 ? 'text-sm' : 'text-xs'}`}><Runs runs={b.runs} /></p>
        : b.t === 'table' ? <Table key={i} rows={b.rows} />
        : b.runs.length === 0 ? <div key={i} className="h-2" />
        : <p key={i} className={`text-xs text-gray-700 leading-relaxed mb-1.5 ${b.bullet ? 'pl-3 -indent-3' : ''}`}>{b.bullet && '• '}<Runs runs={b.runs} /></p>)}
      {p.truncated && !thumb && <p className="text-[10px] text-gray-400 mt-1">Long document — showing the first part. Download for the full file.</p>}
    </div>
  )
  if (p.kind === 'sheet') {
    const s = p.sheets[Math.min(sheet, p.sheets.length - 1)]
    return (
      <>
        {p.sheets.length > 1 && !thumb && (
          <div className="flex gap-1.5 overflow-x-auto mb-1" style={{ scrollbarWidth: 'none' }}>
            {p.sheets.map((x, i) => (
              <button key={i} onClick={() => setSheet(i)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex-shrink-0 ${i === sheet ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-500'}`}>{x.name}</button>
            ))}
          </div>
        )}
        {s.rows.length ? <Table rows={thumb ? s.rows.slice(0, 8) : s.rows} header /> : <NoPreview text="This sheet is empty." />}
        {s.truncated && !thumb && <p className="text-[10px] text-gray-400">Showing the first 200 rows — download for the full spreadsheet.</p>}
      </>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {(thumb ? p.slides.slice(0, 1) : p.slides).map((s, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-gradient-to-br from-white to-gray-50 p-3 aspect-[16/9] overflow-hidden">
          <p className="text-[9px] font-bold text-gray-400 uppercase">Slide {i + 1}</p>
          <p className="text-sm font-bold text-gray-900 mt-0.5">{s.title}</p>
          {s.lines.slice(0, 8).map((l, j) => <p key={j} className="text-[11px] text-gray-600 leading-snug">• {l}</p>)}
        </div>
      ))}
    </div>
  )
}

function NoPreview({ text, icon = '📄' }: { text: string; icon?: string }) {
  return (
    <div className="text-center py-6 px-4">
      <p className="text-3xl mb-1">{icon}</p>
      <p className="text-xs text-gray-500">{text}</p>
    </div>
  )
}

/**
 * Shows any supported file inside the app. Formatting may be simplified; the download is always the original.
 *   thumb — a small, non-interactive glimpse for the document page
 *   full  — the reader: fills the screen, the reader itself scrolls and zooms
 */
export function FilePreview({ file, title, variant = 'full' }: { file: DocFile; title: string; variant?: Variant }) {
  const fmt = formatOf(file.mime, file.name)
  const [parsed, setParsed] = useState<Preview | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const thumb = variant === 'thumb'

  useEffect(() => {
    setParsed(null); setImgFailed(false)
    if (!fmt || !file.dataUrl || fmt.family === 'pdf' || fmt.family === 'image') return
    let live = true
    dataUrlToBytes(file.dataUrl).then(b => buildPreview(fmt, b)).then(p => { if (live) setParsed(p) })
    return () => { live = false }
  }, [file.dataUrl, file.mime])

  const meta = fmt ? FAMILY_META[fmt.family] : FAMILY_META.text

  if (!file.dataUrl) return <NoPreview icon={meta.icon} text={thumb ? `${fmt?.label ?? 'File'} · ${formatBytes(file.size)}` : 'Preview not available — save a copy to open the file.'} />
  if (!fmt) return <NoPreview text="Unknown file type — save a copy to open it." />
  if (fmt.family === 'pdf') {
    // A live PDF frame in a thumbnail would steal scrolling and cost memory; show a clean tile instead.
    return thumb
      ? <NoPreview icon="📕" text={`PDF document · ${formatBytes(file.size)}`} />
      : <PdfFrame dataUrl={file.dataUrl} title={title} fill />
  }
  if (fmt.family === 'image') {
    if (imgFailed) return <NoPreview icon="🖼️" text={`This browser can't display ${fmt.label} images. Save a copy to view it${fmt.id === 'heic' ? ' (opens on iPhone, Mac and Windows Photos)' : ''}.`} />
    return <img src={file.dataUrl} alt={title} onError={() => setImgFailed(true)}
      className={thumb ? 'w-full h-full object-cover rounded-lg' : 'w-full rounded-lg bg-white shadow-sm'} />
  }
  if (!parsed) return <p className="text-xs text-gray-400 text-center py-8">Opening {fmt.label}…</p>
  return (
    <>
      {!thumb && fmt.preview === 'parsed' && <p className="text-[9px] text-gray-400 mb-2">Simplified preview of the {meta.label.toLowerCase()} — save a copy for the original layout.</p>}
      <ParsedView p={parsed} variant={variant} />
    </>
  )
}
