/**
 * Demo documents. Built from the seeded patients' real readings, alerts and
 * prescriptions so every report links back to records that exist.
 */
import type { AppUser, AppAlert, PatientUser, VitalDef, MedicalDocument, DocEvent, DocBody } from '@/shared/lib/types'
import { buildVitalsReport, fnv1a } from './documents'
import { stamp, dayKey } from '@/shared/lib/vitals'

const HR = 3_600_000
const DAY = 24 * HR

export function seedDocuments(users: AppUser[], defs: VitalDef[], alerts: AppAlert[], now: number):
  { docs: MedicalDocument[]; events: DocEvent[] } {
  const p1 = users.find(u => u.id === 'p1') as PatientUser
  const p3 = users.find(u => u.id === 'p3') as PatientUser
  const when = (ago: number) => ({ at: now - ago, createdAt: stamp(new Date(now - ago)), documentDate: dayKey(new Date(now - ago)) })
  const file = (name: string, mime: string, size: number) => ({ name, mime, size, sha256: fnv1a(`${name}:${size}`).repeat(8) })

  const official = (id: string, patientId: string, ago: number, rest: Partial<MedicalDocument> & Pick<MedicalDocument, 'title' | 'category'>): MedicalDocument => ({
    id, patientId, origin: 'system_generated', createdBy: 'd1', status: 'released',
    signedBy: 'd1', signedAt: stamp(new Date(now - ago)), releasedBy: 'd1', releasedAt: stamp(new Date(now - ago)),
    seriesId: id, version: 1, links: [], visibility: 'care_team', seenByPatient: true, ...when(ago), ...rest,
  })
  const personal = (id: string, ago: number, rest: Partial<MedicalDocument> & Pick<MedicalDocument, 'title' | 'category'>): MedicalDocument => ({
    id, patientId: 'p1', origin: 'patient_upload', createdBy: 'p1', seriesId: id, version: 1, links: [], visibility: 'care_team',
    upload: { state: 'ready', progress: 100, attempts: 1, idempotencyKey: `p1:${id}` }, ...when(ago), ...rest,
  })

  const vitals30 = buildVitalsReport(p1, defs, alerts, 30, now)
  const v1Body: DocBody = vitals30.body.type === 'vitals'
    ? { ...vitals30.body, summary: `${vitals30.body.summary} (Blood glucose averages were computed with one reading in mmol/L.)` }
    : vitals30.body
  const p3Report = buildVitalsReport(p3, defs, alerts, 7, now)

  const docs: MedicalDocument[] = [
    // p1 — a corrected report: v1 superseded by v2
    official('doc_k7q2m9x4v1ab', 'p1', 6 * DAY, {
      title: 'Vitals Report — last 30 days', category: 'vitals_report', body: v1Body, links: vitals30.links,
      supersededBy: 'doc_r3n8w1c6z5pe',
    }),
    official('doc_r3n8w1c6z5pe', 'p1', 5 * DAY, {
      title: 'Vitals Report — last 30 days', category: 'vitals_report', body: vitals30.body, links: vitals30.links,
      seriesId: 'doc_k7q2m9x4v1ab', version: 2, supersedes: 'doc_k7q2m9x4v1ab',
      correctionReason: 'One blood glucose reading was entered in mmol/L; averages recalculated in mg/dL.',
    }),
    official('doc_h4t9b2y7k3mw', 'p1', 10 * DAY, {
      title: 'Lab Result — Full Blood Panel', category: 'lab', origin: 'clinician_upload', seenByPatient: false,
      file: file('blood-panel-sep2026.pdf', 'application/pdf', 290_816),
      upload: { state: 'ready', progress: 100, attempts: 1, idempotencyKey: 'p1:seed-lab' },
      description: 'Fasting sample, Kenyatta National Hospital laboratory.',
      body: {
        type: 'lab', lab: 'KNH Laboratory · fasting sample',
        rows: [
          { test: 'HbA1c', value: '7.4', unit: '%', ref: '4.0–5.6', flag: 'H' },
          { test: 'Fasting glucose', value: '148', unit: 'mg/dL', ref: '70–99', flag: 'H' },
          { test: 'Total cholesterol', value: '212', unit: 'mg/dL', ref: '< 200', flag: 'H' },
          { test: 'LDL', value: '131', unit: 'mg/dL', ref: '< 100', flag: 'H' },
          { test: 'Creatinine', value: '0.9', unit: 'mg/dL', ref: '0.7–1.3' },
          { test: 'Haemoglobin', value: '14.2', unit: 'g/dL', ref: '13.5–17.5' },
        ],
        comment: 'Glycaemic control above target. Lipids mildly raised — continue atorvastatin.',
      },
      links: [{ kind: 'appointment', id: 'ap1', label: 'Cardiology Consultation · Oct 4' }],
    }),
    ...p1.prescriptions.filter(rx => rx.active).map((rx, i) => official(`doc_rx${i}a8f3k2p9q`, 'p1', 20 * DAY, {
      title: `Prescription — ${rx.medication}`, category: 'prescription',
      body: { type: 'prescription', medication: rx.medication, dosage: rx.dosage, frequency: rx.frequency, purpose: rx.purpose },
      links: [{ kind: 'prescription', id: rx.id, label: `${rx.medication} · ${rx.frequency}` }],
    })),
    personal('doc_m2x8p4r7t1qa', 40 * DAY, {
      title: 'Discharge Summary — Aga Khan Hospital 2025', category: 'discharge',
      file: file('discharge-2025.pdf', 'application/pdf', 552_960),
      body: { type: 'text', text: 'Admitted with hypertensive urgency (BP 186/112). Treated and discharged on lisinopril.\nAdvised home BP monitoring and cardiology follow-up.' },
    }),
    personal('doc_w9c3j6n1b8ds', 15 * DAY, {
      title: 'NHIF Insurance Card', category: 'insurance', visibility: 'private',
      file: file('nhif-card.png', 'image/png', 184_320),
      body: { type: 'text', text: 'Insurance card (front and back). Kept private — not shared with the care team.' },
    }),
    personal('doc_f5v1z8q3h6ey', 2 * HR, {
      title: 'Chest X-ray (home copy)', category: 'imaging',
      file: file('chest-xray.jpg', 'image/jpeg', 3_984_588),
      upload: { state: 'failed', progress: 60, attempts: 1, idempotencyKey: 'p1:seed-xray', error: 'Connection lost at 60%. Your file is kept — tap Retry.' },
      body: { type: 'text', text: 'Chest radiograph copy from a private clinic.' },
    }),
    personal('doc_g8b4k1w6m3ro', 60 * DAY, {
      title: 'Old insurance card (expired)', category: 'insurance', visibility: 'private',
      file: file('old-card.jpg', 'image/jpeg', 150_000), deletedAt: now - 35 * DAY, deletedBy: 'p1',
      body: { type: 'text', text: 'Replaced by the NHIF card.' },
    }),

    // p3 — a generated report still waiting for the doctor's signature
    official('doc_s6d2h9f4l7ux', 'p3', 2 * HR, {
      title: 'Vitals Report — last 7 days', category: 'vitals_report', status: 'draft', body: p3Report.body, links: p3Report.links,
      signedBy: undefined, signedAt: undefined, releasedBy: undefined, releasedAt: undefined, seenByPatient: undefined,
    }),
    official('doc_t1y7r4e2w9nc', 'p3', 12 * DAY, {
      title: 'Overnight Pulse Oximetry', category: 'lab', origin: 'clinician_upload',
      file: file('oximetry-overnight.pdf', 'application/pdf', 421_888),
      upload: { state: 'ready', progress: 100, attempts: 1, idempotencyKey: 'p3:seed-oxi' },
      body: {
        type: 'lab', lab: 'Sleep lab · 7 h recording',
        rows: [
          { test: 'Mean SpO₂', value: '94', unit: '%', ref: '≥ 95', flag: 'L' },
          { test: 'Lowest SpO₂', value: '86', unit: '%', ref: '≥ 90', flag: 'L' },
          { test: 'Time below 90%', value: '14', unit: 'min', ref: '< 5', flag: 'H' },
        ],
      },
    }),
  ]

  const ev = (id: string, docId: string, patientId: string, actorId: string, action: DocEvent['action'], ago: number, detail?: string): DocEvent =>
    ({ id, docId, patientId, actorId, action, detail, at: now - ago, createdAt: stamp(new Date(now - ago)) })

  const events: DocEvent[] = [
    ev('dev_1', 'doc_f5v1z8q3h6ey', 'p1', 'p1', 'upload_failed', 2 * HR, 'at 60%'),
    ev('dev_2', 'doc_s6d2h9f4l7ux', 'p3', 'd1', 'upload', 2 * HR, 'Generated from the vitals record'),
    ev('dev_3', 'doc_r3n8w1c6z5pe', 'p1', 'p1', 'view', 4 * DAY),
    ev('dev_4', 'doc_r3n8w1c6z5pe', 'p1', 'd1', 'release', 5 * DAY, 'Version 2 replaces version 1'),
    ev('dev_5', 'doc_k7q2m9x4v1ab', 'p1', 'd1', 'correct', 5 * DAY, 'One blood glucose reading was entered in mmol/L'),
    ev('dev_6', 'doc_m2x8p4r7t1qa', 'p1', 'd1', 'view', 30 * DAY),
    ev('dev_7', 'doc_h4t9b2y7k3mw', 'p1', 'd1', 'release', 10 * DAY),
    ev('dev_8', 'doc_k7q2m9x4v1ab', 'p1', 'd1', 'release', 6 * DAY),
  ]
  return { docs, events }
}
