# DRG Systems — Notas de Projeto

Este arquivo serve como memória de contexto pro Claude (ou outra IA) que abrir este projeto. Leia antes de fazer mudanças relevantes.

---

## O que é

**Nome comercial do software: DRG-Kronos 3.0**
A versão é controlada pela constante `APP_VERSION` no topo de `app.js` — altere apenas lá, ela alimenta automaticamente a tela de login e o rodapé do sidebar.

Sistema de gestão de colaboradores para a empresa **D.R. Global Multi Services** (portaria/condomínios). Inclui:

- Cadastro de colaboradores (dados pessoais, endereço, contrato, benefícios, férias, documentos)
- Folha de ponto mensal (com leitura automática de PDF via IA)
- CCT (Convenção Coletiva de Trabalho) com parametrização global
- Dashboard com alertas (exames, férias, contratos, PLR)
- Gestão de postos de trabalho e contratos
- **Contabilidade**: tabela mensal de 24 colunas com exportação CSV e impressão
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

### Service Worker (PWA do `ponto.html`)
O `ponto-sw.js` usa estratégia **network-first** para HTML/JS/CSS/JSON (sempre tenta rede primeiro, cache só se offline) e **cache-first** para imagens. **Sempre que mudar a estratégia de cache ou os assets cacheados, bumpe a constante `CACHE` no início do arquivo** (ex: `'drg-ponto-v3-20260506'` → `'drg-ponto-v4-...'`). Isso força o `activate` hook a apagar caches antigos.

**Atenção:** mesmo com SW novo, o celular pode segurar a versão velha por uma sessão. Usuário precisa fechar e reabrir o app ao menos uma vez (idealmente duas) pra novo SW assumir. Em casos extremos, pode precisar limpar cache do Chrome ou desinstalar/reinstalar o PWA. Documentado em "PWA / Debug" abaixo.

