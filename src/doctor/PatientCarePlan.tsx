import { useState } from 'react'
import { BottomSheet, SheetButton, Field, inputCls, Pill, EmptyState, useSave, SaveError, useToast } from '@/shared'
import { CARE_PLAN_STATUS } from '@/shared/lib/types'
import type { CarePlan, CarePlanItem, CarePlanItemStatus, CarePlanStatus, PatientUser } from '@/shared/lib/types'
import { CarePlanCard } from '@/shared/ui/CarePlanCard'
import { useDoctor } from './useDoctor'

type ItemRow = { id?: string; key: string; kind: 'goal' | 'intervention'; text: string; vitalId: string; targetDate: string }
type Form = { id?: string; title: string; summary: string; reviewDate: string; items: ItemRow[] }
let seq = 0
const rowKey = () => `row_${seq++}`
const blankRow = (kind: 'goal' | 'intervention'): ItemRow => ({ key: rowKey(), kind, text: '', vitalId: '', targetDate: '' })

const STEP: Record<Exclude<CarePlanStatus, 'draft'>, { title: string; button: string; done: string; note?: string; tone: 'primary' | 'danger' }> = {
  active:    { title: 'Start this care plan?', button: 'Start plan', done: 'Care plan started · patient told', tone: 'primary' },
  on_hold:   { title: 'Put the plan on hold?', button: 'Put on hold', done: 'Care plan on hold · patient told', note: 'Why it is paused (optional)', tone: 'primary' },
  completed: { title: 'Complete this care plan?', button: 'Complete plan', done: 'Care plan completed · patient told', note: 'Outcome (optional)', tone: 'primary' },
  cancelled: { title: 'Cancel this care plan?', button: 'Cancel plan', done: 'Care plan cancelled', note: 'Reason (optional)', tone: 'danger' },
}

/* ─── Care plans (doctor) ─────────────────────────────────────────────
   Goals and interventions for this patient. A draft is the doctor's own;
   once started the patient sees the plan on their Care Team screen. One
   plan is active at a time; a completed or cancelled plan is kept as it
   was, and a new one is started for what comes next. */
