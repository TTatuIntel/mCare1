/** Max upload size before processing. */
const MAX_BYTES = 8 * 1024 * 1024
/** Stored avatars are at most this many pixels square. */
const OUT_PX = 320

/**
 * Reads an image file as a square, centre-cropped, downscaled JPEG data URL
 * (so the stored avatar stays small). Rejects with a message fit to show.
 */
export function readSquarePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'))
    if (file.size > MAX_BYTES) return reject(new Error('Image is too large (max 8 MB).'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That image could not be opened.'))
      img.onload = () => {
        const side = Math.min(img.width, img.height)
        const out = Math.min(side, OUT_PX)
        const canvas = document.createElement('canvas')
        canvas.width = out; canvas.height = out
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Could not process that image.'))
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
