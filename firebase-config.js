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
  apiKey:            "AIzaSyDnIGSx-TkCeD3RKOj7LVzOpbzrmU_dCq8",
  authDomain:        "drg-sistema.firebaseapp.com",
  projectId:         "drg-sistema",
  storageBucket:     "drg-sistema.firebasestorage.app",
  messagingSenderId: "763740165429",
  appId:             "1:763740165429:web:6dc8a6aa8a873d95f9287c"
};

// ================================================================
//  REGRAS DE SEGURANÇA DO FIRESTORE
// ================================================================
//  Após configurar, vá em Firestore → Regras e cole o seguinte:
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//      match /{document=**} {
//        allow read, write: if true;
//      }
//    }
//  }
//
//  Depois de publicar no Netlify, restrinja a chave de API:
//  Google Cloud Console → APIs e serviços → Credenciais
//  → clique na sua API Key → Restrições de aplicativo
//  → Sites HTTP → adicione: https://SEU-SITE.netlify.app/*
// ================================================================
