/**
 * Supported file formats: detection, safety checks and in-app previews.
 *
 * A file is accepted only when its extension is on the allow-list AND its
 * actual bytes match that format — the name and the browser's MIME claim are
 * never trusted. Office files carrying macros and PDFs carrying JavaScript are
 * refused. Previews are parsed into plain data and rendered by React, so no
 * document content is ever injected as HTML.
 *
 * No third-party libraries: ZIP entries are read with the browser's native
 * DecompressionStream.
 */

export type FileFamily = 'pdf' | 'image' | 'word' | 'sheet' | 'slides' | 'text' | 'medical'

type Signature = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'bmp' | 'tiff' | 'ooxml' | 'odf' | 'ole' | 'rtf' | 'text' | 'dicom'

export interface FileFormat {
  id: string
  label: string
  exts: string[]
  mime: string
  family: FileFamily
  sig: Signature
  /** OOXML: an entry that must exist in the package. */
  entry?: string
  /** How far the app can show it without leaving mCare. */
  preview: 'native' | 'parsed' | 'none'
}

export const FORMATS: FileFormat[] = [
  { id: 'pdf',  label: 'PDF',  exts: ['pdf'],          mime: 'application/pdf', family: 'pdf', sig: 'pdf', preview: 'native' },
  { id: 'jpg',  label: 'JPG',  exts: ['jpg', 'jpeg'],  mime: 'image/jpeg', family: 'image', sig: 'jpeg', preview: 'native' },
  { id: 'png',  label: 'PNG',  exts: ['png'],          mime: 'image/png',  family: 'image', sig: 'png',  preview: 'native' },
  { id: 'gif',  label: 'GIF',  exts: ['gif'],          mime: 'image/gif',  family: 'image', sig: 'gif',  preview: 'native' },
  { id: 'webp', label: 'WEBP', exts: ['webp'],         mime: 'image/webp', family: 'image', sig: 'webp', preview: 'native' },
  { id: 'heic', label: 'HEIC', exts: ['heic', 'heif'], mime: 'image/heic', family: 'image', sig: 'heic', preview: 'native' },
  { id: 'bmp',  label: 'BMP',  exts: ['bmp'],          mime: 'image/bmp',  family: 'image', sig: 'bmp',  preview: 'native' },
  { id: 'tiff', label: 'TIFF', exts: ['tif', 'tiff'],  mime: 'image/tiff', family: 'image', sig: 'tiff', preview: 'native' },
  { id: 'docx', label: 'DOCX', exts: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', family: 'word', sig: 'ooxml', entry: 'word/document.xml', preview: 'parsed' },
  { id: 'doc',  label: 'DOC',  exts: ['doc'],  mime: 'application/msword', family: 'word', sig: 'ole', preview: 'none' },
  { id: 'odt',  label: 'ODT',  exts: ['odt'],  mime: 'application/vnd.oasis.opendocument.text', family: 'word', sig: 'odf', preview: 'parsed' },
  { id: 'rtf',  label: 'RTF',  exts: ['rtf'],  mime: 'application/rtf', family: 'word', sig: 'rtf', preview: 'parsed' },
  { id: 'txt',  label: 'TXT',  exts: ['txt'],  mime: 'text/plain', family: 'text', sig: 'text', preview: 'parsed' },
  { id: 'xlsx', label: 'XLSX', exts: ['xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'sheet', sig: 'ooxml', entry: 'xl/workbook.xml', preview: 'parsed' },
  { id: 'xls',  label: 'XLS',  exts: ['xls'],  mime: 'application/vnd.ms-excel', family: 'sheet', sig: 'ole', preview: 'none' },
  { id: 'ods',  label: 'ODS',  exts: ['ods'],  mime: 'application/vnd.oasis.opendocument.spreadsheet', family: 'sheet', sig: 'odf', preview: 'parsed' },
  { id: 'csv',  label: 'CSV',  exts: ['csv'],  mime: 'text/csv', family: 'sheet', sig: 'text', preview: 'parsed' },
  { id: 'pptx', label: 'PPTX', exts: ['pptx'], mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', family: 'slides', sig: 'ooxml', entry: 'ppt/presentation.xml', preview: 'parsed' },
  { id: 'ppt',  label: 'PPT',  exts: ['ppt'],  mime: 'application/vnd.ms-powerpoint', family: 'slides', sig: 'ole', preview: 'none' },
  { id: 'odp',  label: 'ODP',  exts: ['odp'],  mime: 'application/vnd.oasis.opendocument.presentation', family: 'slides', sig: 'odf', preview: 'parsed' },
  { id: 'dcm',  label: 'DICOM', exts: ['dcm', 'dicom'], mime: 'application/dicom', family: 'medical', sig: 'dicom', preview: 'none' },
]

export const FAMILY_META: Record<FileFamily, { label: string; icon: string }> = {
  pdf: { label: 'PDF', icon: '📕' },
  image: { label: 'Image', icon: '🖼️' },
  word: { label: 'Word document', icon: '📝' },
  sheet: { label: 'Spreadsheet', icon: '📊' },
  slides: { label: 'Presentation', icon: '📽️' },
  text: { label: 'Text', icon: '📃' },
  medical: { label: 'Medical scan', icon: '🩻' },
}

export const ACCEPT_ATTR = FORMATS.flatMap(f => [...f.exts.map(e => `.${e}`), f.mime]).join(',')
export const SUPPORTED_SUMMARY = 'PDF · Word · Excel · PowerPoint · Images (JPG, PNG, HEIC…) · Text/CSV · DICOM'

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
export const formatByExt = (ext: string) => FORMATS.find(f => f.exts.includes(ext.toLowerCase()))
export const formatByMime = (mime: string) => FORMATS.find(f => f.mime === mime)
/** Best description of a stored file, from its MIME type, falling back to its name. */
export const formatOf = (mime: string, name = '') => formatByMime(mime) ?? formatByExt(extOf(name))

/* ─── Byte helpers ─────────────────────────────────────────────────── */
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x)

function indexOf(hay: Uint8Array, needle: number[], from = 0, limit = hay.length): number {
  const end = Math.min(limit, hay.length) - needle.length
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
const utf16 = (s: string) => [...s].flatMap(c => [c.charCodeAt(0), 0])

/* ─── ZIP (Office Open XML & OpenDocument are ZIP packages) ─────────── */
export interface ZipEntry { name: string; method: number; compSize: number; size: number; dataStart: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** Reads the central directory. Returns null when the bytes are not a valid ZIP. */
export function listZip(b: Uint8Array): ZipEntry[] | null {
  if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return null
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  const out: ZipEntry[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null
    const method = u16(b, p + 10), compSize = u32(b, p + 20), size = u32(b, p + 24)
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32), local = u32(b, p + 42)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen))
    if (local + 30 > b.length || u32(b, local) !== 0x04034b50) return null
    const dataStart = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    out.push({ name, method, compSize, size, dataStart })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Guards previews against ZIP bombs. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024

export async function readZipEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (e.size > MAX_ENTRY_BYTES) throw new Error('Entry too large to preview')
  const raw = b.subarray(e.dataStart, e.dataStart + e.compSize)
  if (e.method === 0) return raw
  if (e.method !== 8) throw new Error('Unsupported compression')
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function zipText(b: Uint8Array, entries: ZipEntry[], name: string): Promise<string | null> {
  const e = entries.find(x => x.name === name)
  return e ? new TextDecoder().decode(await readZipEntry(b, e)) : null
}

/* ─── ZIP writer (for "Download all") ──────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Builds an uncompressed ZIP. Medical files are mostly already compressed, so "store" costs little. */
export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const seen = new Set<string>()
  for (const f of files) {
    let name = f.name, i = 2
    while (seen.has(name)) name = f.name.replace(/(\.[^.]+)?$/, m => ` (${i++})${m}`)
    seen.add(name)
    const nb = enc.encode(name), crc = crc32(f.data), size = f.data.length
    const local = new Uint8Array(30 + nb.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true)
    dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true); dv.setUint16(26, nb.length, true)
    local.set(nb, 30)
    const cen = new Uint8Array(46 + nb.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, nb.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nb, 46)
    parts.push(local, f.data); central.push(cen)
    offset += local.length + size
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end].map(p => p as Uint8Array<ArrayBuffer>), { type: 'application/zip' })
}

/* ─── Detection ────────────────────────────────────────────────────── */

/** Checks the real bytes against the format the extension promises. Returns a reason on failure, null when it matches. */
export function verifyContent(fmt: FileFormat, b: Uint8Array): string | null {
  const bad = `The file claims to be ${fmt.label} but its content does not match. It may be damaged or disguised.`
  switch (fmt.sig) {
    case 'pdf':
      if (indexOf(b, ascii('%PDF-'), 0, 1024) < 0) return bad
      if (indexOf(b, ascii('/JavaScript')) >= 0 || indexOf(b, ascii('/Launch')) >= 0) return 'This PDF contains embedded scripts or launch actions and was blocked for safety.'
      return null
    case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff]) ? null : bad
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : bad
    case 'gif': return startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) ? null : bad
    case 'webp': return startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8) ? null : bad
    case 'heic': {
      const brand = String.fromCharCode(...b.subarray(8, 12))
      return startsWith(b, ascii('ftyp'), 4) && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand) ? null : bad
    }
    case 'bmp': return startsWith(b, ascii('BM')) ? null : bad
    case 'tiff': return startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]) ? null : bad
    case 'rtf': return startsWith(b, ascii('{\\rtf')) ? null : bad
    case 'dicom': return startsWith(b, ascii('DICM'), 128) ? null : bad
    case 'ole': {
      if (!startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return bad
      if (indexOf(b, utf16('_VBA_PROJECT')) >= 0 || indexOf(b, utf16('Macros')) >= 0) return 'This file contains macros and was blocked for safety. Save it without macros and try again.'
      return null
    }
    case 'ooxml': {
      const entries = listZip(b)
      if (!entries || !entries.some(e => e.name === fmt.entry)) return bad
      if (entries.some(e => /vbaProject\.bin$/i.test(e.name) || /activeX/i.test(e.name))) return 'This file contains macros or ActiveX controls and was blocked for safety.'
      return null
    }
    case 'odf': {
      const entries = listZip(b)
      const mt = entries?.find(e => e.name === 'mimetype')
      if (!entries || !mt || mt.method !== 0) return bad
      const declared = new TextDecoder().decode(b.subarray(mt.dataStart, mt.dataStart + mt.compSize)).trim()
      if (declared !== fmt.mime) return bad
      if (entries.some(e => /^(Basic|Scripts)\//.test(e.name))) return 'This file contains macros and was blocked for safety.'
      return null
    }
    case 'text': {
      const head = b.subarray(0, 64 * 1024)
      if (head.includes(0)) return bad
      try { new TextDecoder('utf-8', { fatal: true }).decode(head.length === b.length ? head : head.subarray(0, head.length - 4)) }
      catch { try { new TextDecoder('windows-1252', { fatal: true }).decode(head) } catch { return bad } }
      return null
    }
  }
}

/* ─── Previews ─────────────────────────────────────────────────────── */
export interface Run { text: string; b?: boolean; i?: boolean; u?: boolean }
export type Block =
  | { t: 'h'; level: number; runs: Run[] }
  | { t: 'p'; runs: Run[]; bullet?: boolean }
  | { t: 'table'; rows: string[][] }

export type Preview =
  | { kind: 'doc'; blocks: Block[]; truncated: boolean }
  | { kind: 'sheet'; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { kind: 'slides'; slides: { title: string; lines: string[] }[] }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'none'; reason: string }

const MAX_BLOCKS = 600
const MAX_ROWS = 200
const MAX_COLS = 26
const MAX_TEXT = 200_000

// Namespace-agnostic helpers: Office files use many prefixes, and matching on the local name
// with a plain tree walk behaves the same in every DOM implementation.
const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const lname = (n: { localName?: string | null; nodeName: string }) => (n.localName || n.nodeName).split(':').pop()!
const kids = (el: Element | Document): Element[] => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1)
function all(el: Element | Document, local: string): Element[] {
  const out: Element[] = []
  const walk = (n: Element | Document) => { for (const c of kids(n)) { if (lname(c) === local) out.push(c); walk(c) } }
  walk(el)
  return out
}
const attr = (el: Element | null | undefined, local: string) =>
  el ? (Array.from(el.attributes).find(a => lname(a) === local)?.value ?? null) : null