### Relatórios — arquitetura atual
Os relatórios **não** têm mais seção própria no sidebar. São acessados via botão "Relatórios" dentro de cada módulo, que abre o `modal-reports` dinamicamente via `openReportsModal(allowedTypes, title)`. Os módulos e seus relatórios disponíveis:
- **Colaboradores**: cadastral, contatos, férias-marcadas, férias-pendentes, afastados, setor, **licenca-mat** (colunas: #, Reg., Nome, Setor, Posto, Admissão, Início Licença, Prev. Retorno, CPF, Celular)
- **Folha de Ponto**: financeiro, individual, por-posto (+ stats grid com 9 cards do mês)
- **Postos**: postos-cadastro, posto
- **Contratos**: contratos-rel

### Escalas de trabalho disponíveis
5x2, 5x2A, 5x2B, 6x1, 6x1A, 6x1B, **6x1C** (08h–17h dias úteis / Sáb 08h–12h), 12x36

### Status de colaborador disponíveis
`ativo`, `inativo`, `afastado`, `licenca-maternidade` (novo — badge rosa, card separado no dashboard quando > 0)

### Dashboard — comportamento atual
- Cards são clicáveis: cada card navega para a aba/filtro correspondente em Colaboradores
- Card "Licença Maternidade" só aparece se houver colaboradora nesse status
- Card "Total Remuneração" foi removido

### Modelo de dados (Firestore)
- `employees` — colaboradores (campos relevantes recentemente adicionados: `acumuloFuncao` boolean, `insalubridade` 0/20/40/60, `bonificacaoSemprePagar` boolean)
- `payrolls` — folhas de ponto mensais. Campos recentemente adicionados: `periodoDe` (string DD/MM/AAAA), `periodoAte` (string DD/MM/AAAA), `status` (`'aberta'` | `'fechada'`), `fechadoEm` (ISO timestamp)
- `configuracoes` — coleção nova. Documentos `fechamento_{ano}_{mes}` com estrutura `{ dataFechamento: string, fechado: boolean, fechadoEm: ISO timestamp }`. Controla o fechamento mensal global da Folha de Ponto.
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

### Folha de Ponto — Fechamento de Período

Feature completa implementada em 2026-05-07. Arquitetura:

**Campos Período De/Até no formulário:** cada folha tem `periodoDe` e `periodoAte` (auto-preenchidos com 1º e último dia do mês, editáveis pelo gestor).

**Painel de Fechamento** (faixa acima do formulário):
- Exibe o período atual (ex: "Maio / 2026")
- Campo de data + botão "Salvar" para configurar a data de fechamento global
- Status dinâmico: "🟢 Período Aberto" ou "🔒 Período Fechado"
- Botão "🔒 Fechar Todas as Folhas" — fecha todas as folhas do mês com confirmação

**Auto-fechamento:** ao navegar para Folha de Ponto, `checkAutoFechamento()` verifica se `today >= dataFechamento`; se sim, fecha automaticamente todas as folhas abertas do período atual.

**Fechar folha individual:** botão "🔒 Fechar esta Folha" por colaborador (visível quando a folha está aberta e salva). Útil para demissões no meio do mês. Chama `fecharFolhaIndividual()`.

**Reabrir folha:** botão "🔓 Reabrir esta Folha" por colaborador (visível quando fechada). Exige confirmação. Chama `reabrirFolha()`.

**Formulário bloqueado:** quando uma folha está fechada, todos os campos ficam `disabled` e com opacidade reduzida. Função `_lockPayrollForm(lock: boolean)`.

**Funções principais:**
- `configurarDataFechamento()` — salva a data em `configuracoes/fechamento_{ano}_{mes}`
- `fecharPeriodo()` — fecha todas as folhas abertas do mês
- `fecharFolhaIndividual()` — fecha uma folha individual (seta `status='fechada'` e `fechadoEm`)
- `reabrirFolha()` — reabre uma folha fechada
- `_lockPayrollForm(lock)` — habilita/desabilita o formulário
- `_updateFolhaStatusBadge(payroll)` — atualiza o badge visual de status
- `_updatePainelFechamento(cfg)` — atualiza o painel superior com a config atual
- `checkAutoFechamento()` — verifica e executa auto-fechamento ao entrar na seção

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

## PWA / Debug (`ponto.html`)

O app do colaborador é instalável como PWA (tem `manifest.json` + service worker). Cuidados:

- **Cache pode prender versão velha** mesmo após deploy. Sintoma: usuário vê erro JS antigo que já foi corrigido no código atual.
- **Para destravar no celular:**
  1. **Caminho fácil:** fechar PWA totalmente nos "apps recentes" → reabrir → fechar de novo → reabrir. (2 ciclos: 1º detecta SW novo, 2º aplica.)
  2. **Caminho nuclear:** Chrome → 3 pontos → Configurações → Privacidade → Limpar dados de navegação (Cookies + Cache, "Última hora"). Desinstalar PWA da tela inicial e reinstalar.
- **Para forçar update via código:** bumpar `CACHE` em `ponto-sw.js` E mudar/bumpar query string em `<script src="firebase-config.js?v=...">` em `ponto.html`.
- **Erros silenciosos no login:** o catch em `doLogin()` agora mostra mensagem específica (`failed-precondition`, `permission-denied`, `!navigator.onLine`, etc.) — não envolver o erro real em "Erro de conexão" genérico, que esconde bugs reais.

---

## Pendências conhecidas

### Limpeza / Operacional
- **Apagar pasta `Netlify/` local** — só tem `netlify.toml` antigo, projeto não é mais usado.
- **Apagar projeto Netlify online** (`effervescent-lollipop-d43f31`) — já está pausado pelo Netlify por exceder limite de crédito; antes de excluir, conferir Forms e Domain management (espera-se vazios).
- **Renomear pasta `Software/`** para algo mais descritivo (ex: `DRG_Sistema/`). Antes de tentar: fechar Claude Code, fechar editores, fechar Explorer, **pausar Google Drive Sync**, depois renomear pelo Explorer. Reabrir Claude Code no caminho novo depois.
- **Mover ou criptografar `Backup_DR_Global/`** — contém dados pessoais (CPF/RG/salário/PIX) e está dentro do Google Drive sincronizado. Risco de LGPD se a conta Drive vazar. Mover para HD externo ou pasta criptografada (BitLocker/Veracrypt).
- **Apagar `.claude/`** (opcional) — pasta de trabalho da IA, recriada automaticamente.

### Testes pendentes
- Validar destravamento do PWA no celular após fix do Service Worker (network-first). Se ainda persistir bug "Cannot access 'db' before initialization", seguir o protocolo "PWA / Debug" deste arquivo.
- Testar leitura de IA com escalas 5x2A, 5x2B, 6x1A, 6x1B (apenas 12x36 foi validado).

### Segurança / Refactor
- **Firebase Auth — Caminho A (Anonymous Auth)** — implementar `firebase.auth().signInAnonymously()` após login do sistema próprio, e endurecer regras Firestore de `if true` para `if request.auth != null`. Esforço estimado: ~30 min, sem disrupção pra usuários. Decisão do usuário em pausa.
- **Firebase Auth — Caminho B (Migração completa)** — substituir o módulo `Auth` atual (SHA-256 sem salt) por Firebase Auth real (e-mail + senha). Implica migrar usuários existentes (envio de reset de senha) e reescrever regras do Firestore com `request.auth.uid`. Esforço: 4-5h em outro turno.
- **Regras Firestore/Storage abertas** (`if true`) — vinculado ao Firebase Auth. Endurecer assim que o Caminho A ou B estiver em vigor.
- **API key Gemini** — RESOLVIDO via Cloudflare Worker (chave nunca mais em código público).

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

- **2026-05-06**: Migração Gemini direto → Cloudflare Worker proxy (Google revogou chave por leak no repo público). Worker em `https://drg-gemini-proxy.zett-romao.workers.dev`, chave `GEMINI_API_KEY` como Secret. Conta Cloudflare em `zett.romao@gmail.com`.
- **2026-05-06**: Implementadas features Acúmulo de Função, Insalubridade, Bonificação Boa Permanência (com flag de exceção), PLR completo (parametrização + alertas no dashboard).
- **2026-05-06**: Corrigido bug Firestore login no `ponto.html` (query `!=` exigia índice composto não criado).
- **2026-05-06**: Corrigido `firebase-config.js` para chamar `initializeApp` (ponto.html não inicializava Firebase).
- **2026-05-06**: `ponto-sw.js` migrado de cache-first para network-first em HTML/JS/CSS/JSON. Cache name bumpado para `drg-ponto-v3-20260506` para invalidar caches antigos. Bug "Cannot access 'db' before initialization" no celular era resultado de SW servindo `firebase-config.js` velho do cache.
- **2026-05-06**: Branch `master` órfão deletado, padronizado em `main`.
- **2026-05-06**: Restrições da chave Firebase (`Browser key auto created by Firebase`) limpas de URL antiga do Netlify; mantidas apenas `zett-romao.github.io/*`, `localhost/*`, `127.0.0.1/*`.
- **2026-05-07**: Software rebatizado como **DRG-Kronos 3.0**. Versão centralizada em `APP_VERSION` no topo de `app.js` — alimenta login e sidebar automaticamente.
- **2026-05-07**: Relatórios migrados de seção própria para modais contextuais em cada módulo (`openReportsModal(allowedTypes, title)`). Sidebar sem item "Relatórios".
- **2026-05-07**: Nova seção **Contabilidade** no sidebar — tabela mensal 24 colunas, exportação CSV, impressão.
- **2026-05-07**: Nova escala **6x1C** (08h–17h dias úteis / Sáb 08h–12h).
- **2026-05-07**: Novo status de colaborador **Licença Maternidade** — badge rosa, card condicional no Dashboard.
- **2026-05-07**: Dashboard: todos os cards tornados clicáveis, navegando para filtro correspondente. Card "Total Remuneração" removido.
- **2026-05-07**: Fix de sincronização: `setEmployeeFilter()` limpa o campo de busca antes de filtrar (bug: busca + filtro de status conflitavam).
- **2026-05-07**: Licença Maternidade ganhou campos de data: `emp-licenca-inicio` e `emp-licenca-termino` (aparecem/somem via `onEmpStatusChange()` conforme status selecionado). Campos salvos no Firestore como `licencaMaternidadeInicio` e `licencaMaternidadeTermino`.
- **2026-05-07**: Fix crítico: `savePayroll()` agora preserva `pontoManualDias` existente ao salvar (antes sobrescrevia o documento inteiro apagando os dados do app).
- **2026-05-07**: `openPontoManual()` virou `async` — faz busca direta no Firestore ao abrir para garantir dados frescos do app de ponto, com fallback para `State.payrolls` em cache.
- **2026-05-07**: Cards de stats clicáveis na Folha de Ponto — os 9 cards do stats-grid agora abrem um painel flutuante com a lista dos colaboradores daquela categoria. Clicar num colaborador no painel fecha o painel e abre a folha daquele colaborador direto. Função: `showPayrollStatDetail(fieldKey, label, color)`.
- **2026-05-07**: Fix de segurança no app de ponto (`ponto.html`) — o app agora grava **apenas** `pontoManualDias` no Firestore com `merge:true`, nunca mais espalhando o `currentPayroll` inteiro. Evita sobrescrever campos da folha editados pelo gestor após o colaborador abrir o app.
- **2026-05-07**: Prévia Parcial de impressão — novo botão "👁 Prévia Parcial" no rodapé do modal Ponto Manual. Calcula tudo em memória (sem salvar), imprime com faixa laranja "PRÉVIA PARCIAL — DOCUMENTO NÃO OFICIAL" e restaura os valores originais. Função: `printPreviewParcial()`. `printFolhaPonto(isPreview=false)` aceita flag para watermark.
- **2026-05-07**: Fechamento de Período — feature completa (ver seção "Folha de Ponto — Fechamento de Período" neste arquivo). Campos `periodoDe`/`periodoAte` no formulário, painel de fechamento global, fechamento individual, auto-fechamento por data, reabrir folha, bloqueio de formulário. Nova coleção `configuracoes` no Firestore.
- **2026-05-07**: Fix `showSection()` — remove `modal-stat-detail` ao trocar de seção via sidebar. Corrigia bug onde o modal de stats aberto impedia cliques em botões de outras seções.
- **2026-05-07**: Contabilidade — linhas pares branco (#ffffff), linhas ímpares azul claro (#EEF2FF). Colaboradores sem folha ganham borda vermelha esquerda (#EF9A9A) independente da cor alternada.
- **2026-05-07**: Relatório Licença Maternidade — novo card no modal de relatórios de Colaboradores (tipo `licenca-mat`). Colunas: #, Reg., Nome, Setor, Posto, Admissão, Início Licença, Prev. Retorno, CPF, Celular.
- **2026-05-07**: Tabela de Colaboradores — colunas dinâmicas: quando filtro "Lic. Maternidade" está ativo, colunas Admissão e CPF são substituídas por "Início Licença" e "Prev. Retorno" com datas em destaque rosa (#C2185B).
- **2026-05-07**: Campos de data na Licença Maternidade — opção "Licença Maternidade" só aparece no select de status ao **editar** (não ao criar novo). Ao selecionar, exibe campos "Início da Licença" e "Previsão de Retorno", salvos como `licencaMaternidadeInicio` e `licencaMaternidadeTermino`.
- **2026-05-07**: Dados da empresa configuráveis via Firestore — novo documento `configuracoes/empresa` com campos `nomeEmpresa`, `cnpj`, `descricao`, `subdesc`, `logoUrl`. Carregados em `init()` via `loadEmpresaConfig()`, aplicados a todos os elementos do DOM por `applyEmpresaConfig()`. Substituem todos os textos hardcoded "D.R. Global Multi Services" em `index.html` (15+ lugares com IDs) e em `printFolhaPonto()` em `app.js`. Nova seção "Configurações" no sidebar (apenas master), com formulário para editar os dados e função `saveEmpresaConfig()`. Helper `_e(campo)` retorna valor da empresa com fallback nos defaults.
- **2026-05-08**: Exportar todas as folhas do mês em PDF (lote) — botão "Exportar Folhas em PDF" na seção Contabilidade. Função `exportarTodasFolhasPDF()` lê payrolls do mês filtrados por status, ordena por nome, gera HTML de cada folha via `_buildFolhaHtmlFromRecord(emp, p)` (lê direto do registro Firestore, sem tocar no formulário), concatena com `page-break-after:always` e abre janela de impressão única. Inclui tabela de ponto diário, demonstrativo financeiro, assinaturas e badge "✓ FOLHA FECHADA" para folhas fechadas. Usuário faz Ctrl+P → Salvar como PDF e envia à contabilidade terceirizada.
- **2026-05-08**: Distribuição em pen drive implementada. Arquivos: `montar_pendrive.bat` (monta a pasta `_pendrive/` com todos os arquivos do sistema + `ABRIR.bat` launcher + `firebase-config.js` template sem credenciais), `firebase-config.template.js` (template para novos clientes). Pasta `_pendrive/` está no `.gitignore`. `manual_implantacao.html` criado (guia completo para o revendedor implantar em novo cliente). Manuais master/gestor atualizados para v9.0 com seção Configurações da Empresa. Manuais em `../Manuais/Manuais_DRG_Port/` (fora do repo git).

---

## Estilo de comunicação que o usuário prefere

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Honestidade sobre risco e trade-offs (ex: "isso pode quebrar X", "essa abordagem é hacky mas resolve")
- Confirmar antes de ações destrutivas (delete branch, force push, etc.)
- Não rodar comandos sem necessidade — terminal é caro de contexto

E-mail do usuário: `zett.romao@gmail.com`
