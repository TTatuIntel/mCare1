/**
 * Downloads & exports. Uploaded files always download byte-for-byte as the
 * original — a patient's own upload is never converted or re-rendered.
 * Generated reports (vitals, lab, prescription) can be saved as PDF (via the
 * browser's print dialog), a real Word .docx, or a web page.
 *
 * Callers must get approval from the store (`recordDownload`) first — that
 * is the access check and the audit entry.
 */
import type { AppUser, DoctorUser, MedicalDocument, PatientUser } from '@/shared/lib/types'
import { calcAge } from '@/shared/lib/vitals'
import { DOC_CATEGORIES, DEFAULT_REPORT_INCLUDE, isOfficial } from './documents'
import { renderReportHtml, verificationCode, patientRef, reportNo, type ReportContext, type RenderOptions } from './reportTemplate'
import { buildZip, dataUrlToBytes, type Block } from './fileFormats'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function fileBlob(doc: MedicalDocument): Promise<Blob | null> {
  if (!doc.file?.dataUrl) return null
  return new Blob([(await dataUrlToBytes(doc.file.dataUrl)).slice()], { type: doc.file.mime })
}

/** Opens the original file in a new tab (PDFs and images), where the browser's own viewer and zoom apply. */
export async function openInNewTab(doc: MedicalDocument): Promise<boolean> {
  const blob = await fileBlob(doc)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return !!w
}

export const slug = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'document'
export const exportName = (doc: MedicalDocument, ext: string) => `${slug(doc.title)}${doc.version > 1 ? `-v${doc.version}` : ''}.${ext}`

/** Everyone a report mentions, resolved from live records. */
export function reportContext(doc: MedicalDocument, users: AppUser[]): ReportContext {
  const u = (id?: string) => (id ? users.find(x => x.id === id) : undefined)
  const patient = u(doc.patientId) as PatientUser | undefined
  return { patient, author: u(doc.createdBy), signer: u(doc.signedBy), releaser: u(doc.releasedBy), careDoctor: u(patient?.assignedDoctorId) }
}

export const reportHtml = (doc: MedicalDocument, users: AppUser[], opts?: RenderOptions) => renderReportHtml(doc, reportContext(doc, users), opts)

/** Print through a hidden frame — works inside embedded previews where pop-ups are blocked. "Save as PDF" is in every browser's print dialog. */
export function printReport(doc: MedicalDocument, users: AppUser[]) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = reportHtml(doc, users)
  frame.onload = async () => {
    // Wait (briefly) for the brand fonts so the printed logo matches the app.
    const fonts = frame.contentDocument?.fonts
    if (fonts) await Promise.race([fonts.ready, new Promise(r => setTimeout(r, 1500))])
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}

/* ─── Report → blocks (for Word) — same sections as the printed report ─── */
type SigBlock = { t: 'sig'; png: Uint8Array; w: number; h: number }
type DocxBlock = Block | SigBlock

/** Decode a signature PNG data URL and read its pixel size from the IHDR chunk. */
function pngOf(dataUrl?: string): Omit<SigBlock, 't'> | null {
  const m = dataUrl?.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const bin = atob(m[1]), png = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i)
  if (png.length < 24 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null
  const dv = new DataView(png.buffer)
  return { png, w: dv.getUint32(16), h: dv.getUint32(20) }
}