const child = (el: Element | null | undefined, local: string) => (el ? kids(el).find(c => lname(c) === local) : undefined)
const onOff = (el?: Element) => !!el && !['0', 'false', 'none'].includes(attr(el, 'val') ?? 'true')

/* DOCX */
function docxRuns(p: Element): Run[] {
  return all(p, 'r').map(r => {
    const pr = child(r, 'rPr')
    const text = kids(r).map(c => lname(c) === 't' ? c.textContent ?? '' : lname(c) === 'tab' ? '\t' : lname(c) === 'br' ? '\n' : '').join('')
    return { text, b: onOff(child(pr, 'b')), i: onOff(child(pr, 'i')), u: !!child(pr, 'u') && attr(child(pr, 'u'), 'val') !== 'none' }
  }).filter(r => r.text)
}
function parseDocx(s: string): Preview {
  const body = all(xml(s), 'body')[0]
  if (!body) return { kind: 'none', reason: 'The document body could not be read.' }
  const blocks: Block[] = []
  for (const el of kids(body)) {
    if (blocks.length >= MAX_BLOCKS) break
    if (lname(el) === 'p') {
      const pPr = child(el, 'pPr')
      const style = attr(child(pPr, 'pStyle'), 'val') ?? ''
      const runs = docxRuns(el)
      const h = /^heading\s?(\d)/i.exec(style) ?? (/^title$/i.test(style) ? ['', '1'] : null)
      if (h) blocks.push({ t: 'h', level: Number(h[1]) || 1, runs })
      else blocks.push({ t: 'p', runs, bullet: !!child(pPr, 'numPr') || /list/i.test(style) })
    } else if (lname(el) === 'tbl') {
      const rows = all(el, 'tr').slice(0, MAX_ROWS).map(tr => kids(tr).filter(c => lname(c) === 'tc').slice(0, MAX_COLS)
        .map(tc => all(tc, 't').map(t => t.textContent).join('')))
      blocks.push({ t: 'table', rows })
    }
  }
  return { kind: 'doc', blocks, truncated: blocks.length >= MAX_BLOCKS }
}

