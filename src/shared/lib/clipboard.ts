/**
 * Copies text, on any address. `navigator.clipboard` exists only on https and localhost; a phone testing
 * over the laptop's network address (http://192.168.…) has none, so there the older copy command is used.
 * Resolves to false when neither worked, so the screen can say so instead of claiming "Copied".
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true }
  } catch { /* refused: try the older way */ }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off screen, and 16px so iOS does not zoom in on it.
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px'
  document.body.appendChild(area)
  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch { return false } finally { area.remove() }
}
