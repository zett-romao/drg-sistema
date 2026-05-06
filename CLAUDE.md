# DRG Sistema — Notas de Projeto

Este arquivo serve como memória de contexto pro Claude (ou outra IA) que abrir este projeto. Leia antes de fazer mudanças relevantes.

---

## O que é

Sistema de gestão de colaboradores para a empresa **D.R. Global Multi Services** (portaria/condomínios). Inclui:

- Cadastro de colaboradores (dados pessoais, endereço, contrato, benefícios, férias, documentos)
- Folha de ponto mensal (com leitura automática de PDF via IA)
- CCT (Convenção Coletiva de Trabalho) com parametrização global
- Dashboard com alertas (exames, férias, contratos, PLR)
- Gestão de postos de trabalho e contratos
- App separado de **Ponto Eletrônico** mobile (`ponto.html`) pros colaboradores baterem ponto

**Stack:** HTML/CSS/JS puro, Firebase (Firestore + Storage), Cloudflare Worker (proxy de IA), Gemini API.
**Hospedagem:** GitHub Pages → `https://zett-romao.github.io/drg-sistema/`
**Repo:** `github.com/zett-romao/drg-sistema` (público — atenção ao que vai pro commit)

---

## Estrutura de arquivos

```
.
├── index.html          # App principal (gestor)
├── ponto.html          # App mobile do colaborador
├── app.js              # Toda a lógica do app principal (~4500 linhas)
├── styles.css          # CSS
├── firebase-config.js  # Config Firebase + initializeApp idempotente
├── ponto-sw.js         # Service Worker do PWA do ponto
├── ponto-manifest.json # Manifest do PWA
├── logo.png/svg
└── CLAUDE.md           # Este arquivo
```

`.gitignore` ignora `*backup*.json`, `.claude/`, IDEs e SO files.

---

## Convenções importantes

### Cache busting
Todos os assets locais (`app.js`, `styles.css`, `firebase-config.js`) são referenciados em `index.html` (e `ponto.html`) com query string `?v=YYYYMMDDX` (ex: `?v=20260506k`). **Sempre que mexer em qualquer um deles, bumpe a letra final** (k → l → m...) ou a data, em ambos os HTMLs. Sem isso, o navegador serve versão velha mesmo após push.

### Modelo de dados (Firestore)
- `employees` — colaboradores (campos relevantes recentemente adicionados: `acumuloFuncao` boolean, `insalubridade` 0/20/40/60, `bonificacaoSemprePagar` boolean)
- `payrolls` — folhas de ponto mensais
- `cct` — documento único `id: 'current'`
- `users` — usuários do sistema (login custom, NÃO Firebase Auth)
- `accessLog` — log de auditoria
- `postos`, `contratos`, `perfis` — outros recursos

### CCT — campos novos relevantes
- `cct.salarioMinimo` (default 1518) — base da insalubridade
- `cct.bonificacao` — valor da bonificação Boa Permanência
- `cct.plrValorAnual`, `cct.plrAvisoDias`
- `cct.plrP1Valor`, `cct.plrP1DataLimite`, `cct.plrP1DataPagamento`
- `cct.plrP2Valor`, `cct.plrP2DataLimite`, `cct.plrP2DataPagamento`

### Auth (importante)
NÃO usa Firebase Auth. Tem módulo próprio (`Auth` em `app.js` linha ~130) com:
- Hash SHA-256 da senha (sem salt — ciente disso, é tech debt)
- Sessão em `sessionStorage`
- Roles: `master`, `admin`, `gestor`
- Módulos granulares por usuário (`getUserModules()`)

App do colaborador (`ponto.html`) usa **PIN** = 4 últimos dígitos do CPF, validado contra `employees`.

---

## Integrações externas

### Firebase (projeto: `drg-sistema`)
- **Plano:** Blaze (pós-pagamento) — necessário para Storage e Cloud Functions
- **Firestore rules:** abertas (`if true`) — pendência de segurança
- **Storage rules:** abertas (`if true`) — idem
- **API key Firebase** (`AIzaSyDnIGSx-TkCeD3RKOj7LVzOpbzrmU_dCq8`) está em `firebase-config.js` — é normal Firebase keys serem públicas; restrição é por HTTP Referrer no Google Cloud Console (já configurado pra `zett-romao.github.io/*`, `localhost/*`, `127.0.0.1/*`)
- **Limite de orçamento:** R$ 5/mês configurado no GCP Billing com alertas em 50/90/100%

