import { useState } from 'react'
import { useApp, isActiveAlert } from '@/shared/state/AppContext'
import {
  Pill, SectionHead, PATIENT_QUICK_REPLIES, useToast,
  PortalHeader, HeroCard, QuickGrid, NoticeCard, HERO_GRADIENT, levelStyle,
} from '@/shared'
import { usePatient } from './usePatient'
import { AlertSummaryCard } from './alertKit'
import type { PatientUser } from '@/shared/lib/types'
import { evaluate, latestValid, healthScore, unitView, ago } from '@/shared/lib/vitals'
import { countdown, toneOf, TONE_PILL, type ScheduleItem } from '@/shared/lib/schedule'
import { VitalsStrip } from './VitalsStrip'
import { useDaySchedule } from './useDaySchedule'
import { ReminderSheet } from './ReminderSheet'

/* ─── "Up next" ticker in the hero card ───────────────────────────────
   Cycles through next medicine / meal / vitals check. The active dot's
   fill is a CSS animation; when it ends the ticker advances, so hover
   (which pauses the animation) also pauses the rotation. */
type UpNextItem = { key: string; icon: string; label: string; value: string; sub: string; inMin: number | null; tab: string; item?: ScheduleItem }
const ROTATE_MS = 4500

const upNextTone = (m: number | null) => toneOf(m)

