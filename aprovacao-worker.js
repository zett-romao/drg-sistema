/**
 * aprovacao-worker.js — DRG-Kronos
 * ============================================================
 * Worker de SEGURANÇA: 2FA (TOTP) e Aprovação de Pagamentos.
 * É a "trava real" — verifica identidade + 2FA NO SERVIDOR.
 *
 * DEPLOY no Cloudflare Workers:
 *   1. Workers & Pages → Create application → Create Worker
 *   2. Nome: "drg-aprovacao"  → Deploy
 *   3. Edit code → cole ESTE arquivo inteiro → Save and deploy
 *   4. Settings → Variables and Secrets → Add → tipo "Secret":
 *        Nome:  FIREBASE_SERVICE_ACCOUNT
 *        Valor: cole o CONTEÚDO INTEIRO do JSON da conta de serviço
 *   5. Deploy de novo
 *   URL resultante: https://drg-aprovacao.zett-romao.workers.dev
 *
 * Rotas (todas POST, corpo JSON):
 *   /mfa/enroll        { idToken }                      → gera segredo TOTP novo
 *   /mfa/confirm       { idToken, code }                → ativa o 2FA validando 1 código
 *   /mfa/status        { idToken }                      → diz se o 2FA está ativo
 *   /aprovar-pagamento { idToken, code, solicitacaoId } → valida 2FA + permissão e dispara o PIX
 *   /recuperar-acesso  { code }                         → [PÚBLICA] reseta o master se o código bater
 *   /login             { username, password }           → [PÚBLICA] verifica a senha e devolve custom token
 *   /ponto-login       { matricula, pin }               → [PÚBLICA] valida colaborador e devolve custom token (role: colaborador)
 *   /operator-login    { password }                     → [PÚBLICA] valida a senha do Painel do Operador e devolve custom token (role: operator)
 *   /tenant-cadastrar  { nome, cnpj, tipo, responsavel, usuario, senha } → [PÚBLICA] cria tenant trial 30 dias
 *   /usuarios/listar       { idToken }                          → [master] lista usuários (sem hash)
 *   /usuarios/salvar       { idToken, user, novaSenha? }        → [master] cria/edita usuário
 *   /usuarios/excluir      { idToken, id }                      → [master] exclui usuário
 *   /usuarios/trocar-senha { idToken, currentPassword, newPassword } → troca a própria senha
 *
 * SECRETS no Cloudflare (Settings → Variables and Secrets):
 *   FIREBASE_SERVICE_ACCOUNT  → JSON da conta de serviço
 *   RECOVERY_CODE             → código secreto de recuperação do master
 *   ASAAS_API_KEY             → chave da API Asaas de PRODUÇÃO ($aact_...)
 * ============================================================
 */

const PROJECT_ID   = 'drg-sistema';
const TOKEN_ISSUER = 'https://securetoken.google.com/' + PROJECT_ID;
const JWK_URL      = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FS_BASE      = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const ORIGINS_OK   = ['https://zett-romao.github.io', 'http://localhost', 'http://127.0.0.1'];
const ASAAS_WORKER = 'https://drg-asaas.zett-romao.workers.dev';

