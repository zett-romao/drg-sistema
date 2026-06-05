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
//      function meuTenant(t){ return authed() && request.auth.token.tenantId == t; }  // MT-3
//      // MT-4: a RAIZ é do revendedor — token COM tenantId (cliente) é barrado aqui;
//      // só acessa o que estiver sob tenants/{t}. isRoot() = token sem tenantId.
//      function isRoot()   { return request.auth.token.tenantId == null; }
//      function isOperator(){ return authed() && request.auth.token.role == 'operator'; }
//      function rAuthed()  { return authed()  && isRoot(); }   // versões da RAIZ
//      function rColab()   { return isColab() && isRoot(); }
//      function rStaff()   { return isStaff() && isRoot(); }
//
//      // só-servidor (Worker bypassa via conta de serviço)
//      match /mfa/{d}            { allow read, write: if false; }
//      match /users/{d}          { allow read, write: if false; }
//      match /users/{d}/{r=**}   { allow read, write: if false; }
//
//      // folha: staff total; colaborador lê/cria/atualiza só a PRÓPRIA, e só campos de ponto/conferência
//      match /payrolls/{id} {
//        allow read:   if rStaff() || (rColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if rStaff() || (rColab()
//                         && request.resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.keys().hasOnly(['id','employeeId','mes','ano','pontoManualDias','updatedAt','createdAt']));
//        allow update: if rStaff() || (rColab()
//                         && resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
//                              ['pontoManualDias','updatedAt','createdAt','envioConferencia',
//                               'holeriteConferencia','holeriteAssinatura','assinatura',
//                               'holeriteContestacao','contestacao']));
//        allow delete: if rStaff();
//      }
//
//      // documentos enviados pelo app: colaborador cria os próprios (pendente) e lê os próprios
//      match /documentos/{id} {
//        allow read:   if rStaff() || (rColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if rStaff() || (rColab()
//                         && request.resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.status == 'pendente');
//        allow update, delete: if rStaff();
//      }
//      // atestados: idem documentos
//      match /atestados/{id} {
//        allow read:   if rStaff() || (rColab() && resource.data.employeeId == request.auth.token.empId);
//        allow create: if rStaff() || (rColab() && request.resource.data.employeeId == request.auth.token.empId);
//        allow update, delete: if rStaff();
//      }
//
//      // comunicações (broadcast): todos leem; colaborador só altera reações/lida
//      match /comunicacoes/{id} {
//        allow read:           if rAuthed();
//        allow create, delete: if rStaff();
//        allow update:         if rStaff() || (rColab()
//                                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reacoes','lida','lidaEm']));
//      }
//
//      // pagamentos: colaborador lê os próprios; só staff grava
//      match /solicitacoesPagamento/{id} {
//        allow read:  if rStaff() || (rColab() && resource.data.employeeId == request.auth.token.empId);
//        allow write: if rStaff();
//      }
//
//      // autorizações de ponto: colaborador cria/cancela/expira o PRÓPRIO pedido; só
//      // STAFF (supervisor com permissão) aprova (status 'autorizada'/'recusada').
//      // Colaborador NÃO pode auto-aprovar (antes update:authed() permitia o bypass). #fix-autoriza
//      match /autorizacoesPonto/{id} {
//        allow read:   if rAuthed();
//        allow create: if rStaff() || (rColab() && request.resource.data.employeeId == request.auth.token.empId);
//        allow update: if rStaff() || (rColab()
//                         && resource.data.employeeId == request.auth.token.empId
//                         && request.resource.data.status in ['cancelada','expirada']);
//        allow delete: if rStaff();
//      }
//
//      // recibos enviados: SÓ staff. O link público #/recibo/<token> agora é
//      // servido pelo Worker (/recibo-publico, via conta de serviço) — não há
//      // mais leitura anônima direta. Frente C, etapa 5.
//      match /holeritesEnviados/{id}        { allow read, write: if rStaff(); }
//      match /{p=**}/holeritesEnviados/{id} { allow read: if rStaff(); }   // collectionGroup (só raiz; tenant lê o próprio subcol direto)
//
//      // log de acesso: append-only
//      match /accessLog/{id} {
//        allow read:           if rStaff();
//        allow create:         if rAuthed();
//        allow update, delete: if false;
//      }
//
//      // cadastro: colaborador lê SÓ o próprio; staff total
//      match /employees/{id} {
//        allow read:  if rStaff() || (rColab() && id == request.auth.token.empId);
//        allow write: if rStaff();
//      }
//
//      // demais coleções de GESTÃO (escalas, cct, postos, ferias, rescisoes,
//      // decimoTerceiro, bancoHoras, contratos, disciplina, rubricas, perfis,
//      // saidas, atrasos, usoIA, operator, config...) — SÓ staff DA RAIZ (revendedor).
//      // 'tenants' SAIU daqui (MT-3). MT-4: rStaff() barra token COM tenantId — um
//      // cliente NÃO alcança operator/* (lista/cobranças) nem dados da raiz.
//      match /{col}/{id} {
//        allow read, write: if rStaff()
//          && !(col in ['mfa','users','tenants','payrolls','documentos','atestados','comunicacoes',
//                       'solicitacoesPagamento','autorizacoesPonto','holeritesEnviados','accessLog','employees']);
//      }
//      match /{col}/{id}/{rest=**} {
//        allow read, write: if rStaff() && col != 'mfa' && col != 'users' && col != 'tenants';
//      }
//
//      // ===================== MT-3: ISOLAMENTO MULTI-TENANT =====================
//      // Dado de cada cliente vive em tenants/{t}/<coleção>. TUDO aqui exige
//      // meuTenant(t) (token.tenantId == t) — espelha as regras da raiz por dentro.
//      // Operador (sem tenantId no token) e staff de OUTRO tenant NÃO passam.
//      // O Worker (conta de serviço) bypassa as regras p/ criar/migrar tenants.
//      match /tenants/{t} {
//        allow read:  if isStaff() && meuTenant(t);   // metadata do tenant: staff do próprio tenant
//        allow write: if false;                       // cria/edita só via Worker (conta de serviço)
//
//        match /payrolls/{id} {
//          allow read:   if meuTenant(t) && (isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId));
//          allow create: if meuTenant(t) && (isStaff() || (isColab()
//                           && request.resource.data.employeeId == request.auth.token.empId
//                           && request.resource.data.keys().hasOnly(['id','employeeId','mes','ano','pontoManualDias','updatedAt','createdAt'])));
//          allow update: if meuTenant(t) && (isStaff() || (isColab()
//                           && resource.data.employeeId == request.auth.token.empId
//                           && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
//                                ['pontoManualDias','updatedAt','createdAt','envioConferencia',
//                                 'holeriteConferencia','holeriteAssinatura','assinatura',
//                                 'holeriteContestacao','contestacao'])));
//          allow delete: if meuTenant(t) && isStaff();
//        }
//        match /documentos/{id} {
//          allow read:   if meuTenant(t) && (isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId));
//          allow create: if meuTenant(t) && (isStaff() || (isColab()
//                           && request.resource.data.employeeId == request.auth.token.empId
//                           && request.resource.data.status == 'pendente'));
//          allow update, delete: if meuTenant(t) && isStaff();
//        }
//        match /atestados/{id} {
//          allow read:   if meuTenant(t) && (isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId));
//          allow create: if meuTenant(t) && (isStaff() || (isColab() && request.resource.data.employeeId == request.auth.token.empId));
//          allow update, delete: if meuTenant(t) && isStaff();
//        }
//        match /comunicacoes/{id} {
//          allow read:           if meuTenant(t) && authed();
//          allow create, delete: if meuTenant(t) && isStaff();
//          allow update:         if meuTenant(t) && (isStaff() || (isColab()
//                                  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reacoes','lida','lidaEm'])));
//        }
//        match /solicitacoesPagamento/{id} {
//          allow read:  if meuTenant(t) && (isStaff() || (isColab() && resource.data.employeeId == request.auth.token.empId));
//          allow write: if meuTenant(t) && isStaff();
//        }
//        match /autorizacoesPonto/{id} {
//          allow read:   if meuTenant(t) && authed();
//          allow create: if meuTenant(t) && (isStaff() || (isColab() && request.resource.data.employeeId == request.auth.token.empId));
//          allow update: if meuTenant(t) && (isStaff() || (isColab()
//                           && resource.data.employeeId == request.auth.token.empId
//                           && request.resource.data.status in ['cancelada','expirada']));
//          allow delete: if meuTenant(t) && isStaff();
//        }
//        match /holeritesEnviados/{id} { allow read, write: if meuTenant(t) && isStaff(); }
//        match /accessLog/{id} {
//          allow read:           if meuTenant(t) && isStaff();
//          allow create:         if meuTenant(t) && authed();
//          allow update, delete: if false;
//        }
//        match /employees/{id} {
//          allow read:  if meuTenant(t) && (isStaff() || (isColab() && id == request.auth.token.empId));
//          allow write: if meuTenant(t) && isStaff();
//        }
//        // só-servidor dentro do tenant
//        match /mfa/{d}          { allow read, write: if false; }
//        match /users/{d}        { allow read, write: if false; }
//        match /users/{d}/{r=**} { allow read, write: if false; }
//        // demais coleções de gestão do tenant — só staff DO tenant
//        match /{col}/{id} {
//          allow read, write: if meuTenant(t) && isStaff()
//            && !(col in ['mfa','users','payrolls','documentos','atestados','comunicacoes',
//                         'solicitacoesPagamento','autorizacoesPonto','holeritesEnviados','accessLog','employees']);
//        }
//        match /{col}/{id}/{rest=**} {
//          allow read, write: if meuTenant(t) && isStaff() && col != 'mfa' && col != 'users';
//        }
//      }
//      // =================== fim MT-3 ===================
//    }
//  }
//
//  STORAGE — Storage → Regras → Publicar:
//
//  ⚠️ MT-3 NÃO isola o Storage. Os caminhos do app são PLANOS (employees/{empId}/...,
//  atestados/{empId}/..., etc.) — NÃO há prefixo de tenant. Isolar o Storage exige
//  ANTES prefixar os caminhos com tenants/{t}/ em TODAS as chamadas do app.js/ponto.html
//  (DB.storage.ref) e só então adicionar regras tenants/{t}/... no Storage. Passo à parte
//  (MT-3b/Storage). Até lá, no modo tenant, arquivos ficam isolados só por empId/role,
//  NÃO por tenant. Sem live tenants, sem exposição hoje. #multitenant-storage-gap
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
