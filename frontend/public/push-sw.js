// Service worker de Web Push, inyectado en el SW autogenerado por
// vite-plugin-pwa vía `workbox.importScripts` (ver frontend/vite.config.ts).
// Código plano, sin bundling: se sirve tal cual desde /push-sw.js.
//
// Alcance: solo los eventos que ya pasan por notification_service.py en el
// backend (reportes de incidencias, menciones en notas). El payload que
// manda el backend tiene forma { title, body, url, tag }.

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }

  const { title, body, url, tag } = payload

  event.waitUntil(
    (async () => {
      // Si alguna pestaña ya tiene foco, el usuario ya se entera por el
      // WebSocket / toast en la app abierta: mostrar el push ahí sería
      // duplicar el aviso.
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const hasFocusedClient = clientList.some((client) => client.focused === true)
      if (hasFocusedClient) return

      await self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        tag: tag || 'push-generico',
        data: { url },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existingClient = clientList[0]

      if (existingClient) {
        await existingClient.focus()
        if (url) existingClient.postMessage({ type: 'push-navigate', url })
        return
      }

      if (url) await self.clients.openWindow(url)
    })()
  )
})