// ── CORS / resposta ──────────────────────────────────────────
function corsHeaders(origin){
  const allow = ORIGINS_OK.some(o => (origin||'').startsWith(o)) ? origin : ORIGINS_OK[0];
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(obj, status, origin){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── base64url ────────────────────────────────────────────────
function b64ToBytes(str){
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function bytesToB64url(bytes){
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Verificação do ID token do Firebase ─────────────────────
let _fbKeys = null;
async function getFirebaseKeys(){
  if (_fbKeys && _fbKeys.exp > Date.now()) return _fbKeys.map;
  const res  = await fetch(JWK_URL);
  const data = await res.json();
  const map  = {};
  for (const jwk of (data.keys || [])) {
    map[jwk.kid] = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  const m = (res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/);
  _fbKeys = { map, exp: Date.now() + (m ? +m[1] : 3600) * 1000 };
  return map;
}
async function verifyIdToken(idToken){
  if (!idToken) throw new Error('token ausente');
  const p = String(idToken).split('.');
  if (p.length !== 3) throw new Error('token malformado');
  const header  = JSON.parse(new TextDecoder().decode(b64ToBytes(p[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64ToBytes(p[1])));
  if (header.alg !== 'RS256') throw new Error('alg invalido');
  const key = (await getFirebaseKeys())[header.kid];
  if (!key) throw new Error('chave nao encontrada');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64ToBytes(p[2]),
    new TextEncoder().encode(p[0] + '.' + p[1]));
  if (!ok) throw new Error('assinatura invalida');
  const agora = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT_ID)   throw new Error('projeto invalido');
  if (payload.iss !== TOKEN_ISSUER) throw new Error('emissor invalido');
  if (!payload.sub || !payload.exp || payload.exp <= agora) throw new Error('token expirado');
  return { uid: payload.sub, email: payload.email || '', authTime: payload.auth_time || 0 };
}

// ── TOTP — RFC 6238 (Google Authenticator) ───────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes){
  let bits = 0, val = 0, out = '';
  for (const x of bytes) { val = (val << 8) | x; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(val >> bits) & 31]; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(s){
  s = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); } }
  return new Uint8Array(out);
}
async function totpAt(keyBytes, counter){
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 0x100000000));
  dv.setUint32(4, counter >>> 0);
  const k   = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, buf));
  const off = mac[19] & 15;
  const n   = ((mac[off] & 127) << 24) | (mac[off+1] << 16) | (mac[off+2] << 8) | mac[off+3];
  return String(n % 1000000).padStart(6, '0');
}
async function verifyTotp(secretB32, code){
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) return false;
  const key = base32Decode(secretB32);
  if (!key.length) return false;
  const passo = Math.floor(Date.now() / 1000 / 30);
  for (let d = -1; d <= 1; d++) { if (await totpAt(key, passo + d) === code) return true; }
  return false;
}

// ── Conta de serviço → access token (OAuth2) ─────────────────
let _accessToken = null;
async function getAccessToken(env){
  if (_accessToken && _accessToken.exp > Date.now() + 60000) return _accessToken.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT nao configurado');
  const sa  = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const enc = s => bytesToB64url(new TextEncoder().encode(s));
  const header = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = enc(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now, exp: now + 3600,
  }));
  const pemB64  = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const keyBytes = b64ToBytes(pemB64);
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = bytesToB64url(new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claim))));
  const jwt = header + '.' + claim + '.' + sig;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('falha OAuth: ' + (data.error_description || data.error || '?'));
  _accessToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return _accessToken.token;
}

// Gera um Firebase Custom Token (JWT assinado pela conta de serviço).
// O cliente troca por uma sessão real via signInWithCustomToken().
async function mintCustomToken(uid, claims, env){
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT nao configurado');
  const sa  = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const enc = s => bytesToB64url(new TextEncoder().encode(s));
  const header  = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = enc(JSON.stringify({
    iss:    sa.client_email,
    sub:    sa.client_email,
    aud:    'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat:    now,
    exp:    now + 3600,
    uid:    String(uid),
    claims: claims || {},
  }));
  const pemB64   = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8', b64ToBytes(pemB64), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = bytesToB64url(new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + payload))));
  return header + '.' + payload + '.' + sig;
}

