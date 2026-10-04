import { useEffect, useState } from 'react'
import { BackHeader, BottomSheet, Field, Pill, SaveError, SheetButton, Toggle, inputCls, useAct, useSave } from '@/shared'
import type { ConditionDef, RetentionSettings, SecuritySettings, UserRole } from '@/shared/lib/types'
import { useAdmin } from './useAdmin'

const ROLES: { id: UserRole; label: string }[] = [
  { id: 'admin', label: 'Admins' }, { id: 'assistant', label: 'Assistants' }, { id: 'doctor', label: 'Doctors' }, { id: 'patient', label: 'Patients' },
]
const RETENTION: { key: keyof RetentionSettings; label: string; hint: string }[] = [
  { key: 'auditDays', label: 'Audit entries', hint: 'At least 180 days' },
  { key: 'deletedDocumentDays', label: 'Deleted documents', hint: 'The patient can restore them until then' },
  { key: 'readNotificationDays', label: 'Read notifications', hint: 'At least 7 days' },
  { key: 'deliveryDays', label: 'Sent email and text records', hint: 'At least 7 days' },
]
const EMPTY_CONDITION: ConditionDef = { code: '', name: '', icon: '🩺', active: true, vitals: [] }

/* ─── Settings (full admins) ──────────────────────────────────────────
   What an administrator decides for the whole service. The database checks every value
   again and audits each change with before and after (save_settings). */