### Gemini AI (via Cloudflare Worker)
A chave Gemini **NÃO está no código**. Fluxo:
1. Browser → POST → `https://drg-gemini-proxy.zett-romao.workers.dev`
2. Worker valida origem (`zett-romao.github.io`, localhost) e usa `env.GEMINI_API_KEY` (Secret criptografado)
3. Worker → Gemini API → Worker → Browser

Worker code está em `worker.js` no painel Cloudflare (não está versionado neste repo). Modelo atual: `gemini-2.5-flash`.

**Por quê:** o Google revoga automaticamente chaves Gemini detectadas em repos públicos. Worker resolve definitivamente.

### Gemini — projeto onde a chave existe
A chave do Gemini está no projeto AI Studio chamado **`drglobal-gestao`** (`gen-lang-client-0543112550`), com billing vinculado à mesma conta do Firebase. NÃO está no projeto `drg-sistema` do Firebase.

---

## Lógica complexa que vale entender

### `recalculate()` em app.js (linha ~1639)
Função central que recalcula TODA a folha de ponto: descontos por falta, atrasos, VT, VR, VA proporcional/integral, adicional noturno (12x36), acúmulo de função (+20%), insalubridade (% sobre salário mínimo), bonificação Boa Permanência (com flag `bonificacaoSemprePagar`), horas extras.

### Bonificação Boa Permanência — 3 estados
1. 0 faltas → liberada e auto-preenchida da CCT
2. Faltas > 0 + flag `bonificacaoSemprePagar` desligada → bloqueada (zero)
3. Faltas > 0 + flag ligada → liberada com aviso laranja

### Prompt da IA Gemini (em `app.js`, função `callGemini`)
Tem `ESCALA_RULES` por escala de trabalho (5x2A, 5x2B, 6x1A, 6x1B, 12x36) com regras anti-engano específicas. Em particular para **12x36**: dias sem registro NÃO são faltas (são folgas alternadas). Só conta como falta se OBS dizer "FALTA/FALTOU/AUSENTE/F.I.".

### Git workflow
- Branch padrão: `main` (não `master` — havia confusão antiga, foi limpo)
- Push direto pra main, sem PR (projeto solo)
- GitHub Pages serve a partir de `main`

---

## Pendências conhecidas

### Segurança
- **Firebase Auth** — atualmente usa hash SHA-256 sem salt. Plano: implementar Anonymous Auth ("Caminho A") como camada e endurecer regras Firestore de `if true` para `if request.auth != null`. (Decisão pendente do usuário.)
- **Regras Firestore/Storage** abertas (`if true`) — vinculado ao item acima.
- **API key Gemini** — RESOLVIDO via Worker.

### Funcional
- Testar leitura de IA com escalas 5x2A, 5x2B, 6x1A, 6x1B (12x36 já validado)
- Migração eventual pra Firebase Auth completo (Caminho B) — em outro turno, é refactor grande

---

## Comandos úteis

```bash
# Verificar estado
git status
git log --oneline -10

# Push padrão
git add <files>
git commit -m "feat/fix/chore: ..."
git push origin main

# Bumpar cache buster (substitua a versão antiga pela nova nos 2 HTMLs)
# Ex: v=20260506k → v=20260506l
```

---

## Histórico de decisões importantes

- **2026-05-06**: Migração Gemini direto → Cloudflare Worker proxy (Google revogou chave por leak no repo público).
- **2026-05-06**: Implementadas features Acúmulo de Função, Insalubridade, Bonificação Boa Permanência (com flag de exceção), PLR completo (parametrização + alertas no dashboard).
- **2026-05-06**: Corrigido bug Firestore login no `ponto.html` (query `!=` exigia índice composto não criado).
- **2026-05-06**: Corrigido `firebase-config.js` para chamar `initializeApp` (ponto.html não inicializava Firebase).
- **2026-05-06**: Branch `master` órfão deletado, padronizado em `main`.

---

## Estilo de comunicação que o usuário prefere

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Honestidade sobre risco e trade-offs (ex: "isso pode quebrar X", "essa abordagem é hacky mas resolve")
- Confirmar antes de ações destrutivas (delete branch, force push, etc.)
- Não rodar comandos sem necessidade — terminal é caro de contexto

E-mail do usuário: `zett.romao@gmail.com`