// ── Firestore REST — conversão de valores ────────────────────
function toFsValue(v){
  if (v === null || v === undefined)     return { nullValue: null };
  if (typeof v === 'boolean')            return { booleanValue: v };
  if (typeof v === 'number')             return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')             return { stringValue: v };
  if (Array.isArray(v))                  return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object')             return { mapValue:   { fields: toFsFields(v) } };
  return { stringValue: String(v) };
}
function toFsFields(obj){
  const f = {}; for (const k in obj) f[k] = toFsValue(obj[k]); return f;
}
function fromFsValue(v){
  if (!v) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue'       in v) return fromFsFields(v.mapValue.fields || {});
  return null;
}
function fromFsFields(fields){
  const o = {}; for (const k in fields) o[k] = fromFsValue(fields[k]); return o;
}
async function fsGetDoc(path, token){
  const res = await fetch(FS_BASE + '/' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore GET ' + res.status);
  const doc = await res.json();
  return fromFsFields(doc.fields || {});
}
async function fsSetDoc(path, obj, token){
  const res = await fetch(FS_BASE + '/' + path, {
    method:  'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: toFsFields(obj) }),
  });
  if (!res.ok) throw new Error('Firestore PATCH ' + res.status + ' ' + (await res.text()));
  return true;
}
// PATCH parcial — atualiza SÓ os campos passados (updateMask), preserva o resto do doc.
async function fsUpdate(path, obj, token){
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const res  = await fetch(FS_BASE + '/' + path + '?' + mask, {
    method:  'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: toFsFields(obj) }),
  });
  if (!res.ok) throw new Error('Firestore UPDATE ' + res.status + ' ' + (await res.text()));
  return true;
}
// id curto único (mesmo formato do genId do app).
function genIdW(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,10); }
// Lista uma coleção inteira (1 página de 300 — suficiente para `users`).
async function fsListCollection(coll, token){
  const res = await fetch(FS_BASE + '/' + coll + '?pageSize=300', {
    headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Firestore list ' + res.status);
  const data = await res.json();
  return (data.documents || []).map(d => {
    const o = fromFsFields(d.fields || {});
    if (!o.id) { const p = d.name.split('/'); o.id = p[p.length - 1]; }
    return o;
  });
}
async function fsDeleteDoc(path, token){
  const res = await fetch(FS_BASE + '/' + path, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok && res.status !== 404) throw new Error('Firestore DELETE ' + res.status);
  return true;
}
// Busca o doc de `users` por username (login).
async function fsFindUserByUsername(username, token){
  const res = await fetch(FS_BASE + ':runQuery', {
    method:  'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ structuredQuery: {
      from:  [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'username' }, op: 'EQUAL',
               value: { stringValue: username } } },
      limit: 1,
    } }),
  });
  if (!res.ok) throw new Error('Firestore query ' + res.status);
  const rows = await res.json();
  for (const row of (rows || [])) if (row.document) {
    const o = fromFsFields(row.document.fields || {});
    if (!o.id) { const p = row.document.name.split('/'); o.id = p[p.length - 1]; }
    return o;
  }
  return null;
}
// Busca o doc de `users` cujo firebaseUid casa com o uid do token.
async function fsFindUser(uid, token){
  const res = await fetch(FS_BASE + ':runQuery', {
    method:  'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ structuredQuery: {
      from:  [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'firebaseUid' }, op: 'EQUAL',
               value: { stringValue: uid } } },
      limit: 1,
    } }),
  });
  if (!res.ok) throw new Error('Firestore query ' + res.status);
  const rows = await res.json();
  for (const row of (rows || [])) if (row.document) return fromFsFields(row.document.fields || {});
  return null;
}

