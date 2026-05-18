// ================================================================
//  CONFIGURAÇÃO DO FIREBASE — D.R. Global Sistema de Gestão
// ================================================================
//
//  PASSO A PASSO PARA CONFIGURAR:
//
//  1. Acesse https://console.firebase.google.com
//  2. Clique "Criar um projeto" → nome: drg-sistema → Continuar
//  3. Desative Google Analytics → Criar projeto
//  4. Menu lateral → "Firestore Database" → "Criar banco de dados"
//     → "Iniciar no modo de produção" → Região: southamerica-east1
//  5. Menu lateral → Engrenagem ⚙ → "Configurações do projeto"
//  6. Role até "Seus apps" → clique em </> (Adicionar app Web)
//  7. Dê um apelido (ex: drg-web) → Registrar app
//  8. Copie os valores do objeto firebaseConfig e cole abaixo
//
// ================================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDnIGSx-TkCeD3RKOj7LVrOpbzrmU_dCq8",
  authDomain:        "drg-sistema.firebaseapp.com",
  projectId:         "drg-sistema",
  storageBucket:     "drg-sistema.firebasestorage.app",
  messagingSenderId: "763740165429",
  appId:             "1:763740165429:web:6dc8a6aa8a873d95f9287c"
};

// Inicializa o Firebase imediatamente (idempotente — só inicializa se ainda não foi).
// Necessário para páginas como ponto.html que usam firebase.firestore() direto,
// sem passar pelo DB.init() do app.js.
if (typeof firebase !== 'undefined' && firebase.apps && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

// ================================================================
//  REGRAS DE SEGURANÇA — atualizadas em 2026-05-17 (migração S2-B2)
// ================================================================
//  Exige autenticação E bloqueia o cliente nas coleções só-servidor
//  `mfa` (segredos de 2FA) e `users` (login/hashes). Essas duas são
//  acessadas APENAS pelo Worker drg-aprovacao, via conta de serviço.
//
//  FIRESTORE — Firestore Database → Regras → Publicar:
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//      match /{col}/{docId} {
//        allow read, write: if request.auth != null && col != 'mfa' && col != 'users';
//      }
//      match /{col}/{docId}/{rest=**} {
//        allow read, write: if request.auth != null && col != 'mfa' && col != 'users';
//      }
//    }
//  }
//
//  STORAGE — Storage → Regras → Publicar:
//
//  rules_version = '2';
//  service firebase.storage {
//    match /b/{bucket}/o {
//      match /{allPaths=**} {
//        allow read, write: if request.auth != null;
//      }
//    }
//  }
//
//  NOTA: a Etapa S3 vai endurecer ainda mais — bloquear sessão anônima
//  nas demais coleções (employees, payrolls...) e rotear o app de ponto
//  pelo Worker. Storage também será endurecido na S3.
// ================================================================
