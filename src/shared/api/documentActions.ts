/**
 * Documents on the backend (live mode): the rows in `documents`, and their
 * files in the private `documents` storage bucket.
 *
 * Who may open, sign, release, correct, share or delete is decided by the
 * database (supabase/migrations/0002_documents.sql). A file is readable
 * exactly when its document row is, because the bucket's rule looks the row
 * up as the person asking.
 */
import type { DocBody, DocCategory, DocOrigin, DocSourceLink, DocVisibility } from '@/shared/lib/types'
import { ApiError, explain } from './actions'
import { getSupabase } from './supabase'

const BUCKET = 'documents'
const db = getSupabase

/** What a supabase-js request resolves with: the data, or the error. */
type Reply = { data: unknown; error: { message: string; code?: string } | null; status?: number }
async function ok<T = unknown>(request: PromiseLike<Reply>): Promise<T> {
  let reply: Reply
  try { reply = await request } catch (e) { throw new ApiError(explain(e)) }
  if (reply.error) throw new ApiError(explain(reply.error, reply.status))
  return reply.data as T
}
const storageFailed = (e: { message?: string } | null, fallback: string) =>
  new ApiError(/failed to fetch|network/i.test(e?.message ?? '') ? explain(e) : fallback)

export interface NewUpload {
  patientId: string
  title: string
  category: DocCategory
  origin: Exclude<DocOrigin, 'system_generated'>
  documentDate: string
  description?: string
  visibility: DocVisibility
  links: DocSourceLink[]
  file: { name: string; mime: string; size: number; sha256: string; bytes: ArrayBuffer }
}

/**
 * Stores the file, then records the document. The file goes into the
 * patient's folder under a name made from its content hash, so sending the
 * same file again overwrites itself rather than piling up, and the unique
 * rule on (patient, hash) refuses a second document for it.
 */
export async function uploadDocument(u: NewUpload): Promise<string> {
  const supabase = await db()
  const ext = (u.file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase()
  const path = `${u.patientId}/${u.file.sha256.slice(0, 64)}${ext}`
  const stored = await supabase.storage.from(BUCKET).upload(path, u.file.bytes, { contentType: u.file.mime, upsert: true })
  if (stored.error) throw storageFailed(stored.error, 'The file could not be stored. Check your connection and try again.')
  const row = await ok<{ id: string }>(supabase.from('documents').insert({
    patient_id: u.patientId, title: u.title.trim(), category: u.category, origin: u.origin,
    description: u.description?.trim() || null, document_date: u.documentDate, visibility: u.visibility, links: u.links,
    file_path: path, file_name: u.file.name, file_mime: u.file.mime, file_size: u.file.size, file_sha256: u.file.sha256,
    upload_state: 'ready',
  }).select('id').single())
  return row.id
}

/** The file's bytes as a data URL, for the viewer and for downloads. The request is refused unless the document may be opened. */
export async function downloadFile(path: string, mime: string): Promise<string> {
  const { data, error } = await (await db()).storage.from(BUCKET).download(path)
  if (error || !data) throw storageFailed(error, 'The file could not be opened. You may no longer have access to it.')
  const typed = new Blob([data], { type: mime })
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new ApiError('The file could not be read.'))
    reader.readAsDataURL(typed)
  })
}

/** Writes "opened" or "downloaded" to the document's history. Also the server's own access check. */
export const recordAccess = async (docId: string, act: 'view' | 'download') => { await ok((await db()).rpc('record_document_access', { doc: docId, act })) }

export const setVisibility = async (docId: string, visibility: DocVisibility) => { await ok((await db()).from('documents').update({ visibility }).eq('id', docId)) }
/** Recoverable for 30 days; the database then removes it for good. */
export const softDelete = async (docId: string) => { await ok((await db()).from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', docId)) }
export const restore = async (docId: string) => { await ok((await db()).from('documents').update({ deleted_at: null }).eq('id', docId)) }
export const markSeen = async (docIds: string[]) => {
  if (docIds.length) await ok((await db()).from('documents').update({ seen_by_patient: true }).in('id', docIds))
}

/* ─── Sharing with someone outside mCare ────────────────────────────── */
/** The link's token. It is returned once: the server keeps only a hash of it. */
export const createShareLink = async (docIds: string[], recipient: string, ttlHours: number, oneTime: boolean) =>
  ok<string>((await db()).rpc('create_share_link', { docs: docIds, recipient: recipient.trim(), ttl_hours: ttlHours, one_time: oneTime }))
export const revokeShareLink = async (id: string) => { await ok((await db()).from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)) }

export interface SharedDocument { id: string; title: string; category: DocCategory; documentDate: string; body: DocBody | null; fileName: string | null; recipient: string }
/** What the outside clinician's browser calls. No account: the token is the credential, and every opening is recorded. */
export async function openShareLink(token: string): Promise<SharedDocument[]> {
  const rows = await ok<Record<string, unknown>[]>((await db()).rpc('open_share_link', { token }))
  return rows.map(r => ({
    id: r.id as string, title: r.title as string, category: r.category as DocCategory, documentDate: r.document_date as string,
    body: (r.body as DocBody | null) ?? null, fileName: (r.file_name as string | null) ?? null, recipient: r.recipient as string,
  }))
}

/* ─── Clinical documents (treating doctor) ──────────────────────────── */
export async function createReport(patientId: string, title: string, body: DocBody, links: DocSourceLink[], documentDate: string): Promise<string> {
  const row = await ok<{ id: string }>((await db()).from('documents').insert({
    patient_id: patientId, title, category: 'vitals_report', origin: 'system_generated', body, links, document_date: documentDate,
  }).select('id').single())
  return row.id
}
/** Editing the words of a signed report voids the signature: the database puts it back to draft. */
export const setReportBody = async (docId: string, body: DocBody, links?: DocSourceLink[]) => {
  await ok((await db()).from('documents').update({ body, ...(links ? { links } : {}) }).eq('id', docId))
}
export const sign = async (docId: string) => { await ok((await db()).rpc('sign_document', { doc: docId })) }
export const release = async (docId: string) => { await ok((await db()).rpc('release_document', { doc: docId })) }
/** Starts version n+1 as a draft. The released version stays current until the correction is released. */
export const correct = async (docId: string, reason: string) => ok<string>((await db()).rpc('correct_document', { doc: docId, reason }))
export const requestSupportAccess = async (docId: string, reason: string) => { await ok((await db()).rpc('request_support_access', { doc: docId, reason })) }
