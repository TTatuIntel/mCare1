import { useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { Avatar, Pill, PageTitle, BottomSheet, SheetButton, Field, inputCls, useToast } from '@/shared'
import type { AdminUser, PatientUser, VitalDef } from '@/shared/lib/types'
import { can, isFullAdmin } from '@/assistant/permissions'
import PatientThresholdView from './PatientThresholdView'

/* ─── Vitals Tab (Definitions + Patient Ranges) ─────────────────────── */
type DefForm = { name: string; unit: string; normalMin: string; normalMax: string; criticalMin: string; criticalMax: string; hardMin: string; hardMax: string; icon: string }
const EMPTY_DEF: DefForm = { name: '', unit: '', normalMin: '', normalMax: '', criticalMin: '', criticalMax: '', hardMin: '', hardMax: '', icon: '📊' }

export default function VitalsTab({ admin }: { admin: AdminUser }) {
  const { vitalDefs, setVitalDefs, getPatients, logAudit } = useApp()
  const canManageDefs = isFullAdmin(admin)
  const canManagePatients = can(admin, 'monitor_patients')

  const [subView, setSubView] = useState<'defs' | 'patients'>(canManageDefs ? 'defs' : 'patients')
  const [selectedPatient, setSelectedPatient] = useState<PatientUser | null>(null)
  const [sheet, setSheet] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null)
  const [form, setForm] = useState<DefForm>(EMPTY_DEF)
  const toast = useToast()

  const patients = getPatients().filter(p => p.status === 'active')
  const n = (v: string) => (v.trim() === '' ? NaN : Number(v))
  const err = (() => {
    if (!form.name.trim() || !form.unit.trim()) return 'Name and unit are required.'
    const [a, b, c, d] = [n(form.normalMin), n(form.normalMax), n(form.criticalMin), n(form.criticalMax)]
    if (isNaN(a) || isNaN(b)) return 'Enter normal min and max.'
    if (a >= b) return 'Normal min must be lower than normal max.'
    if (!isNaN(c) && c >= a) return 'Critical low must be below normal min.'
    if (!isNaN(d) && d <= b) return 'Critical high must be above normal max.'
    return null
  })()

  const toggleActive = (id: string) => {
    const v = vitalDefs.find(x => x.id === id)
    setVitalDefs(prev => prev.map(x => x.id === id ? { ...x, active: !x.active } : x))
    logAudit(v?.active ? 'Deactivated vital type' : 'Activated vital type', v?.name ?? id)
  }

  const openEdit = (v: VitalDef) => {
    setForm({
      name: v.name, unit: v.unit, icon: v.icon,
      normalMin: String(v.normalMin), normalMax: String(v.normalMax),
      criticalMin: v.criticalMin !== undefined ? String(v.criticalMin) : '', criticalMax: v.criticalMax !== undefined ? String(v.criticalMax) : '',
      hardMin: String(v.hardMin), hardMax: String(v.hardMax),
    })
    setSheet({ mode: 'edit', id: v.id })
  }

  const save = () => {
    if (err || !sheet) return
    const a = n(form.normalMin), b = n(form.normalMax)
    const base = {
      name: form.name.trim(), unit: form.unit.trim(), icon: form.icon || '📊',
      normalMin: a, normalMax: b,
      criticalMin: isNaN(n(form.criticalMin)) ? undefined : n(form.criticalMin),
      criticalMax: isNaN(n(form.criticalMax)) ? undefined : n(form.criticalMax),
      hardMin: isNaN(n(form.hardMin)) ? Math.min(0, a) : n(form.hardMin),
      hardMax: isNaN(n(form.hardMax)) ? b * 3 : n(form.hardMax),
    }
    if (sheet.mode === 'edit') {
      setVitalDefs(prev => prev.map(v => v.id === sheet.id ? { ...v, ...base } : v))
      logAudit('Updated vital definition', `${base.name}: normal ${a}–${b}`)
      toast.show(`${base.name} updated`)
    } else {
      setVitalDefs(prev => [...prev, { ...base, id: base.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now(), active: true }])
      logAudit('Added vital type', base.name)
      toast.show(`${base.name} added`)
    }
    setSheet(null)
  }

  if (selectedPatient) {
    const liveP = (patients.find(p => p.id === selectedPatient.id) ?? selectedPatient)
    return <PatientThresholdView patient={liveP} onBack={() => setSelectedPatient(null)} />
  }

  return (
    <div className="flex flex-col gap-4 card-flow">
      <PageTitle title="Vitals" action={subView === 'defs' && canManageDefs ? '+ Add type' : undefined}
        onAction={() => { setForm(EMPTY_DEF); setSheet({ mode: 'add' }) }} />
      {toast.node}

      <div className="flex bg-gray-100 rounded-xl p-[3px] gap-[2px]">
        {[
          { id: 'defs', label: 'Definitions', show: canManageDefs },
          { id: 'patients', label: 'Patient Vitals', show: canManagePatients },
        ].filter(t => t.show).map(({ id, label }) => (
          <button key={id} onClick={() => setSubView(id as typeof subView)}
            className={`flex-1 text-[11px] px-3 py-1.5 rounded-lg font-semibold transition-all ${subView === id ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {subView === 'defs' && (
        <>
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-3">
            <p className="text-xs text-teal-800 leading-relaxed">
              Defaults apply when a doctor has not set a personal target. Critical limits always raise an immediate alert, whatever the doctor's target.
            </p>
          </div>
          {vitalDefs.map(v => (
            <div key={v.id} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{v.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-900">{v.name}</p>
                    <Pill color={v.active ? 'green' : 'gray'}>{v.active ? 'Active' : 'Inactive'}</Pill>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{v.unit} · Normal {v.normalMin}–{v.normalMax}</p>
                  <p className="text-[11px] text-red-500">
                    Critical {v.criticalMin !== undefined ? `≤ ${v.criticalMin}` : '—'} / {v.criticalMax !== undefined ? `≥ ${v.criticalMax}` : '—'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <button onClick={() => canManageDefs && toggleActive(v.id)} disabled={!canManageDefs} aria-label={`Toggle ${v.name}`}
                    className={`relative flex-shrink-0 rounded-full transition-colors ${v.active ? 'bg-teal-600' : 'bg-gray-200'} ${!canManageDefs ? 'opacity-40 cursor-not-allowed' : ''}`}
                    style={{ width: 40, height: 22 }}>
                    <span className="absolute top-0.5 bg-white rounded-full shadow transition-all" style={{ width: 18, height: 18, left: v.active ? 20 : 2 }} />
                  </button>
                  {canManageDefs && (
                    <button onClick={() => openEdit(v)} className="text-[10px] text-teal-600 font-semibold bg-teal-50 px-2 py-0.5 rounded-full">Edit</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {subView === 'patients' && (
        <>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="text-xs text-blue-800 leading-relaxed">View each patient's latest readings and the targets their doctor has set.</p>
          </div>
          {patients.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center"><p className="text-sm text-gray-400">No active patients found.</p></div>
          ) : patients.map(p => (
            <button key={p.id} onClick={() => setSelectedPatient(p)}
              className="bg-white rounded-2xl px-4 py-4 flex items-center gap-3 shadow-sm text-left active:bg-gray-50 transition-colors">
              <Avatar name={p.name} avatar={p.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-400 truncate">{p.email}</p>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full font-semibold">{p.trackedVitalIds.length} vitals</span>
                  {Object.keys(p.thresholds).length > 0 && (
                    <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">{Object.keys(p.thresholds).length} doctor targets</span>
                  )}
                </div>
              </div>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </>
      )}

      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.mode === 'edit' ? 'Edit Vital Type' : 'Add New Vital Type'}
        footer={<><SheetButton tone="ghost" onClick={() => setSheet(null)}>Cancel</SheetButton><SheetButton disabled={!!err} onClick={save}>{sheet?.mode === 'edit' ? 'Save' : 'Add Vital'}</SheetButton></>}>
        <div className="grid grid-cols-2 gap-x-3">
          {([
            ['Name *', 'name', 'e.g. Respiratory Rate'], ['Unit *', 'unit', 'e.g. /min'],
            ['Normal min *', 'normalMin', ''], ['Normal max *', 'normalMax', ''],
            ['Critical low', 'criticalMin', ''], ['Critical high', 'criticalMax', ''],
            ['Lowest plausible', 'hardMin', ''], ['Highest plausible', 'hardMax', ''],
            ['Icon', 'icon', ''],
          ] as const).map(([label, key, ph]) => (
            <Field key={key} label={label}>
              <input value={form[key]} placeholder={ph} inputMode={key === 'name' || key === 'unit' || key === 'icon' ? 'text' : 'decimal'}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls} />
            </Field>
          ))}
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
      </BottomSheet>
    </div>
  )
}