/* XLSX */
const colIndex = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
async function parseXlsx(b: Uint8Array, entries: ZipEntry[]): Promise<Preview> {
  const sst = await zipText(b, entries, 'xl/sharedStrings.xml')
  const shared = sst ? all(xml(sst), 'si').map(si => all(si, 't').map(t => t.textContent).join('')) : []
  const wb = xml((await zipText(b, entries, 'xl/workbook.xml')) ?? '<x/>')
  const relsTxt = await zipText(b, entries, 'xl/_rels/workbook.xml.rels')
  const rels = relsTxt ? all(xml(relsTxt), 'Relationship') : []
  const sheets: { name: string; rows: string[][]; truncated: boolean }[] = []
  for (const sh of all(wb, 'sheet').slice(0, 6)) {
    const rid = attr(sh, 'id')
    const target = rels.find(r => attr(r, 'Id') === rid)?.getAttribute('Target') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const txt = await zipText(b, entries, path)
    if (!txt) continue
    const rowEls = all(xml(txt), 'row')
    const rows = rowEls.slice(0, MAX_ROWS).map(row => {
      const out: string[] = []
      for (const c of all(row, 'c')) {
        const idx = colIndex(attr(c, 'r') ?? '')
        if (idx < 0 || idx >= MAX_COLS) continue
        const type = attr(c, 't')
        const v = child(c, 'v')?.textContent ?? ''
        out[idx] = type === 's' ? shared[Number(v)] ?? ''
          : type === 'inlineStr' ? all(c, 't').map(t => t.textContent).join('')
          : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v
      }
      return Array.from(out, x => x ?? '')
    })
    sheets.push({ name: attr(sh, 'name') ?? `Sheet ${sheets.length + 1}`, rows, truncated: rowEls.length > MAX_ROWS })
  }
  return sheets.length ? { kind: 'sheet', sheets } : { kind: 'none', reason: 'No readable sheets found.' }
}

