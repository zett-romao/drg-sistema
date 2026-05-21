/**
 * DRG-Kronos — Asaas API Proxy Worker
 * =====================================
 * Deploy no Cloudflare Workers como "drg-asaas"
 * URL resultante: https://drg-asaas.zett-romao.workers.dev
 *
 * SECRETS (Cloudflare Dashboard → Settings → Variables → Secret):
 *   ASAAS_API_KEY  — sua chave da API Asaas (OBRIGATORIO; $aact_ = producao)
 *   ASAAS_ENV      — OPCIONAL. "sandbox" para testes; ausente ou qualquer
 *                    outro valor usa PRODUCAO (padrao).
 *
 * Como criar o Worker:
 *   1. Acesse dash.cloudflare.com → Workers & Pages → Create Application → Create Worker
 *   2. Nomeie como "drg-asaas"
 *   3. Cole este código no editor
 *   4. Salve (Save and Deploy)
 *   5. Vá em Settings → Variables → Add variable (secret):
 *      - ASAAS_API_KEY = sua chave (obrigatório)
 *      - ASAAS_ENV (opcional) = defina como "sandbox" apenas para testes
 */

'use strict';

const ALLOWED_ORIGINS = [
  'https://zett-romao.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

// URLs oficiais da API Asaas v3 (conferidas em docs.asaas.com).
const ASAAS_BASE = {
  sandbox:    'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

export default {
  async fetch(request, env) {
    // ── CORS ─────────────────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
    const cors = {
      'Access-Control-Allow-Origin':  allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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

    // Producao e o padrao. So usa sandbox se ASAAS_ENV for exatamente "sandbox".
    const base = (env.ASAAS_ENV === 'sandbox') ? ASAAS_BASE.sandbox : ASAAS_BASE.production;

    // ── Monta URL da Asaas ────────────────────────────────────────────────
    const url      = new URL(request.url);
    const asaasUrl = base + url.pathname + url.search;

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
