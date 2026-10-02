import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BackHeader, BottomSheet, SheetButton, Field, Pill, Toggle, inputCls, useAct, useSave, SaveError } from '@/shared'
import type { DocSourceLink, DoctorUser, PatientUser } from '@/shared/lib/types'
import { SignatureSheet } from '@/shared/profile/SignatureSheet'
import {
  DOC_CATEGORIES, isOfficial, formatBytes, titleFor, whoCanOpen,
  canSign, canRelease, canCorrect, canDelete, canRestore, canShare, SUPPORT_ACCESS_MIN, DOC_RETENTION_DAYS,
} from './documents'
import { ago } from '@/shared/lib/vitals'
import { DocBadges, DocBodyView, docDate } from './DocKit'
import { DownloadSheet } from './DownloadSheet'
import { DocumentReader } from './DocumentReader'
import { formatOf, FAMILY_META } from './fileFormats'
import { UploadSheet } from './UploadSheet'
import { suggestInterpretation } from './analysis'
import { ShareSheet } from './ShareSheet'

const ACTION_LABEL: Record<string, string> = {
  view: 'Viewed', download: 'Downloaded', upload: 'Added', upload_failed: 'Upload failed', retry: 'Retried upload',
  rejected: 'Rejected', sign: 'Signed', release: 'Released', correct: 'Correction started', share: 'Shared link created',
  share_revoke: 'Share link revoked', share_open: 'Opened via share link', visibility: 'Visibility changed',
  delete: 'Deleted', restore: 'Restored', support_access: 'Support access', denied: 'Access denied',
}

/**
 * One viewer for every role. What it offers depends only on the policy:
 * patients can share and manage their uploads, the treating doctor signs,
 * releases and corrects, admins see metadata unless they open a
 * time-limited, reason-stated support grant.
 */
