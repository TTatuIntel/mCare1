/**
 * Push notifications on this device (Web Push).
 *
 * Available when the browser supports it, the page is served over https (or
 * localhost), and mCare has a push key (VITE_VAPID_PUBLIC_KEY, the public half
 * of the key pair the sender uses: docs/DELIVERY.md). The service worker is
 * public/sw.js.
 */
const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? ''

export type PushState =
  | 'unsupported'     // this browser, or a page that is not https
  | 'unconfigured'    // mCare has no push key yet
  | 'blocked'         // the person refused notifications for this site
  | 'off' | 'on'

const supported = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** The base64url VAPID key as the browser wants it. */
function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

const registration = () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (!VAPID) return 'unconfigured'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

/** What the database keeps for this device. */
export interface DevicePush { endpoint: string; p256dh: string; auth: string; userAgent: string }

/** Asks the browser's permission and subscribes this device. Throws with a sentence fit to show. */
export async function subscribePush(): Promise<DevicePush> {
  if (!supported()) throw new Error('This browser cannot receive notifications from mCare.')
  if (!VAPID) throw new Error('Push notifications are not set up for mCare yet.')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for mCare. Allow them in the browser settings, then try again.')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) })
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('The browser did not give a usable subscription. Try again.')
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, userAgent: navigator.userAgent.slice(0, 300) }
}

/** Stops push on this device. Resolves with the endpoint that was removed, if there was one. */
export async function unsubscribePush(): Promise<string | undefined> {
  if (!supported()) return undefined
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return undefined
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}
