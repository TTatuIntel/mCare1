/**
 * What someone outside mCare sees when they open a patient's share link
 * (`?share=<token>`). They have no account: the link is the only credential.
 * The server checks it (not expired, not revoked, not already used), records
 * the opening in each document's history and tells the patient.
 *
 * The page shows report content only. A patient's uploaded files stay in
 * private storage, which a person without an account cannot reach.
 */
import { useEffect, useState } from 'react'
import type { MedicalDocument } from '@/shared/lib/types'
import { backendConfigured } from '@/shared/api/supabase'
import { explain } from '@/shared/api/actions'
import { openShareLink, type SharedDocument } from '@/shared/api/documentActions'
import { MCareLogo } from '@/shared/layout/MCareLogo'
import { DOC_CATEGORIES } from './documents'
import { DocBodyView } from './DocKit'

/** One opening per page load: asking twice would spend a one-time link (and React runs effects twice in development). */
const opened = new Map<string, Promise<SharedDocument[]>>()
const openOnce = (token: string) => {
  if (!opened.has(token)) opened.set(token, openShareLink(token))
  return opened.get(token)!
}

/** Enough of a document for the reader to draw its content. */
const asDocument = (d: SharedDocument): MedicalDocument => ({
  id: d.id, patientId: '', title: d.title, category: d.category, origin: 'system_generated', documentDate: d.documentDate,
  createdAt: '', at: 0, createdBy: '', body: d.body ?? undefined, status: 'released', seriesId: d.id, version: 1, links: [], visibility: 'care_team',
})

export function SharedDocuments({ token }: { token: string }) {
  const [docs, setDocs] = useState<SharedDocument[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!backendConfigured) { setError('This link can only be opened on the live mCare service.'); return }
    let stale = false
    openOnce(token).then(
      list => { if (!stale) setDocs(list) },
      e => { if (!stale) setError(/no longer valid/i.test(explain(e)) ? 'This link is no longer valid. It may have expired, been withdrawn by the patient, or already been used. Ask the patient for a new one.' : explain(e)) })
    return () => { stale = true }
  }, [token])

  return (
    <div className="h-full overflow-y-auto bg-gray-100" style={{ scrollbarWidth: 'none' }}>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 @2xl:px-8 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          <MCareLogo size="sm" />
          <div className="min-w-0">
            <h1 className="text-lg font-black text-gray-900 font-display leading-tight">Shared medical documents</h1>
            <p className="text-xs text-gray-500 truncate">{docs?.[0] ? `Shared with ${docs[0].recipient}` : 'mCare secure link'}</p>
          </div>
        </header>

        {error ? (
          <div role="alert" className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <p className="text-sm font-bold text-gray-900">These documents cannot be opened</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{error}</p>
          </div>
        ) : !docs ? (
          <p role="status" className="bg-white rounded-2xl p-6 shadow-sm text-center text-sm text-gray-500">Opening the documents…</p>
        ) : docs.length === 0 ? (
          <p className="bg-white rounded-2xl p-6 shadow-sm text-center text-sm text-gray-500">The patient has since withdrawn these documents.</p>
        ) : (
          <>
            <p className="text-[11px] text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Confidential health information, shared by the patient for their care. The patient is told each time this link is opened. Do not forward it.
            </p>
            {docs.map(d => (
              <article key={d.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-xl" aria-hidden="true">{DOC_CATEGORIES[d.category].icon}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-gray-900">{d.title}</h2>
                    <p className="text-[11px] text-gray-500">{DOC_CATEGORIES[d.category].label} · <span className="font-mono">{d.documentDate}</span></p>
                  </div>
                </div>
                {d.body
                  ? <DocBodyView doc={asDocument(d)} />
                  : <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5">{d.fileName ? `“${d.fileName}” is a file the patient uploaded. Files are not sent through links: ask the patient to send it to you directly.` : 'This document has no content to show.'}</p>}
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