export function DocumentViewer({ docId, onBack, onLink, onOpenDoc }: {
  docId: string
  onBack: () => void
  /** Jump to the clinical record a source link points at. */
  onLink?: (link: DocSourceLink) => void
  /** Switch the viewer to another document (versions, corrections). */
  onOpenDoc: (id: string) => void
}) {
  const app = useApp()
  const {
    currentUser, users, alerts, appointments, now, getDocument, openDocument, versionsOf, pendingCorrectionOf,
    docEventsFor, docPolicyCtx, setDocVisibility, deleteDocument, restoreDocument, signDocument, releaseDocument,
    correctReport, supportGrantFor, requestSupportAccess, documentsFor, setReportInterpretation,
  } = app
  const entry = getDocument(docId)
  // `toast` is the screen's one result line; `save` belongs to whichever sheet is open.
  const toast = useAct()
  const save = useSave()
  const [sheet, setSheet] = useState<null | 'versions' | 'history' | 'share' | 'correct' | 'correctFile' | 'support' | 'delete' | 'release' | 'download'>(null)
  const [reason, setReason] = useState('')
  const [interpDraft, setInterpDraft] = useState('')
  const [sigOpen, setSigOpen] = useState(false)
  // Pre-fill the interpretation each time the release sheet opens.
  useEffect(() => {
    const d = getDocument(docId)?.doc
    if (sheet === 'release' && d?.body?.type === 'vitals') setInterpDraft(d.body.interpretation ?? '')
  }, [sheet, docId])
  const [err, setErr] = useState('')
  const [showLinks, setShowLinks] = useState(false)
  const [reading, setReading] = useState(false)

  // Opening is an access event: log it once per open (the store de-duplicates quick re-opens).
  useEffect(() => { if (entry?.level === 'content') openDocument(docId) }, [docId, entry?.level])

  if (!entry) {
    return (
      <div className="flex flex-col gap-4">
        <BackHeader title="Document" onBack={onBack} />
        <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
          <p className="text-2xl mb-2">🔒</p>
          <p className="text-sm font-semibold text-gray-700">Document not found or you do not have access.</p>
        </div>
      </div>
    )
  }

  const { doc, level } = entry
  const ctx = docPolicyCtx()
  const me = currentUser!
  const cat = DOC_CATEGORIES[doc.category]
  const name = (id?: string) => users.find(u => u.id === id)?.name ?? '—'
  const patient = users.find(u => u.id === doc.patientId) as PatientUser | undefined
  const versions = versionsOf(doc)
  const pending = pendingCorrectionOf(doc)
  const current = doc.supersededBy ? versions.find(v => !v.doc.supersededBy && v.doc.status === 'released') : undefined
  const grant = supportGrantFor(doc.id)
  const isStaff = me.role === 'admin' || me.role === 'assistant'
  const events = docEventsFor(doc.id)

  // Live sync with the source record: flag anything that changed after this document was produced.
  const linkStatus = (l: DocSourceLink): string | null => {
    if (l.kind === 'reading') return patient?.readings.find(r => r.id === l.id)?.invalid ? 'marked invalid since' : null
    if (l.kind === 'alert') { const a = alerts.find(x => x.id === l.id); return a ? a.status : null }
    if (l.kind === 'prescription') { const rx = patient?.prescriptions.find(x => x.id === l.id); return rx ? (rx.active ? 'active' : 'stopped') : null }
    if (l.kind === 'appointment') { const a = appointments.find(x => x.id === l.id); return a ? a.status : null }
    return null
  }
  const invalidSources = doc.links.filter(l => l.kind === 'reading' && linkStatus(l) === 'marked invalid since').length
  const counts = doc.links.reduce<Record<string, number>>((m, l) => ({ ...m, [l.kind]: (m[l.kind] ?? 0) + 1 }), {})
  const countText = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' · ')

  const doCorrect = async () => {
    const drafted = await save.run(async () => {
      const id = await correctReport(doc.id, reason)
      return id ? { ok: true as const, value: id } : { ok: false as const, error: 'The correction could not be started. Check your connection and try again.' }
    })
    if (!drafted.ok) return
    setSheet(null); setReason('')
    toast.say('Correction drafted. Review it, then release.')
    onOpenDoc(drafted.value)
  }
  /** The words first, then the release: saving the interpretation after signing would void the signature. */
  const doRelease = async () => {
    const released = await save.run(async () => {
      if (doc.body?.type === 'vitals') {
        const edited = await setReportInterpretation(doc.id, interpDraft)
        if (!edited.ok) return edited
      }
      return releaseDocument(doc.id)
    })
    if (!released.ok) return
    setSheet(null)
    toast.say(doc.supersedes ? 'Correction released · the previous version is superseded' : 'Released to the patient')
  }
  const doDelete = async () => {
    if (!(await save.run(() => deleteDocument(doc.id))).ok) return
    setSheet(null); onBack()
  }
  const doSupport = async () => {
    const res = await requestSupportAccess(doc.id, reason)
    if (!res.ok) return setErr(res.error ?? 'Not permitted')
    setSheet(null); setReason(''); setErr('')
  }

  /* ─── Status banner ─── */
  const banner = (() => {
    if (doc.deletedAt) return { tone: 'bg-red-50 border-red-100 text-red-700', text: `Deleted ${ago(doc.deletedAt, now)} by ${name(doc.deletedBy)}. ${now - doc.deletedAt > DOC_RETENTION_DAYS * 86_400_000 ? 'Past the recovery window — scheduled for permanent removal.' : `Recoverable for ${DOC_RETENTION_DAYS} days.`}` }
    if (doc.supersededBy) return { tone: 'bg-gray-100 border-gray-200 text-gray-600', text: `This is version ${doc.version}. It was replaced by a corrected version — do not rely on it.` }
    if (!isOfficial(doc)) return { tone: 'bg-gray-50 border-gray-100 text-gray-600', text: `Personal upload by ${name(doc.createdBy)}. Not reviewed or signed by a clinician.` }
    if (doc.status === 'released') return { tone: 'bg-emerald-50 border-emerald-100 text-emerald-800', text: `✓ Official clinical document · Signed by ${name(doc.signedBy)} · ${doc.signedAt}${doc.releasedAt && doc.releasedAt !== doc.signedAt ? ` · Released ${doc.releasedAt}` : ''}` }
    if (doc.status === 'signed') return { tone: 'bg-blue-50 border-blue-100 text-blue-800', text: `Signed by ${name(doc.signedBy)} · ${doc.signedAt}. Not yet released — the patient cannot see it.` }
    return { tone: 'bg-red-50 border-red-100 text-red-700', text: 'DRAFT · not signed · not visible to the patient. Not for clinical use until signed.' }
  })()

  const actions: { key: string; label: string; onClick: () => void; tone?: string }[] = []
  if (canShare(me, doc, ctx)) actions.push({ key: 'share', label: '🔗 Share', onClick: () => setSheet('share') })
  if (canSign(me, doc, ctx)) actions.push({ key: 'sign', label: '✍️ Sign', onClick: () => { void toast.run(() => signDocument(doc.id), 'Signed · not yet released') } })
  if (canRelease(me, doc, ctx)) actions.push({ key: 'rel', label: doc.status === 'draft' ? '✅ Sign & release' : '📤 Release', onClick: () => { save.clear(); setSheet('release') }, tone: 'primary' })
  if (canCorrect(me, doc, documentsFor(doc.patientId, { allVersions: true, deleted: false }).map(e => e.doc), ctx))
    actions.push({ key: 'corr', label: '✏️ Issue correction', onClick: () => { setReason(''); save.clear(); setSheet(doc.origin === 'system_generated' ? 'correct' : 'correctFile') } })
  if (versions.length > 1) actions.push({ key: 'ver', label: `🕘 Versions (${versions.length})`, onClick: () => setSheet('versions') })
  if (events.length > 0 || me.id === doc.patientId) actions.push({ key: 'hist', label: '👁 Access history', onClick: () => setSheet('history') })
  if (canDelete(me, doc, ctx)) actions.push({ key: 'del', label: '🗑 Delete', onClick: () => { save.clear(); setSheet('delete') }, tone: 'danger' })
  if (canRestore(me, doc, ctx)) actions.push({ key: 'res', label: '♻️ Restore', onClick: () => { void toast.run(() => restoreDocument(doc.id), 'Document restored') }, tone: 'primary' })
  if (me.role === 'admin' && level === 'metadata' && !doc.deletedAt) actions.push({ key: 'sup', label: '🛟 Support access', onClick: () => { setReason(''); setErr(''); setSheet('support') } })

  const openers = whoCanOpen(doc, ctx).filter(x => x.access.level === 'content')
  const ready = level === 'content' && (!doc.upload || doc.upload.state === 'ready')
  const fileFmt = doc.file ? formatOf(doc.file.mime, doc.file.name) : undefined
  const fileMeta = fileFmt ? FAMILY_META[fileFmt.family] : { icon: '📄', label: 'Report' }
  const fileLine = doc.file
    ? `${fileFmt?.label ?? 'File'} · ${formatBytes(doc.file.size)} · ${doc.file.name}`
    : 'Generated report · save as PDF, Word or web page'
  const [primary, ...secondary] = actions[0]?.tone === 'primary' ? actions : [undefined, ...actions]
  const coverTone = doc.deletedAt || doc.supersededBy ? 'from-gray-500 to-gray-600'
    : !isOfficial(doc) ? 'from-slate-600 to-slate-700'
    : doc.status === 'released' ? 'from-[#064f4f] to-[#0d9e82]'
    : doc.status === 'signed' ? 'from-blue-700 to-blue-500' : 'from-rose-700 to-rose-500'

  return (
    <div className="flex flex-col gap-3">
      <BackHeader title="Document" onBack={onBack} right={doc.version > 1 ? <Pill color="purple">v{doc.version}</Pill> : undefined} />
      {toast.node}

      {/* Cover: what it is, who signed it, and its state — at a glance */}
      <div className={`rounded-[22px] bg-gradient-to-br ${coverTone} text-white shadow-lg overflow-hidden`}>
        <div className="p-4 flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center text-2xl flex-shrink-0">{cat.icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/60 font-semibold">{cat.label}</p>
            <h2 className="text-base font-black leading-snug">{titleFor(me, doc, level)}</h2>
            <p className="text-[11px] text-white/70 mt-0.5">
              {docDate(doc.documentDate)}
              {isOfficial(doc) && doc.signedBy ? ` · ${name(doc.signedBy)}` : !isOfficial(doc) ? ` · ${name(doc.createdBy)}` : ''}
              {isStaff || me.role === 'doctor' ? ` · ${patient?.name ?? ''}` : ''}
            </p>
            <div className="mt-1.5"><DocBadges doc={doc} level={level} compact /></div>
          </div>
        </div>
        <div className="bg-black/15 px-4 py-2.5">
          <p className="text-[11px] font-medium leading-snug text-white/90">{banner.text}</p>
          {doc.correctionReason && <p className="text-[11px] mt-1 text-white/75">Corrects version {doc.version - 1}: {doc.correctionReason}</p>}
          {current && <button onClick={() => onOpenDoc(current.doc.id)} className="text-[11px] font-bold text-white underline mt-1">Open current version (v{current.doc.version}) →</button>}
        </div>
      </div>

      {pending && pending.id !== doc.id && (
        <button onClick={() => onOpenDoc(pending.id)} className="bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-2.5 text-left">
          <p className="text-[11px] font-semibold text-amber-800">Correction v{pending.version} is in draft — this version stays current until it's released. Open →</p>
        </button>
      )}
      {me.role === 'doctor' && invalidSources > 0 && !doc.supersededBy && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-2.5">
          <p className="text-[11px] font-semibold text-amber-800">⚠ {invalidSources} source reading{invalidSources > 1 ? 's were' : ' was'} marked invalid after this report was produced. Consider issuing a correction.</p>
        </div>
      )}
      {grant && (
        <div className="bg-purple-50 border border-purple-100 rounded-2xl px-3.5 py-2.5">
          <p className="text-[11px] font-semibold text-purple-800">🛟 Support access — closes in {Math.max(1, Math.ceil((grant.expiresAt - now) / 60_000))} min. The patient has been notified and this session is audited.</p>
        </div>
      )}

      {level === 'content' ? (
        <>
          {doc.description && <p className="text-xs text-gray-600 px-1">{doc.description}</p>}
          {/* File + actions — the View button opens the full reader; nothing is saved by viewing */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-base">{fileMeta.icon}</span>
              <p className="flex-1 min-w-0 text-[10px] text-gray-500 truncate">{ready ? fileLine : 'Upload in progress…'}</p>
            </div>
            {ready && (
              <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                <button onClick={() => setReading(true)} className="py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold shadow-sm active:bg-teal-800">👁 View</button>
                <button onClick={() => setSheet('download')} className="py-2.5 rounded-xl bg-teal-50 text-teal-800 text-xs font-bold active:bg-teal-100">
                  ⬇ {me.id === doc.patientId ? 'Save to my device' : 'Save a copy'}
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
          <p className="text-2xl mb-1">🔒</p>
          <p className="text-xs font-semibold text-gray-700">{doc.deletedAt ? 'Restore this document to open it.' : 'Content hidden — you can see that this document exists, not what it says.'}</p>
          {isStaff && !doc.deletedAt && <p className="text-[10px] text-gray-400 mt-1">{me.role === 'admin' ? `Open time-limited support access (${SUPPORT_ACCESS_MIN} min) with a stated reason if a support case needs it.` : 'Assistants work from metadata only.'}</p>}
        </div>
      )}

      {/* One main action, the rest as compact chips */}
      {primary && (
        <button onClick={primary.onClick} className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow">{primary.label}</button>
      )}
      {secondary.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {secondary.map(a => a && (
            <button key={a.key} onClick={a.onClick}
              className={`px-3 py-2 rounded-full text-[11px] font-bold ${a.tone === 'primary' ? 'bg-teal-50 text-teal-800' : a.tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-white text-gray-700 shadow-sm'}`}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {me.id === doc.patientId && doc.origin === 'patient_upload' && !doc.deletedAt && (
        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold text-gray-900">Share with my care team</p>
            <p className="text-[10px] text-gray-400">{doc.visibility === 'private' ? 'Private — your doctor cannot open it.' : 'Your doctor can open this file.'}</p>
          </div>
          <Toggle on={doc.visibility === 'care_team'} disabled={toast.busy} label="Share with my care team"
            onChange={() => { void toast.run(() => setDocVisibility(doc.id, doc.visibility === 'private' ? 'care_team' : 'private'), doc.visibility === 'private' ? 'Shared with your care team' : 'Now private') }} />
        </div>
      )}

      {/* Provenance — every official document points back to the record it came from */}
      {doc.links.length > 0 && level === 'content' && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <button onClick={() => setShowLinks(s => !s)} className="w-full flex items-center justify-between">
            <div className="text-left">
              <p className="text-xs font-bold text-gray-900">Source record</p>
              <p className="text-[10px] text-gray-400">{countText}</p>
            </div>
            <span className="text-[11px] font-bold text-teal-700">{showLinks ? 'Hide' : 'Show'}</span>
          </button>
          {showLinks && (
            <div className="mt-2 flex flex-col">
              {doc.links.map(l => {
                const st = linkStatus(l)
                return (
                  <button key={`${l.kind}-${l.id}`} onClick={() => onLink?.(l)} disabled={!onLink}
                    className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0 text-left">
                    <span className="text-[9px] font-bold uppercase text-gray-400 w-16 flex-shrink-0">{l.kind}</span>
                    <span className="text-[11px] text-gray-700 flex-1 truncate">{l.label}</span>
                    {st && <span className={`text-[9px] font-bold ${st.includes('invalid') || st === 'stopped' ? 'text-amber-600' : 'text-gray-400'}`}>{st}</span>}
                    {onLink && <span className="text-gray-300 text-xs">›</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Details — folded away; most people only need the content above */}
      <details className="bg-white rounded-2xl shadow-sm group">
        <summary className="px-4 py-3 flex items-center justify-between cursor-pointer list-none">
          <span>
            <span className="block text-xs font-bold text-gray-900">About this document</span>
            <span className="block text-[10px] text-gray-400">Author, file, version and who can open it</span>
          </span>
          <span className="text-gray-300 text-sm transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="px-4 pb-4">
        {([
          ['Patient', patient?.name ?? '—'],
          [isOfficial(doc) ? 'Author' : 'Uploaded by', name(doc.createdBy)],
          ['Added', doc.createdAt],
          ...(doc.file ? [['File', `${level === 'content' || !isStaff ? doc.file.name : 'hidden'} · ${formatBytes(doc.file.size)}`], ['Checksum', doc.file.sha256.slice(0, 16)]] : []),
          ['Version', `${doc.version}${doc.supersededBy ? ' (superseded)' : ''}`],
          ['Document ID', doc.id],
        ] as [string, string][]).map(([l, v]) => (
          <div key={l} className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-[11px] text-gray-400">{l}</span>
            <span className="text-[11px] font-semibold text-gray-800 text-right break-all">{v}</span>
          </div>
        ))}
        <div className="mt-2">
          <p className="text-[10px] text-gray-400 mb-1">Who can open it now</p>
          <div className="flex flex-wrap gap-1">
            {openers.map(o => <Pill key={o.user.id} color={o.user.role === 'patient' ? 'teal' : o.user.role === 'doctor' ? 'blue' : 'purple'}>{o.user.id === me.id ? 'You' : o.user.name}</Pill>)}
          </div>
          {!isStaff && <p className="text-[9px] text-gray-400 mt-1">mCare admins see only that a file exists. If support ever needs to open it, you are notified.</p>}
        </div>
        </div>
      </details>

      {/* ── Sheets ── */}
      <BottomSheet open={sheet === 'release'} onClose={() => setSheet(null)} title={doc.status === 'draft' ? 'Sign & release' : 'Release to patient'}
        subtitle="Releasing makes this an official document in the patient's library and notifies them."
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton disabled={save.busy} onClick={doRelease}>{save.busy ? 'Releasing…' : doc.status === 'draft' ? 'Sign & release' : 'Release'}</SheetButton></>}>
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-[11px] text-gray-600 leading-relaxed">
          I, {me.name}, confirm I have reviewed <b>{doc.title}</b>{doc.version > 1 ? ` (version ${doc.version})` : ''} for {patient?.name} and that it is accurate to the best of my knowledge.
          {doc.supersedes && <><br />Version {doc.version - 1} will be marked superseded; the patient keeps access to it in the version history.</>}
        </div>
        {doc.body?.type === 'vitals' && (
          <div className="mt-3">
            <Field label="Clinical interpretation & plan">
              <textarea value={interpDraft} onChange={e => setInterpDraft(e.target.value)} rows={5} className={`${inputCls} resize-none`}
                placeholder="Your assessment of these readings and the plan — printed above your signature." />
            </Field>
            <button onClick={() => { if (doc.body?.type === 'vitals') setInterpDraft(suggestInterpretation(doc.body, patient)) }}
              className="text-[10px] font-bold text-teal-700 -mt-1 mb-1 block">✨ {interpDraft.trim() ? 'Replace with suggested analysis' : 'Suggest analysis from the readings'}</button>
            <p className="text-[10px] text-gray-400">{interpDraft.trim() ? 'Locked once released. Later changes need a correction.' : 'Optional, but recommended — without it the report shows findings only.'}</p>
          </div>
        )}
        {doc.status === 'draft' && me.role === 'doctor' && (
          <div className="mt-3 rounded-xl border border-gray-100 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Signature on the report</p>
              <button onClick={() => setSigOpen(true)} className="text-[10px] font-bold text-teal-700">{(me as DoctorUser).signature ? 'Change' : 'Add'}</button>
            </div>
            {(me as DoctorUser).signature
              ? <img src={(me as DoctorUser).signature} alt="Your signature" className="h-12 mt-1 object-contain" />
              : <p className="text-[11px] text-gray-500 mt-1">No handwritten signature yet — your typed name is used. <button onClick={() => setSigOpen(true)} className="font-bold text-teal-700">Add one now</button></p>}
          </div>
        )}
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>
      <SignatureSheet open={sigOpen} onClose={() => setSigOpen(false)} />

      <BottomSheet open={sheet === 'correct'} onClose={() => setSheet(null)} title="Issue a correction"
        subtitle={`Creates version ${doc.version + 1} from the current record as a draft. Version ${doc.version} stays current until you release the correction.`}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton disabled={reason.trim().length < 5 || save.busy} onClick={doCorrect}>{save.busy ? 'Creating…' : 'Create draft'}</SheetButton></>}>
        <Field label="Reason for correction *">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={`${inputCls} resize-none`}
            placeholder="e.g. A reading used in this report was later marked invalid." />
        </Field>
        <SaveError message={save.error} />
      </BottomSheet>

      <UploadSheet open={sheet === 'correctFile'} onClose={() => setSheet(null)} patientId={doc.patientId} correcting={doc}
        onDone={id => { toast.say('Correction uploading. Release it when ready.'); onOpenDoc(id) }} />

      <BottomSheet open={sheet === 'support'} onClose={() => setSheet(null)} title="Open for support"
        subtitle={`Grants you content access to this one document for ${SUPPORT_ACCESS_MIN} minutes. The patient is notified with your reason, and every step is audited.`}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton disabled={reason.trim().length < 10} onClick={doSupport}>Open for {SUPPORT_ACCESS_MIN} min</SheetButton></>}>
        <Field label="Support case / reason *">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className={`${inputCls} resize-none`}
            placeholder="e.g. Ticket #214 — patient reports the file shows blank." />
        </Field>
        {err && <p className="text-[11px] text-red-600 font-semibold">{err}</p>}
      </BottomSheet>

      <BottomSheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete document?"
        subtitle={`It moves to Recently deleted and can be restored for ${DOC_RETENTION_DAYS} days.`}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton tone="danger" disabled={save.busy} onClick={doDelete}>{save.busy ? 'Deleting…' : 'Delete'}</SheetButton></>}>
        <p className="text-xs text-gray-600">{doc.title}</p>
        <SaveError message={save.error} className="mt-3" />
      </BottomSheet>

      <BottomSheet open={sheet === 'versions'} onClose={() => setSheet(null)} title="Version history" subtitle="Every version is kept. The current one is marked."
        footer={<SheetButton onClick={() => setSheet(null)}>Close</SheetButton>}>
        {versions.map(({ doc: v }) => (
          <button key={v.id} onClick={() => { setSheet(null); onOpenDoc(v.id) }}
            className={`w-full text-left border rounded-xl p-3 mb-2 ${v.id === doc.id ? 'border-teal-300 bg-teal-50' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-900">Version {v.version}</p>
              {v.supersededBy ? <Pill color="gray">Superseded</Pill> : v.status === 'released' ? <Pill color="green">Current</Pill> : <Pill color="red">{v.status === 'signed' ? 'Signed · not released' : 'Draft'}</Pill>}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{v.releasedAt ? `Released ${v.releasedAt} by ${name(v.releasedBy)}` : `Created ${v.createdAt} by ${name(v.createdBy)}`}</p>
            {v.correctionReason && <p className="text-[11px] text-gray-600 mt-1">{v.correctionReason}</p>}
          </button>
        ))}
      </BottomSheet>

      <BottomSheet open={sheet === 'history'} onClose={() => setSheet(null)} title="Access history"
        subtitle="Who opened, downloaded or changed this document." footer={<SheetButton onClick={() => setSheet(null)}>Close</SheetButton>}>
        {events.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No activity yet.</p>}
        {events.map(e => (
          <div key={e.id} className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${e.action === 'denied' ? 'bg-red-500' : e.action === 'support_access' ? 'bg-purple-500' : 'bg-teal-500'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800">{ACTION_LABEL[e.action] ?? e.action}</p>
              <p className="text-[10px] text-gray-500">{e.actorId.startsWith('external:') ? `${e.actorId.slice(9)} (outside doctor)` : e.actorId === me.id ? 'You' : name(e.actorId)}{e.detail ? ` · ${e.detail}` : ''}</p>
            </div>
            <p className="text-[10px] text-gray-400 flex-shrink-0">{ago(e.at, now)}</p>
          </div>
        ))}
      </BottomSheet>

      {level === 'content' && <DocumentReader doc={doc} open={reading} onClose={() => setReading(false)} onSave={ready ? () => setSheet('download') : undefined} />}
      {level === 'content' && <DownloadSheet doc={doc} open={sheet === 'download'} onClose={() => setSheet(null)} />}
      <ShareSheet open={sheet === 'share'} onClose={() => setSheet(null)} patientId={doc.patientId} preselect={[doc.id]} />
    </div>
  )
}
