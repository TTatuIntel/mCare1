import { useEffect, useState } from 'react'
import { BackHeader, BottomSheet, Field, Pill, SaveError, SheetButton, Toggle, inputCls, useAct, useSave } from '@/shared'
import { FREQUENCY_LABELS } from '@/shared/lib/types'
import type { ConditionDef, PathwayVital, RetentionSettings, SecuritySettings, UserRole, VitalFrequency } from '@/shared/lib/types'
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
const EMPTY_CONDITION: ConditionDef = { code: '', name: '', icon: '🩺', active: true, vitals: [], vitalPlans: {}, goals: [] }
const FREQS = Object.keys(FREQUENCY_LABELS) as VitalFrequency[]
const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s))

/* ─── Settings (full admins) ──────────────────────────────────────────
   What an administrator decides for the whole service. The database checks every value
   again and audits each change with before and after (save_settings). */
export default function SettingsTab({ onBack }: { onBack: () => void }) {
  const { admin, settings, saveSecuritySettings, saveRetentionSettings, runRetentionNow, conditionDefs, saveConditionDef, vitalDefs, medicationDefs, setMedicationActive } = useAdmin()
  const [security, setSecurity] = useState<SecuritySettings>(settings.security)
  const [retention, setRetention] = useState<Record<keyof RetentionSettings, string>>(() => toText(settings.retention))
  const [condition, setCondition] = useState<ConditionDef | null>(null)
  const [markReviewed, setMarkReviewed] = useState(false)
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
    if ((await savingCondition.run(() => saveConditionDef(condition, markReviewed))).ok) { act.say(`${condition.name.trim()} saved${markReviewed ? ' and marked reviewed' : ''}`); setCondition(null) }
  }
  const vitalName = (id: string) => vitalDefs.find(v => v.id === id)?.name ?? id
  const openCondition = (c: ConditionDef) => { savingCondition.clear(); setMarkReviewed(false); setCondition({ ...c, vitalPlans: { ...(c.vitalPlans ?? {}) }, goals: [...(c.goals ?? [])] }) }
  const setPlan = (id: string, patch: Partial<PathwayVital>) => setCondition(c => c && { ...c, vitalPlans: { ...(c.vitalPlans ?? {}), [id]: { ...(c.vitalPlans?.[id] ?? {}), ...patch } } })
  // A target needs both ends, low below high, within what the vital can plausibly be (the database checks it again).
  const pathwayIssue = (() => {
    if (!condition) return null
    for (const id of condition.vitals) {
      const p = condition.vitalPlans?.[id], d = vitalDefs.find(v => v.id === id)
      if (!p || (p.targetMin === undefined && p.targetMax === undefined)) continue
      if (p.targetMin === undefined || p.targetMax === undefined || !(p.targetMin < p.targetMax)) return `Give ${vitalName(id)} a low target below the high one, or neither.`
      if (d && (p.targetMin < d.hardMin || p.targetMax > d.hardMax)) return `The target for ${d.name} must be within ${d.hardMin} to ${d.hardMax} ${d.unit}.`
    }
    const f = condition.fluidLimitGlasses
    if (f !== undefined && (!Number.isInteger(f) || f < 1 || f > 30)) return 'A fluid limit must be between 1 and 30 glasses.'
    return null
  })()

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

      {/* Medicine catalogue: offered when prescribing (free text still works for anything else) */}
      <section className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2 span-all" aria-label="Medicines">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Medicines</h2>
          <p className="text-xs text-gray-500 mt-0.5">The catalogue doctors prescribe from: each medicine's class, usual doses, the vitals to watch (prescribing it starts tracking them) and the usual "check before taking" rule. Switch one off to stop offering it; prescriptions already made keep it.</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {medicationDefs.map(m => (
            <li key={m.code} className="py-2 flex items-center gap-3">
              <span className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-800">{m.name}</span>
                <span className="ml-1.5 text-[11px] text-gray-400">{m.drugClass}</span>
                <span className="block text-[11px] text-gray-400 truncate">
                  {[m.usualDoses.join(', '), m.monitorVitals.length ? `watch ${m.monitorVitals.map(vitalName).join(', ')}` : '', m.holdIf ? `hold ${m.holdIf.below !== undefined ? `below ${m.holdIf.below}` : ''}${m.holdIf.above !== undefined ? ` above ${m.holdIf.above}` : ''} (${vitalName(m.holdIf.vitalId)})` : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              {!m.active && <Pill color="gray">Off</Pill>}
              <Toggle on={m.active} disabled={act.busy} label={`Offer ${m.name}`}
                onChange={() => act.run(() => setMedicationActive(m.code, !m.active), `${m.name} ${m.active ? 'switched off' : 'switched on'}`)} />
            </li>
          ))}
        </ul>
      </section>

      {/* Conditions catalogue */}
      <section className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2 span-all" aria-label="Conditions">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Conditions</h2>
            <p className="text-xs text-gray-500 mt-0.5">What patients choose from at setup, and each condition's care pathway: the starting plan a treating doctor reviews and applies (how often to measure, targets, fluid limit, diet, goals).</p>
          </div>
          <button onClick={() => openCondition(EMPTY_CONDITION)}
            className="text-xs font-semibold text-teal-700 border border-teal-200 px-3 py-1.5 rounded-full flex-shrink-0">+ Add</button>
        </div>
        <ul className="divide-y divide-gray-100">
          {conditionDefs.map(c => (
            <li key={c.code} className="py-2 flex items-center gap-3">
              <span className="text-xl w-7 text-center">{c.icon}</span>
              <button className="flex-1 min-w-0 text-left" onClick={() => openCondition(c)}>
                <span className="text-sm font-semibold text-gray-800">{c.name}</span>
                {c.icd10 && <span className="ml-1.5 text-[10px] font-mono text-gray-400">{c.icd10}</span>}
                <span className="block text-[11px] text-gray-400 truncate">{c.vitals.length ? c.vitals.map(vitalName).join(' · ') : 'No vitals suggested'}</span>
              </button>
              {c.active && (c.reviewedAt ? <Pill color="green">Reviewed</Pill> : <Pill color="amber">Not reviewed</Pill>)}
              {!c.active && <Pill color="gray">Off</Pill>}
              <Toggle on={c.active} disabled={act.busy} label={`Offer ${c.name}`}
                onChange={() => act.run(() => saveConditionDef({ ...c, active: !c.active }), `${c.name} ${c.active ? 'switched off' : 'switched on'}`)} />
            </li>
          ))}
        </ul>
      </section>

      <BottomSheet open={!!condition} onClose={() => setCondition(null)} title={condition?.code ? 'Edit condition' : 'Add a condition'}
        footer={<SheetButton disabled={savingCondition.busy || !condition?.name.trim() || !!pathwayIssue} onClick={saveCondition}>{savingCondition.busy ? 'Saving…' : 'Save'}</SheetButton>}>
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
            {condition.vitals.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Care pathway: starting plan per vital</p>
                {condition.vitals.map(id => {
                  const p = condition.vitalPlans?.[id] ?? {}, d = vitalDefs.find(v => v.id === id)
                  return (
                    <div key={id} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 items-center">
                      <select value={p.frequency ?? ''} onChange={e => setPlan(id, { frequency: (e.target.value || undefined) as VitalFrequency | undefined })}
                        className={inputCls} aria-label={`How often to measure ${vitalName(id)}`}>
                        <option value="">{vitalName(id)}: usual schedule</option>
                        {FREQS.map(f => <option key={f} value={f}>{vitalName(id)}: {FREQUENCY_LABELS[f].toLowerCase()}</option>)}
                      </select>
                      <input value={p.targetMin ?? ''} inputMode="decimal" placeholder="Low" aria-label={`${vitalName(id)} target low (${d?.unit ?? ''})`}
                        onChange={e => setPlan(id, { targetMin: numOrUndef(e.target.value) })} className={inputCls} />
                      <input value={p.targetMax ?? ''} inputMode="decimal" placeholder={`High ${d?.unit ?? ''}`} aria-label={`${vitalName(id)} target high (${d?.unit ?? ''})`}
                        onChange={e => setPlan(id, { targetMax: numOrUndef(e.target.value) })} className={inputCls} />
                    </div>
                  )
                })}
              </div>
            )}
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <Field label="Fluid limit (glasses)">
                <input className={inputCls} inputMode="numeric" placeholder="None" value={condition.fluidLimitGlasses ?? ''}
                  onChange={e => setCondition({ ...condition, fluidLimitGlasses: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Diet note">
                <input className={inputCls} maxLength={500} placeholder="e.g. Low salt (under 5 g a day)" value={condition.dietNote ?? ''}
                  onChange={e => setCondition({ ...condition, dietNote: e.target.value || undefined })} />
              </Field>
            </div>
            <Field label="Care-plan goals">
              <div className="flex flex-col gap-1.5">
                {(condition.goals ?? []).map((g, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={inputCls} maxLength={300} value={g.text} aria-label={`Goal ${i + 1}`}
                      onChange={e => setCondition({ ...condition, goals: (condition.goals ?? []).map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} />
                    <button onClick={() => setCondition({ ...condition, goals: (condition.goals ?? []).filter((_, j) => j !== i) })}
                      aria-label={`Remove goal ${i + 1}`} className="text-xs text-red-500 font-bold px-2">✕</button>
                  </div>
                ))}
                {(condition.goals ?? []).length < 6 && (
                  <button onClick={() => setCondition({ ...condition, goals: [...(condition.goals ?? []), { text: '' }] })} className="text-xs font-bold text-teal-700 text-left">+ Add a goal</button>
                )}
              </div>
            </Field>
            <label className="flex items-start gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <input type="checkbox" checked={markReviewed} onChange={e => setMarkReviewed(e.target.checked)} className="mt-0.5 accent-teal-700" />
              <span className="text-xs text-gray-700">
                Mark this pathway clinically reviewed
                <span className="block text-[10px] text-gray-400">{condition.reviewedAt ? `Last reviewed ${condition.reviewedAt}. ` : 'Not reviewed yet. '}Doctors are told when values have not been reviewed; any later change clears the review.</span>
              </span>
            </label>
            {pathwayIssue && <p className="text-xs text-red-500">{pathwayIssue}</p>}
            <SaveError message={savingCondition.error} />
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

const toText = (r: RetentionSettings): Record<keyof RetentionSettings, string> =>
  Object.fromEntries(RETENTION.map(f => [f.key, r[f.key] === null ? '' : String(r[f.key])])) as Record<keyof RetentionSettings, string>