export default function SettingsTab({ onBack }: { onBack: () => void }) {
  const { admin, settings, saveSecuritySettings, saveRetentionSettings, runRetentionNow, conditionDefs, saveConditionDef, vitalDefs } = useAdmin()
  const [security, setSecurity] = useState<SecuritySettings>(settings.security)
  const [retention, setRetention] = useState<Record<keyof RetentionSettings, string>>(() => toText(settings.retention))
  const [condition, setCondition] = useState<ConditionDef | null>(null)
  const savingSecurity = useSave(), savingRetention = useSave(), savingCondition = useSave()
  const act = useAct()

  // A change saved elsewhere (another admin, another tab) shows here once it arrives, unless this form is being edited.
  useEffect(() => { if (!savingSecurity.busy) setSecurity(settings.security) }, [settings.security]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!savingRetention.busy) setRetention(toText(settings.retention)) }, [settings.retention]) // eslint-disable-line react-hooks/exhaustive-deps

  const required = (r: UserRole) => security.mfaRequiredRoles.includes(r)
  const toggleRequired = (r: UserRole) => setSecurity(s => ({ ...s, mfaRequiredRoles: required(r) ? s.mfaRequiredRoles.filter(x => x !== r) : [...s.mfaRequiredRoles, r] }))
  const saveSecurity = async () => { if ((await savingSecurity.run(() => saveSecuritySettings(security))).ok) act.say('Security settings saved') }
  const saveRetention = async () => {
    const value = Object.fromEntries(RETENTION.map(f => [f.key, retention[f.key].trim() === '' ? null : Number(retention[f.key])])) as unknown as RetentionSettings
    if (Object.values(value).some(v => v !== null && !Number.isFinite(v))) { savingRetention.clear(); return }
    if ((await savingRetention.run(() => saveRetentionSettings(value))).ok) act.say('Retention settings saved')
  }
  const saveCondition = async () => {
    if (!condition) return
    if ((await savingCondition.run(() => saveConditionDef(condition))).ok) { act.say(`${condition.name.trim()} saved`); setCondition(null) }
  }
  const vitalName = (id: string) => vitalDefs.find(v => v.id === id)?.name ?? id

  return (
    <div className="flex flex-col gap-3 card-flow">
      <BackHeader title="Settings" subtitle="Security and data retention, for everyone" onBack={onBack} />
      {act.node && <div className="span-all">{act.node}</div>}

      {/* Two-step sign-in and idle sign-out */}
      <section className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3" aria-label="Security">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Two-step sign-in</h2>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Everyone can turn it on for their own account from their profile. Require it for a role and that role cannot open mCare without the code from an authenticator app.
          </p>
        </div>
        {ROLES.map(r => (
          <div key={r.id} className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700">Require for {r.label.toLowerCase()}</span>
            <Toggle on={required(r.id)} onChange={() => toggleRequired(r.id)} label={`Require two-step sign-in for ${r.label.toLowerCase()}`} disabled={savingSecurity.busy} />
          </div>
        ))}
        {required(admin.role) && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">Turn on two-step sign-in for your own account first, or the save is refused.</p>}

        <div className="border-t border-gray-100 pt-3">
          <h3 className="text-xs font-bold text-gray-700">Sign out after minutes without use</h3>
          <p className="text-[11px] text-gray-400 mb-2">0 means never. A warning comes a minute before.</p>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(r => (
              <Field key={r.id} label={r.label}>
                <input type="number" inputMode="numeric" min={0} max={720} className={inputCls} aria-label={`Idle minutes for ${r.label.toLowerCase()}`}
                  value={security.idleMinutes[r.id]} onChange={e => setSecurity(s => ({ ...s, idleMinutes: { ...s.idleMinutes, [r.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) } }))} />
              </Field>
            ))}
          </div>
        </div>
        <SaveError message={savingSecurity.error} />
        <button onClick={saveSecurity} disabled={savingSecurity.busy}
          className="self-start text-xs font-bold text-white bg-teal-700 px-4 py-2 rounded-full disabled:opacity-50">{savingSecurity.busy ? 'Saving…' : 'Save security settings'}</button>
      </section>

      {/* Retention */}
      <section className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3" aria-label="Data retention">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Data retention</h2>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            How many days to keep each. Leave a box empty to keep it for ever. Check the periods against the health-records and data-protection law where mCare is used. Readings, prescriptions, notes and other clinical records are never removed by retention.
          </p>
        </div>
        {RETENTION.map(f => (
          <Field key={f.key} label={`${f.label} (days)`}>
            <input type="number" inputMode="numeric" min={1} className={inputCls} placeholder="Keep for ever" aria-label={`${f.label} days`}
              value={retention[f.key]} onChange={e => setRetention(r => ({ ...r, [f.key]: e.target.value }))} />
            <span className="text-[10px] text-gray-400">{f.hint}</span>
          </Field>
        ))}
        <SaveError message={savingRetention.error} />
        <div className="flex gap-2 flex-wrap">
          <button onClick={saveRetention} disabled={savingRetention.busy}
            className="text-xs font-bold text-white bg-teal-700 px-4 py-2 rounded-full disabled:opacity-50">{savingRetention.busy ? 'Saving…' : 'Save retention'}</button>
          <button disabled={act.busy} onClick={() => act.run(runRetentionNow, r =>
            `Removed ${r.documents} document${r.documents === 1 ? '' : 's'}, ${r.audit} audit entr${r.audit === 1 ? 'y' : 'ies'}, ${r.notifications} notification${r.notifications === 1 ? '' : 's'}, ${r.deliveries} message record${r.deliveries === 1 ? '' : 's'}`)}
            className="text-xs font-semibold text-teal-700 border border-teal-200 px-4 py-2 rounded-full disabled:opacity-50">Apply now</button>
        </div>
      </section>

      {/* Conditions catalogue */}
      <section className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2 span-all" aria-label="Conditions">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Conditions</h2>
            <p className="text-xs text-gray-500 mt-0.5">What patients choose from at setup, and the vitals each suggests tracking.</p>
          </div>
          <button onClick={() => { savingCondition.clear(); setCondition(EMPTY_CONDITION) }}
            className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full flex-shrink-0">+ Add</button>
        </div>
        <ul className="divide-y divide-gray-100">
          {conditionDefs.map(c => (
            <li key={c.code} className="py-2 flex items-center gap-3">
              <span className="text-xl w-7 text-center">{c.icon}</span>
              <button className="flex-1 min-w-0 text-left" onClick={() => { savingCondition.clear(); setCondition(c) }}>
                <span className="text-sm font-semibold text-gray-800">{c.name}</span>
                {c.icd10 && <span className="ml-1.5 text-[10px] font-mono text-gray-400">{c.icd10}</span>}
                <span className="block text-[11px] text-gray-400 truncate">{c.vitals.length ? c.vitals.map(vitalName).join(' · ') : 'No vitals suggested'}</span>
              </button>
              {!c.active && <Pill color="gray">Off</Pill>}
              <Toggle on={c.active} disabled={act.busy} label={`Offer ${c.name}`}
                onChange={() => act.run(() => saveConditionDef({ ...c, active: !c.active }), `${c.name} ${c.active ? 'switched off' : 'switched on'}`)} />
            </li>
          ))}
        </ul>
      </section>

      <BottomSheet open={!!condition} onClose={() => setCondition(null)} title={condition?.code ? 'Edit condition' : 'Add a condition'}
        footer={<SheetButton disabled={savingCondition.busy || !condition?.name.trim()} onClick={saveCondition}>{savingCondition.busy ? 'Saving…' : 'Save'}</SheetButton>}>
        {condition && (
          <div className="flex flex-col gap-3">
            <Field label="Name"><input className={inputCls} value={condition.name} onChange={e => setCondition({ ...condition, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Icon"><input className={inputCls} value={condition.icon} maxLength={4} onChange={e => setCondition({ ...condition, icon: e.target.value })} /></Field>
              <Field label="ICD-10 code"><input className={`${inputCls} font-mono`} placeholder="e.g. I10" value={condition.icd10 ?? ''} onChange={e => setCondition({ ...condition, icd10: e.target.value || undefined })} /></Field>
            </div>
            <Field label="Vitals to suggest">
              <div className="flex flex-wrap gap-1.5">
                {vitalDefs.filter(v => v.active).map(v => {
                  const on = condition.vitals.includes(v.id)
                  return (
                    <button key={v.id} aria-pressed={on} onClick={() => setCondition({ ...condition, vitals: on ? condition.vitals.filter(x => x !== v.id) : [...condition.vitals, v.id] })}
                      className={`text-xs px-3 py-1.5 rounded-full border ${on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600 border-gray-200'}`}>{v.icon} {v.name}</button>
                  )
                })}
              </div>
            </Field>
            <SaveError message={savingCondition.error} />
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

const toText = (r: RetentionSettings): Record<keyof RetentionSettings, string> =>
  Object.fromEntries(RETENTION.map(f => [f.key, r[f.key] === null ? '' : String(r[f.key])])) as Record<keyof RetentionSettings, string>
