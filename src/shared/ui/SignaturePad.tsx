import { useEffect, useRef, useState } from 'react'

const INK = '#12356b'
const W = 600, H = 200

/**
 * Draw a handwritten signature with a finger, stylus or mouse — or load a
 * photo of one signed on paper (the white background is removed). Returns a
 * trimmed PNG with a transparent background, ready to place on a report.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { clear() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = () => ref.current!.getContext('2d')!
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  function clear() {
    ctx().clearRect(0, 0, W, H)
    setEmpty(true); setError(''); onChange(null)
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    ref.current!.setPointerCapture(e.pointerId)
    last.current = pos(e)
    const c = ctx(); c.fillStyle = INK
    c.beginPath(); c.arc(last.current.x, last.current.y, 1.6, 0, Math.PI * 2); c.fill()
  }
  const move = (e: React.PointerEvent) => {
    if (!last.current) return
    const p = pos(e), c = ctx()
    // Pressure where the device reports it; otherwise a steady pen width.
    c.lineWidth = e.pressure && e.pressure !== 0.5 ? 1.8 + e.pressure * 2.6 : 3
    c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 }
    c.beginPath(); c.moveTo(last.current.x, last.current.y); c.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y); c.lineTo(p.x, p.y); c.stroke()
    last.current = p
    if (empty) setEmpty(false)
  }
  const up = () => {
    if (!last.current) return
    last.current = null
    setEmpty(false)
    onChange(exportTrimmed())
  }

  /** Crop to the ink and return a PNG; null when nothing is drawn. */
  function exportTrimmed(): string | null {
    const c = ctx(), { data } = c.getImageData(0, 0, W, H)
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0 || x1 - x0 < 12) return null
    const pad = 6
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad)
    const out = document.createElement('canvas')
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
    out.getContext('2d')!.drawImage(ref.current!, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  /** A photo of a paper signature: fit it, drop the paper, recolour the ink. */
  const load = (file: File) => {
    setError('')
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { setError('Use a PNG, JPG or WebP photo under 5 MB.'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const c = ctx()
      c.clearRect(0, 0, W, H)
      const s = Math.min(W / img.width, H / img.height) * 0.92
      const w = img.width * s, h = img.height * s
      c.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      URL.revokeObjectURL(url)
      const im = c.getImageData(0, 0, W, H), d = im.data
      let ink = 0
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const a = d[i + 3] < 30 ? 0 : Math.max(0, Math.min(255, (190 - lum) * 2.4))
        d[i] = 0x12; d[i + 1] = 0x35; d[i + 2] = 0x6b; d[i + 3] = a
        if (a > 40) ink++
      }
      c.putImageData(im, 0, 0)
      if (ink < 150) { clear(); setError('No signature found in that photo — sign in dark ink on white paper.'); return }
      setEmpty(false)
      onChange(exportTrimmed())
    }
    img.onerror = () => { URL.revokeObjectURL(url); setError('That image could not be read.') }
    img.src = url
  }

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-gray-200 bg-white">
        <canvas ref={ref} width={W} height={H} aria-label="Signature pad"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          className="w-full h-auto block touch-none cursor-crosshair rounded-xl" />
        <div className="absolute left-5 right-5 bottom-[26%] border-b border-gray-300 pointer-events-none" />
        <span className="absolute left-3 bottom-[27%] text-gray-300 text-lg pointer-events-none">✕</span>
        {empty && <p className="absolute inset-x-0 top-3 text-center text-[11px] text-gray-400 pointer-events-none">Sign here with your finger, stylus or mouse</p>}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={clear} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-bold">Clear</button>
        <label className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-bold cursor-pointer">
          📷 Use a photo
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
        </label>
      </div>
      {error && <p className="text-[11px] text-red-600 font-semibold mt-1">{error}</p>}
    </div>
  )
}