function UpNext({ items, go, onOpen }: { items: UpNextItem[]; go: (t: string) => void; onOpen: (i: ScheduleItem) => void }) {
  // Open on whatever needs attention first: late, then soonest.
  const [idx, setIdx] = useState(() => {
    let best = 0
    items.forEach((it, j) => { const b = items[best].inMin; if (it.inMin !== null && (b === null || it.inMin < b)) best = j })
    return best
  })
  const [paused, setPaused] = useState(false)
  const cur = items[idx % items.length]
  const tone = upNextTone(cur.inMin)

  return (
    <div className="text-right min-w-0 max-w-[52%]"
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <button onClick={() => (cur.item ? onOpen(cur.item) : go(cur.tab))} className="block w-full text-right" aria-live="polite">
        <div key={cur.key} className="upnext-in">
          <p className="text-[10px] text-teal-300 uppercase tracking-wider truncate">{cur.icon} {cur.label}</p>
          <p className={`font-black text-lg leading-tight mt-0.5 ${tone === 'late' ? 'text-red-300' : tone === 'soon' ? 'text-amber-200' : 'text-white'}`}>{cur.value}</p>
          <p className="text-teal-300 text-[10px] truncate">{cur.sub}</p>
        </div>
      </button>
      <div className="flex justify-end items-center gap-1 mt-2">
        {items.map((it, j) => {
          const t = upNextTone(it.inMin)
          const active = j === idx % items.length
          return (
            <button key={it.key} onClick={() => setIdx(j)} aria-label={`Show ${it.label}`} aria-current={active}
              className={`relative h-1 rounded-full overflow-hidden transition-all duration-300 ${active ? 'w-5 bg-white/25' : `w-1.5 ${t === 'late' ? 'bg-red-300' : t === 'soon' ? 'bg-amber-200' : 'bg-white/35'}`}`}>
              {active && (
                <span className="upnext-progress absolute inset-y-0 left-0 bg-white rounded-full"
                  style={{ animationDuration: `${ROTATE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                  onAnimationEnd={() => setIdx(k => (k + 1) % items.length)} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Home ──────────────────────────────────────────────────────────── */
export function HomeTab({ go, openVital, onLog }: {
  go: (t: string) => void
  openVital: (vitalId: string) => void
  /** Opens the log sheet for one vital. */
  onLog: (vitalId: string) => void
}) {
  const { currentUser, vitalDefs, alerts, now, unseenDocs } = useApp()
  const patient = currentUser as PatientUser
  const { resumeSetup } = usePatient()
  const [openItem, setOpenItem] = useState<ScheduleItem | null>(null)
  const toast = useToast()
  const score = healthScore(patient, vitalDefs)
  const myAlerts = alerts.filter(a => a.patientId === patient.id && isActiveAlert(a))
  const heroIds = ['bp', 'hr', 'temp', 'spo2', 'gluc', 'wt'].filter(id => patient.trackedVitalIds.includes(id)).slice(0, 4)

  // ── reminders: shared with the Meds / Meals / Vitals tabs ──
  const day = useDaySchedule()
  const { nextMed, nextMeal, nextAppt, vitals } = day
  const reminders = day.due
  const lastReadingAt = vitals.lastAt
  const hasMeds = patient.prescriptions.some(rx => rx.active)
  // The vitals form can be opened early, before the check is formally due
  const vitalsOpenItem: ScheduleItem | undefined = patient.trackedVitalIds.length ? vitals.item ?? {
    key: 'vitals', kind: 'vitals', refId: 'vitals', slot: 0, icon: '🩺', title: 'Log your vitals',
    sub: 'Next check', inMin: vitals.dueIn, done: false, tone: toneOf(vitals.dueIn),
  } : undefined


  return (
    <div className="flex flex-col gap-4 card-flow">
      <PortalHeader onNavigate={go} onProfile={() => go('profile')} />

      {/* the health-profile setup was skipped: one tap goes back to it */}
      {patient.profileSetup === 'skipped' && (
        <NoticeCard tone="teal" pulse={false} title="Finish your health profile" action="Set up →" onAction={resumeSetup}>
          <p className="text-[11px] text-teal-800">It takes about 2 minutes and helps your care team look after you.</p>
        </NoticeCard>
      )}

      {/* active alerts for me */}
      <AlertSummaryCard alerts={myAlerts} onOpenAll={() => go('alerts')} onLog={onLog} />

      {/* health hero card — the vitals trend popover floats over it */}
      <HeroCard
        eyebrow="Health Score"
        value={score ?? '—'}
        suffix="/100"
        caption={(() => {
          if (score === null) return 'Log your vitals to see your score'
          const off = patient.trackedVitalIds.filter(id => { const d = vitalDefs.find(v => v.id === id); const r = latestValid(patient, id); return d && r && evaluate(patient, d, r.value) !== 'normal' }).length
          return off === 0 ? 'All readings on target' : `${off} reading${off > 1 ? 's' : ''} need${off > 1 ? '' : 's'} attention`
        })()}
        progress={score ?? 0}
        aside={
            <UpNext go={go} onOpen={setOpenItem} items={[
              {
                key: 'med', icon: '💊', label: 'Next medicine', tab: 'medicine', item: nextMed,
                inMin: nextMed?.inMin ?? null,
                value: nextMed ? countdown(nextMed.inMin) : hasMeds ? 'All taken' : 'No meds',
                sub: `${nextMed ? `${nextMed.title} · ` : ''}${day.doses.taken}/${day.doses.total} doses`,
              },
              {
                key: 'meal', icon: '🍽️', label: 'Next meal', tab: 'meals', item: nextMeal,
                inMin: nextMeal?.inMin ?? null,
                value: nextMeal ? countdown(nextMeal.inMin) : 'All logged',
                sub: `${nextMeal ? `${nextMeal.title} · ` : ''}${day.meals.logged}/${day.meals.total} logged`,
              },
              {
                key: 'vitals', icon: '🩺', label: 'Vitals check', tab: 'vitals', item: vitalsOpenItem,
                inMin: vitals.item?.inMin ?? vitals.dueIn,
                value: countdown(vitals.item?.inMin ?? vitals.dueIn),
                sub: lastReadingAt ? `Last logged ${ago(lastReadingAt, now)}` : 'No readings yet',
              },
              ...(nextAppt ? [{
                key: 'appt', icon: '📅', label: 'Next visit', tab: 'appts', item: nextAppt,
                inMin: nextAppt.inMin, value: countdown(nextAppt.inMin), sub: nextAppt.title,
              }] : []),
            ]} />
        }>
        {heroIds.length > 0 && (
          <VitalsStrip patient={patient} defs={vitalDefs} ids={heroIds} now={now} onOpen={openVital} />
        )}
      </HeroCard>

      <QuickGrid items={[
        { icon: '⚠️', label: 'Alerts', onClick: () => go('alerts'), badge: myAlerts.length },
        { icon: '🩺', label: 'Care Team', onClick: () => go('care') },
        { icon: '📄', label: 'Records', onClick: () => go('docs'), badge: unseenDocs(patient.id) },
        { icon: '🍽️', label: 'Meals', onClick: () => go('meals') },
      ]} />

      {/* doctor's latest note */}
      {patient.doctorNote && (
        <div className="rounded-2xl p-4 text-white" style={{ background: HERO_GRADIENT }}>
          <p className="text-[10px] text-white/60 uppercase tracking-wider font-bold mb-1">📋 Latest note from your doctor</p>
          <p className="text-xs text-white/90 leading-relaxed italic">"{patient.doctorNote}"</p>
        </div>
      )}

      {/* today's reminders: meds, meals, vitals and visits in time order */}
      <div>
        {toast.node && <div className="mb-2">{toast.node}</div>}
        <SectionHead title={`Today's reminders · ${day.doses.taken + day.meals.logged}/${day.doses.total + day.meals.total} done`} action="Meds →" onAction={() => go('medicine')} />
        <div className="flex flex-col gap-2 mt-2">
          {reminders.length === 0 ? (
            <div className="bg-emerald-50 rounded-xl px-3.5 py-3 flex items-center gap-2">
              <span className="text-base">✅</span>
              <p className="text-xs text-emerald-700 font-medium">You're all caught up for today. Nice work!</p>
            </div>
          ) : reminders.slice(0, 5).map(r => (
            <div key={r.key} className={`bg-white rounded-xl px-3.5 py-3 flex items-center gap-3 shadow-sm ${r.tone === 'late' ? 'border-l-4 border-red-400' : r.tone === 'soon' ? 'border-l-4 border-amber-400' : ''}`}>
              {r.kind === 'med' || r.kind === 'meal' ? (
                // quick tick; the row body opens the full form
                <button onClick={() => { day.toggle(r); toast.show(`${r.title} ${r.kind === 'med' ? 'taken' : 'logged'}`) }} aria-label={`Mark ${r.title} done`}
                  className="w-7 h-7 rounded-full flex-shrink-0 border-2 border-gray-200 active:bg-emerald-500 active:border-emerald-500 transition-all" />
              ) : (
                <button onClick={() => setOpenItem(r)} aria-label={r.kind === 'vitals' ? 'Log vitals' : `Open ${r.title}`}
                  className="w-7 h-7 rounded-full flex-shrink-0 bg-teal-600 text-white text-sm font-bold flex items-center justify-center">{r.kind === 'vitals' ? '+' : '›'}</button>
              )}
              <span className="text-lg">{r.icon}</span>
              {/* the row body opens this reminder's detail form */}
              <button onClick={() => setOpenItem(r)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-gray-800 truncate">{r.title}</p>
                <p className="text-[11px] text-gray-400 truncate">{r.sub}</p>
              </button>
              <Pill color={TONE_PILL[r.tone]}>{countdown(r.inMin)}</Pill>
            </div>
          ))}
        </div>
      </div>


      {/* recent activity */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <SectionHead title="Recent readings" action="Vitals →" onAction={() => go('vitals')} />
        <div className="mt-2">
          {patient.readings.filter(r => r.at).slice(0, 4).map(r => {
            const def = vitalDefs.find(v => v.id === r.vitalId)
            if (!def) return null
            return (
              <button key={r.id} onClick={() => openVital(def.id)} className="w-full flex items-center gap-2 py-1.5 text-xs text-left">
                <span>{def.icon}</span>
                <span className="flex-1 text-gray-600">{def.name}</span>
                <span className={`font-bold ${levelStyle(evaluate(patient, def, r.value)).value} font-mono`}>{unitView(def, patient).value(r.value)}</span>
                <span className="text-[10px] text-gray-400 w-16 text-right">{ago(r.at!, now)}</span>
                <span className="text-gray-300" aria-hidden="true">›</span>
              </button>
            )
          })}
          {patient.readings.length === 0 && <p className="text-xs text-gray-400">No readings yet.</p>}
        </div>
      </div>

      <ReminderSheet item={openItem} onClose={() => setOpenItem(null)} go={go} onDone={toast.show} />

      {/* upgrade */}
      <div className="rounded-2xl overflow-hidden" style={{ background: HERO_GRADIENT }}>
        <div className="p-4 flex gap-3">
          <span className="text-2xl flex-shrink-0">⭐</span>
          <div>
            <p className="text-white font-bold text-sm">mCare Premium</p>
            <p className="text-teal-200 text-xs mt-0.5 leading-relaxed">AI health coach, unlimited records, priority consultations. From KES 499/mo.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
