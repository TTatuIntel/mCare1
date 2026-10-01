import { useMemo, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { BackHeader, Pill, useToast } from '@/shared'
import type { AdminUser } from '@/shared/lib/types'
import { isOfficial, DOC_RETENTION_DAYS, SUPPORT_ACCESS_MIN } from '@/shared/documents/documents'
import { ago } from '@/shared/lib/vitals'
import { DocRow, useDocFilters } from '@/shared/documents/DocKit'
import { DocumentViewer } from '@/shared/documents/DocumentViewer'
import { isFullAdmin } from '@/assistant/permissions'

type View = 'registry' | 'recovery' | 'policy'
const DAY = 86_400_000

/**
 * Document operations for Admins and permitted Assistants. Everything here
 * works from metadata: staff can find, recover and audit documents without
 * reading them. A full Admin can open one document's content for a support
 * case — time-limited, reason required, patient notified.
 */
export default function DocumentsTab({ admin, onBack }: { admin: AdminUser; onBack: () => void }) {
  const {
    users, now, documentsFor, docBackups, createDocBackup, testDocBackup, restoreDocBackup, purgeExpired,
    restoreDocument, runDocSelfTests,
  } = useApp()
  const [view, setView] = useState<View>('registry')
  const [openId, setOpenId] = useState<string | null>(null)
  const [attention, setAttention] = useState(false)
  const toast = useToast()
  const full = isFullAdmin(admin)

  const all = documentsFor(undefined, { allVersions: true })
  const deleted = documentsFor(undefined, { deleted: true, allVersions: true })
  const tests = useMemo(() => runDocSelfTests(), [view])
  const needsAttention = (e: typeof all[number]) =>
    e.doc.upload?.state === 'failed' || (isOfficial(e.doc) && e.doc.status !== 'released' && now - e.doc.at > DAY)
  const { filtered, controls } = useDocFilters(attention ? all.filter(needsAttention) : all, users)
  const patientName = (id: string) => users.find(u => u.id === id)?.name ?? '—'

  if (openId) return <DocumentViewer docId={openId} onBack={() => setOpenId(null)} onOpenDoc={setOpenId} />

  const expired = deleted.filter(e => now - (e.doc.deletedAt ?? now) > DOC_RETENTION_DAYS * DAY)
  const lastTest = docBackups.find(b => b.lastTest)?.lastTest
  const stats = [
    { v: all.length, l: 'Documents', c: 'text-teal-700' },
    { v: all.filter(e => isOfficial(e.doc)).length, l: 'Official', c: 'text-emerald-600' },
    { v: all.filter(e => !isOfficial(e.doc)).length, l: 'Personal', c: 'text-gray-700' },
    { v: all.filter(e => isOfficial(e.doc) && e.doc.status !== 'released').length, l: 'Unreleased', c: 'text-amber-600' },
    { v: all.filter(e => e.doc.upload?.state === 'failed').length, l: 'Failed uploads', c: 'text-red-500' },
    { v: deleted.length, l: 'Deleted', c: 'text-gray-500' },
  ]
  const passed = tests.filter(t => t.pass).length

  return (
    <div className="flex flex-col gap-3 card-flow">
      <BackHeader title="Documents" subtitle="Registry · recovery · access policy" onBack={onBack} />
      {toast.node}

      <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
        <p className="text-[11px] text-purple-800 leading-relaxed">
          {full
            ? `You see metadata only — never titles or content. To open one document for a support case, use Support access (${SUPPORT_ACCESS_MIN} min, reason required, patient notified).`
            : 'Document support: metadata and recovery only. Signing and releasing clinical documents belongs to the treating doctor and cannot be granted to assistants.'}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map(s => (
          <div key={s.l} className="bg-white rounded-2xl py-2.5 text-center shadow-sm">
            <p className={`text-lg font-black ${s.c}`}>{s.v}</p>
            <p className="text-[9px] text-gray-400 leading-tight">{s.l}</p>
          </div>
        ))}
      </div>

      <div className="flex bg-white rounded-full p-0.5 shadow-sm">
        {([['registry', 'Registry'], ['recovery', 'Recovery'], ['policy', `Policy ${passed}/${tests.length}`]] as [View, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)}
            className={`flex-1 py-1.5 rounded-full text-[11px] font-bold ${view === id ? 'bg-teal-700 text-white' : 'text-gray-500'}`}>{label}</button>
        ))}
      </div>

      {view === 'registry' && (
        <>
          <button onClick={() => setAttention(a => !a)}
            className={`self-start px-3 py-1.5 rounded-full text-[10px] font-bold ${attention ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 shadow-sm'}`}>
            ⚠ Needs attention ({all.filter(needsAttention).length})
          </button>
          {controls}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {filtered.length === 0
              ? <p className="text-xs text-gray-400 text-center py-8">No documents match.</p>
              : filtered.map((e, i) => <DocRow key={e.doc.id} entry={e} onOpen={setOpenId} patientName={patientName(e.doc.patientId)} last={i === filtered.length - 1} />)}
          </div>
        </>
      )}

      {view === 'recovery' && (
        <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <p className="text-xs font-bold text-gray-900">Recently deleted ({deleted.length})</p>
              <p className="text-[10px] text-gray-400">{DOC_RETENTION_DAYS}-day recovery window</p>
            </div>
            {deleted.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Nothing deleted.</p>}
            {deleted.map(e => {
              const past = now - (e.doc.deletedAt ?? now) > DOC_RETENTION_DAYS * DAY
              return (
                <div key={e.doc.id} className="flex items-center gap-2 pr-3 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0"><DocRow entry={e} onOpen={setOpenId} patientName={patientName(e.doc.patientId)} last /></div>
                  {past
                    ? <Pill color="gray">Expired</Pill>
                    : <button onClick={() => { restoreDocument(e.doc.id); toast.show('Document restored') }} className="text-[11px] font-bold text-teal-700 flex-shrink-0">Restore</button>}
                </div>
              )
            })}
            {expired.length > 0 && full && (
              <div className="px-4 py-3 bg-gray-50">
                <p className="text-[10px] text-gray-500 mb-1.5">{expired.length} document{expired.length > 1 ? 's are' : ' is'} past the recovery window. Purging removes {expired.length > 1 ? 'them' : 'it'} permanently — take a backup first.</p>
                <button onClick={() => toast.show(`Purged ${purgeExpired()} document(s)`)} className="text-[11px] font-bold text-red-600">Purge expired</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-gray-900">Backups</p>
              <button onClick={() => { createDocBackup(); toast.show('Backup created') }} className="text-[11px] font-bold text-white bg-teal-700 px-3 py-1 rounded-full">+ Back up now</button>
            </div>
            <p className="text-[10px] text-gray-400 mb-2">
              {lastTest ? `Last restore test ${ago(lastTest.at, now)}: ${lastTest.ok ? 'passed' : 'FAILED'}` : 'No restore test recorded yet — create a backup and test it.'}
            </p>
            {docBackups.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No backups yet.</p>}
            {docBackups.map(b => (
              <div key={b.id} className="border border-gray-100 rounded-xl p-3 mb-2 last:mb-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-900">{b.createdAt}</p>
                  <span className="text-[10px] text-gray-400 font-mono">#{b.checksum}</span>
                </div>
                <p className="text-[10px] text-gray-400">{b.count} documents · by {patientName(b.createdBy)}</p>
                {b.lastTest && (
                  <p className={`text-[10px] mt-1 font-semibold ${b.lastTest.ok ? 'text-emerald-700' : 'text-red-600'}`}>{b.lastTest.ok ? '✓' : '✗'} {b.lastTest.detail}</p>
                )}
                <div className="flex gap-3 mt-1.5">
                  <button onClick={() => testDocBackup(b.id)} className="text-[11px] font-bold text-teal-700">Test restore</button>
                  {full && <button onClick={() => { const n = restoreDocBackup(b.id); toast.show(n ? `Recovered ${n} document(s)` : 'Nothing missing — live data already complete') }} className="text-[11px] font-bold text-blue-600">Restore missing</button>}
                </div>
              </div>
            ))}
            <p className="text-[9px] text-gray-400 mt-2">Restore is non-destructive: it recovers records missing from live data and never overwrites newer changes.</p>
          </div>
        </>
      )}

      {view === 'policy' && (
        <>
          <div className={`rounded-2xl p-3.5 border ${passed === tests.length ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
            <p className={`text-xs font-bold ${passed === tests.length ? 'text-emerald-800' : 'text-red-700'}`}>
              {passed === tests.length ? `✓ All ${tests.length} access rules hold` : `${tests.length - passed} rule(s) failing`}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">Runs the live access policy against a synthetic cast of users and documents. No real records are read.</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
            {tests.map(t => (
              <div key={t.name} className="flex items-start gap-2 px-4 py-2.5">
                <span className={`text-xs font-black ${t.pass ? 'text-emerald-600' : 'text-red-600'}`}>{t.pass ? '✓' : '✗'}</span>
                <p className="text-[11px] text-gray-700 flex-1">{t.name}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-900 mb-2">Who sees what</p>
            {[
              ['Patient', 'Own released reports and own uploads. Never drafts.'],
              ['Treating doctor', 'All official documents for assigned patients, plus uploads the patient shares. Signs, releases, corrects.'],
              ['Admin', `Metadata only. Content via ${SUPPORT_ACCESS_MIN}-min support access with a reason; patient notified.`],
              ['Assistant', 'Metadata and recovery with Document Support permission. Never content, never clinical approval.'],
              ['Outside doctor', 'Only documents in a patient-issued link, until it expires or is revoked.'],
            ].map(([r, d]) => (
              <div key={r} className="py-1.5 border-b border-gray-50 last:border-0">
                <p className="text-[11px] font-bold text-gray-800">{r}</p>
                <p className="text-[10px] text-gray-500 leading-snug">{d}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
