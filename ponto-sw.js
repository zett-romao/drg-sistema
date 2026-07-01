// ============================================================
// DRG Ponto Eletronico — Service Worker
// Estrategia:
//  - APIs ao vivo do Firebase/Google (Firestore, Auth, token) → rede-apenas
//    (offline falham de boa; o Firestore tem cache proprio em IndexedDB).
//  - SDK do Firebase (gstatic, versionado/imutavel) + firebase-config → cache-first
//    (PRECISAM carregar offline, senao o app nem inicializa). #ponto-offline
//  - HTML/JS/CSS/JSON do app → network-first (pega versao nova; offline cai no cache).
//  - Imagens/estaticos → cache-first.
// ============================================================
const CACHE = 'drg-ponto-v64-20260701a-ferias-assinatura';

// Essenciais do mesmo dominio — o install FALHA se algum nao baixar (intencional).
const ASSETS = [
  'ponto.html',
  'ponto-manifest.json',
  'firebase-config.js',
  'logo.png'
];
// SDK do Firebase (cross-origin gstatic) — precache best-effort: nao derruba o
// install se a rede falhar no momento. Em runtime tambem e cache-first.
const SDK = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);                              // mesmo dominio: tem que dar certo
    await Promise.allSettled(SDK.map(u => c.add(u)));    // SDK: best-effort
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // 1) APIs AO VIVO do Firebase/Google → SEMPRE rede (deixa o SDK lidar com offline;
  //    o Firestore guarda leitura/gravacao em IndexedDB e sincroniza ao reconectar).
  if (/(?:firestore|identitytoolkit|securetoken|fcmregistrations|firebaseinstallations)\.googleapis\.com/.test(url)
      || url.includes('fcm.googleapis.com')
      || url.includes('google.com/recaptcha')) {
    e.respondWith(fetch(req));
    return;
  }

  // 2) SDK do Firebase (gstatic, versionado) → cache-first (carrega offline).
  if (url.includes('gstatic.com/firebasejs')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(resp => {
        if (resp && resp.status === 200) { const cl = resp.clone(); caches.open(CACHE).then(c => c.put(req, cl)); }
        return resp;
      }))
    );
    return;
  }

  // 3) HTML/JS/CSS/JSON do app → network-first (versao nova); offline cai no cache.
  //    ignoreSearch p/ casar mesmo com ?v=... (firebase-config.js?v=, etc.).
  const isHtmlOrCode = url.includes('.html') || url.includes('.js') ||
                       url.includes('.css')  || url.includes('.json');
  if (isHtmlOrCode) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp && resp.status === 200) { const cl = resp.clone(); caches.open(CACHE).then(c => c.put(req, cl)); }
          return resp;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // 4) Imagens e outros estaticos → cache-first.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req))
  );
});
