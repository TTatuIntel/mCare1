import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import { LoaderProvider, useLoaderBusy } from '@/shared/ui/Loader'
import SplashScreen from './SplashScreen'
import { StatusBar } from './StatusBar'

/* ─── App frame ───────────────────────────────────────────────────────
   The frame every role renders inside. By default it fills the browser
   window, and the layout inside adapts to its width:

     mobile   under 672px   bottom tab bar, one column
     tablet   672px and up  icon rail on the left, wider content
     web      1024px and up labelled sidebar, multi-column pages

   The frame is a CSS container (`@container`), so screens size themselves
   with Tailwind's container variants — `@2xl:` for tablet, `@5xl:` for
   web — never the viewport ones (`md:`, `lg:`). That is what lets the
   preview switcher below show the tablet and phone layouts on a desktop.

   Also owns: theme and font scale, the sheet layer, the loading popup and
   the boot splash. */

type Device = 'web' | 'tablet' | 'mobile'
const DEVICES: { id: Device; label: string; icon: string }[] = [
  { id: 'web',    label: 'Web',    icon: '🖥' },
  { id: 'tablet', label: 'Tablet', icon: '▭' },
  { id: 'mobile', label: 'Mobile', icon: '📱' },
]
const DEVICE_KEY = 'mcare-device'
/** Below this window width there is no room to preview another device: the app just fills the screen. */
const PREVIEW_MIN = '(min-width: 900px)'

/** Framed sizes for the previews; `web` has no frame. */
const FRAME: Record<Exclude<Device, 'web'>, { width: number; height: number; radius: number }> = {
  tablet: { width: 834, height: 1112, radius: 28 },
  mobile: { width: 390, height: 844,  radius: 50 },
}

function useMediaQuery(query: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setOn(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return on
}

function readDevice(): Device {
  try {
    const v = localStorage.getItem(DEVICE_KEY)
    return v === 'tablet' || v === 'mobile' ? v : 'web'
  } catch { return 'web' }
}

export function PhoneShell({ children }: { children: React.ReactNode }) {
  const { currentUser } = useApp()
  const canPreview = useMediaQuery(PREVIEW_MIN)
  const [chosen, setChosen] = useState<Device>(readDevice)
  const device: Device = canPreview ? chosen : 'web'
  const pick = (d: Device) => {
    setChosen(d)
    try { localStorage.setItem(DEVICE_KEY, d) } catch { /* private mode: the choice just isn't remembered */ }
  }

  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const theme = currentUser?.theme ?? 'light'
  const isDark = theme === 'dark' || (theme === 'auto' && prefersDark)
  const fontCls = `mcare-font-${currentUser?.fontSize ?? 'md'}`
  const frame = device === 'web' ? null : FRAME[device]

  return (
    <div className="h-dvh flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(160deg,#d8eae8 0%,#c4d8e8 100%)' }}>
      <div className={`@container relative flex flex-col bg-gray-100 overflow-hidden ${frame ? '' : 'w-full h-full'} ${isDark ? 'mcare-theme-dark' : ''} ${fontCls}`}
        style={frame ? {
          width: frame.width, height: frame.height, maxHeight: 'calc(100dvh - 24px)', borderRadius: frame.radius,
          boxShadow: '0 50px 100px rgba(0,0,0,.40), 0 0 0 1px rgba(255,255,255,.25), inset 0 0 0 1.5px rgba(0,0,0,.08)',
        } : undefined}>
        <LoaderProvider>
          {device === 'mobile' && <StatusBar />}
          <AppScreen>{children}</AppScreen>
        </LoaderProvider>
        <SplashScreen />
      </div>

      {/* preview switcher — only where the window is wide enough to show another device */}
      {canPreview && (
        <div className="fixed bottom-3 right-3 z-[70] flex bg-white/90 backdrop-blur rounded-full p-1 shadow-lg ring-1 ring-black/5" role="group" aria-label="Preview as">
          {DEVICES.map(d => (
            <button key={d.id} onClick={() => pick(d.id)} aria-pressed={device === d.id} title={`Preview as ${d.label.toLowerCase()}`}
              className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-full transition-colors ${device === d.id ? 'bg-teal-700 text-white' : 'text-gray-500'}`}>
              <span aria-hidden="true">{d.icon}</span>{d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The screen and sheet layers; locked (no taps, no focus) while the loading popup is up. */
function AppScreen({ children }: { children: React.ReactNode }) {
  const busy = useLoaderBusy()
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }} inert={busy} aria-busy={busy}>
        {children}
      </div>
      <div id="sheet-root" className="absolute inset-0 z-40 pointer-events-none overflow-hidden" inert={busy} />
    </>
  )
}