// ── Permissão / Asaas ────────────────────────────────────────
// true se o usuário pode APROVAR pagamentos (master, ou perfil com pagamentosAprovar).
async function temPermAprovar(user, token){
  const role = (user && user.role) || '';
  if (role === 'master')   return true;
  if (role === 'operador') return false;
  if (role.startsWith('p_')) {
    const perfil = await fsGetDoc('perfis/' + role.slice(2), token);
    return !!(perfil && perfil.modules && perfil.modules.pagamentosAprovar);
  }
  return false;
}
// Dispara a transferência PIX DIRETO na API do Asaas (produção).
// Chamada server-to-server a partir DESTE Worker — não passa por outro
// Worker. O fetch de Worker-para-Worker via workers.dev se mostrou
// instável (o Cloudflare devolvia HTTP 404 mesmo com o proxy drg-asaas
// 100% correto). Por isso este Worker usa o seu próprio ASAAS_API_KEY.
async function asaasTransfer(body, env){
  if (!env || !env.ASAAS_API_KEY)
    throw new Error('ASAAS_API_KEY nao configurado no Worker drg-aprovacao');
  const res = await fetch('https://api.asaas.com/v3/transfers', {
    method:  'POST',
    headers: {
      'access_token': env.ASAAS_API_KEY,
      'Content-Type': 'application/json',
      'User-Agent':   'DRG-Kronos/3.0',
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let data = {};
  try { data = JSON.parse(txt); } catch (_) { /* corpo não-JSON */ }
  if (!res.ok) {
    const msg = (data.errors && data.errors[0] && data.errors[0].description)
              || data.description || data.error
              || ('Asaas HTTP ' + res.status + ' — ' + (txt ? txt.slice(0, 300) : 'sem corpo'));
    throw new Error(msg);
  }
  return data;
}

// ── Recuperação de acesso do master (rota pública) ───────────
// SHA-256 hex — mesmo algoritmo do Auth.hashPassword do app.
async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
// Gera uma senha temporária forte (sem caracteres ambíguos).
function gerarSenhaTemp(){
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r  = crypto.getRandomValues(new Uint8Array(11));
  let s = '';
  for (const x of r) s += cs[x % cs.length];
  return s + '@' + new Date().getFullYear();
}
async function handleRecuperarAcesso(body, env, token){
  const code = String(body.code || '');
  if (!env.RECOVERY_CODE)        return { ok:false, erro:'recuperação não configurada no servidor' };
  if (!code)                     return { ok:false, erro:'informe o código de recuperação' };
  if (code !== env.RECOVERY_CODE) return { ok:false, erro:'código de recuperação incorreto' };
  const senha = gerarSenhaTemp();
  const hash  = await sha256hex(senha);
  await fsUpdate('users/master-default', {
    username:'admin', passwordHash:hash, role:'master',
    active:true, forceChange:true, recuperadoEm:new Date().toISOString(),
  }, token);
  return { ok:true, username:'admin', senha };
}

// ── Login do app de ponto (rota pública) ─────────────────────
// Recebe { matricula, pin }, confere contra `employees` e devolve um
// custom token com claim `role: 'colaborador'`. Substitui o
// signInAnonymously() que o ponto.html usava — S3-B da blindagem.
async function fsFindEmployeeByRegistro(fsValue, token){
  const res = await fetch(FS_BASE + ':runQuery', {
    method:  'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ structuredQuery: {
      from:  [{ collectionId: 'employees' }],
      where: { fieldFilter: { field: { fieldPath: 'registro' },
               op: 'EQUAL', value: fsValue } },
      limit: 1,
    } }),
  });
  if (!res.ok) throw new Error('Firestore query ' + res.status);
  const rows = await res.json();
  for (const row of (rows || [])) if (row.document) {
    const o = fromFsFields(row.document.fields || {});
    if (!o.id) { const p = row.document.name.split('/'); o.id = p[p.length - 1]; }
    return o;
  }
  return null;
}
async function handlePontoLogin(body, token, env){
  const matInput = String(body.matricula || '').trim();
  const pinInput = String(body.pin || '').trim();
  if (!matInput || !pinInput) return { ok:false, erro:'informe matrícula e PIN' };

  // registro pode estar salvo como int OU string — tenta os dois (mesma lógica do app)
  let emp = null;
  const matNum = parseInt(matInput, 10);
  if (!Number.isNaN(matNum)) {
    emp = await fsFindEmployeeByRegistro({ integerValue: String(matNum) }, token);
  }
  if (!emp) {
    emp = await fsFindEmployeeByRegistro({ stringValue: matInput }, token);
  }
  if (!emp) return { ok:false, erro:'matrícula não encontrada' };

  if ((emp.status || 'ativo') === 'inativo')
    return { ok:false, erro:'colaborador inativo — procure o gestor' };

  // PIN aceito: campo emp.pin se houver, senão 4 últimos dígitos do CPF
  const cpfClean    = String(emp.cpf || '').replace(/\D/g, '');
  const pinEsperado = emp.pin || (cpfClean.length >= 4 ? cpfClean.slice(-4) : '0000');
  if (pinInput !== String(pinEsperado))
    return { ok:false, erro:'PIN incorreto. Use os 4 últimos dígitos do seu CPF.' };

  // uid estável = id do doc do employee. Claim empId pra S3-C usar nas regras.
  const customToken = await mintCustomToken(emp.id, {
    role: 'colaborador', empId: emp.id, drg: true,
  }, env);

  return { ok:true, customToken, emp: {
    id:          emp.id,
    nome:        emp.nome || '',
    registro:    emp.registro,
    cpf:         emp.cpf || '',
    cargo:       emp.cargo || '',
    posto:       emp.posto || '',
    foto:        emp.foto || '',
    // Flag "trabalha sozinho" — usada pela UI do ponto pra pular intervalos
    semRefeicao: !!emp.semRefeicao,
  } };
}