function reportBlocks(doc: MedicalDocument, users: AppUser[]): DocxBlock[] {
  const rc = reportContext(doc, users)
  const signer = (rc.signer ?? rc.author) as DoctorUser | undefined
  const official = isOfficial(doc)
  const p = rc.patient
  const h2 = (text: string): Block => ({ t: 'h', level: 2, runs: [{ text }] })
  const kv = (k: string, v: string): Block => ({ t: 'p', runs: [{ text: `${k}: `, b: true }, { text: v }] })
  const out: DocxBlock[] = [
    { t: 'p', runs: [{ text: 'mCare · Remote Patient Monitoring', b: true }, { text: signer?.role === 'doctor' && signer.hospital ? `   ${signer.hospital}` : '' }] },
    { t: 'h', level: 1, runs: [{ text: official ? (DOC_CATEGORIES[doc.category].label === 'Vitals Report' ? 'Vital Signs Monitoring Report' : DOC_CATEGORIES[doc.category].label) : 'Personal Document' }] },
    { t: 'p', runs: [{ text: doc.title, i: true }, { text: `   ${!official ? 'PERSONAL' : doc.supersededBy ? 'SUPERSEDED' : doc.status === 'released' ? 'FINAL' : doc.status === 'signed' ? 'SIGNED' : 'DRAFT — NOT SIGNED'}`, b: true }] },
  ]
  if (doc.correctionReason) out.push({ t: 'p', runs: [{ text: `Corrected report — version ${doc.version}. Reason: ${doc.correctionReason}`, i: true }] })
  const age = p?.dob ? calcAge(p.dob) : null
  const h = p?.health
  out.push({ t: 'table', rows: [
    ['Patient', p?.name ?? '—', 'Report no.', reportNo(doc)],
    ['Patient ID', patientRef(p), 'Date', doc.documentDate],
    ['Date of birth', p?.dob ? `${p.dob}${age !== null ? ` (${age} y)` : ''}` : '—', 'Clinician', signer?.name ?? '—'],
    ['Sex', h?.sex ? h.sex[0].toUpperCase() + h.sex.slice(1) : '—', 'Facility', signer?.role === 'doctor' ? signer.hospital : '—'],
    ['Phone', p?.phone || '—', 'Licence No.', signer?.role === 'doctor' ? signer.licenseNo : '—'],
  ] })
  const b = doc.body
  const inc = b?.type === 'vitals' ? { ...DEFAULT_REPORT_INCLUDE, ...b.include } : null
  if (h && ((inc?.healthProfile) || b?.type === 'prescription')) {
    const allergies = h.allergies.length ? h.allergies.map(a => `${a.substance} (${a.severity})`).join(', ') : h.noKnownAllergies ? 'No known allergies' : 'Not recorded'
    out.push({ t: 'table', rows: b?.type === 'prescription' ? [['Allergies', allergies]] : [
      ['Blood type', h.bloodType ?? 'Unknown'], ['Allergies', allergies],
      ['Long-term conditions', h.conditions.length ? h.conditions.join(', ') : h.noConditions ? 'None' : 'Not recorded'],
    ] })
  }
  if (doc.description) out.push({ t: 'p', runs: [{ text: doc.description }] })
  if (b?.type === 'vitals' && inc) {
    if (inc.findings) {
      out.push(h2('Summary of findings'))
      ;(b.findings?.length ? b.findings : [b.summary]).forEach(f => out.push({ t: 'p', bullet: true, runs: [{ text: f }] }))
    }
    out.push(h2(inc.trends ? 'Vital signs & trends' : 'Vital signs'))
    out.push({ t: 'table', rows: [['Vital', 'Latest', 'Average', 'Range', 'Target', 'In target', ...(inc.trends ? ['Trend'] : [])],
      ...b.rows.map(r => [r.name, `${r.latest} ${r.unit}`, r.total ? String(r.averageText ?? r.average) : '—', r.total ? (r.rangeText ?? `${r.min}–${r.max}`) : '—', r.target,
        r.total ? `${r.inRange}/${r.total}` : '—',
        ...(inc.trends ? [r.direction && r.direction !== 'unknown' ? `${r.direction}${r.change ? ` (${r.change > 0 ? '+' : ''}${r.change})` : ''}` : '—'] : [])])] })
    if (inc.alerts && b.alerts.length) {
      out.push(h2('Alerts & events'))
      out.push({ t: 'table', rows: [['Date & time', 'Event', 'Severity', 'Status'], ...b.alerts.map(a => [a.at, a.label, a.severity === 'danger' ? 'Critical' : 'Warning', `${a.status}${a.resolution ? ` — ${a.resolution}` : ''}`])] })
    }
    if (inc.medications && b.medications?.length) {
      out.push(h2('Current medications'))
      out.push({ t: 'table', rows: [['Medication', 'Dose', 'Frequency', 'Indication'], ...b.medications.map(m => [m.name, m.dose, m.frequency, m.purpose || '—'])] })
    }
    if (b.notes?.length) {
      out.push(h2('Clinical notes'))
      b.notes.forEach(n => {
        out.push({ t: 'p', runs: [{ text: `${n.at} · ${n.author}`, i: true }] })
        n.content.split('\n').forEach(l => out.push({ t: 'p', runs: [{ text: l }] }))
      })
    }
    out.push(h2("Clinician's interpretation & plan"))
    ;(b.interpretation ? b.interpretation.split('\n') : ['To be completed by the signing clinician before release.']).forEach(l => out.push({ t: 'p', runs: [{ text: l, i: !b.interpretation }] }))
  } else if (b?.type === 'lab') {
    out.push(h2('Results'))
    out.push(kv('Laboratory', b.lab))
    out.push({ t: 'table', rows: [['Test', 'Result', 'Unit', 'Reference', 'Flag'], ...b.rows.map(r => [r.test, r.value, r.unit, r.ref, r.flag === 'H' ? 'High' : r.flag === 'L' ? 'Low' : ''])] })
    if (b.comment) { out.push(h2('Comment')); out.push({ t: 'p', runs: [{ text: b.comment }] }) }
  } else if (b?.type === 'prescription') {
    out.push(h2('Prescription'))
    out.push({ t: 'table', rows: [['Medication', b.medication], ['Dose', b.dosage], ['Frequency', b.frequency], ['Indication', b.purpose || '—']] })
  } else if (b?.type === 'text') {
    b.text.split('\n').forEach(l => out.push({ t: 'p', runs: [{ text: l }] }))
  }
  if (official) {
    out.push(h2('Sign-off'))
    if (doc.signedBy && doc.status !== 'draft') {
      const sig = pngOf(doc.signatureImage)
      if (sig) out.push({ t: 'sig', ...sig })
      out.push(kv('Electronically signed by',`${signer?.name ?? '—'}${signer?.role === 'doctor' ? ` · ${signer.specialty} · Licence ${signer.licenseNo}` : ''}`))
      out.push(kv('Signed', doc.signedAt ?? '—'))
      out.push(kv('Verification code', verificationCode(doc)))
    } else out.push({ t: 'p', runs: [{ text: 'NOT SIGNED — draft, not valid for clinical use.', b: true }] })
  }
  out.push({ t: 'p', runs: [{ text: `Confidential — contains personal health information. Document ${doc.id} · version ${doc.version}`, i: true }] })
  return out
}

