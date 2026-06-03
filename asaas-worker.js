/**
 * DRG-Kronos — Asaas API Proxy Worker
 * =====================================
 * Deploy no Cloudflare Workers como "drg-asaas"
 * URL resultante: https://drg-asaas.zett-romao.workers.dev
 *
 * SECRET obrigatório (Cloudflare Dashboard → Settings → Variables → Secret):
 *   ASAAS_API_KEY  — chave da API Asaas de PRODUÇÃO (começa com $aact_)
 *
 * Este worker fala SEMPRE com a produção do Asaas (api.asaas.com/v3).
 * O DRG-Kronos só faz pagamentos reais — não há modo sandbox aqui, de
 * propósito (era o modo sandbox mal-configurado que causava erro 404).
 *
 * Como criar/atualizar o Worker:
 *   1. dash.cloudflare.com → Workers & Pages → abra (ou crie) "drg-asaas"
 *   2. Edit Code → cole este código → Save and Deploy
 *   3. Settings → Variables and Secrets → Secret ASAAS_API_KEY = sua chave
 */

'use strict';

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

// API Asaas v3 — PRODUÇÃO (endereço conferido em docs.asaas.com).
const ASAAS_BASE = 'https://api.asaas.com/v3';

// ── Verificação do ID token do Firebase (mesma do drg-aprovacao) ──────────
// Sem isto, este proxy ficava ABERTO: qualquer um com a URL criava cobrança /
// lia clientes (CORS NÃO protege contra chamada via curl/servidor). Agora exige
// 'Authorization: Bearer <idToken>' de um gestor logado no DRG-Kronos. #asaas-auth
const PROJECT_ID   = 'drg-sistema';
const TOKEN_ISSUER = 'https://securetoken.google.com/' + PROJECT_ID;
const JWK_URL      = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
function b64ToBytes(str){
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
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
  if (payload.drg !== true) throw new Error('claim drg ausente');
  if (payload.role === 'colaborador') throw new Error('perfil sem permissao para Asaas');
  return { uid: payload.sub, email: payload.email || '', role: payload.role || '' };
}

export default {
  async fetch(request, env) {
    // ── CORS ─────────────────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    const cors = {
      'Access-Control-Allow-Origin':  allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── Validação básica ──────────────────────────────────────────────────
    const apiKey = env.ASAAS_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ASAAS_API_KEY não configurada no Worker.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── Auth: exige idToken do Firebase (gestor logado) ───────────────────
    // Antes este proxy era PÚBLICO. Agora só responde a quem mandar um idToken
    // válido do projeto DRG-Kronos no header Authorization. #asaas-auth
    const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    try {
      await verifyIdToken(idToken);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'não autorizado — faça login no DRG-Kronos (' + (e.message || e) + ')' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── Monta a URL da Asaas (sempre produção) ────────────────────────────
    // ASAAS_BASE já termina em "/v3". Se o chamador mandar o caminho com um
    // "/v3" (ou "/api/v3") na frente, a URL viraria ".../v3/v3/transfers" e
    // a Asaas responde HTTP 404 (corpo vazio → erro "Asaas HTTP 404").
    // Removemos esse prefixo redundante para o proxy aceitar as duas formas.
    const url  = new URL(request.url);
    let   path = url.pathname;
    path = path.replace(/^\/api(?=\/|$)/, '');   // remove "/api" redundante
    path = path.replace(/^\/v3(?=\/|$)/,  '');   // remove "/v3" redundante
    if (!path.startsWith('/')) path = '/' + path;

    // ── Whitelist de segurança ────────────────────────────────────────────
    // Este proxy é PÚBLICO (a URL está no repositório). Por isso só encaminha
    // o que o app no navegador realmente precisa:
    //   • COBRANÇA: /customers, /payments, /subscriptions
    //   • leitura de UMA transferência (GET /transfers/<id>), usada só para
    //     puxar o comprovante do PIX — não move dinheiro.
    // Qualquer outra coisa é recusada — em especial POST /transfers (saque)
    // e GET /transfers (lista tudo). Transferências de verdade passam pelo
    // Worker autenticado drg-aprovacao, não por aqui.
    const cobranca   = ['/customers', '/payments', '/subscriptions']
                         .some(p => path === p || path.startsWith(p + '/'));
    const leTransfer = request.method === 'GET' && /^\/transfers\/[\w-]+$/.test(path);
    if (!cobranca && !leTransfer) {
      return new Response(
        JSON.stringify({ error: 'Endpoint nao permitido por este proxy.' }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const asaasUrl = ASAAS_BASE + path + url.search;

    // ── Corpo da requisição ───────────────────────────────────────────────
    const hasBody  = request.method !== 'GET' && request.method !== 'HEAD';
    const body     = hasBody ? await request.text() : undefined;

    // ── Encaminha para a Asaas ────────────────────────────────────────────
    let asaasResp;
    try {
      asaasResp = await fetch(asaasUrl, {
        method:  request.method,
        headers: {
          'access_token':  apiKey,
          'Content-Type':  'application/json',
          'User-Agent':    'DRG-Kronos/3.0',
        },
        body,
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Erro ao conectar com a Asaas: ' + e.message }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const data = await asaasResp.text();
    return new Response(data, {
      status:  asaasResp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
