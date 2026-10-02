/* mCare service worker: shows push notifications, and opens mCare when one is tapped.
   It does not cache the app or its data: a medical record is always read fresh. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'mCare', body: event.data ? event.data.text() : '' } }
  const title = data.title || 'mCare'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: new URL('brand/mcare-logo.png', self.registration.scope).href,
    badge: new URL('brand/mcare-logo.png', self.registration.scope).href,
    tag: data.urgent ? undefined : 'mcare',
    renotify: !!data.urgent,
    requireInteraction: !!data.urgent,
    data: { link: data.link || '' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const scope = self.registration.scope
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const mine = open.find(c => c.url.startsWith(scope))
    if (mine) return mine.focus()
    return self.clients.openWindow(scope)
  })())
})
