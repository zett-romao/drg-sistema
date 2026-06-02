// push-sw.js — Service Worker SÓ para Web Push do Monitor de Faltas (robô 24h).
// NÃO faz cache (não intercepta fetch) — não afeta o cache do app principal. #monitor-faltas-cron
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let titulo = 'DRG-Kronos — Faltas';
  let corpo  = 'Há colaborador(es) sem entrada batida. Abra o Monitor de Faltas.';
  try { if (event.data) { const d = event.data.json(); if (d && d.title) titulo = d.title; if (d && d.body) corpo = d.body; } } catch (_) {}
  event.waitUntil(self.registration.showNotification(titulo, {
    body: corpo,
    tag: 'drg-faltas',
    renotify: true,
    requireInteraction: true,
    data: { url: './index.html' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('index.html') && 'focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
