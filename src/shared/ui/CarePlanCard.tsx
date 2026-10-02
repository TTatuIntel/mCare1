import { CARE_PLAN_STATUS } from '@/shared/lib/types'
import type { CarePlan, CarePlanItem } from '@/shared/lib/types'
import { Pill } from './primitives'

const EVENT_LABEL: Record<string, string> = {
  created: 'Drafted', edited: 'Edited', active: 'Started', on_hold: 'Put on hold', completed: 'Completed', cancelled: 'Cancelled',
  item_achieved: 'Reached', item_dropped: 'Dropped', item_reopened: 'Reopened',
}
const day = (iso?: string) => (iso ? new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const MARK = { open: '○', achieved: '✓', dropped: '✕' } as const

/* ─── One care plan ───────────────────────────────────────────────────
   The same card for the doctor who writes it and the patient who follows
   it: what it is for, its goals and what will be done, where each stands,
   and everything that has happened to it. The doctor's portal passes the
   buttons as children and `onItem` to record progress. */
export function CarePlanCard({ plan, nameOf, vitalName, onItem, children }: {
  plan: CarePlan
  nameOf: (id?: string) => string
  vitalName?: (id?: string) => string | undefined
  /** Makes each goal and intervention a button (the doctor records progress on it). */
  onItem?: (item: CarePlanItem) => void
  children?: React.ReactNode
}) {
  const st = CARE_PLAN_STATUS[plan.status]
  const goals = plan.items.filter(i => i.kind === 'goal')
  const reached = goals.filter(i => i.status === 'achieved').length
  const list = (kind: 'goal' | 'intervention', title: string) => {
    const items = plan.items.filter(i => i.kind === kind)
    if (!items.length) return null
    return (
      <div className="mt-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
        {items.map(i => {
          const body = (
            <>
              <span className={`w-5 flex-shrink-0 text-center font-black ${i.status === 'achieved' ? 'text-emerald-600' : i.status === 'dropped' ? 'text-gray-300' : 'text-gray-400'}`} aria-hidden="true">{MARK[i.status]}</span>
              <span className="flex-1 min-w-0">
                <span className={`block text-xs text-gray-800 ${i.status === 'dropped' ? 'line-through text-gray-400' : ''}`}>{i.text}</span>
                {(i.vitalId || i.targetDate) && (
                  <span className="block text-[10px] text-gray-400">{[vitalName?.(i.vitalId) && `Measured by ${vitalName?.(i.vitalId)}`, i.targetDate && `by ${day(i.targetDate)}`].filter(Boolean).join(' · ')}</span>
                )}
                {i.progressNote && <span className="block text-[10px] text-teal-700">{i.progressNote}</span>}
              </span>
            </>
          )
          return onItem
            ? <button key={i.id} onClick={() => onItem(i)} className="w-full flex items-start gap-1.5 py-1.5 text-left border-b border-gray-50 last:border-0">{body}<span className="text-[10px] font-bold text-teal-700 flex-shrink-0">Update</span></button>
            : <div key={i.id} className="flex items-start gap-1.5 py-1.5 border-b border-gray-50 last:border-0">{body}</div>
        })}
      </div>
    )
  }
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{plan.title}</p>
          <p className="text-[10px] text-gray-400">
            {nameOf(plan.doctorId)} · {plan.startDate ? `started ${day(plan.startDate)}` : `drafted ${plan.createdAt}`}
            {plan.reviewDate && plan.status !== 'completed' && plan.status !== 'cancelled' ? ` · review ${day(plan.reviewDate)}` : ''}
          </p>
        </div>
        <Pill color={st.color}>{st.label}</Pill>
      </div>
      {plan.summary && <p className="text-xs text-gray-600 leading-relaxed mt-2 whitespace-pre-wrap">{plan.summary}</p>}
      {goals.length > 0 && (
        <div className="mt-3">
          <div className="bg-gray-100 rounded-full h-1.5"><div className="bg-teal-600 rounded-full h-1.5 transition-all" style={{ width: `${(reached / goals.length) * 100}%` }} /></div>
          <p className="text-[10px] text-gray-400 mt-1"><span className="font-mono">{reached}/{goals.length}</span> goal{goals.length === 1 ? '' : 's'} reached</p>
        </div>
      )}
      {list('goal', 'Goals')}
      {list('intervention', 'What will be done')}
      {plan.closeNote && <p className="text-[11px] text-gray-600 mt-3"><span className="font-semibold">{plan.status === 'on_hold' ? 'On hold: ' : plan.status === 'cancelled' ? 'Cancelled: ' : 'Outcome: '}</span>{plan.closeNote}</p>}
      {plan.history.length > 0 && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer select-none text-gray-400">History ({plan.history.length})</summary>
          <ol className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-gray-100 pl-3">
            {plan.history.map(e => (
              <li key={e.id}>
                <p className="font-semibold text-gray-700">{EVENT_LABEL[e.action] ?? e.action}<span className="font-normal text-gray-400"> · {nameOf(e.actorId)} · {e.createdAt}</span></p>
                {e.detail && <p className="text-gray-500">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {children}
    </div>
  )
}
