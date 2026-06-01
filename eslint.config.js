// ============================================================
// "Camada 3" da blindagem — pega REFERÊNCIA A FUNÇÃO/VARIÁVEL QUE NÃO EXISTE
// (no-undef) ANTES de publicar. O `node -c` só pega erro de sintaxe; foi um
// "esc is not defined" que travou o app no passado — é isto que esta checagem evita.
// Roda no GitHub Actions (nuvem) — node_modules NUNCA entra na pasta do Drive. #camada3
// ============================================================
const globals = require('globals');

// Globais que vêm de FORA do app.js (não são erro):
//  - libs via CDN (index.html)  - firebase-config.js  - blindagem inline (index.html)
const externos = {
  firebase: 'readonly',           // firebase-*-compat.js (CDN)
  FIREBASE_CONFIG: 'readonly',    // firebase-config.js
  JSZip: 'readonly',              // jszip (CDN)
  pdfjsLib: 'readonly',           // pdf.js (CDN)
  QRCode: 'readonly', qrcode: 'readonly',   // qrcode (CDN)
  __APP_BOOTED: 'writable', __APP_ERRORS: 'writable',  // blindagem (#blindagem-erro)
};

module.exports = [
  {
    // App do gestor — script clássico (funções no topo viram globais; sem import/export)
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...externos },
    },
    rules: {
      'no-undef': 'error',       // <- o coração: variável/função que não existe
      'no-dupe-keys': 'error',   // chave duplicada em objeto
      'no-dupe-args': 'error',
      'no-func-assign': 'error',
      'no-unreachable': 'warn',
    },
  },
  {
    // Service worker do app de ponto — globais próprios (self, caches, clients...)
    files: ['ponto-sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error' },
  },
];
