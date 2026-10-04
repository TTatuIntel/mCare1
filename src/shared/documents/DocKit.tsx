/**
 * Document UI kit — shared by the Patient, Doctor and Admin portals.
 * Every screen shows documents with these pieces so an official report,
 * a personal upload and a draft always look the same wherever they appear.
 */
import { useMemo, useState, useEffect } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Pill, inputCls } from '@/shared'
import type { MedicalDocument, DocCategory, AppUser, DocBody } from '@/shared/lib/types'
import { DOC_CATEGORIES, isOfficial, formatBytes, titleFor, type AccessLevel } from './documents'
import { formatOf } from './fileFormats'
import { FilePreview } from './FilePreview'
import { DownloadSheet } from './DownloadSheet'
import type { DocEntry } from './useDocumentStore'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-20" → "Sep 20, 2026" */
export function docDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : ymd
}

/* ─── Status pills ─────────────────────────────────────────────────── */

/** The one place that decides how a document's state is labelled. */
export function DocBadges({ doc, level, compact }: { doc: MedicalDocument; level: AccessLevel; compact?: boolean }) {
  const cat = DOC_CATEGORIES[doc.category]
  const up = doc.upload
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {!compact && <Pill color={cat.color}>{cat.label}</Pill>}
      {isOfficial(doc)
        ? doc.status === 'released'
          ? <Pill color="green">✓ Official</Pill>
          : doc.status === 'signed'
            ? <Pill color="blue">Signed · not released</Pill>
            : <Pill color="red">Draft · unsigned</Pill>
        : <Pill color="gray">My upload</Pill>}
      {doc.version > 1 && !doc.supersededBy && <Pill color="purple">v{doc.version} · corrected</Pill>}
      {doc.supersededBy && <Pill color="gray">Superseded</Pill>}
      {doc.origin === 'patient_upload' && doc.visibility === 'private' && <Pill color="amber">🔒 Private</Pill>}
      {up?.state === 'uploading' && <Pill color="blue">Uploading {up.progress}%</Pill>}
      {up?.state === 'scanning' && <Pill color="blue">Checking file…</Pill>}
      {up?.state === 'failed' && <Pill color="red">Upload failed</Pill>}
      {doc.deletedAt && <Pill color="red">Deleted</Pill>}
      {level === 'metadata' && !doc.deletedAt && <Pill color="gray">Metadata only</Pill>}
    </div>
  )
}

