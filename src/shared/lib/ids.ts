/**
 * A reference for one form, sent with its save. The database keeps one record
 * per reference, so a save sent twice (a double tap, a retry after the answer
 * was lost) does not make two.
 *
 * `crypto.randomUUID` only exists on https and localhost; a phone testing over
 * the local network has neither, so the same value is built from random bytes.
 */
export function newRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
