/**
 * A small QR code encoder for the local backend: byte mode, error correction level M, versions 1–10
 * (up to 213 bytes, enough for an otpauth:// link). Hosted Supabase Auth returns its own QR code when
 * an authenticator app is set up; this gives the local backend the same, so the app can show one there too.
 * Follows ISO/IEC 18004; the block layout, masks and format bits are the standard ones.
 */

/* Per version (index = version): error-correction codewords per block, and [blocks, data codewords] per group, at level M. */
const BLOCKS_M = [null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]],
]
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

/* GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1 */
function mul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}
function divisor(degree) {
  const r = new Array(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1] }
    root = mul(root, 0x02)
  }
  return r
}
function remainder(data, div) {
  const out = div.map(() => 0)
  for (const b of data) {
    const factor = b ^ out.shift()
    out.push(0)
    div.forEach((c, i) => { out[i] ^= mul(c, factor) })
  }
  return out
}

/** The codewords for `bytes` at `version`, split into blocks and interleaved, error correction included. */
function codewords(bytes, version) {
  const [ecLen, ...groups] = BLOCKS_M[version]
  const capacity = groups.reduce((n, [count, len]) => n + count * len, 0)
  const bits = []
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4)                                   // byte mode
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, capacity * 8 - bits.length))  // terminator
  put(0, (8 - bits.length % 8) % 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad)

  const blocks = []
  let at = 0
  for (const [count, len] of groups) for (let i = 0; i < count; i++) { blocks.push(data.slice(at, at + len)); at += len }
  const div = divisor(ecLen)
  const ecc = blocks.map(b => remainder(b, div))
  const out = []
  const longest = Math.max(...blocks.map(b => b.length))
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const e of ecc) out.push(e[i])
  return out
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
]

/** Builds the module grid (true = dark) for one version and mask. */
function grid(words, version, mask) {
  const size = version * 4 + 17
  const dark = Array.from({ length: size }, () => new Array(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }   // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {                  // finders and their separators
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, d !== 2 && d !== 4)
    }
  }
  const al = ALIGN[version]
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  // format bits: level M (00) and the mask, BCH(15,5), then XOR 0x5412
  const fdata = (0b00 << 3) | mask
  let rem = fdata
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const fbits = ((fdata << 10) | rem) ^ 0x5412
  const fb = i => ((fbits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, fb(i))
  set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i))
  set(8, size - 8, true)   // the dark module

  if (version >= 7) {      // version bits, BCH(18,6)
    let r = version
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const vbits = (version << 12) | r
    for (let i = 0; i < 18; i++) {
      const on = ((vbits >>> i) & 1) === 1
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, on); set(b, a, on)
    }
  }

  // data, in the two-column zigzag from the bottom right, masked
  const test = MASKS[mask]
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? size - 1 - v : v
      if (fixed[y][x]) continue
      const bit = i < words.length * 8 ? ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1 : false
      i++
      dark[y][x] = bit !== test(x, y)
    }
  }
  return dark
}

/** Lower is easier to scan: long runs, 2×2 blocks, finder look-alikes and imbalance cost points. */
function penalty(dark) {
  const size = dark.length
  let score = 0
  const lines = [...dark, ...dark[0].map((_, x) => dark.map(row => row[x]))]
  for (const line of lines) {
    let run = 1
    for (let k = 1; k <= size; k++) {
      if (k < size && line[k] === line[k - 1]) { run++; continue }
      if (run >= 5) score += run - 2
      run = 1
    }
    const s = line.map(b => (b ? 1 : 0)).join('')
    score += 40 * ((s.match(/(?=10111010000|00001011101)/g) ?? []).length)
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = dark[y][x]
    if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3
  }
  const total = dark.flat().filter(Boolean).length
  score += Math.floor(Math.abs(total * 20 - size * size * 10) / (size * size)) * 10
  return score
}

/** The module grid for `text` (true = dark), or throws when it is longer than version 10 can hold. */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)]
  let version = 1
  for (; version <= 10; version++) {
    const [, ...groups] = BLOCKS_M[version]
    const capacity = groups.reduce((n, [count, len]) => n + count * len, 0)
    if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8) break
  }
  if (version > 10) throw new Error('Too long for a QR code here')
  const words = codewords(bytes, version)
  let best = null, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const g = grid(words, version, mask)
    const s = penalty(g)
    if (s < bestScore) { best = g; bestScore = s }
  }
  return best
}

/**
 * The QR code as SVG markup, as Supabase Auth returns it in `totp.qr_code` (supabase-js turns it into a
 * `data:image/svg+xml;utf-8,` URL, unescaped, so the markup avoids `#`).
 */
export function qrSvg(text) {
  const m = qrMatrix(text)
  const n = m.length + 8
  let path = ''
  m.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="white"/><path d="${path}" fill="black"/></svg>`
}
