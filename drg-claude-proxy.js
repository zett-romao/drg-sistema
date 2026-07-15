// ============================================================
// DRG Claude Proxy — Cloudflare Worker
// Mantém a ANTHROPIC_API_KEY em SEGREDO (nunca vai pro cliente) e fala com a API
// da Anthropic pelos apps DRG. Mesmo contrato do proxy do Gemini:
//   POST { model, prompt, mimeType, base64Data }  →  { content:[{type:'text', text}] }
// Assim o cliente (Kronos) troca Gemini⟷Claude só mudando a URL, sem mexer no parser.
//
// COMO PUBLICAR (Cloudflare):
//  1. Dashboard → Workers & Pages → Create → Worker → cole este arquivo → Deploy.
//  2. No Worker → Settings → Variables and Secrets → Add → Secret:
//        Name  = ANTHROPIC_API_KEY
//        Value = <sua chave, a MESMA dos outros projetos DRG>
//     (é criptografada; não aparece no código nem no cliente.)
//  3. Copie a URL do worker (…workers.dev) e cole no Kronos:
//        Configurações → Inteligência Artificial da Ajuda → chave em "Claude"
//        → URL do proxy + modelo (ex.: claude-sonnet-4-5) → Salvar.
// ============================================================

// Origens autorizadas (mesma ideia do proxy do Gemini). Ajuste se mudar o domínio.
const ORIGENS_OK = [
  'https://zett-romao.github.io',   // Kronos (GitHub Pages)
  'http://localhost:5500',          // testes locais (Live Server)
  'http://127.0.0.1:5500',
];

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODELO_PADRAO = 'claude-sonnet-4-5';
const MAX_TOKENS = 1024;

function corsHeaders(origin) {
  const permitido = ORIGENS_OK.includes(origin) ? origin : ORIGENS_OK[0];
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (request.method !== 'POST') {
      return json({ error: 'Use POST.' }, 405, cors);
    }
    // Trava de origem (só os apps DRG chamam)
    if (origin && !ORIGENS_OK.includes(origin)) {
      return json({ error: 'Origem não autorizada' }, 403, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Servidor sem ANTHROPIC_API_KEY configurada.' }, 500, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'JSON inválido.' }, 400, cors); }

    const { model, prompt, mimeType, base64Data } = body || {};
    if (!prompt) return json({ error: 'Parâmetro obrigatório: prompt' }, 400, cors);

    // Monta o conteúdo do usuário: imagem (se veio) + texto.
    const content = [];
    if (base64Data && mimeType && mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: base64Data },
      });
    }
    content.push({ type: 'text', text: prompt });

    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: (model || env.ANTHROPIC_MODEL || MODELO_PADRAO),
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content }],
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        return json({ error: data?.error?.message || 'Erro na API da Anthropic' }, resp.status, cors);
      }
      // Devolve o payload da Anthropic como veio (content[0].text + usage). O cliente
      // já entende data.content[0].text. usage → { input_tokens, output_tokens }.
      return json(data, 200, cors);
    } catch (e) {
      return json({ error: 'Falha ao chamar a Anthropic: ' + (e.message || e) }, 502, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
