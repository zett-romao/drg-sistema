// ================================================================
//  CONFIGURAÇÃO DO FIREBASE — DRG-Kronos 3.0
// ================================================================
//
//  ATENÇÃO: Preencha os valores abaixo com as credenciais do
//  projeto Firebase criado para este cliente.
//
//  Como obter os valores:
//  1. Acesse https://console.firebase.google.com
//  2. Abra o projeto do cliente
//  3. Engrenagem ⚙ → Configurações do projeto
//  4. Role até "Seus apps" → seção Web
//  5. Copie os valores do objeto firebaseConfig
//
//  Consulte o Manual de Implantação para o passo a passo completo.
//
// ================================================================

const FIREBASE_CONFIG = {
  apiKey:            "COLE_AQUI_A_API_KEY",
  authDomain:        "COLE_AQUI.firebaseapp.com",
  projectId:         "COLE_AQUI_O_PROJECT_ID",
  storageBucket:     "COLE_AQUI.firebasestorage.app",
  messagingSenderId: "COLE_AQUI_O_MESSAGING_SENDER_ID",
  appId:             "COLE_AQUI_O_APP_ID"
};

// Inicialização idempotente do Firebase
if (typeof firebase !== 'undefined' && firebase.apps && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
