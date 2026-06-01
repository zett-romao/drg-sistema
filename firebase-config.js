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
//  REGRAS DE SEGURANÇA — S3-C/D (Frente B) — atualizadas em 2026-06-01
// ================================================================
//  MODELO DE PAPÉIS (custom claims no token, mintados pelo Worker drg-aprovacao):
//   - Gestor   (/login):         { role: 'master'|'operador'|'p_<perfil>'|'', drg:true }
//   - Colaborador (/ponto-login): { role: 'colaborador', empId:<id>, drg:true }
//   - Operador (/operator-login): { role: 'operator', drg:true }
//   → TODO token legítimo tem `drg:true`. Anônimo NÃO tem (só sobra no link
//     público de recibo #/recibo/<token>, que lê apenas `holeritesEnviados`).
//
//  PRINCÍPIO: staff (drg:true e role != 'colaborador') faz a gestão; o
//  colaborador só acessa os PRÓPRIOS dados e só grava os campos do app de
//  ponto/conferência. `mfa` e `users` continuam SÓ-SERVIDOR (Worker via conta
//  de serviço bypassa as regras). Produção roda em modo RAIZ (tenantId null).
//
//  ⚠️ RESÍDUO conhecido: o link público de recibo lê `holeritesEnviados` com
//  sessão anônima (segurança = token secreto na URL). Endurecer depois roteando
//  pelo Worker (Frente C). As regras abaixo NÃO pioram isso — só restringem.
//
//  ⚠️ PUBLICAR COM CUIDADO: testar no SIMULADOR antes (casos no chat da sessão),
//  publicar, e logo conferir login do gestor + 1 batida de ponto de colaborador.
//  Se travar, reverter pras regras anteriores (git mostra o bloco antigo).
//
//  FIRESTORE — Firestore Database → Regras → Publicar:
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//      function authed()   { return request.auth != null && request.auth.token.drg == true; }
//      function isColab()  { return authed() && request.auth.token.role == 'colaborador'; }
//      function isStaff()  { return authed() && request.auth.token.role != 'colaborador'; }
//      function meuEmp(id) { return request.auth.token.empId == id; }
//
//      // só-servidor (Worker bypassa via conta de serviço)
//      match /mfa/{d}            { allow read, write: if false; }
//      match /users/{d}          { allow read, write: if false; }
//      match /users/{d}/{r=**}   { allow read, write: if false; }
//
//      // folha: staff total; colaborador lê/cria/atualiza só a PRÓPRIA, e só campos de ponto/conferência
//      match /payrolls/{id} {
//        allow read:   if isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if isStaff() || (isColab()
//                         && request.resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.keys().hasOnly(['id','employeeId','mes','ano','pontoManualDias','updatedAt','createdAt']));
//        allow update: if isStaff() || (isColab()
//                         && resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
//                              ['pontoManualDias','updatedAt','createdAt','envioConferencia',
//                               'holeriteConferencia','holeriteAssinatura','assinatura',
//                               'holeriteContestacao','contestacao']));
//        allow delete: if isStaff();
//      }
//
//      // documentos enviados pelo app: colaborador cria os próprios (pendente) e lê os próprios
//      match /documentos/{id} {
//        allow read:   if isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if isStaff() || (isColab()
//                         && request.resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.status == 'pendente');
//        allow update, delete: if isStaff();
//      }
//      // atestados: idem documentos
//      match /atestados/{id} {
//        allow read:   if isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if isStaff() || (isColab() && request.resource.data.employeeId == request.auth.token.empId);
//        allow update, delete: if isStaff();
//      }
//
//      // comunicações (broadcast): todos leem; colaborador só altera reações/lida
//      match /comunicacoes/{id} {
//        allow read:           if authed();
//        allow create, delete: if isStaff();
//        allow update:         if isStaff() || (isColab()
//                                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reacoes','lida','lidaEm']));
//      }
//
//      // pagamentos: colaborador lê os próprios; só staff grava
//      match /solicitacoesPagamento/{id} {
//        allow read:  if isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId);
//        allow write: if isStaff();
//      }
//
//      // autorizações de ponto (pedido do colaborador / liberação do supervisor)
//      match /autorizacoesPonto/{id} {
//        allow read, create, update: if authed();
//        allow delete:               if isStaff();
//      }
//
//      // recibos enviados: leitura PÚBLICA por token (link #/recibo/...) — staff grava
//      match /holeritesEnviados/{id}          { allow read: if request.auth != null; allow write: if isStaff(); }
//      match /{p=**}/holeritesEnviados/{id}   { allow read: if request.auth != null; } // collectionGroup
//
//      // log de acesso: append-only
//      match /accessLog/{id} {
//        allow read:           if isStaff();
//        allow create:         if authed();
//        allow update, delete: if false;
//      }
//
//      // cadastro: colaborador lê SÓ o próprio; staff total
//      match /employees/{id} {
//        allow read:  if isStaff() || (isColab() && id == request.auth.token.empId);
//        allow write: if isStaff();
//      }
//
//      // demais coleções de GESTÃO (escalas, cct, postos, ferias, rescisoes,
//      // decimoTerceiro, bancoHoras, contratos, disciplina, rubricas, perfis,
//      // saidas, atrasos, usoIA, operator, config, tenants...) — SÓ staff
//      match /{col}/{id} {
//        allow read, write: if isStaff()
//          && !(col in ['mfa','users','payrolls','documentos','atestados','comunicacoes',
//                       'solicitacoesPagamento','autorizacoesPonto','holeritesEnviados','accessLog','employees']);
//      }
//      match /{col}/{id}/{rest=**} {
//        allow read, write: if isStaff() && col != 'mfa' && col != 'users';
//      }
//    }
//  }
//
//  STORAGE — Storage → Regras → Publicar:
//
//  rules_version = '2';
//  service firebase.storage {
//    match /b/{bucket}/o {
//      function authed()   { return request.auth != null && request.auth.token.drg == true; }
//      function isColab()  { return authed() && request.auth.token.role == 'colaborador'; }
//      function isStaff()  { return authed() && request.auth.token.role != 'colaborador'; }
//      function meuEmp(id) { return request.auth.token.empId == id; }
//
//      // uploads do colaborador — só na PRÓPRIA pasta
//      match /documentos/{empId}/{p=**} { allow read, write: if isStaff() || (isColab() && meuEmp(empId)); }
//      match /atestados/{empId}/{p=**}  { allow read, write: if isStaff() || (isColab() && meuEmp(empId)); }
//
//      // foto, saídas, atrasos — só staff (gestor)
//      match /employees/{empId}/{p=**}  { allow read, write: if isStaff(); }
//      match /saidas/{empId}/{p=**}     { allow read, write: if isStaff(); }
//      match /atrasos/{empId}/{p=**}    { allow read, write: if isStaff(); }
//
//      // anexos de comunicação — staff grava, qualquer logado lê (app do colaborador)
//      match /comunicacoes/{p=**} { allow read: if authed(); allow write: if isStaff(); }
//
//      // disciplina, contratos e tudo mais — só staff
//      match /disciplina/{p=**} { allow read, write: if isStaff(); }
//      match /contratos/{p=**}  { allow read, write: if isStaff(); }
//      match /{allPaths=**}     { allow read, write: if isStaff(); }
//    }
//  }
// ================================================================