/* PPTX */
async function parsePptx(b: Uint8Array, entries: ZipEntry[]): Promise<Preview> {
  const slideFiles = entries.map(e => e.name).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, c) => Number(a.match(/\d+/)![0]) - Number(c.match(/\d+/)![0])).slice(0, 80)
  const slides: { title: string; lines: string[] }[] = []
  for (const f of slideFiles) {
    const doc = xml((await zipText(b, entries, f)) ?? '<x/>')
    const lines = all(doc, 'p').map(p => all(p, 't').map(t => t.textContent).join('')).filter(l => l.trim())
    slides.push({ title: lines[0] ?? `Slide ${slides.length + 1}`, lines: lines.slice(1) })
  }
  return slides.length ? { kind: 'slides', slides } : { kind: 'none', reason: 'No slides found.' }
}

/* OpenDocument */
const odfText = (el: Element): string => Array.from(el.childNodes).map(node => {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const n = node as Element
  return lname(n) === 's' ? ' '.repeat(Number(attr(n, 'c') ?? 1)) : lname(n) === 'tab' ? '\t' : lname(n) === 'line-break' ? '\n' : odfText(n)
}).join('')

async function parseOdf(b: Uint8Array, entries: ZipEntry[], family: FileFamily): Promise<Preview> {
  const doc = xml((await zipText(b, entries, 'content.xml')) ?? '<x/>')
  if (family === 'sheet') {
    const sheets = all(doc, 'table').slice(0, 6).map(tbl => {
      const rowEls = all(tbl, 'table-row')
      const rows = rowEls.slice(0, MAX_ROWS).map(r => all(r, 'table-cell').flatMap(c =>
        Array(Math.min(Number(attr(c, 'number-columns-repeated') ?? 1), MAX_COLS)).fill(odfText(c))).slice(0, MAX_COLS))
      while (rows.length && rows[rows.length - 1].every(x => !x)) rows.pop()
      return { name: attr(tbl, 'name') ?? 'Sheet', rows: rows.map(r => { while (r.length && !r[r.length - 1]) r.pop(); return r }), truncated: rowEls.length > MAX_ROWS }
    })
    return sheets.length ? { kind: 'sheet', sheets } : { kind: 'none', reason: 'No readable sheets found.' }
  }
  if (family === 'slides') {
    const slides = all(doc, 'page').slice(0, 80).map((pg, i) => {
      const lines = all(pg, 'p').map(odfText).filter(l => l.trim())
      return { title: lines[0] ?? `Slide ${i + 1}`, lines: lines.slice(1) }
    })
    return slides.length ? { kind: 'slides', slides } : { kind: 'none', reason: 'No slides found.' }
  }
  const text = all(doc, 'text')[0]
  const blocks: Block[] = []
  const walk = (el: Element, bullet = false) => {
    for (const c of kids(el)) {
      if (blocks.length >= MAX_BLOCKS) return
      if (lname(c) === 'h') blocks.push({ t: 'h', level: Number(attr(c, 'outline-level') ?? 1), runs: [{ text: odfText(c) }] })
      else if (lname(c) === 'p') blocks.push({ t: 'p', runs: [{ text: odfText(c) }], bullet })
      else if (lname(c) === 'list') walk(c, true)
      else if (lname(c) === 'list-item' || lname(c) === 'section') walk(c, bullet)
      else if (lname(c) === 'table') blocks.push({ t: 'table', rows: all(c, 'table-row').slice(0, MAX_ROWS).map(r => all(r, 'table-cell').slice(0, MAX_COLS).map(odfText)) })
    }
  }
  if (text) walk(text)
  return { kind: 'doc', blocks, truncated: blocks.length >= MAX_BLOCKS }
}

