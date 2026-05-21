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
