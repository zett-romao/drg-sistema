// ============================================================
// DRG Supervisor — Service Worker
// Estrategia identica ao ponto-sw.js: network-first para HTML/JS/CSS
// (busca sempre a versao nova), cache-first para imagens.
// ============================================================
const CACHE = 'drg-sup-v3-20260523c';
const ASSETS = [
  'supervisor.html',
  'supervisor-manifest.json',
  'firebase-config.js',
  'logo.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Firebase: sempre rede (precisa realtime)
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first para HTML/JS/CSS — evita servir versao velha
  const isHtmlOrCode = url.endsWith('.html') ||
                       url.endsWith('.js') ||
                       url.endsWith('.css') ||
                       url.endsWith('.json');
  if (isHtmlOrCode) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first para imagens / assets estaticos
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