export function PatientCarePlan({ patient }: { patient: PatientUser }) {
  const { carePlansFor, vitalDefs, nameOf, saveCarePlan, setCarePlanStatus, setCarePlanItem, deleteCarePlanDraft } = useDoctor()
  const plans = carePlansFor(patient.id)
  const open = plans.filter(p => p.status !== 'completed' && p.status !== 'cancelled')
  const closed = plans.filter(p => p.status === 'completed' || p.status === 'cancelled')
  const toast = useToast()
  const tracked = vitalDefs.filter(v => patient.trackedVitalIds.includes(v.id))

  /* writing or editing a plan */
  const [form, setForm] = useState<Form | null>(null)
  const formSave = useSave()
  const openForm = (p?: CarePlan) => {
    formSave.clear()
    setForm(p
      ? { id: p.id, title: p.title, summary: p.summary ?? '', reviewDate: p.reviewDate ?? '',
          items: p.items.map(i => ({ id: i.id, key: i.id, kind: i.kind, text: i.text, vitalId: i.vitalId ?? '', targetDate: i.targetDate ?? '' })) }
      : { title: '', summary: '', reviewDate: '', items: [blankRow('goal'), blankRow('intervention')] })
  }
  const setRow = (key: string, patch: Partial<ItemRow>) => setForm(f => f && { ...f, items: f.items.map(i => i.key === key ? { ...i, ...patch } : i) })
  const filled = form?.items.filter(i => i.text.trim()) ?? []
  const formIssue = !form ? null : !form.title.trim() ? 'Give the plan a title.' : !filled.some(i => i.kind === 'goal') ? 'Add at least one goal.' : null
  const submit = async () => {
    if (!form || formIssue) return
    const saved = await formSave.run(() => saveCarePlan({
      id: form.id, patientId: patient.id, title: form.title, summary: form.summary, reviewDate: form.reviewDate || undefined,
      items: filled.map(i => ({ id: i.id, kind: i.kind, text: i.text, vitalId: i.vitalId || undefined, targetDate: i.targetDate || undefined })),
    }))
    if (!saved.ok) return
    toast.show(form.id ? 'Care plan saved' : 'Draft saved · start it when it is ready for the patient')
    setForm(null)
  }

  /* moving a plan to its next step */
  const [step, setStep] = useState<{ plan: CarePlan; to: Exclude<CarePlanStatus, 'draft'> } | null>(null)
  const [note, setNote] = useState('')
  const stepSave = useSave()
  const cfg = step ? STEP[step.to] : null
  const move = async () => {
    if (!step || !cfg) return
    if (!(await stepSave.run(() => setCarePlanStatus(step.plan.id, step.to, note))).ok) return
    toast.show(step.plan.status === 'on_hold' && step.to === 'active' ? 'Care plan resumed · patient told' : cfg.done)
    setStep(null)
  }
  const ask = (plan: CarePlan, to: Exclude<CarePlanStatus, 'draft'>) => { stepSave.clear(); setNote(''); setStep({ plan, to }) }

  /* progress on one goal or intervention */
  const [progress, setProgress] = useState<{ plan: CarePlan; item: CarePlanItem; status: CarePlanItemStatus } | null>(null)
  const [progressNote, setProgressNote] = useState('')
  const progressSave = useSave()
  const saveProgress = async () => {
    if (!progress) return
    if (!(await progressSave.run(() => setCarePlanItem(progress.plan.id, progress.item.id, progress.status, progressNote))).ok) return
    toast.show('Progress saved')
    setProgress(null)
  }

  const dropSave = useSave()
  const quiet = 'flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-600'

  return (
    <>
      {toast.node && <div className="span-all">{toast.node}</div>}
      <SaveError message={dropSave.error} className="span-all" />
      <button onClick={() => openForm()} className="w-full py-3 rounded-2xl bg-teal-700 text-white text-sm font-bold shadow span-all">+ New care plan</button>

      {plans.length === 0 && (
        <div className="span-all"><EmptyState icon="📋" title="No care plan yet" text="Set goals and what will be done to reach them. The patient sees the plan once you start it." /></div>
      )}

      {open.map(p => (
        <CarePlanCard key={p.id} plan={p} nameOf={id => nameOf(id, 'A previous doctor')} vitalName={id => vitalDefs.find(v => v.id === id)?.name}
          onItem={item => { progressSave.clear(); setProgressNote(item.progressNote ?? ''); setProgress({ plan: p, item, status: item.status }) }}>
          <div className="flex gap-2 mt-3">
            {p.status === 'draft' && <button onClick={() => ask(p, 'active')} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white">Start plan</button>}
            {p.status === 'on_hold' && <button onClick={() => ask(p, 'active')} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white">Resume</button>}
            {p.status === 'active' && <button onClick={() => ask(p, 'completed')} className="flex-1 rounded-xl bg-teal-700 py-2 text-xs font-bold text-white">Complete</button>}
            <button onClick={() => openForm(p)} className={quiet}>Edit</button>
            {p.status === 'active' && <button onClick={() => ask(p, 'on_hold')} className={quiet}>Hold</button>}
            {p.status === 'draft'
              ? <button disabled={dropSave.busy} onClick={async () => { if ((await dropSave.run(() => deleteCarePlanDraft(p.id))).ok) toast.show('Draft removed') }} className={`${quiet} text-red-600`}>Discard</button>
              : <button onClick={() => ask(p, 'cancelled')} className={`${quiet} text-red-600`}>Cancel</button>}
          </div>
        </CarePlanCard>
      ))}

      {closed.length > 0 && <p className="span-all text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1 -mb-2">Earlier plans · {closed.length}</p>}
      {closed.map(p => <CarePlanCard key={p.id} plan={p} nameOf={id => nameOf(id, 'A previous doctor')} vitalName={id => vitalDefs.find(v => v.id === id)?.name} />)}

      {/* write or edit */}
      <BottomSheet open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit care plan' : 'New care plan'}
        subtitle={form?.id ? 'Goals you keep keep the progress already recorded.' : `For ${patient.name}. Saved as a draft until you start it.`}
        footer={<><SheetButton tone="ghost" onClick={() => setForm(null)}>Cancel</SheetButton>
          <SheetButton disabled={!!formIssue || formSave.busy} onClick={submit}>{formSave.busy ? 'Saving…' : 'Save plan'}</SheetButton></>}>
        {form && (
          <>
            <Field label="Title *"><input value={form.title} maxLength={120} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Blood pressure control" className={inputCls} /></Field>
            <Field label="Summary"><textarea value={form.summary} rows={2} maxLength={2000} onChange={e => setForm({ ...form, summary: e.target.value })}
              placeholder="What this plan is for, in words the patient will read." className={`${inputCls} resize-none`} /></Field>
            {(['goal', 'intervention'] as const).map(kind => (
              <Field key={kind} label={kind === 'goal' ? 'Goals *' : 'What will be done'}>
                <div className="flex flex-col gap-2">
                  {form.items.filter(i => i.kind === kind).map(i => (
                    <div key={i.key} className="rounded-xl border border-gray-100 p-2">
                      <div className="flex gap-2">
                        <input value={i.text} maxLength={500} onChange={e => setRow(i.key, { text: e.target.value })} className={inputCls}
                          placeholder={kind === 'goal' ? 'e.g. Morning blood pressure under 135/85 on most days' : 'e.g. Walk 30 minutes, five days a week'} />
                        <button onClick={() => setForm({ ...form, items: form.items.filter(x => x.key !== i.key) })} aria-label="Remove" className="px-2 text-gray-400 text-sm">✕</button>
                      </div>
                      {kind === 'goal' && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <select value={i.vitalId} onChange={e => setRow(i.key, { vitalId: e.target.value })} className={inputCls} aria-label="Measured by">
                            <option value="">Not tied to a vital</option>
                            {tracked.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                          <input type="date" value={i.targetDate} onChange={e => setRow(i.key, { targetDate: e.target.value })} className={inputCls} aria-label="Target date" />
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setForm({ ...form, items: [...form.items, blankRow(kind)] })} className="self-start text-[11px] font-bold text-teal-700">+ Add {kind === 'goal' ? 'a goal' : 'an intervention'}</button>
                </div>
              </Field>
            ))}
            <Field label="Review on (optional)"><input type="date" value={form.reviewDate} onChange={e => setForm({ ...form, reviewDate: e.target.value })} className={inputCls} /></Field>
            {formIssue && <p className="text-xs text-red-500 mb-2">{formIssue}</p>}
            <SaveError message={formSave.error} />
          </>
        )}
      </BottomSheet>

      {/* next step */}
      <BottomSheet open={!!step} onClose={() => setStep(null)} title={step?.plan.status === 'on_hold' && step.to === 'active' ? 'Resume this care plan?' : cfg?.title}
        subtitle={step?.plan.title}
        footer={<><SheetButton tone="ghost" onClick={() => setStep(null)}>Back</SheetButton>
          <SheetButton tone={cfg?.tone} disabled={stepSave.busy} onClick={move}>{stepSave.busy ? 'Saving…' : step?.plan.status === 'on_hold' && step.to === 'active' ? 'Resume plan' : cfg?.button}</SheetButton></>}>
        {cfg?.note && (
          <Field label={cfg.note}><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} className={`${inputCls} resize-none`} /></Field>
        )}
        <p className="text-xs text-gray-600 leading-relaxed">
          {step?.to === 'active' ? `${patient.name} is told and can read the plan and its goals.`
            : step?.to === 'cancelled' && step.plan.status === 'draft' ? 'The draft was never shown to the patient.'
            : step?.to === 'on_hold' ? `${patient.name} is told. You can resume it later.`
            : `${patient.name} is told. A closed plan is kept as it is; start a new one for what comes next.`}
        </p>
        <SaveError message={stepSave.error} className="mt-3" />
      </BottomSheet>

      {/* progress */}
      <BottomSheet open={!!progress} onClose={() => setProgress(null)} title={progress?.item.kind === 'goal' ? 'Progress on this goal' : 'Progress on this intervention'}
        subtitle={progress?.item.text}
        footer={<><SheetButton tone="ghost" onClick={() => setProgress(null)}>Cancel</SheetButton>
          <SheetButton disabled={progressSave.busy} onClick={saveProgress}>{progressSave.busy ? 'Saving…' : 'Save progress'}</SheetButton></>}>
        {progress && (
          <>
            <Field label="Where it stands">
              <div className="grid grid-cols-3 gap-2">
                {([['open', 'In progress'], ['achieved', progress.item.kind === 'goal' ? 'Reached' : 'Done'], ['dropped', 'Dropped']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setProgress({ ...progress, status: id })}
                    className={`py-2 rounded-xl text-xs font-semibold border-2 ${progress.status === id ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>{label}</button>
                ))}
              </div>
            </Field>
            <Field label="Note on progress"><textarea value={progressNote} onChange={e => setProgressNote(e.target.value)} rows={2} maxLength={1000} className={`${inputCls} resize-none`}
              placeholder="e.g. Six of the last seven mornings in range." /></Field>
            <SaveError message={progressSave.error} />
          </>
        )}
      </BottomSheet>
      {closed.length === 0 && open.length > 0 && <p className="span-all text-[10px] text-gray-400 px-1"><Pill color={CARE_PLAN_STATUS.active.color}>Active</Pill> plans are visible to the patient. Drafts are not.</p>}
    </>
  )
}
