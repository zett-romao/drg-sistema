// push-sup-sw.js — Service Worker SÓ para Web Push do app do Supervisor.
// NÃO faz cache (não intercepta fetch) — não afeta o supervisor-sw.js. #janela-notif
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let titulo = 'DRG Supervisor — Novo pedido';
  let corpo  = 'Um colaborador pediu autorização de ponto. Abra o app para liberar.';
  try { if (event.data) { const d = event.data.json(); if (d && d.title) titulo = d.title; if (d && d.body) corpo = d.body; } } catch (_) {}
  event.waitUntil(self.registration.showNotification(titulo, {
    body: corpo,
    tag: 'drg-pedido',
    renotify: true,
    requireInteraction: true,
    data: { url: './supervisor.html' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './supervisor.html';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('supervisor.html') && 'focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