/* RTF — keeps the text, drops formatting tables and embedded objects. */
export function rtfToText(src: string): string {
  const SKIP = /^\\(\*|fonttbl|colortbl|stylesheet|info|pict|object|header|footer|listtable|listoverridetable|themedata|datastore|xmlnstbl|rsidtbl|generator)/
  let out = '', i = 0, depth = 0, skipAt = -1
  while (i < src.length && out.length < MAX_TEXT) {
    const ch = src[i]
    if (ch === '{') {
      depth++
      if (skipAt < 0 && SKIP.test(src.slice(i + 1, i + 24))) skipAt = depth
      i++; continue
    }
    if (ch === '}') { if (depth === skipAt) skipAt = -1; depth--; i++; continue }
    if (skipAt >= 0) { i++; continue }
    if (ch === '\\') {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i.exec(src.slice(i, i + 32))
      if (!m) { i++; continue }
      i += m[0].length
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16))
      else if (m[4]) out += m[4] === '~' ? ' ' : /[\\{}]/.test(m[4]) ? m[4] : ''
      else if (m[1] === 'par' || m[1] === 'line') out += '\n'
      else if (m[1] === 'tab') out += '\t'
      else if (m[1] === 'u' && m[2]) out += String.fromCharCode((Number(m[2]) + 65536) % 65536)
      continue
    }
    if (ch !== '\r' && ch !== '\n') out += ch
    i++
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/* CSV */
export function parseCsv(src: string, maxRows = MAX_ROWS): string[][] {
  const delim = (src.split('\n')[0].match(/;/g)?.length ?? 0) > (src.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row.slice(0, MAX_COLS)); row = []; cell = '' }
    else cell += c
  }
  if ((cell || row.length) && rows.length < maxRows) { row.push(cell); rows.push(row.slice(0, MAX_COLS)) }
  return rows
}

