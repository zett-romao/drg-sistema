// ============================================================
// DRG Ponto Eletronico — Service Worker
// Estrategia: network-first para HTML/JS/CSS (sempre busca versao
// nova), cache-first para imagens/assets estaticos.
// ============================================================
const CACHE = 'drg-ponto-v28-20260528a';
const ASSETS = [
  'ponto.html',
  'ponto-manifest.json',
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

  // Nunca cacheia requests do Firebase (precisam de rede sempre)
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first para HTML/JS/CSS — evita servir versao velha
  // Se a rede falhar (offline), usa cache como fallback.
  const isHtmlOrCode = url.endsWith('.html') ||
                       url.endsWith('.js') ||
                       url.endsWith('.css') ||
                       url.endsWith('.json');
  if (isHtmlOrCode) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          // Atualiza cache em background com a resposta nova
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

  // Cache-first para imagens e outros assets estaticos
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
