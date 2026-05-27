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
//  REGRAS DE SEGURANÇA — atualizadas em 2026-05-27 (cole "documentos")
// ================================================================
//  Exige autenticação E bloqueia o cliente nas coleções só-servidor
//  `mfa` (segredos de 2FA) e `users` (login/hashes). Essas duas são
//  acessadas APENAS pelo Worker drg-aprovacao, via conta de serviço.
//
//  A coleção `documentos` (envio de documentos pelo app do colaborador):
//  o colaborador (sessão anônima de ponto.html) só pode CRIAR — com
//  validação de campos. Ler/aprovar/recusar/apagar é restrito a sessão
//  não-anônima (gestor, via custom token do Worker drg-aprovacao).
//
//  FIRESTORE — Firestore Database → Regras → Publicar:
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//
//      // documentos: anônimo cria com validação, gestor (não-anon) faz o resto
//      match /documentos/{docId} {
//        allow create: if request.auth != null
//          && request.resource.data.status == 'pendente'
//          && request.resource.data.origem == 'app'
//          && request.resource.data.employeeId is string
//          && request.resource.data.employeeId.size() > 0
//          && request.resource.data.tipo is string
//          && request.resource.data.arquivoUrl is string;
//        allow read, update, delete: if request.auth != null
//          && request.auth.token.firebase.sign_in_provider != 'anonymous';
//      }
//
//      // catch-all — exclui mfa, users e documentos (esta última tem regra própria acima)
//      match /{col}/{docId} {
//        allow read, write: if request.auth != null
//          && col != 'mfa' && col != 'users' && col != 'documentos';
//      }
//      match /{col}/{docId}/{rest=**} {
//        allow read, write: if request.auth != null
//          && col != 'mfa' && col != 'users' && col != 'documentos';
//      }
//    }
//  }
//
//  STORAGE — Storage → Regras → Publicar:
//
//  rules_version = '2';
//  service firebase.storage {
//    match /b/{bucket}/o {
//
//      // documentos/**: anônimo escreve (upload do app), leitura só não-anon
//      // (URL devolvida por getDownloadURL tem token e funciona mesmo assim)
//      match /documentos/{path=**} {
//        allow write: if request.auth != null;
//        allow read:  if request.auth != null
//          && request.auth.token.firebase.sign_in_provider != 'anonymous';
//      }
//
//      // resto: aberto pra qualquer auth (S3 endurece o resto)
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