// ── Login (rota pública) ─────────────────────────────────────
// Verifica a senha NO SERVIDOR e devolve um custom token + o usuário.
async function handleLogin(body, token, env){
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return { ok:false, erro:'informe usuário e senha' };
  const user = await fsFindUserByUsername(username, token);
  if (!user)                return { ok:false, erro:'usuário inválido ou sem acesso' };
  if (user.active === false) return { ok:false, erro:'usuário inativo' };
  if (!user.passwordHash)   return { ok:false, erro:'usuário sem senha definida' };
  if ((await sha256hex(password)) !== user.passwordHash)
    return { ok:false, erro:'senha incorreta' };
  // uid estável: reusa firebaseUid se já existe (preserva o 2FA enrollado),
  // senão usa o id do doc de users.
  const uid   = user.firebaseUid || user.id;
  const agora = new Date().toISOString();
  const upd   = { lastLogin: agora };
  if (!user.firebaseUid) upd.firebaseUid = uid;
  await fsUpdate('users/' + user.id, upd, token);
  const customToken = await mintCustomToken(uid, { role: user.role || '', drg: true }, env);
  user.firebaseUid = uid;
  user.lastLogin   = agora;
  delete user.passwordHash;   // o hash nunca volta para o cliente
  return { ok:true, user, customToken };
}

// ── Login do Painel do Operador (rota pública) ───────────────
// Substitui o signInAnonymously() do operator.html. Senha master
// armazenada em `operator/config.senhaHash` (SHA-256). No 1º acesso
// cria o doc com a senha digitada. uid estável = 'operator-default'.
async function handleOperatorLogin(body, token, env){
  const password = String(body.password || '');
  if (!password) return { ok:false, erro:'digite a senha' };

  const cfg  = await fsGetDoc('operator/config', token);
  const hash = await sha256hex(password);

  if (!cfg) {
    // 1º acesso — cria o doc de config com a senha digitada (mesma lógica do operator.html legado)
    await fsSetDoc('operator/config', {
      senhaHash: hash, criadoEm: new Date().toISOString(),
    }, token);
  } else if (cfg.senhaHash !== hash) {
    return { ok:false, erro:'senha incorreta' };
  }

  const customToken = await mintCustomToken('operator-default',
    { role: 'operator', drg: true }, env);
  return { ok:true, customToken };
}

