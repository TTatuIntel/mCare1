/** How mCare may reach this person besides the app: email, text message and push. Opened from ProfileCard, the same for every role. */
import { useEffect, useState } from 'react'
import { useApp } from '@/shared/state/AppContext'
import type { NotifyPrefs } from '@/shared/lib/types'
import { pushState, type PushState } from '@/shared/lib/push'
import { Toggle } from '@/shared/ui/primitives'
import { BottomSheet, SheetButton, SaveError, useSave } from '@/shared/ui/BottomSheet'

const DEFAULTS: NotifyPrefs = { email: true, sms: true, push: true }
const PUSH_NOTE: Record<PushState, string> = {
  unsupported: 'This browser cannot receive notifications from mCare (it needs a secure https address, or a browser that supports them).',
  unconfigured: 'Push notifications are not set up for mCare yet.',
  blocked: 'Notifications are blocked for mCare in this browser. Allow them in the browser’s site settings.',
  off: 'This device does not receive mCare notifications.',
  on: 'This device receives mCare notifications.',
}

export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, updateUser, setDevicePush, live } = useApp()
  const prefs = { ...DEFAULTS, ...currentUser?.notify }
  const save = useSave()
  const device = useSave()
  const [push, setPush] = useState<PushState | null>(null)
  useEffect(() => { if (open) { save.clear(); device.clear(); void pushState().then(setPush) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!currentUser) return null

  // Each switch saves on its own; it moves only once the save has come back.
  const toggle = (k: keyof NotifyPrefs) => save.run(() => updateUser(currentUser.id, { notify: { ...prefs, [k]: !prefs[k] } }))
  const toggleDevice = async () => {
    const on = push !== 'on'
    if ((await device.run(() => setDevicePush(on))).ok) setPush(await pushState())
  }
  const hasPhone = currentUser.phone.replace(/\D/g, '').length >= 9

  const row = (k: keyof NotifyPrefs, title: string, text: string) => (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{text}</p>
      </div>
      <Toggle on={prefs[k]} disabled={save.busy} label={title} onChange={() => { void toggle(k) }} />
    </div>
  )

  return (
    <BottomSheet open={open} onClose={onClose} title="Notifications"
      subtitle="Notifications always appear in the app. Choose where else mCare may reach you."
      footer={<SheetButton onClick={onClose}>Done</SheetButton>}>
      {row('email', 'Email', `Every notification, to ${currentUser.email}.`)}
      {row('sms', 'Text message', hasPhone
        ? `Only what cannot wait (an SOS, an escalation, a critical reading), to ${currentUser.phone}.`
        : 'Only what cannot wait. Add a phone number in Edit Profile to receive them.')}
      {row('push', 'Push notifications', 'Every notification, on each device where you allow them below.')}
      <SaveError message={save.error} className="mt-2" />

      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 mt-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-900">This device</p>
            <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{!live ? 'Push notifications work once mCare is connected to its server.' : push ? PUSH_NOTE[push] : 'Checking…'}</p>
          </div>
          {live && (push === 'on' || push === 'off') && (
            <button onClick={toggleDevice} disabled={device.busy || !prefs.push}
              className={`text-xs font-bold px-3 py-2 rounded-full flex-shrink-0 disabled:opacity-50 ${push === 'on' ? 'bg-white border border-gray-200 text-gray-700' : 'bg-teal-700 text-white'}`}>
              {device.busy ? 'Saving…' : push === 'on' ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>
        {!prefs.push && push === 'off' && <p className="text-[10px] text-gray-400 mt-1">Switch on push notifications above first.</p>}
        <SaveError message={device.error} className="mt-2" />
      </div>
      <p className="text-[10px] text-gray-400 mt-3 leading-snug">In an emergency, do not wait for a message: use SOS or call your local emergency number.</p>
    </BottomSheet>
  )
}