/* ─── List row ─────────────────────────────────────────────────────── */
export function DocRow({ entry, onOpen, onRetry, onDiscard, patientName, isNew, last }: {
  entry: DocEntry
  onOpen: (id: string) => void
  onRetry?: (id: string) => void
  onDiscard?: (id: string) => void
  patientName?: string
  isNew?: boolean
  last?: boolean
}) {
  const { currentUser, users } = useApp()
  const { doc, level } = entry
  const cat = DOC_CATEGORIES[doc.category]
  const up = doc.upload
  const busy = up && (up.state === 'uploading' || up.state === 'scanning')
  const author = users.find(u => u.id === (doc.signedBy ?? doc.createdBy))?.name
  const [dl, setDl] = useState(false)
  const downloadable = level === 'content' && !doc.deletedAt && (!up || up.state === 'ready') && (!!doc.file?.dataUrl || !!doc.file?.path || !!doc.body)
  const fmt = doc.file ? formatOf(doc.file.mime, doc.file.name) : undefined
  return (
    <div className={`px-3 py-2 ${last ? '' : 'border-b border-gray-50'}`}>
      <div className="flex items-center gap-2">
      <button onClick={() => onOpen(doc.id)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 relative ${isOfficial(doc) ? 'bg-teal-50' : 'bg-gray-50'}`}>
          {cat.icon}
          {isNew && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-teal-500 border-2 border-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold truncate leading-tight ${doc.supersededBy || doc.deletedAt ? 'text-gray-400' : 'text-gray-900'}`}>{titleFor(currentUser, doc, level)}</p>
          <p className="text-[10px] text-gray-400 truncate">
            {patientName ? `${patientName} · ` : ''}{docDate(doc.documentDate)} · {cat.label}
            {isOfficial(doc) && author ? ` · ${author}` : ''}
            {doc.file ? ` · ${fmt?.label ?? 'File'} ${formatBytes(doc.file.size)}` : ''}
          </p>
          {/* status on one line; overflow is clipped rather than wrapping the row taller */}
          <div className="mt-0.5 overflow-hidden [&>div]:flex-nowrap"><DocBadges doc={doc} level={level} compact /></div>
        </div>
      </button>
      {downloadable && (
        <button onClick={() => setDl(true)} aria-label={`Download ${doc.title}`}
          className="w-7 h-7 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center text-xs flex-shrink-0">⬇</button>
      )}
      </div>
      {downloadable && <DownloadSheet doc={doc} open={dl} onClose={() => setDl(false)} />}
      {busy && (
        <div className="mt-2 ml-[52px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${up!.state === 'scanning' ? 'bg-blue-400 animate-pulse' : 'bg-teal-500'}`} style={{ width: `${up!.progress}%` }} />
        </div>
      )}
      {up?.state === 'failed' && (
        <div className="mt-2 ml-[52px] bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-[11px] text-red-600">{up.error ?? 'Upload failed.'}</p>
          <div className="flex gap-2 mt-1.5">
            {onRetry && <button onClick={() => onRetry(doc.id)} className="text-[11px] font-bold text-white bg-teal-700 px-3 py-1 rounded-full">↻ Retry</button>}
            {onDiscard && <button onClick={() => onDiscard(doc.id)} className="text-[11px] font-bold text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">Discard</button>}
            <span className="text-[10px] text-gray-400 self-center">Attempt {up.attempts}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Search & filters ─────────────────────────────────────────────── */
type Origin = 'all' | 'official' | 'personal'
type Range = 'any' | '30' | '90' | '365' | 'custom'
type Sort = 'newest' | 'oldest' | 'az'
const RANGES: { id: Range; label: string }[] = [
  { id: 'any', label: 'Any time' }, { id: '30', label: '30 days' }, { id: '90', label: '3 months' },
  { id: '365', label: '12 months' }, { id: 'custom', label: 'Custom' },
]
const SORTS: { id: Sort; label: string }[] = [{ id: 'newest', label: 'Newest' }, { id: 'oldest', label: 'Oldest' }, { id: 'az', label: 'A–Z' }]

const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${on ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600'}`

/**
 * Search, origin tabs, and a Filters panel (type, date, sort).
 * Active filters show as removable chips so the bar stays one line tall.
 */
export function useDocFilters(entries: DocEntry[], users: AppUser[]) {
  const { currentUser } = useApp()
  const staff = currentUser?.role === 'admin' || currentUser?.role === 'assistant'
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<DocCategory | 'all'>('all')
  const [origin, setOrigin] = useState<Origin>('all')
  const [range, setRange] = useState<Range>('any')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [panel, setPanel] = useState(false)

  const present = useMemo(() => [...new Set(entries.map(e => e.doc.category))], [entries])
  const counts = useMemo(() => ({
    all: entries.length,
    official: entries.filter(e => isOfficial(e.doc)).length,
    personal: entries.filter(e => !isOfficial(e.doc)).length,
  }), [entries])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const today = new Date()
    const cutoff = range === 'any' || range === 'custom' ? '' : new Date(today.getTime() - Number(range) * 86_400_000).toISOString().slice(0, 10)
    const out = entries.filter(({ doc, level }) => {
      if (cat !== 'all' && doc.category !== cat) return false
      if (origin === 'official' && !isOfficial(doc)) return false
      if (origin === 'personal' && isOfficial(doc)) return false
      if (cutoff && doc.documentDate < cutoff) return false
      if (range === 'custom' && ((from && doc.documentDate < from) || (to && doc.documentDate > to))) return false
      if (!needle) return true
      const author = users.find(u => u.id === (doc.signedBy ?? doc.createdBy))?.name ?? ''
      // Staff working from metadata can't search inside titles they aren't allowed to see.
      const text = level === 'content' || !staff ? `${doc.title} ${doc.description ?? ''} ${doc.file?.name ?? ''}` : ''
      return `${text} ${DOC_CATEGORIES[doc.category].label} ${author}`.toLowerCase().includes(needle)
    })
    return out.sort((a, b) => sort === 'az' ? a.doc.title.localeCompare(b.doc.title)
      : sort === 'oldest' ? a.doc.documentDate.localeCompare(b.doc.documentDate)
      : b.doc.documentDate.localeCompare(a.doc.documentDate))
  }, [entries, q, cat, origin, range, from, to, users, staff, sort])

  const panelCount = (cat !== 'all' ? 1 : 0) + (range !== 'any' ? 1 : 0) + (sort !== 'newest' ? 1 : 0)
  const active = !!(q || cat !== 'all' || origin !== 'all' || range !== 'any')
  const reset = () => { setQ(''); setCat('all'); setOrigin('all'); setRange('any'); setFrom(''); setTo(''); setSort('newest') }

  const activeChips: { label: string; clear: () => void }[] = [
    ...(cat !== 'all' ? [{ label: `${DOC_CATEGORIES[cat].icon} ${DOC_CATEGORIES[cat].label}`, clear: () => setCat('all') }] : []),
    ...(range !== 'any' ? [{ label: range === 'custom' ? `${from || '…'} → ${to || '…'}` : RANGES.find(r => r.id === range)!.label, clear: () => { setRange('any'); setFrom(''); setTo('') } }] : []),
    ...(sort !== 'newest' ? [{ label: `Sort: ${SORTS.find(s => s.id === sort)!.label}`, clear: () => setSort('newest') }] : []),
  ]

  const controls = (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search documents…" aria-label="Search documents"
            className="w-full h-9 bg-white rounded-xl shadow-sm pl-8 pr-7 text-xs outline-none focus:ring-2 focus:ring-teal-200" />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">🔍</span>
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">✕</button>}
        </div>
        <button onClick={() => setPanel(p => !p)} aria-expanded={panel}
          className={`h-9 px-3 rounded-xl shadow-sm text-[11px] font-bold flex items-center gap-1 flex-shrink-0 ${panel || panelCount ? 'bg-teal-700 text-white' : 'bg-white text-gray-700'}`}>
          ⚙ Filters{panelCount ? <span className="bg-white text-teal-700 rounded-full w-4 h-4 text-[9px] flex items-center justify-center">{panelCount}</span> : null}
        </button>
      </div>

      {/* origin tabs with counts */}
      <div className="flex bg-white rounded-xl p-0.5 shadow-sm">
        {(['all', 'official', 'personal'] as Origin[]).map(o => (
          <button key={o} onClick={() => setOrigin(o)}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${origin === o ? 'bg-teal-700 text-white' : 'text-gray-500'}`}>
            {o === 'all' ? 'All' : o === 'official' ? 'Official' : 'Uploads'} <span className="opacity-70">{counts[o]}</span>
          </button>
        ))}
      </div>

      {panel && (
        <div className="bg-white rounded-xl shadow-sm p-3 flex flex-col gap-2.5">
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Type</p>
            <div className="flex flex-wrap gap-1">
              {(['all', ...present] as (DocCategory | 'all')[]).map(c => (
                <button key={c} onClick={() => setCat(c)} className={chip(cat === c)}>
                  {c === 'all' ? 'All types' : `${DOC_CATEGORIES[c].icon} ${DOC_CATEGORIES[c].label}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Date</p>
            <div className="flex flex-wrap gap-1">
              {RANGES.map(r => <button key={r.id} onClick={() => setRange(r.id)} className={chip(range === r.id)}>{r.label}</button>)}
            </div>
            {range === 'custom' && (
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <label className="text-[10px] text-gray-400">From<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={inputCls} /></label>
                <label className="text-[10px] text-gray-400">To<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={inputCls} /></label>
              </div>
            )}
          </div>
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Sort</p>
            <div className="flex gap-1">
              {SORTS.map(s => <button key={s.id} onClick={() => setSort(s.id)} className={chip(sort === s.id)}>{s.label}</button>)}
            </div>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-gray-50">
            <button onClick={reset} className="text-[10px] font-bold text-gray-500">Reset all</button>
            <button onClick={() => setPanel(false)} className="text-[11px] font-bold text-white bg-teal-700 rounded-full px-3 py-1">Show {filtered.length}</button>
          </div>
        </div>
      )}

      {!panel && (activeChips.length > 0 || active) && (
        <div className="flex items-center gap-1 flex-wrap">
          {activeChips.map(c => (
            <button key={c.label} onClick={c.clear} className="text-[10px] font-semibold text-teal-800 bg-teal-50 rounded-full pl-2 pr-1.5 py-0.5">{c.label} ✕</button>
          ))}
          <span className="ml-auto text-[10px] text-gray-400">{filtered.length} of {entries.length}</span>
          <button onClick={reset} className="text-[10px] font-bold text-teal-700">Clear</button>
        </div>
      )}
    </div>
  )
  return { filtered, controls, active, sort }
}

/**
 * A contained, scrollable document list. Month headers stick while scrolling
 * (when sorted by date) so long libraries stay easy to scan.
 */
export function DocList({ entries, onOpen, isNew, grouped = true, maxHeight = 440, empty }: {
  entries: DocEntry[]
  onOpen: (id: string) => void
  isNew?: (id: string) => boolean
  grouped?: boolean
  maxHeight?: number
  empty?: React.ReactNode
}) {
  if (entries.length === 0) return <div className="bg-white rounded-2xl shadow-sm py-8 text-center px-6">{empty ?? <p className="text-xs text-gray-400">No documents.</p>}</div>
  const groups: [string, DocEntry[]][] = grouped ? groupByMonth(entries) : [['', entries]]
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-y-auto overscroll-contain" style={{ maxHeight, scrollbarWidth: 'thin' }}>
      {groups.map(([month, list]) => (
        <div key={month || 'all'}>
          {month && (
            <div className="sticky top-0 z-[1] bg-gray-50/95 backdrop-blur px-3 py-1 flex justify-between">
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">{month}</span>
              <span className="text-[9px] text-gray-400">{list.length}</span>
            </div>
          )}
          {list.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={onOpen} isNew={isNew?.(e.doc.id)} last={i === list.length - 1} />)}
        </div>
      ))}
    </div>
  )
}

/** Groups a list by "September 2026" for scanning long libraries. */
export function groupByMonth(entries: DocEntry[]): [string, DocEntry[]][] {
  const out = new Map<string, DocEntry[]>()
  entries.forEach(e => {
    const [y, m] = e.doc.documentDate.split('-').map(Number)
    const key = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
    out.set(key, [...(out.get(key) ?? []), e])
  })
  return [...out.entries()]
}

/* ─── Content ──────────────────────────────────────────────────────── */

const levelTone: Record<string, string> = {
  critical: 'bg-red-50 text-red-600', warning: 'bg-amber-50 text-amber-700', normal: 'bg-emerald-50 text-emerald-700', none: 'bg-gray-50 text-gray-400',
}

const LEVEL_DOT: Record<string, string> = { critical: 'bg-red-500', warning: 'bg-amber-400', normal: 'bg-emerald-500', none: 'bg-gray-300' }
const LEVEL_TEXT: Record<string, string> = { critical: 'Critical', warning: 'Out of range', normal: 'On target', none: 'No data' }

/**
 * Vitals report at a glance: headline numbers and what needs attention.
 * The per-vital breakdown and alert list stay one tap away.
 */
function VitalsSummary({ body: b }: { body: Extract<DocBody, { type: 'vitals' }> }) {
  const [full, setFull] = useState(false)
  const measured = b.rows.filter(r => r.total > 0)
  const inRange = measured.reduce((s, r) => s + r.inRange, 0)
  const total = measured.reduce((s, r) => s + r.total, 0)
  const pct = total ? Math.round((inRange / total) * 100) : null
  const attention = b.rows.filter(r => r.level === 'critical' || r.level === 'warning')
  const openAlerts = b.alerts.filter(a => a.status !== 'resolved').length

  return (
    <>
      {/* headline numbers */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { v: b.readingsCount, l: 'Readings' },
          { v: pct === null ? '—' : `${pct}%`, l: 'In range', c: pct !== null && pct < 90 ? 'text-amber-600' : 'text-emerald-600' },
          { v: attention.length, l: 'Need attention', c: attention.length ? 'text-amber-600' : 'text-emerald-600' },
          { v: openAlerts, l: 'Open alerts', c: openAlerts ? 'text-red-600' : 'text-gray-900' },
        ].map(s => (
          <div key={s.l} className="bg-gray-50 rounded-xl py-2 text-center">
            <p className={`text-base font-black leading-none ${s.c ?? 'text-gray-900'}`}>{s.v}</p>
            <p className="text-[9px] text-gray-400 mt-1 leading-tight">{s.l}</p>
          </div>
        ))}
      </div>

      {/* in-range bar */}
      {pct !== null && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${pct < 90 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{inRange} of {total} readings within target · last {b.periodDays} days</p>
        </div>
      )}

      {/* what needs attention */}
      <div className="mt-3">
        {attention.length === 0 ? (
          <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">✓ All {measured.length} measured vitals were on target at their latest reading.</p>
        ) : attention.map(r => (
          <div key={r.vitalId} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-sm">{r.icon}</span>
            <span className="text-xs text-gray-700 flex-1 truncate">{r.name}</span>
            <span className="text-xs font-bold text-gray-900 font-mono">{r.latest} <span className="text-[9px] font-normal text-gray-400">{r.unit}</span></span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${levelTone[r.level]}`}>{LEVEL_TEXT[r.level]}</span>
          </div>
        ))}
      </div>

      {/* full breakdown on demand */}
      {full && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-600 leading-relaxed mb-2">{b.summary}</p>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 text-[9px] font-bold text-gray-400 uppercase">
              <span className="flex-1">Vital</span><span className="w-14 text-right">Latest</span><span className="w-12 text-right">Avg</span><span className="w-10 text-right">In range</span>
            </div>
            {b.rows.map(r => (
              <div key={r.vitalId} className="flex items-center gap-2 px-2.5 py-2 text-[11px] border-t border-gray-50">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${LEVEL_DOT[r.level]}`} />
                <span className="flex-1 min-w-0 truncate text-gray-700">{r.icon} {r.name}<span className="block text-[9px] text-gray-400">Target {r.target}</span></span>
                <span className="w-14 text-right font-bold text-gray-900 font-mono">{r.latest}</span>
                <span className="w-12 text-right text-gray-500 font-mono">{r.total ? r.average : '—'}</span>
                <span className="w-10 text-right text-gray-500">{r.total ? `${r.inRange}/${r.total}` : '—'}</span>
              </div>
            ))}
          </div>
          {b.alerts.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Alerts in period</p>
              {b.alerts.map(a => (
                <div key={a.id} className="py-1 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-gray-600 truncate">{a.label}</span>
                    <span className={`font-semibold ${a.status === 'resolved' ? 'text-emerald-600' : 'text-red-600'}`}>{a.status === 'resolved' ? 'Resolved' : 'Unresolved'}</span>
                    <span className="text-[10px] text-gray-400">{a.at}</span>
                  </div>
                  {a.steps?.map((st, i) => (
                    <p key={i} className="pl-2 text-[10px] text-gray-500 leading-snug">↳ {st.text} <span className="text-gray-400">· {st.when}</span></p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <p className="text-[9px] text-gray-400">Generated {b.generatedAt}</p>
        <button onClick={() => setFull(f => !f)} className="text-[11px] font-bold text-teal-700">
          {full ? 'Hide breakdown' : `Full breakdown (${b.rows.length} vitals${b.alerts.length ? `, ${b.alerts.length} alerts` : ''}) ›`}
        </button>
      </div>
    </>
  )
}

/** A stored file on its way from the backend. Says so, and offers a retry if it could not be fetched. */
function FilePending({ docId, name, thumb }: { docId: string; name: string; thumb: boolean }) {
  const { loadDocumentFile } = useApp()
  const [failed, setFailed] = useState(false)
  const load = () => { setFailed(false); loadDocumentFile(docId).then(url => { if (!url) setFailed(true) }) }
  useEffect(load, [docId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (thumb) return <p className="text-[11px] text-gray-400 py-6 text-center">{failed ? 'Preview unavailable' : 'Loading preview…'}</p>
  return (
    <div className="py-10 text-center" role="status">
      <p className="text-sm font-semibold text-gray-700">{failed ? 'The file could not be opened' : 'Opening the file…'}</p>
      <p className="text-xs text-gray-400 mt-1 truncate">{failed ? 'Check your connection, then try again.' : name}</p>
      {failed && <button onClick={load} className="mt-3 text-xs bg-teal-700 text-white px-5 py-2 rounded-full font-bold">Try again</button>}
    </div>
  )
}

/** The document's content. `thumb` is a cropped, non-interactive glimpse; `full` is the reader page. */
export function DocBodyView({ doc, variant = 'full' }: { doc: MedicalDocument; variant?: 'thumb' | 'full' }) {
  const b = doc.body
  const f = doc.file
  const watermark = isOfficial(doc) && doc.status !== 'released'
  let inner: React.ReactNode
  if (f?.dataUrl) {
    inner = <FilePreview file={f} title={doc.title} variant={variant} />
  } else if (f?.path && !b) {
    // Live mode: the file is in storage and is fetched when the document is opened.
    inner = <FilePending docId={doc.id} name={f.name} thumb={variant === 'thumb'} />
  } else if (b?.type === 'vitals') {
    inner = <VitalsSummary body={b} />
  } else if (b?.type === 'lab') {
    inner = (
      <>
        <p className="text-[11px] text-gray-500 mb-2">{b.lab}</p>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {b.rows.map((r, i) => (
            <div key={r.test} className={`flex items-center gap-2 px-3 py-2 text-xs ${i % 2 ? 'bg-gray-50/60' : ''}`}>
              <span className="flex-1 text-gray-700">{r.test}</span>
              <span className={`font-bold ${r.flag ? 'text-red-600' : 'text-gray-900'} font-mono`}>{r.value} <span className="text-[9px] font-normal text-gray-400">{r.unit}</span></span>
              <span className="w-16 text-right text-[10px] text-gray-400">{r.ref}</span>
              <span className={`w-4 text-[10px] font-black ${r.flag === 'H' ? 'text-red-500' : 'text-blue-500'}`}>{r.flag ?? ''}</span>
            </div>
          ))}
        </div>
        {b.comment && <p className="text-[11px] text-gray-600 italic mt-2">“{b.comment}”</p>}
      </>
    )
  } else if (b?.type === 'prescription') {
    inner = (
      <div className="flex flex-col">
        {[['Medication', b.medication], ['Dose', b.dosage], ['Frequency', b.frequency], ['Purpose', b.purpose || '—']].map(([l, v]) => (
          <div key={l} className="flex justify-between py-2 border-b border-gray-50 last:border-0 text-xs">
            <span className="text-gray-400">{l}</span><span className="font-semibold text-gray-900">{v}</span>
          </div>
        ))}
      </div>
    )
  } else if (b?.type === 'text') {
    inner = b.text.split('\n').map((l, i) => <p key={i} className="text-xs text-gray-700 leading-relaxed mb-1.5">{l}</p>)
  } else {
    inner = <p className="text-xs text-gray-400 text-center py-6">Preview not available — download to open the file.</p>
  }
  return (
    <div className={variant === 'thumb' ? 'relative h-full p-3' : 'bg-white rounded-xl p-4 shadow-sm relative overflow-hidden'}>
      {inner}
      {watermark && (
        <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-5xl font-black text-red-500/15 -rotate-12 tracking-widest">DRAFT</span>
        </div>
      )}
    </div>
  )
}