const decodeText = (b: Uint8Array) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return new TextDecoder('windows-1252').decode(b) }
}

/** Builds a readable preview for formats the browser can't show natively. */
export async function buildPreview(fmt: FileFormat, b: Uint8Array): Promise<Preview> {
  try {
    if (fmt.preview === 'none') {
      return { kind: 'none', reason: fmt.family === 'medical'
        ? 'DICOM scans open in a medical image viewer. Download the file to open it.'
        : `Older ${fmt.label} files can't be previewed in the app. Download to open in ${fmt.family === 'word' ? 'Word' : fmt.family === 'sheet' ? 'Excel' : 'PowerPoint'}.` }
    }
    if (fmt.id === 'txt') {
      const text = decodeText(b.subarray(0, MAX_TEXT))
      return { kind: 'text', text, truncated: b.length > MAX_TEXT }
    }
    if (fmt.id === 'csv') {
      const all = decodeText(b.subarray(0, 2 * 1024 * 1024))
      const rows = parseCsv(all)
      return { kind: 'sheet', sheets: [{ name: 'CSV', rows, truncated: rows.length >= MAX_ROWS }] }
    }
    if (fmt.id === 'rtf') {
      const text = rtfToText(decodeText(b))
      return { kind: 'doc', blocks: text.split('\n').map(l => ({ t: 'p' as const, runs: [{ text: l }] })), truncated: text.length >= MAX_TEXT }
    }
    const entries = listZip(b)
    if (!entries) return { kind: 'none', reason: 'The file could not be opened.' }
    if (fmt.id === 'docx') return parseDocx((await zipText(b, entries, 'word/document.xml')) ?? '')
    if (fmt.id === 'xlsx') return parseXlsx(b, entries)
    if (fmt.id === 'pptx') return parsePptx(b, entries)
    if (fmt.sig === 'odf') return parseOdf(b, entries, fmt.family)
    return { kind: 'none', reason: 'Preview not available for this file.' }
  } catch {
    return { kind: 'none', reason: 'This file could not be previewed. Download it to open it.' }
  }
}

export const dataUrlToBytes = async (dataUrl: string) => new Uint8Array(await (await fetch(dataUrl)).arrayBuffer())
