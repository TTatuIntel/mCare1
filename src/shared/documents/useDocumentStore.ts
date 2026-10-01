/**
 * Document store — stands in for the documents API.
 *
 * Every read and write goes through the access policy in documents.ts,
 * so screens only ever receive what the signed-in user is allowed to see.
 * Raw state never leaves this hook.
 */
import { useRef, useState } from 'react'
import type {
  AppUser, AdminUser, DoctorUser, PatientUser, VitalDef, AppAlert, Prescription, NotifKind, VitalsReportInclude,
  MedicalDocument, DocEvent, DocAction, DocCategory, DocVisibility, ShareLink, SupportGrant, DocBackup,
} from '@/shared/lib/types'
import {
  docAccess, resolveDoc, canUploadFor, canSign, canRelease, canCorrect, canDelete, canRestore, canShare,
  isTreatingDoctor, inspectFile, hashBuffer, fnv1a, opaqueId, buildVitalsReport, runPolicySelfTests, isOfficial,
  DOC_CATEGORIES, DOC_RETENTION_DAYS, SUPPORT_ACCESS_MIN,
  type AccessLevel, type PolicyCtx, type SelfTest,
} from './documents'
import { stamp, dayKey } from '@/shared/lib/vitals'

const MIN = 60_000
const DAY = 86_400_000

export interface DocEntry { doc: MedicalDocument; level: AccessLevel }

export interface UploadInput {
  patientId: string
  file: File
  title: string
  category: DocCategory
  documentDate: string
  description?: string
  /** Patient uploads only. Defaults to the patient's privacy preference. */
  visibility?: DocVisibility
  /** Clinician uploads: sign and release to the patient once stored. */
  releaseNow?: boolean
  appointmentId?: string
  /** Replace a released document with a corrected version (clinicians). */
  supersedes?: string
  correctionReason?: string
  /** Demo: drop the connection part-way so the retry path can be exercised. */
  simulateDrop?: boolean
}

export type UploadResult =
  | { ok: true; docId: string; resumed?: boolean }
  | { ok: false; error: string; duplicateOf?: string }

export interface DocumentApi {
  documentsFor: (patientId?: string, opts?: { deleted?: boolean; allVersions?: boolean }) => DocEntry[]
  getDocument: (id: string) => DocEntry | null
  versionsOf: (doc: MedicalDocument) => DocEntry[]
  pendingCorrectionOf: (doc: MedicalDocument) => MedicalDocument | undefined
  openDocument: (id: string) => { ok: true; doc: MedicalDocument } | { ok: false; error: string }
  recordDownload: (id: string) => boolean
  uploadDocument: (input: UploadInput) => Promise<UploadResult>
  retryUpload: (id: string) => void
  discardUpload: (id: string) => void
  setDocVisibility: (id: string, visibility: DocVisibility) => void
  setDocPrivacyDefault: (patientId: string, privateByDefault: boolean) => void
  deleteDocument: (id: string) => void
  restoreDocument: (id: string) => void
  purgeExpired: () => number
  generateVitalsReport: (patientId: string, days: number, interpretation?: string, include?: VitalsReportInclude) => string | null
  /** Doctors: save (or clear) the handwritten signature stamped onto reports they sign. */
  setMySignature: (dataUrl: string | undefined) => void
  /** The signing clinician's interpretation & plan. Editable only while the report is unreleased. */
  setReportInterpretation: (id: string, text: string) => void
  signDocument: (id: string) => void
  releaseDocument: (id: string) => void
  correctReport: (id: string, reason: string) => string | null
  filePrescription: (patientId: string, rx: Prescription) => void
  markDocsSeen: (patientId: string) => void
  unseenDocs: (patientId: string) => number
  docEventsFor: (docId: string) => DocEvent[]
  shareLinksFor: (patientId: string) => ShareLink[]
  createShareLink: (docIds: string[], recipient: string, ttlHours: number, oneTime: boolean) => ShareLink | null
  revokeShareLink: (id: string) => void
  openShareLink: (token: string) => { ok: true; docs: MedicalDocument[]; link: ShareLink } | { ok: false; error: string }
  supportGrantFor: (docId: string) => SupportGrant | undefined
  requestSupportAccess: (docId: string, reason: string) => { ok: boolean; error?: string }
  docBackups: DocBackup[]
  createDocBackup: () => void
  testDocBackup: (id: string) => void
  restoreDocBackup: (id: string) => number
  runDocSelfTests: () => SelfTest[]
  docPolicyCtx: () => PolicyCtx
}

