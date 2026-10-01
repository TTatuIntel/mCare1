import { useLayoutEffect, useRef } from 'react'

/* ─── Device scale ────────────────────────────────────────────────────
   The whole app is sized in rem (Tailwind's spacing and text scales, the
   logo), so one number on the root element resizes everything together:
   text, icons, spacing and the brand mark keep their proportions.

   The root font size is a percentage, so it starts from the size the
   device asks for (browser or system text size). On top of that it follows
   the width of the app frame: reduced on a phone narrower than the width
   the screens are designed at, and raised a little on a wider phone.
   Tablet and web keep the device's size: their layouts use the extra
   width for columns instead.
   The user's own Small / Medium / Large choice (`mcare-font-*` in
   index.css) multiplies on top of this. */

/** The frame width the mobile screens are drawn for: the scale is 1 here. */
const DESIGN_WIDTH = 390
/** Never shrink past this, so text stays readable on the smallest phones. */
const MIN_SCALE = 0.8
/** Never grow past this on a large phone, so a screen still holds what it was designed to. */
const MAX_SCALE = 1.1
/** Where the tablet layout starts (`@2xl`, 42rem at the browser's default text size). */
const TABLET_WIDTH = 672

export function deviceScale(frameWidth: number) {
  if (!frameWidth || frameWidth >= TABLET_WIDTH) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((frameWidth / DESIGN_WIDTH) * 1000) / 1000))
}

/** Attach to the app frame: keeps the root font size fitted to the frame's width. */
export function useDeviceScale<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const fit = () => {
      const scale = deviceScale(el.clientWidth)
      root.style.fontSize = scale === 1 ? '' : `${scale * 100}%`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.fontSize = '' }
  }, [])
  return ref
}
