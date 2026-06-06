# eSocial — Fase 3c: Back-end de Transmissão (plano de arquitetura)

> Documento de planejamento. O DRG-Kronos já **gera** os eventos eSocial em XML
> (S-1000, S-1005, S-1010, S-2200, S-1200) em produção restrita. Falta **assinar e
> transmitir** — o que exige um servidor dedicado. Este doc descreve como.

## 1. Por que precisa de um back-end novo
O app é estático (GitHub Pages) + Cloudflare Workers + Firebase. A transmissão ao eSocial exige:
- **Assinatura XML-DSig** de cada evento com o certificado e-CNPJ (A1 `.pfx`/`.p12` ou A3).
- **mTLS** (TLS com certificado de cliente) contra os Web Services do eSocial.

Cloudflare Workers **não** fazem mTLS com cert de cliente externo nem assinatura com `.pfx` de forma confiável. → precisa de um **serviço Node.js** dedicado.

## 2. Restrição firme do dono (segurança do certificado)
- O certificado **NUNCA** fica no repositório nem é armazenado em banco.
- Uso **sob demanda / custodiado**: o certificado é enviado no momento da transmissão
  (com senha/PIN), usado **em memória**, e **descartado** logo após. Modelo parecido
  com os portais dos tribunais.

## 3. Fluxo proposto (por transmissão)
```
App (master)                Back-end Node (HTTPS)              eSocial WS (gov)
  |  POST /esocial/transmitir                                       
  |   { tenantId, eventosXML[], certB64, senhaCert }  ---->         
  |                         1. valida sessão (token Firebase)       
  |                         2. carrega cert EM MEMÓRIA (forge)      
  |                         3. assina cada XML (xml-crypto)         
  |                         4. monta envioLoteEventos               
  |                         5. mTLS + envia lote          ---->     
  |                                                       <----  recibo/protocolo
  |                         6. ZERA cert da memória                 
  |   <---- { protocolo, status }                                   
  |  POST /esocial/consultar { protocolo }  ----> consulta lote --> 
```
Pontos de segurança:
- HTTPS obrigatório; autenticar a chamada com o **token do Firebase** (só master do tenant).
- Cert e senha **só em memória**, nunca em log/disco/banco; `try/finally` zera as variáveis.
- Sem persistência do `.pfx`. Rate-limit + auditoria de QUEM transmitiu (sem o cert).
- Multi-tenant: o `tenantId` no token define a empresa; isola os dados.

## 4. Stack técnica
- **Node.js** (ex.: Fastify/Express).
- `node-forge` (ler o `.pfx`, extrair chave/cadeia) + `xml-crypto` (assinar XML-DSig).
- `https.Agent` com `pfx`+`passphrase` para o **mTLS** na chamada ao WS.
- Web Services eSocial: `ServicoEnviarLoteEventos` (envio) e `ServicoConsultarLoteEventos`
  (consulta do resultado). Ambiente: **produção restrita** primeiro (homologação).

## 5. Onde hospedar (decisão do dono — tem custo)
| Opção | Prós | Contras |
|---|---|---|
| **VPS pequena** (ex.: Hetzner/Contabo, ~US$5/mês) | controle total, IP fixo, simples | você administra o servidor |
| **Render/Railway/Fly.io** (free/baixo custo) | deploy fácil via Git | cold start; conferir suporte a mTLS de saída |
| **Cloud Run / container** | escala, isolável | um pouco mais de setup |

Recomendação: **VPS pequena** ou **Render**, rodando o serviço Node, atrás de HTTPS.
O `.pfx` **não vai pro servidor de forma permanente** — chega na requisição e some.

## 6. Plano incremental da Fase 3c
1. **Empacotar lote** (`envioLoteEventos`) no próprio app (XML do lote, sem assinar) — base.
2. Scaffold do serviço Node (endpoints `/transmitir` e `/consultar`, auth Firebase, sem segredo no repo).
3. Assinatura XML-DSig (xml-crypto) — testar contra o XSD em produção restrita.
4. mTLS + envio do lote ao WS de homologação; consulta do protocolo.
5. UI no app: botão "Transmitir competência" → chama o back-end → mostra protocolo/erros.
6. Auditoria, rate-limit, e só então liberar `tpAmb=1` (produção) por empresa.

## 7. Pré-requisitos antes de codar a transmissão
- ✅ Eventos gerando (feito).
- ⏳ **Validar os XMLs no eSocial produção restrita** (confirma o leiaute antes de assinar/enviar).
- ⏳ Decisão de **hospedagem** (item 5) + obtenção do **certificado e-CNPJ** do cliente.
- ⏳ Preencher **naturezas das rubricas** (S-1010) com o contador.

> Enquanto a hospedagem não é decidida, dá pra adiantar o **passo 1 (empacotar lote)**
> no app, que é seguro e não depende de servidor.