interface Deps {
  currentUserId: string | null
  usersRef: React.MutableRefObject<AppUser[]>
  alertsRef: React.MutableRefObject<AppAlert[]>
  vitalDefs: VitalDef[]
  notify: (userId: string, kind: NotifKind, title: string, body: string, link?: string) => void
  logAudit: (action: string, detail: string) => void
  updateUser: (id: string, patch: Partial<AppUser>) => void
}

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result as string)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(file)
})

export function useDocumentStore(deps: Deps, seed: { docs: MedicalDocument[]; events: DocEvent[] }): DocumentApi {
  const [docs, setDocs] = useState<MedicalDocument[]>(seed.docs)
  const [events, setEvents] = useState<DocEvent[]>(seed.events)
  const [shares, setShares] = useState<ShareLink[]>([])
  const [grants, setGrants] = useState<SupportGrant[]>([])
  const [backups, setBackups] = useState<DocBackup[]>([])
  const docsRef = useRef(docs); docsRef.current = docs
  const grantsRef = useRef(grants); grantsRef.current = grants
  const sharesRef = useRef(shares); sharesRef.current = shares
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>())
  const lastView = useRef(new Map<string, number>())

  const { notify, logAudit } = deps
  const me = (): AppUser | null => deps.usersRef.current.find(u => u.id === deps.currentUserId) ?? null
  const userName = (id?: string) => deps.usersRef.current.find(u => u.id === id)?.name ?? 'Unknown'
  const ctx = (): PolicyCtx => ({ users: deps.usersRef.current, grants: grantsRef.current, now: Date.now() })
  const find = (id: string) => docsRef.current.find(d => d.id === id)
  const patch = (id: string, fn: (d: MedicalDocument) => MedicalDocument) =>
    setDocs(prev => prev.map(d => d.id === id ? fn(d) : d))
  const catLabel = (d: MedicalDocument) => DOC_CATEGORIES[d.category].label
  const signatureOf = (userId: string) => {
    const u = deps.usersRef.current.find(x => x.id === userId)
    return u?.role === 'doctor' ? (u as DoctorUser).signature : undefined
  }

  const logEvent = (doc: MedicalDocument, action: DocAction, detail?: string, actorId?: string) => {
    const t = Date.now()
    setEvents(prev => [{
      id: opaqueId('dev'), docId: doc.id, patientId: doc.patientId, actorId: actorId ?? deps.currentUserId ?? 'system',
      action, detail, at: t, createdAt: stamp(new Date(t)),
    }, ...prev])
  }

  const byDate = (a: MedicalDocument, b: MedicalDocument) =>
    b.documentDate.localeCompare(a.documentDate) || b.at - a.at

  /* ─── Reads ─── */
  const documentsFor: DocumentApi['documentsFor'] = (patientId, opts = {}) => {
    const u = me(), c = ctx()
    return docs
      .filter(d => (!patientId || d.patientId === patientId) && !!d.deletedAt === !!opts.deleted && (opts.allVersions || !d.supersededBy))
      .map(doc => ({ doc, level: docAccess(u, doc, c).level }))
      .filter(e => e.level !== 'none')
      .sort((a, b) => byDate(a.doc, b.doc))
  }

  const getDocument = (id: string): DocEntry | null => {
    const d = docs.find(x => x.id === id)
    if (!d) return null
    const level = docAccess(me(), d, ctx()).level
    return level === 'none' ? null : { doc: d, level }
  }

  const versionsOf = (doc: MedicalDocument) => {
    const u = me(), c = ctx()
    return docs.filter(d => d.seriesId === doc.seriesId && !d.deletedAt)
      .map(d => ({ doc: d, level: docAccess(u, d, c).level }))
      .filter(e => e.level !== 'none')
      .sort((a, b) => b.doc.version - a.doc.version)
  }

  const pendingCorrectionOf = (doc: MedicalDocument) =>
    docs.find(d => d.supersedes === doc.id && !d.deletedAt && d.status !== 'released')

  /** Open for reading. Logs the view; failed attempts are logged too and get the same answer whether or not the ID exists. */
  const openDocument: DocumentApi['openDocument'] = (id) => {
    const u = me()
    const res = resolveDoc(u, id, docsRef.current, ctx())
    if (!res.ok) {
      const existing = find(id)
      if (existing) logEvent(existing, 'denied', docAccess(u, existing, ctx()).reason)
      logAudit('Denied document access', `${u?.name ?? 'Unknown'} → ${existing ? `${catLabel(existing)} of ${userName(existing.patientId)}` : 'unknown document ID'}`)
      return { ok: false, error: res.error }
    }
    const key = `${u?.id}:${id}`
    const recent = Date.now() - (lastView.current.get(key) ?? 0) < 5 * MIN
    if (!recent) {
      lastView.current.set(key, Date.now())
      logEvent(res.doc, 'view')
      if (u && u.role !== 'patient') logAudit('Viewed document', `${catLabel(res.doc)} · ${userName(res.doc.patientId)}`)
    }
    return { ok: true, doc: res.doc }
  }

  const recordDownload = (id: string) => {
    const res = resolveDoc(me(), id, docsRef.current, ctx())
    if (!res.ok) return false
    logEvent(res.doc, 'download')
    if (me()?.role !== 'patient') logAudit('Downloaded document', `${catLabel(res.doc)} · ${userName(res.doc.patientId)}`)
    return true
  }

  /* ─── Upload pipeline ─── */
  const finishUpload = (id: string) => {
    const d = find(id)
    if (!d) return
    patch(id, x => ({ ...x, upload: x.upload && { ...x.upload, state: 'ready', progress: 100, error: undefined } }))
    logEvent(d, 'upload', d.file?.name, d.createdBy)
    logAudit('Uploaded document', `${catLabel(d)} for ${userName(d.patientId)} by ${userName(d.createdBy)}`)
    const pt = deps.usersRef.current.find(u => u.id === d.patientId) as PatientUser | undefined
    if (d.origin === 'patient_upload' && d.visibility === 'care_team' && pt?.assignedDoctorId)
      notify(pt.assignedDoctorId, 'document', `New document from ${pt.name}`, `${catLabel(d)} · ${d.title}`, 'patients')
    // Re-check at completion: the uploader must still be this patient's treating doctor.
    if (d.origin === 'clinician_upload' && d.releaseOnReady && isTreatingDoctor({ id: d.createdBy } as AppUser, d.patientId, deps.usersRef.current))
      releaseInternal(id, d.createdBy)
  }

  const runPipeline = (id: string, failAt?: number) => {
    clearInterval(timers.current.get(id))
    let progress = 0
    const h = setInterval(() => {
      progress += 20
      if (failAt !== undefined && progress >= failAt) {
        clearInterval(h); timers.current.delete(id)
        patch(id, x => ({ ...x, upload: x.upload && { ...x.upload, state: 'failed', progress, error: `Connection lost at ${progress}%. Your file is kept — tap Retry.` } }))
        const d = find(id)
        if (d) logEvent(d, 'upload_failed', `at ${progress}%`, d.createdBy)
        return
      }
      if (progress < 100) { patch(id, x => ({ ...x, upload: x.upload && { ...x.upload, progress } })); return }
      clearInterval(h); timers.current.delete(id)
      // Stored — now the content scan (type re-check, malware scan) before anyone can open it.
      patch(id, x => ({ ...x, upload: x.upload && { ...x.upload, state: 'scanning', progress: 100 } }))
      setTimeout(() => finishUpload(id), 800)
    }, 220)
    timers.current.set(id, h)
  }

  const uploadDocument = async (input: UploadInput): Promise<UploadResult> => {
    const u = me()
    if (!canUploadFor(u, input.patientId, deps.usersRef.current)) return { ok: false, error: 'You cannot add documents to this record.' }
    const old = input.supersedes ? find(input.supersedes) : undefined
    if (input.supersedes && (!old || !canCorrect(u, old, docsRef.current, ctx()))) return { ok: false, error: 'This document cannot be corrected.' }
    if (old && !input.correctionReason?.trim()) return { ok: false, error: 'A correction reason is required.' }

    const check = await inspectFile(input.file)
    if (!check.ok) {
      logAudit('Rejected upload', `${u!.name}: ${input.file.name.slice(0, 60)} — ${check.reason}`)
      return { ok: false, error: check.reason }
    }
    const buf = await input.file.arrayBuffer()
    const sha = await hashBuffer(buf)
    const key = `${input.patientId}:${sha}`

    // Idempotency: the same file for the same patient maps to one record.
    const same = docsRef.current.find(d => d.upload?.idempotencyKey === key && !d.deletedAt)
    if (same?.upload?.state === 'failed') { retryUpload(same.id); return { ok: true, docId: same.id, resumed: true } }
    if (same && same.upload?.state !== 'ready') return { ok: true, docId: same.id, resumed: true }
    if (same) return { ok: false, error: `This file is already in the library as “${same.title}”.`, duplicateOf: same.id }

    const dataUrl = await readAsDataUrl(input.file)
    const pt = deps.usersRef.current.find(x => x.id === input.patientId) as PatientUser | undefined
    const clinician = u!.role === 'doctor'
    const t = Date.now()
    const id = opaqueId('doc')
    const appt = input.appointmentId ? { kind: 'appointment' as const, id: input.appointmentId, label: 'Related appointment' } : null
    const doc: MedicalDocument = {
      id, patientId: input.patientId,
      title: old?.title ?? (input.title.trim() || check.name),
      category: old?.category ?? input.category,
      origin: clinician ? 'clinician_upload' : 'patient_upload',
      description: input.description?.trim() || undefined,
      documentDate: input.documentDate || dayKey(),
      createdAt: stamp(new Date(t)), at: t, createdBy: u!.id,
      file: { name: check.name, mime: check.mime, size: input.file.size, sha256: sha, dataUrl },
      upload: { state: 'uploading', progress: 0, attempts: 1, idempotencyKey: key },
      status: clinician ? 'draft' : undefined,
      releaseOnReady: clinician ? !!input.releaseNow : undefined,
      seriesId: old?.seriesId ?? id, version: old ? old.version + 1 : 1,
      supersedes: old?.id, correctionReason: old ? input.correctionReason!.trim() : undefined,
      links: [...(old?.links ?? []), ...(appt ? [appt] : [])],
      visibility: clinician ? 'care_team' : input.visibility ?? (pt?.docPrefs?.privateByDefault ? 'private' : 'care_team'),
    }
    setDocs(prev => [doc, ...prev])
    docsRef.current = [doc, ...docsRef.current]
    runPipeline(id, input.simulateDrop ? 60 : undefined)
    return { ok: true, docId: id }
  }

  const retryUpload = (id: string) => {
    const d = find(id), u = me()
    if (!d?.upload || d.upload.state !== 'failed' || !u || (d.createdBy !== u.id && !canUploadFor(u, d.patientId, deps.usersRef.current))) return
    patch(id, x => ({ ...x, upload: x.upload && { ...x.upload, state: 'uploading', progress: 0, error: undefined, attempts: x.upload.attempts + 1 } }))
    logEvent(d, 'retry', `attempt ${d.upload.attempts + 1}`)
    runPipeline(id)
  }

  /** A failed upload never became part of the record, so discarding removes it outright. */
  const discardUpload = (id: string) => {
    const d = find(id), u = me()
    if (!d?.upload || d.upload.state !== 'failed' || d.createdBy !== u?.id) return
    setDocs(prev => prev.filter(x => x.id !== id))
    logAudit('Discarded failed upload', `${catLabel(d)} for ${userName(d.patientId)}`)
  }

  /* ─── Patient privacy ─── */
  const setDocVisibility = (id: string, visibility: DocVisibility) => {
    const d = find(id), u = me()
    if (!d || !u || u.id !== d.patientId || d.origin !== 'patient_upload' || d.visibility === visibility) return
    patch(id, x => ({ ...x, visibility }))
    logEvent(d, 'visibility', visibility === 'private' ? 'Made private' : 'Shared with care team')
    logAudit('Changed document visibility', `${u.name} · ${catLabel(d)} → ${visibility === 'private' ? 'private' : 'care team'}`)
    const pt = u as PatientUser
    if (visibility === 'care_team' && pt.assignedDoctorId && d.upload?.state === 'ready')
      notify(pt.assignedDoctorId, 'document', `${pt.name} shared a document`, `${catLabel(d)} · ${d.title}`, 'patients')
  }

  const setDocPrivacyDefault = (patientId: string, privateByDefault: boolean) => {
    if (deps.currentUserId !== patientId) return
    deps.updateUser(patientId, { docPrefs: { privateByDefault } } as Partial<PatientUser>)
    logAudit('Changed document privacy default', `${userName(patientId)} → ${privateByDefault ? 'private' : 'shared with care team'}`)
  }

  /* ─── Delete & recover ─── */
  const deleteDocument = (id: string) => {
    const d = find(id), u = me()
    if (!d || !canDelete(u, d, ctx())) return
    patch(id, x => ({ ...x, deletedAt: Date.now(), deletedBy: u!.id }))
    logEvent(d, 'delete')
    logAudit('Deleted document', `${catLabel(d)} · ${userName(d.patientId)} (recoverable ${DOC_RETENTION_DAYS} days)`)
  }

  const restoreDocument = (id: string) => {
    const d = find(id), u = me()
    if (!d || !canRestore(u, d, ctx())) return
    patch(id, x => ({ ...x, deletedAt: undefined, deletedBy: undefined }))
    logEvent(d, 'restore')
    logAudit('Restored document', `${catLabel(d)} · ${userName(d.patientId)}`)
    if (u!.id !== d.patientId && d.origin === 'patient_upload')
      notify(d.patientId, 'document', 'A document was restored', `${d.title} was recovered by mCare support`, 'docs')
  }

  /** Permanently removes documents past the retention window. Full admins only. */
  const purgeExpired = () => {
    const u = me() as AdminUser | null
    if (!u || u.role !== 'admin' || u.isAssistant) return 0
    const cutoff = Date.now() - DOC_RETENTION_DAYS * DAY
    const gone = docsRef.current.filter(d => d.deletedAt && d.deletedAt < cutoff)
    if (!gone.length) return 0
    setDocs(prev => prev.filter(d => !gone.some(g => g.id === d.id)))
    logAudit('Purged expired documents', `${gone.length} past the ${DOC_RETENTION_DAYS}-day retention window`)
    return gone.length
  }

  /* ─── Clinical lifecycle ─── */
  const generateVitalsReport = (patientId: string, days: number, interpretation?: string, include?: VitalsReportInclude) => {
    const u = me()
    const pt = deps.usersRef.current.find(x => x.id === patientId) as PatientUser | undefined
    if (!u || !pt || !isTreatingDoctor(u, patientId, deps.usersRef.current)) return null
    const t = Date.now()
    const { body, links } = buildVitalsReport(pt, deps.vitalDefs, deps.alertsRef.current, days, t, interpretation, include)
    const id = opaqueId('doc')
    const doc: MedicalDocument = {
      id, patientId, title: `Vitals Report — last ${days} days`, category: 'vitals_report', origin: 'system_generated',
      documentDate: dayKey(new Date(t)), createdAt: stamp(new Date(t)), at: t, createdBy: u.id,
      status: 'draft', seriesId: id, version: 1, body, links, visibility: 'care_team',
    }
    setDocs(prev => [doc, ...prev])
    docsRef.current = [doc, ...docsRef.current]
    logEvent(doc, 'upload', 'Generated from the vitals record')
    logAudit('Generated report draft', `Vitals report (${days} days) · ${pt.name}`)
    return id
  }

  const setMySignature = (dataUrl: string | undefined) => {
    const u = me()
    if (!u || u.role !== 'doctor') return
    if (dataUrl && (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 400_000)) return
    deps.updateUser(u.id, { signature: dataUrl } as Partial<AppUser>)
    logAudit(dataUrl ? 'Updated signature' : 'Removed signature', 'Applies to reports signed from now on')
  }

  const setReportInterpretation = (id: string, text: string) => {
    const d = find(id), u = me()
    if (!d || d.body?.type !== 'vitals' || d.status === 'released' || !canRelease(u, d, ctx())) return
    const interpretation = text.trim() || undefined
    if ((d.body.interpretation ?? undefined) === interpretation) return
    // Changing the words after signing voids the signature — it must be signed again.
    patch(id, x => x.body?.type === 'vitals'
      ? { ...x, body: { ...x.body, interpretation }, ...(x.status === 'signed' ? { status: 'draft' as const, signedBy: undefined, signedAt: undefined, signatureImage: undefined } : {}) }
      : x)
    logAudit('Edited report interpretation', `${catLabel(d)} · ${userName(d.patientId)}`)
  }

  const signDocument = (id: string) => {
    const d = find(id), u = me()
    if (!d || !canSign(u, d, ctx())) return
    patch(id, x => ({ ...x, status: 'signed', signedBy: u!.id, signedAt: stamp(), signatureImage: signatureOf(u!.id) }))
    logEvent(d, 'sign')
    logAudit('Signed document', `${catLabel(d)}${d.version > 1 ? ` v${d.version}` : ''} · ${userName(d.patientId)}`)
  }

  const releaseInternal = (id: string, actorId: string) => {
    const d = find(id)
    if (!d) return
    const t = stamp()
    patch(id, x => ({
      ...x, status: 'released', signedBy: x.signedBy ?? actorId, signedAt: x.signedAt ?? t,
      signatureImage: x.signedBy ? x.signatureImage : signatureOf(actorId),
      releasedBy: actorId, releasedAt: t, seenByPatient: false, releaseOnReady: undefined,
    }))
    if (d.supersedes) patch(d.supersedes, x => ({ ...x, supersededBy: id }))
    logEvent(d, 'release', d.supersedes ? `Version ${d.version} replaces version ${d.version - 1}` : undefined, actorId)
    logAudit(d.supersedes ? 'Released corrected document' : 'Released document', `${catLabel(d)}${d.version > 1 ? ` v${d.version}` : ''} → ${userName(d.patientId)}`)
    notify(d.patientId, 'document', d.supersedes ? 'Corrected report available' : 'New report from your doctor',
      `${d.title}${d.supersedes ? ` — updated to version ${d.version}` : ''}`, 'docs')
  }

  const releaseDocument = (id: string) => {
    const d = find(id), u = me()
    if (!d || !u || !canRelease(u, d, ctx())) return
    if (d.status === 'draft') logEvent(d, 'sign', 'Signed on release')
    releaseInternal(id, u.id)
  }

  /** Start a corrected version of a released report. The original stays current until the correction is released. */
  const correctReport = (id: string, reason: string) => {
    const old = find(id), u = me()
    if (!old || !u || !reason.trim() || !canCorrect(u, old, docsRef.current, ctx())) return null
    const pt = deps.usersRef.current.find(x => x.id === old.patientId) as PatientUser
    const t = Date.now()
    const rebuilt = old.body?.type === 'vitals'
      ? buildVitalsReport(pt, deps.vitalDefs, deps.alertsRef.current, old.body.periodDays, t, old.body.interpretation, old.body.include)
      : { body: old.body, links: old.links }
    const nid = opaqueId('doc')
    const doc: MedicalDocument = {
      ...old, id: nid, createdAt: stamp(new Date(t)), at: t, createdBy: u.id, documentDate: dayKey(new Date(t)),
      body: rebuilt.body, links: rebuilt.links, status: 'draft',
      signedBy: undefined, signedAt: undefined, signatureImage: undefined, releasedBy: undefined, releasedAt: undefined,
      version: old.version + 1, supersedes: old.id, supersededBy: undefined, correctionReason: reason.trim(), seenByPatient: undefined,
    }
    setDocs(prev => [doc, ...prev])
    docsRef.current = [doc, ...docsRef.current]
    logEvent(old, 'correct', reason.trim())
    logAudit('Started correction', `${catLabel(old)} of ${userName(old.patientId)} v${old.version} → v${doc.version}`)
    return nid
  }

  /** Prescriptions are signed at the moment of prescribing, so they file straight into the library. */
  const filePrescription = (patientId: string, rx: Prescription) => {
    const t = Date.now()
    const id = opaqueId('doc')
    const doc: MedicalDocument = {
      id, patientId, title: `Prescription — ${rx.medication}`, category: 'prescription', origin: 'system_generated',
      documentDate: dayKey(new Date(t)), createdAt: stamp(new Date(t)), at: t, createdBy: rx.doctorId,
      status: 'released', signedBy: rx.doctorId, signedAt: stamp(new Date(t)), releasedBy: rx.doctorId, releasedAt: stamp(new Date(t)),
      seriesId: id, version: 1, visibility: 'care_team', seenByPatient: false,
      body: { type: 'prescription', medication: rx.medication, dosage: rx.dosage, frequency: rx.frequency, purpose: rx.purpose },
      links: [{ kind: 'prescription', id: rx.id, label: `${rx.medication} · ${rx.frequency}` }],
    }
    setDocs(prev => [doc, ...prev])
    logEvent(doc, 'release', 'Filed automatically when prescribed', rx.doctorId)
  }

  /* ─── Patient library state ─── */
  const unseenFilter = (d: MedicalDocument, patientId: string) =>
    d.patientId === patientId && isOfficial(d) && d.status === 'released' && !d.supersededBy && !d.deletedAt && d.seenByPatient === false

  const markDocsSeen = (patientId: string) => {
    if (deps.currentUserId !== patientId || !docsRef.current.some(d => unseenFilter(d, patientId))) return
    setDocs(prev => prev.map(d => unseenFilter(d, patientId) ? { ...d, seenByPatient: true } : d))
  }
  const unseenDocs = (patientId: string) => docs.filter(d => unseenFilter(d, patientId)).length

  /** Access history: the patient sees who opened their files; staff see it for documents they can reach. */
  const docEventsFor = (docId: string) => {
    const d = docs.find(x => x.id === docId), u = me()
    if (!d || !u) return []
    const lvl = docAccess(u, d, ctx()).level
    const allowed = u.id === d.patientId || lvl === 'content' || (lvl === 'metadata' && u.role !== 'patient')
    return allowed ? events.filter(e => e.docId === docId) : []
  }

  /* ─── External sharing ─── */
  const shareLinksFor = (patientId: string) => deps.currentUserId === patientId ? shares.filter(s => s.patientId === patientId) : []

  const createShareLink = (docIds: string[], recipient: string, ttlHours: number, oneTime: boolean) => {
    const u = me()
    const list = docIds.map(find).filter((d): d is MedicalDocument => !!d)
    if (!u || !recipient.trim() || list.length === 0 || !list.every(d => canShare(u, d, ctx()))) return null
    const t = Date.now()
    const link: ShareLink = {
      id: opaqueId('shr'), token: opaqueId('tok').slice(4) + opaqueId('x').slice(2), patientId: u.id, docIds: list.map(d => d.id),
      recipient: recipient.trim(), at: t, createdAt: stamp(new Date(t)), expiresAt: t + ttlHours * 3_600_000, oneTime,
    }
    setShares(prev => [link, ...prev])
    list.forEach(d => logEvent(d, 'share', `${link.recipient} · ${ttlHours} h${oneTime ? ' · one-time' : ''}`))
    logAudit('Created share link', `${u.name} → ${link.recipient} · ${list.length} document${list.length > 1 ? 's' : ''} · ${ttlHours} h`)
    return link
  }

  const revokeShareLink = (id: string) => {
    const s = sharesRef.current.find(x => x.id === id)
    if (!s || s.patientId !== deps.currentUserId || s.revokedAt) return
    setShares(prev => prev.map(x => x.id === id ? { ...x, revokedAt: Date.now() } : x))
    s.docIds.map(find).forEach(d => d && logEvent(d, 'share_revoke', s.recipient))
    logAudit('Revoked share link', `${userName(s.patientId)} → ${s.recipient}`)
  }

  /** What the outside clinician's browser would call. No mCare account involved — the token is the credential. */
  const openShareLink: DocumentApi['openShareLink'] = (token) => {
    const s = sharesRef.current.find(x => x.token === token)
    const t = Date.now()
    if (!s || s.revokedAt || t > s.expiresAt || (s.oneTime && s.usedAt))
      return { ok: false, error: !s ? 'Link not recognised.' : s.revokedAt ? 'This link was revoked.' : t > s.expiresAt ? 'This link has expired.' : 'This one-time link was already used.' }
    const list = s.docIds.map(find).filter((d): d is MedicalDocument => !!d && !d.deletedAt)
    if (s.oneTime) setShares(prev => prev.map(x => x.id === s.id ? { ...x, usedAt: t } : x))
    list.forEach(d => logEvent(d, 'share_open', s.recipient, `external:${s.recipient}`))
    logAudit('Share link opened', `${s.recipient} · ${list.length} document${list.length > 1 ? 's' : ''} of ${userName(s.patientId)}`)
    notify(s.patientId, 'document', 'Your shared link was opened', `${s.recipient} viewed ${list.length} document${list.length > 1 ? 's' : ''}`, 'docs')
    return { ok: true, docs: list, link: s }
  }

  /* ─── Admin support access ─── */
  const supportGrantFor = (docId: string) => grants.find(g => g.docId === docId && g.adminId === deps.currentUserId && g.expiresAt > Date.now())

  const requestSupportAccess = (docId: string, reason: string) => {
    const d = find(docId), u = me() as AdminUser | null
    if (!d || !u || u.role !== 'admin' || u.isAssistant) return { ok: false, error: 'Only a full Admin can open document content for support.' }
    if (d.deletedAt) return { ok: false, error: 'Restore the document first.' }
    if (reason.trim().length < 10) return { ok: false, error: 'Describe the support case (at least 10 characters).' }
    const t = Date.now()
    const g: SupportGrant = { id: opaqueId('sg'), adminId: u.id, docId, reason: reason.trim(), at: t, expiresAt: t + SUPPORT_ACCESS_MIN * MIN }
    setGrants(prev => [g, ...prev])
    grantsRef.current = [g, ...grantsRef.current]
    logEvent(d, 'support_access', reason.trim())
    logAudit('Support access to document', `${catLabel(d)} of ${userName(d.patientId)} · ${SUPPORT_ACCESS_MIN} min · ${reason.trim()}`)
    notify(d.patientId, 'document', 'mCare support opened one of your documents', `${catLabel(d)} — reason: ${reason.trim()}`, 'docs')
    return { ok: true }
  }

  /* ─── Backup & recovery ─── */
  const canBackup = (u: AppUser | null) => !!u && (u.role === 'admin' || (u.role === 'assistant' && (u as AdminUser).permissions.includes('document_support')))

  const createDocBackup = () => {
    const u = me()
    if (!canBackup(u)) return
    const payload = JSON.stringify(docsRef.current)
    const t = Date.now()
    const b: DocBackup = { id: opaqueId('bk'), at: t, createdAt: stamp(new Date(t)), createdBy: u!.id, count: docsRef.current.length, checksum: fnv1a(payload), payload }
    setBackups(prev => [b, ...prev])
    logAudit('Created document backup', `${b.count} documents · checksum ${b.checksum}`)
  }

  /** Dry-run restore: verify integrity and report what a real restore would recover, without touching live data. */
  const testDocBackup = (id: string) => {
    const b = backups.find(x => x.id === id)
    if (!b || !canBackup(me())) return
    let ok = true, detail = ''
    try {
      if (fnv1a(b.payload) !== b.checksum) throw new Error('checksum mismatch — backup is corrupted')
      const parsed = JSON.parse(b.payload) as MedicalDocument[]
      const bad = parsed.filter(d => !d.id || !d.patientId || !d.seriesId)
      if (bad.length) throw new Error(`${bad.length} malformed record${bad.length > 1 ? 's' : ''}`)
      const recoverable = parsed.filter(d => !docsRef.current.some(l => l.id === d.id)).length
      detail = `Checksum verified · ${parsed.length} documents readable · ${recoverable} would be recovered`
    } catch (e) {
      ok = false; detail = e instanceof Error ? e.message : 'Unreadable backup'
    }
    setBackups(prev => prev.map(x => x.id === id ? { ...x, lastTest: { at: Date.now(), ok, detail } } : x))
    logAudit('Tested backup restore', `${b.createdAt} — ${ok ? 'passed' : 'FAILED'}: ${detail}`)
  }

  /** Non-destructive restore: brings back records missing from live data, never overwrites newer changes. */
  const restoreDocBackup = (id: string) => {
    const b = backups.find(x => x.id === id), u = me() as AdminUser | null
    if (!b || !u || u.role !== 'admin' || u.isAssistant || fnv1a(b.payload) !== b.checksum) return 0
    const parsed = JSON.parse(b.payload) as MedicalDocument[]
    const missing = parsed.filter(d => !docsRef.current.some(l => l.id === d.id))
    if (missing.length) setDocs(prev => [...prev, ...missing])
    logAudit('Restored documents from backup', `${missing.length} recovered from ${b.createdAt}`)
    return missing.length
  }

  return {
    documentsFor, getDocument, versionsOf, pendingCorrectionOf, openDocument, recordDownload,
    uploadDocument, retryUpload, discardUpload, setDocVisibility, setDocPrivacyDefault,
    deleteDocument, restoreDocument, purgeExpired,
    generateVitalsReport, setMySignature, setReportInterpretation,signDocument, releaseDocument, correctReport, filePrescription,
    markDocsSeen, unseenDocs, docEventsFor,
    shareLinksFor, createShareLink, revokeShareLink, openShareLink,
    supportGrantFor, requestSupportAccess,
    docBackups: backups, createDocBackup, testDocBackup, restoreDocBackup,
    runDocSelfTests: () => runPolicySelfTests(),
    docPolicyCtx: ctx,
  }
}
