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
 *   /mfa/enroll   { idToken }            → gera segredo TOTP novo
 *   /mfa/confirm  { idToken, code }      → ativa o 2FA validando 1 código
 *   /mfa/status   { idToken }            → diz se o 2FA está ativo
 *   /aprovar-pagamento  (Etapa 4c — ainda não implementado)
 * ============================================================
 */

const PROJECT_ID   = 'drg-sistema';
const TOKEN_ISSUER = 'https://securetoken.google.com/' + PROJECT_ID;
const JWK_URL      = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FS_BASE      = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const ORIGINS_OK   = ['https://zett-romao.github.io', 'http://localhost', 'http://127.0.0.1'];

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

// ── Roteador ─────────────────────────────────────────────────
export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST')    return json({ error: 'método não permitido' }, 405, origin);

    const url = new URL(request.url);
    try {
      const body  = await request.json().catch(() => ({}));
      const auth  = await verifyIdToken(body.idToken);   // 401 se o token for inválido
      const token = await getAccessToken(env);

      if (url.pathname === '/mfa/enroll')  return json(await handleEnroll(auth, token), 200, origin);
      if (url.pathname === '/mfa/confirm') return json(await handleConfirm(auth, body.code, token), 200, origin);
      if (url.pathname === '/mfa/status')  return json(await handleStatus(auth, token), 200, origin);
      // if (url.pathname === '/aprovar-pagamento') ...  ← Etapa 4c

      return json({ error: 'rota desconhecida' }, 404, origin);
    } catch (e) {
      const msg  = String((e && e.message) || e);
      const auth = /token|assinatura|expirad|emissor|projeto|ausente|malformado|chave nao/.test(msg);
      return json({ error: msg }, auth ? 401 : 500, origin);
    }
  },
};