/* ─── Minimal, valid .docx writer ──────────────────────────────────── */
const x = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

function runXml(r: { text: string; b?: boolean; i?: boolean; u?: boolean }, size?: number) {
  const pr = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}`
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`
}

const EMU_PER_PX = 9525
/** Inline picture sized to a signature line: 0.6" tall, at most 2.4" wide. */
function sigXml(bl: SigBlock): string {
  const cy = Math.round(0.6 * 914400), cx = Math.min(Math.round(cy * bl.w / Math.max(1, bl.h)), 2.4 * 914400, bl.w * EMU_PER_PX * 3)
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Signature"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="rIdSig"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function blocksXml(blocks: DocxBlock[]): string {
  return blocks.map(bl => {
    if (bl.t === 'sig') return sigXml(bl)
    if (bl.t === 'h') return `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>${bl.runs.map(r => runXml({ ...r, b: true }, bl.level === 1 ? 36 : 28)).join('')}</w:p>`
    if (bl.t === 'p') return `<w:p>${bl.bullet ? '<w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr>' : ''}${bl.bullet ? runXml({ text: '• ' }) : ''}${bl.runs.map(r => runXml(r)).join('')}</w:p>`
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join('')
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${
      bl.rows.map((row, i) => `<w:tr>${row.map(c => `<w:tc><w:p>${runXml({ text: c, b: i === 0 }, 20)}</w:p></w:tc>`).join('')}</w:tr>`).join('')
    }</w:tbl><w:p/>`
  }).join('')
}

export function buildDocx(blocks: DocxBlock[]): Blob {
  const enc = new TextEncoder()
  const sig = blocks.find((b): b is SigBlock => b.t === 'sig')
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sig ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${blocksXml(blocks)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`) },
    ...(sig ? [
      { name: 'word/_rels/document.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSig" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.png"/></Relationships>') },
      { name: 'word/media/signature.png', data: sig.png },
    ] : []),
  ]
  return new Blob([buildZip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export const reportDocx = (doc: MedicalDocument, users: AppUser[]) => buildDocx(reportBlocks(doc, users))

/* ─── Whole-library export ─────────────────────────────────────────── */

/** One zip: original files as uploaded, reports as printable web pages, plus an index. */
export async function buildLibraryZip(docs: MedicalDocument[], users: AppUser[], patientName: string): Promise<Blob> {
  const enc = new TextEncoder()
  const files: { name: string; data: Uint8Array }[] = []
  const index: string[] = [`mCare documents — ${patientName}`, `Exported ${new Date().toLocaleString()}`, '']
  for (const d of docs) {
    const folder = DOC_CATEGORIES[d.category].label
    let name: string
    if (d.file?.dataUrl) {
      name = `${folder}/${d.documentDate} ${d.file.name}`
      files.push({ name, data: await dataUrlToBytes(d.file.dataUrl) })
    } else if (!isOfficial(d)) {
      // Patient uploads are never re-rendered — only the original file is theirs to export.
      name = '(original held in secure storage — not included)'
    } else {
      name = `${folder}/${d.documentDate} ${exportName(d, 'html')}`
      files.push({ name, data: enc.encode(reportHtml(d, users)) })
    }
    const status = isOfficial(d) ? (d.supersededBy ? 'official · superseded' : 'official') : 'personal upload'
    index.push(`${d.documentDate}  ${d.title}${d.version > 1 ? ` (v${d.version})` : ''}  [${status}]  → ${name}`)
  }
  files.push({ name: 'INDEX.txt', data: enc.encode(index.join('\r\n')) })
  return buildZip(files)
}