// ── Cadastro de novo tenant (rota pública) ───────────────────
// Substitui as escritas diretas do cadastro.html (auto-cadastro de
// novos clientes — trial 30 dias). O Worker faz todas as 3 escritas
// com a conta de serviço (operator/tenants/lista/{id}, tenants/{id}/
// users/master_{id}, tenants/{id}/configuracoes/empresa).
async function handleTenantCadastrar(body, token){
  const nome        = String(body.nome || '').trim();
  const cnpjRaw     = String(body.cnpj || '').replace(/\D/g, '');
  const tipo        = String(body.tipo || '').trim();
  const responsavel = String(body.responsavel || '').trim();
  const usuario     = String(body.usuario || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const senha       = String(body.senha || '');
  const cnpjFmt     = String(body.cnpjFmt || '').trim() || cnpjRaw;

  if (!nome)                 return { ok:false, erro:'informe o nome da empresa' };
  if (cnpjRaw.length !== 14) return { ok:false, erro:'CNPJ inválido — verifique os 14 dígitos' };
  if (!responsavel)          return { ok:false, erro:'informe o nome do responsável' };
  if (usuario.length < 3)    return { ok:false, erro:'usuário deve ter ao menos 3 caracteres' };
  if (senha.length < 6)      return { ok:false, erro:'senha deve ter ao menos 6 caracteres' };

  const tenantId = cnpjRaw;

  // Verifica se já existe
  const existing = await fsGetDoc('operator/tenants/lista/' + tenantId, token);
  if (existing) return { ok:false, erro:'este CNPJ já possui uma conta', jaExiste:true };

  // Trial 30 dias
  const validade = new Date(); validade.setDate(validade.getDate() + 30);
  const validadeStr = validade.toISOString().split('T')[0];
  const agora       = new Date().toISOString();

  // 1. Metadata do tenant no painel operador
  await fsSetDoc('operator/tenants/lista/' + tenantId, {
    id: tenantId, nome, cnpj: cnpjFmt, tipo,
    plano: 'trial', status: 'trial',
    mensalidade: 0, validade: validadeStr, responsavel,
    criadoEm: agora, updatedAt: agora,
  }, token);

  // 2. Usuário master no tenant
  const userId = 'master_' + tenantId;
  await fsSetDoc('tenants/' + tenantId + '/users/' + userId, {
    id: userId, username: usuario, passwordHash: await sha256hex(senha),
    role: 'master', active: true, criadoEm: agora,
  }, token);

  // 3. Config inicial da empresa
  await fsSetDoc('tenants/' + tenantId + '/configuracoes/empresa', {
    nomeEmpresa: nome, cnpj: cnpjFmt,
    descricao: tipo, subdesc: 'Sistema de Gestão de Colaboradores',
    logoUrl: '', modoContabilidade: 'ambas',
  }, token);

  return { ok:true, tenantId };
}

// ── Gestão de usuários (coleção `users` é só-servidor) ───────
async function exigirMaster(auth, token){
  const u = await fsFindUser(auth.uid, token);
  if (!u)                  return { erro: 'usuário não encontrado' };
  if (u.role !== 'master') return { erro: 'apenas o master pode gerir usuários' };
  return { user: u };
}
async function handleUsuariosListar(auth, token){
  const m = await exigirMaster(auth, token);
  if (m.erro) return { ok:false, erro:m.erro };
  const lista = await fsListCollection('users', token);
  lista.forEach(u => { delete u.passwordHash; });
  return { ok:true, usuarios:lista };
}
// Sanitiza a lista de postos sob responsabilidade — só strings não-vazias, sem
// duplicar. Master nunca tem restrição (a coleção fica vazia mesmo se vier algo).
function _sanitizePostosResponsavel(v, role){
  if (role === 'master') return [];
  if (!Array.isArray(v)) return [];
  const seen = new Set(); const out = [];
  for (const it of v) {
    if (typeof it !== 'string') continue;
    const t = it.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
}
async function handleUsuariosSalvar(auth, body, token){
  const m = await exigirMaster(auth, token);
  if (m.erro) return { ok:false, erro:m.erro };
  const dados = body.user || {};
  const novaSenha = String(body.novaSenha || '');
  const username = String(dados.username || '').trim().toLowerCase().replace(/\s+/g, '.');
  const email    = String(dados.email || '').trim().toLowerCase();
  if (!username) return { ok:false, erro:'usuário obrigatório' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok:false, erro:'e-mail inválido' };
  const todos = await fsListCollection('users', token);
  if (todos.some(u => u.username === username && u.id !== dados.id))
    return { ok:false, erro:'já existe um usuário com esse nome' };
  if (todos.some(u => (u.email || '').toLowerCase() === email && u.id !== dados.id))
    return { ok:false, erro:'esse e-mail já está em uso por outro usuário' };
  if (dados.id) {
    const ex = todos.find(u => u.id === dados.id);
    if (!ex) return { ok:false, erro:'usuário não encontrado' };
    const role = dados.role || ex.role;
    const merged = { ...ex, username, email,
      role, active: dados.active !== false };
    if ('showLog' in dados) merged.showLog = !!dados.showLog;
    if ('postosResponsavel' in dados)
      merged.postosResponsavel = _sanitizePostosResponsavel(dados.postosResponsavel, role);
    if (novaSenha) {
      if (novaSenha.length < 6) return { ok:false, erro:'a senha precisa de ao menos 6 caracteres' };
      merged.passwordHash = await sha256hex(novaSenha);
      merged.forceChange  = false;
    }
    await fsSetDoc('users/' + dados.id, merged, token);
    return { ok:true, id:dados.id };
  }
  if (!novaSenha || novaSenha.length < 6)
    return { ok:false, erro:'informe uma senha de ao menos 6 caracteres' };
  const id = genIdW();
  const role = dados.role || 'operador';
  await fsSetDoc('users/' + id, {
    id, username, email, role,
    active: dados.active !== false, passwordHash: await sha256hex(novaSenha),
    postosResponsavel: _sanitizePostosResponsavel(dados.postosResponsavel, role),
    createdAt: new Date().toISOString(), lastLogin: null, forceChange: false,
  }, token);
  return { ok:true, id };
}
async function handleUsuariosExcluir(auth, body, token){
  const m = await exigirMaster(auth, token);
  if (m.erro) return { ok:false, erro:m.erro };
  const id = String(body.id || '');
  if (!id)                    return { ok:false, erro:'id não informado' };
  if (id === 'master-default') return { ok:false, erro:'o usuário padrão não pode ser removido' };
  if (m.user.id === id)        return { ok:false, erro:'você não pode excluir o próprio usuário' };
  await fsDeleteDoc('users/' + id, token);
  return { ok:true };
}
async function handleTrocarSenha(auth, body, token){
  const atual = String(body.currentPassword || '');
  const nova  = String(body.newPassword || '');
  if (nova.length < 6) return { ok:false, erro:'a nova senha precisa de ao menos 6 caracteres' };
  const user = await fsFindUser(auth.uid, token);
  if (!user) return { ok:false, erro:'usuário não encontrado' };
  if ((await sha256hex(atual)) !== user.passwordHash)
    return { ok:false, erro:'senha atual incorreta' };
  await fsUpdate('users/' + user.id, {
    passwordHash: await sha256hex(nova), forceChange: false,
    senhaAlteradaEm: new Date().toISOString(),
  }, token);
  return { ok:true };
}

// ── Handlers de 2FA ──────────────────────────────────────────
async function handleEnroll(auth, token){
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  await fsSetDoc('mfa/' + auth.uid,
    { secretBase32: secret, ativo: false, atualizadoEm: new Date().toISOString() }, token);
  const label = encodeURIComponent('DRG-Kronos:' + (auth.email || auth.uid));
  const uri   = `otpauth://totp/${label}?secret=${secret}&issuer=DRG-Kronos&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}
async function handleConfirm(auth, code, token){
  const mfa = await fsGetDoc('mfa/' + auth.uid, token);
  if (!mfa || !mfa.secretBase32) throw new Error('Configure o 2FA primeiro (enroll).');
  if (!(await verifyTotp(mfa.secretBase32, code))) return { ok: false };
  await fsSetDoc('mfa/' + auth.uid,
    { secretBase32: mfa.secretBase32, ativo: true, atualizadoEm: new Date().toISOString() }, token);
  return { ok: true };
}
async function handleStatus(auth, token){
  const mfa = await fsGetDoc('mfa/' + auth.uid, token);
  return { ativo: !!(mfa && mfa.ativo) };
}

// ── Handler de Aprovação de Pagamento (Etapa 4c) ─────────────
// Valida identidade + permissão "pagamentosAprovar" + 2FA TOTP,
// confere a solicitação pendente e dispara o PIX no Asaas.
async function handleAprovarPagamento(auth, body, token, env){
  const code  = String(body.code || '');
  const solId = String(body.solicitacaoId || '');
  if (!solId) throw new Error('solicitação não informada');

  // 1. usuário do sistema + permissão de aprovar
  const user = await fsFindUser(auth.uid, token);
  if (!user) return { ok: false, erro: 'usuário não encontrado no sistema' };
  if (!(await temPermAprovar(user, token)))
    return { ok: false, erro: 'sem permissão para aprovar pagamentos' };

  // 2. segundo fator — TOTP
  const mfa = await fsGetDoc('mfa/' + auth.uid, token);
  if (!mfa || !mfa.ativo || !mfa.secretBase32)
    return { ok: false, erro: '2FA não ativado — ative em "Minha Conta"' };
  if (!(await verifyTotp(mfa.secretBase32, code)))
    return { ok: false, erro: 'código 2FA inválido' };

  // 3. solicitação pendente
  const path = 'solicitacoesPagamento/' + solId;
  const sol  = await fsGetDoc(path, token);
  if (!sol) throw new Error('solicitação não encontrada');
  if (sol.status === 'pago')
    return { ok: true, jaPago: true, asaasTransferId: sol.asaasTransferId || '', status: sol.asaasStatus || '' };
  // aceita 'pendente' e 'erro' (retentativa de uma que falhou no Asaas)
  if (sol.status !== 'pendente' && sol.status !== 'erro')
    return { ok: false, erro: 'solicitação não está pendente (status: ' + sol.status + ')' };

  const nome  = user.nome || auth.email || auth.uid;
  const agora = new Date().toISOString();

  // 4. dispara o PIX no Asaas
  let resp;
  try {
    const tBody = {
      value:             sol.valor,
      pixAddressKey:     sol.pixKey,
      pixAddressKeyType: sol.keyType || 'CPF',
      description:       sol.descricao || 'Pagamento DRG-Kronos',
    };
    if (sol.scheduleDate) tBody.scheduleDate = sol.scheduleDate;
    resp = await asaasTransfer(tBody, env);
  } catch (e) {
    await fsUpdate(path, { status: 'erro', erro: String(e.message || e),
      aprovadoPor: auth.uid, aprovadoPorNome: nome, aprovadoEm: agora }, token);
    return { ok: false, erro: String(e.message || e) };
  }

  // 5. grava a aprovação na solicitação
  await fsUpdate(path, {
    status: 'pago',
    asaasTransferId: resp.id || '',
    asaasStatus:     resp.status || 'PENDING',
    aprovadoPor:     auth.uid,
    aprovadoPorNome: nome,
    aprovadoEm:      agora,
  }, token);

  // 6. espelha o pagamento na folha (não-crítico — não falha o pagamento)
  if (sol.payrollId) {
    try {
      await fsUpdate('payrolls/' + sol.payrollId, { pagamentoAsaas: {
        asaasTransferId: resp.id || '', asaasTipo: 'pix', asaasValor: sol.valor,
        asaasStatus: resp.status || 'PENDING', asaasData: sol.scheduleDate || '',
        asaasPagoEm: agora, solicitacaoId: solId,
      } }, token);
    } catch (e) { /* silencioso */ }
  }

  return { ok: true, asaasTransferId: resp.id || '', status: resp.status || 'PENDING' };
}

// ── Roteador ─────────────────────────────────────────────────
export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST')    return json({ error: 'método não permitido' }, 405, origin);

    const url = new URL(request.url);
    try {
      const body  = await request.json().catch(() => ({}));

      // Rotas PÚBLICAS — não exigem login.
      if (url.pathname === '/recuperar-acesso') {
        const t = await getAccessToken(env);
        return json(await handleRecuperarAcesso(body, env, t), 200, origin);
      }
      if (url.pathname === '/login') {
        const t = await getAccessToken(env);
        return json(await handleLogin(body, t, env), 200, origin);
      }
      if (url.pathname === '/ponto-login') {
        const t = await getAccessToken(env);
        return json(await handlePontoLogin(body, t, env), 200, origin);
      }
      if (url.pathname === '/operator-login') {
        const t = await getAccessToken(env);
        return json(await handleOperatorLogin(body, t, env), 200, origin);
      }
      if (url.pathname === '/tenant-cadastrar') {
        const t = await getAccessToken(env);
        return json(await handleTenantCadastrar(body, t), 200, origin);
      }

      const auth  = await verifyIdToken(body.idToken);   // 401 se o token for inválido
      const token = await getAccessToken(env);

      if (url.pathname === '/mfa/enroll')  return json(await handleEnroll(auth, token), 200, origin);
      if (url.pathname === '/mfa/confirm') return json(await handleConfirm(auth, body.code, token), 200, origin);
      if (url.pathname === '/mfa/status')  return json(await handleStatus(auth, token), 200, origin);
      if (url.pathname === '/aprovar-pagamento') return json(await handleAprovarPagamento(auth, body, token, env), 200, origin);
      if (url.pathname === '/usuarios/listar')       return json(await handleUsuariosListar(auth, token), 200, origin);
      if (url.pathname === '/usuarios/salvar')       return json(await handleUsuariosSalvar(auth, body, token), 200, origin);
      if (url.pathname === '/usuarios/excluir')      return json(await handleUsuariosExcluir(auth, body, token), 200, origin);
      if (url.pathname === '/usuarios/trocar-senha') return json(await handleTrocarSenha(auth, body, token), 200, origin);

      return json({ error: 'rota desconhecida' }, 404, origin);
    } catch (e) {
      const msg  = String((e && e.message) || e);
      const auth = /token|assinatura|expirad|emissor|projeto|ausente|malformado|chave nao/.test(msg);
      return json({ error: msg }, auth ? 401 : 500, origin);
    }
  },
};
