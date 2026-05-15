# DRG Systems — Notas de Projeto

Este arquivo serve como memória de contexto pro Claude (ou outra IA) que abrir este projeto. Leia antes de fazer mudanças relevantes.

---

## O que é

**Nome comercial do software: DRG-Kronos 3.0**
A versão é controlada pela constante `APP_VERSION` no topo de `app.js` — altere apenas lá, ela alimenta automaticamente a tela de login e o rodapé do sidebar.

Sistema de gestão de colaboradores para a empresa **D.R. Global Multi Services** (portaria/condomínios). Inclui:

- Cadastro de colaboradores (dados pessoais, endereço, contrato, benefícios, férias, documentos, refeição)
- Folha de ponto mensal (com leitura automática de PDF via IA + ponto manual com suporte a turno noturno cross-midnight)
- **Escalas** mensais projetadas automaticamente por colaborador (5x2, 6x1, 12x36) com edição inline e exportação PDF/Excel/Word
- CCT (Convenção Coletiva de Trabalho) com parametrização global
- Dashboard com alertas (exames, férias, contratos, PLR) e cards clicáveis
- Gestão de postos de trabalho e contratos
- **Pagamentos / 13º Salário / Férias** com cálculos CLT (INSS/IRRF/FGTS tabela 2026)
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
- `employees` — colaboradores. Campos relevantes recentemente adicionados: `acumuloFuncao` boolean, `insalubridade` 0/20/40/60, `bonificacaoSemprePagar` boolean, `horarioRefIni` / `horarioRefFim` (Início/Retorno Refeição — default 12:00–13:00 quando vazios), `dependentesIRRF`, `pensaoAlimenticia`, `planoSaude`, `outrosProventos[]`, `outrosDescontos[]`.
- `payrolls` — folhas de ponto mensais. Campos: `periodoDe`/`periodoAte` (DD/MM/AAAA), `status` (`'aberta'` | `'fechada'`), `fechadoEm` (ISO), `pontoManualDias[]` (dias preenchidos via modal ou app), `inss`/`irrf`/`fgts`/`totalLiquidoFinal` etc.
- `escalas` — **NOVA coleção**. Schema: `{ id, employeeId, mes, ano, dias:[{dia, diaSem, tipo:'trabalho'|'folga', entrada, intIni, intFim, saida, revisao?:bool}], createdAt, updatedAt }`. Documento único por colaborador/mês. Listener real-time em `init()`.
- `configuracoes` — Documentos `fechamento_{ano}_{mes}` (controle de fechamento) e `empresa` (nome, CNPJ, descrição, logoUrl, modoContabilidade).
- `decimoTerceiro` — id `{empId}_{ano}` — cálculo de 13º com 1ª e 2ª parcela.
- `ferias` — id `{empId}_{ano}_{inicio}` — período de gozo, abono, demonstrativo.
- `cct` — documento único `id: 'current'`
- `bancoHoras` — **coleção**. Cada doc é um lançamento. Crédito de folha: id fixo `bh_folha_{payrollId}` (idempotente) `{tipo:'credito', horas, data, validade, origem:'folha', competencia, payrollId}`. Débito manual: id `genId()` `{tipo:'debito', horas, data, origem:'manual', observacao}`. Saldo = créditos − débitos; expiração via FIFO (`bancoProximaExpiracao`). Listener em `init()`.
- `users` — usuários do sistema (login custom, NÃO Firebase Auth)
- `accessLog` — log de auditoria
- `postos`, `contratos`, `perfis` — outros recursos

### CCT — campos novos relevantes
- `cct.salarioMinimo` (default 1518) — base da insalubridade
- `cct.bonificacao` — valor da bonificação Boa Permanência
- `cct.plrValorAnual`, `cct.plrAvisoDias`
- `cct.plrP1Valor`, `cct.plrP1DataLimite`, `cct.plrP1DataPagamento`
- `cct.plrP2Valor`, `cct.plrP2DataLimite`, `cct.plrP2DataPagamento`
- `cct.bancoValidadeMeses` (default 12) — validade das horas no banco de horas
- `cct.bancoAvisoDias` (default 30) — antecedência do alerta de expiração no Dashboard

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
- **Código de recuperação de acesso:** `DRGlobal@Master2025` — digitado no modal de recuperação da tela de login, recria o usuário `master-default` com a senha `Admin@DRGlobal25`

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

# Validar sintaxe do JS ANTES de cada push (Node.js LTS instalado na máquina)
node --check app.js
node --check ponto-sw.js
```

> **Fluxo obrigatório antes de publicar:** rodar `node --check app.js` (e nos demais .js alterados). Só fazer `git push` se passar. Evita publicar código quebrado.

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
- **2026-05-08**: Módulo de Pagamentos — Part 1a: nova aba "Encargos & IRRF" no cadastro de colaborador com campos `dependentesIRRF` (0-10), `pensaoAlimenticia`, `planoSaude`, e listas dinâmicas `outrosProventos` / `outrosDescontos` (descrição + valor, adicionadas/removidas dinamicamente). Salvo no Firestore junto com o cadastro. Funções `renderOutrosItens`, `addOutroItem`, `removeOutroItem`, `collectOutrosItens`.
- **2026-05-08**: Botão Voltar global — `State.sectionHistory[]` empilha seções visitadas. `goBack()` desempilha sem criar nova entrada (flag `_navigatingBack`). `_updateBackBtn()` mostra/oculta `#btn-voltar` no topbar. Botão estilizado com hover azul; label "Voltar" oculto em mobile < 480px via CSS `.btn-voltar-label`. Cap de 30 entradas na pilha.
- **2026-05-08**: Módulo de Pagamentos — Part 3: card "Folha do Mês" no Dashboard adaptado ao modo de contabilidade. Se interna/ambas: mostra totalLiquidoFinal + INSS + FGTS, navega para Pagamentos. Se externa: mostra total de remunerações, navega para Contabilidade. Configurações ganhou campo `modoContabilidade` (interna/externa/ambas, salvo em `configuracoes/empresa`). Banners contextuais inseridos em Pagamentos (`pag-modo-banner`) e Contabilidade (`cont-modo-banner`) — aplicados por `_applyModoBanners(modo)` ao entrar nas seções e ao salvar config. EMPRESA_DEFAULTS inclui `modoContabilidade:'ambas'`.
- **2026-05-08**: Módulo de Pagamentos — Part 2: nova seção "Pagamentos" no sidebar (`nav-pagamentos-li`, `section-pagamentos`). Stats grid com 6 cards clicáveis (Total da Folha, INSS, IRRF, FGTS empregador, Com Holerite, Sem Holerite). Tabela com colunas: #, Reg., Nome, Cargo, Sal. Base, Total Bruto, INSS, IRRF, FGTS, Líquido Final, Status (badge fechada/aberta/sem folha), Ação (botão abre folha do colaborador). Totais no rodapé da tabela. Exportação CSV e impressão. `pagamentos` adicionado a `MODULOS_LABELS`, `getUserModules` (master + operador), `applyUserSession`, `showSection`, profile modal checkbox. Funções: `renderPagamentos()`, `exportPagamentosCsv()`, `printPagamentos()`.
- **2026-05-08**: Módulo de Pagamentos — Part 1b: cálculos INSS/IRRF/FGTS adicionados. Funções puras `calcINSS` (tabela progressiva 2026, teto R$ 8.157,41), `calcFGTS` (8%), `calcIRRF` (tabela progressiva 2026 com deduções por dependente R$ 189,59 e pensão). Card "Encargos Legais & Líquido Final" adicionado ao formulário da Folha de Ponto (ID `encargos-legais-card`, oculto até colaborador ser selecionado). Campos read-only: `payroll-total-bruto`, `payroll-outros-proventos`, `payroll-outros-descontos`, `payroll-inss`, `payroll-irrf`, `payroll-fgts`, `payroll-plano-saude-desc`, `payroll-pensao`, `payroll-total-liquido-final`. `recalculate()` atualiza todos os campos no final. `savePayroll()` salva novos campos. `_buildFolhaHtmlFromRecord()` exibe encargos no holerite com seções Proventos / Descontos + box de resumo de encargos à direita. Retrocompatível: registros antigos sem encargos exibem `totalLiquido` pela fórmula antiga.
- **2026-05-08**: Módulo 13º Salário — nova seção `decimoterceiro` no sidebar. Tabela com colunas: #, Reg., Nome, Meses, Total Bruto, 1ª Parcela, INSS, IRRF, FGTS*, 2ª Parcela Líq., Status. Modal com demonstrativo completo (campos readonly calculados automaticamente), datas de pagamento das parcelas, status (Pendente/Parcial/Pago), observações. Impressão de recibo individual por colaborador. Cálculos: INSS sobre total bruto (tabela progressiva 2026), IRRF sobre 2ª parcela (após INSS), FGTS 8% patronal informativo. Proporcional por meses trabalhados no ano (>15 dias = mês completo). Salvo em coleção `decimoTerceiro`, ID `{empId}_{ano}`. Funções: `renderDecimoTerceiro`, `openDecimoTerceiro`, `_calcDecTercPreview`, `saveDecimoTerceiro`, `printDecimoTerceiro`, `printDecimoTerceiroLista`. DB.listen em `init()`.
- **2026-05-08**: Módulo Férias — nova seção `ferias` no sidebar. Tabela com colunas: #, Reg., Nome, Cargo, Período Aquisitivo (calculado automaticamente da admissão), Direito (ano), Status (Pendente/Agendadas/Gozadas). Modal com: início/fim do gozo, abono pecuniário (0–10 dias, oculto se 0), demonstrativo calculado automaticamente (salário de fruição, 1/3 constitucional, abono, INSS, IRRF, total líquido). Impressão de recibo com nota sobre isenção do abono. Cálculos: INSS sobre (fruição + terço), abono pecuniário isento de INSS (art. 144 CLT), IRRF sobre (fruição + terço - INSS - dependentes - pensão). Salvo em coleção `ferias`, ID `{empId}_{ano}_{inicio}`. Funções: `renderFeriasModulo`, `openFeriasModulo`, `calcFeriasModuloPreview`, `saveFeriasModulo`, `printFeriasModulo`. DB.listen em `init()`.
- **2026-05-08**: Distribuição em pen drive implementada. Arquivos: `montar_pendrive.bat` (monta a pasta `_pendrive/` com todos os arquivos do sistema + `ABRIR.bat` launcher + `firebase-config.js` template sem credenciais), `firebase-config.template.js` (template para novos clientes). Pasta `_pendrive/` está no `.gitignore`. `manual_implantacao.html` criado (guia completo para o revendedor implantar em novo cliente). Manuais master/gestor atualizados para v9.0 com seção Configurações da Empresa. Manuais em `../Manuais/Manuais_DRG_Port/` (fora do repo git).
- **2026-05-08**: Bug fix turno noturno (commit `fa0be22`) — intervalo cross-midnight (`intIni > intFim`) agora soma 24h em vez de retornar 0; helper `_calcIntervaloMin` centraliza a lógica nos 5 locais. Modal de Ponto Manual mostra dicas "⚠ Saída no dia seguinte" / "⚠ Fim no dia seguinte" automaticamente quando entrada > saída no mesmo card. Tabela impressa marca cross-midnight com sufixo "(+1)" laranja. Escala 12x36: dias vazios não contam mais como falta no resumo automático e aparecem como "Folga" na impressão (alinha com regra anti-engano da IA Gemini).
- **2026-05-08**: Módulo **Escalas** completo (commit `991b4ed` + `f6009fb`) — nova seção `escalas` no sidebar entre Folha de Ponto e Pagamentos. Card no Dashboard mostra contagem de escalas projetadas vs pendentes. Algoritmos de projeção por família: 5x2 (Seg-Sex trabalho), 6x1A/C (Seg-Sáb trabalho), 6x1B (folga rotativa, detecta âncora do mês anterior — sem dados marca tudo trabalho com ⚠), 12x36 (alternância detectada do último dia trabalhado do mês anterior — sem dados começa dia 1 com ⚠). Cores: 5x2/6x1 → Sáb amarelo suave / Dom rosa suave; 12x36 → trabalho azul claro / folga amarelo claro alternados. Edição inline (entrada, intIni, intFim, saída) + status clicável Trabalho⇄Folga. Filtros: nome, posto, setor, escala, turno (diurno/noturno). Exports sem libs externas: Print (window.print), Excel (.xls via HTML+Blob), Word (.doc via HTML+Blob). Nova coleção Firestore `escalas` com schema `{id, employeeId, mes, ano, dias:[{dia, diaSem, tipo, entrada, intIni, intFim, saida}], createdAt, updatedAt}`. Listener real-time em `init()`. Módulo `escalas` adicionado a `MODULOS_LABELS`, `getUserModules` (master + operador true por default), `showSection` check, `applyUserSession` toggle, e checkbox no modal de perfil customizado (`f6009fb`). Novos campos no colaborador: `horarioRefIni` / `horarioRefFim` (Início/Retorno Refeição, default 12:00–13:00). Refeição também aparece no "Horário Contratual" da folha de ponto impressa (sincronização).
- **2026-05-08**: Atualização documentação — manuais master/gestor ganharam seção dedicada "Escalas" (s7b master, s10b gestor) com algoritmos por escala, cores, edição, filtros e exportações. PROMPT_DO_PROJETO.md reescrito da v5 (Netlify) para v6 (DRG-Kronos 3.0 / GitHub Pages / Cloudflare Worker / todos módulos atuais). Pendrive ressincronizado via `montar_pendrive.bat` + cópia manual dos manuais.
- **2026-05-08**: Refeição em massa + flag "Sem refeição" — novo campo `semRefeicao` (boolean) no colaborador, com checkbox no cadastro ("Trabalha sozinho — sem horário de refeição"). Quando ativo, projeção da escala deixa intIni/intFim vazios; folha impressa mostra "(Sem refeição)" em vermelho no Horário Contratual; badge "🚫 Sem refeição" no card da Escala. Botão "🍽 Refeição em massa" no card da Escala abre modal `modal-bulk-refeicao` com inputs de início/retorno + dia inicial + checkboxes "atualizar cadastro" / "aplicar a meses futuros". Função `applyBulkRefeicao()` cascateia: (1) atualiza DOM de dias >= startDia onde tipo=trabalho; (2) salva `employees/{id}` com novos defaults se checkbox; (3) percorre `escalas` futuras (mes,ano > atuais) atualizando intIni/intFim de todos os dias com tipo=trabalho. Card é marcado como dirty; usuário ainda precisa clicar Salvar pra confirmar o mês atual.
- **2026-05-08**: Default de refeição diferenciado por turno — `_escalaHorariosDia()` agora usa 12:00–13:00 para diurno e 00:00–01:00 para noturno (`emp.turnoNoturno`) quando o colaborador não tem `horarioRefIni/Fim` no cadastro. Antes, todos caíam em 12:00–13:00 mesmo noturnos.
- **2026-05-08**: Edição em folgas (troca de dias entre colaboradores) — inputs em linhas de Folga ficam editáveis (apenas dimmed com opacity .55, sem `disabled`). Ao digitar qualquer horário numa linha de Folga, `onEscalaCellEdit` auto-converte para Trabalho: atualiza `dataset.tipo`, troca o badge para "Trabalho", restaura opacidade e pré-preenche os outros 3 campos vazios usando `_escalaHorariosDia(emp, diaSem)`. `toggleEscalaTipo` simplificado (não usa mais `disabled`). Casos de uso: trocas pontuais entre colaboradores, plantões extras em dia de folga, edições caso a caso.
- **2026-05-11**: Benefícios a Pagar complementado — planilha com Matrícula + Chave PIX + Período explícito + export Excel (.xls). Modal lista geral ganhou 4 colunas (Matr., Período, PIX + as anteriores). Modal individual mostra Matrícula/CPF/PIX no header (caixa verde destacando a chave). PDFs e .xls geram planilha completa pra pagamento manual (PIX/espécie/cartão). `_abrirJanelaExport(html, formato, baseName)` aceita 'excel' agora (Blob application/vnd.ms-excel + UTF-8 BOM, download via `<a download>`).
- **2026-05-11**: Card "Benefícios a Pagar" no Dashboard + 2 modais (lista + detalhe individual). Card mostra contadores e totais Hoje + Esta Semana. Modal `modal-beneficios-pagar` tem tabs Hoje|Esta Semana com tabela colaboradores × VT/AM × VR × Total. Click no nome ou ícone abre `modal-beneficio-detalhe` com planilha editável dos benefícios daquele colaborador (valores override locais para a impressão; não persistem). Botões: Imprimir, Exportar PDF (via window.print()). Helpers: `_colabTrabalhaNoDia(emp, dataISO)` resolve via escala salva > pontoManualDias > escala contratual; `_colabsTrabalhandoEm(dataISO)` retorna lista; `_diasTrabalhadosNoIntervalo(emp, ini, fim)` itera dias; `_semanaDe(dataISO)` retorna segunda-domingo da semana; `_calcBeneficiosColab(emp, ini, fim, escopo)` computa valores conforme freq cadastrada. Inativos ignorados.
- **2026-05-11**: VT/AM e VR com frequência diária OU semanal (separados por benefício) — novo campo `vtFreq` e `vrFreq` no cadastro do colaborador (default 'diario'). Cálculo no recalculate + savePayroll: se 'semanal', usa `_semanasTrabalhadas(dias, escala)` (5x2=5d/sem, 6x1=6d/sem, 12x36=3.5d/sem, ceil) em vez de dias. Helpers `onVtFreqChange/onVrFreqChange/_updateVtLabel` ajustam dinamicamente os labels (Valor Diário/Semanal VT/AM e VR). Campo `semanasTrabalhadas` também salvo no payroll para auditoria. Dias não preenchidos = não recebe (proporcionalidade real). VA continua mensal (regra de proporcionalidade por faltas inalterada).
- **2026-05-10**: Cadastro do colaborador expandido — 14 novos campos pessoais em "Dados Pessoais": `sexo`, `rgExpedicao` + `rgOrgao`, `estadoCivil`, `localNascimento` + `ufNascimento`, `raca`, `nomeMae` + `nomePai`, `grauInstrucao` + `instrucaoConcluido`, `pisData`, `tituloZona` + `tituloSecao`, `ctpsEmissao`, `cnh` + `cnhCategoria`. Persistidos no schema do colaborador. Layout dividido em seções com `<div class="divider">` separando "dados pessoais", "documentos & eleitorais" e "dependentes".
- **2026-05-10**: Dependentes do colaborador — nova seção dinâmica em "Dados Pessoais" com botão "+ Adicionar dependente". Funções `renderDependentes/_createDependenteRow/addDependente/removeDependente/collectDependentes`. Cada dep tem `{nome, cpf (com maskCpf), dataNasc}`. Salvos em `emp.dependentes` (array). Linhas com nome vazio são descartadas no save. Alerta visual informa que esses dados são informativos — pra abater IRRF, ajustar `Encargos & IRRF → Dependentes IRRF` (campo separado já existente).
- **2026-05-10**: Documentos "Outros" — select de Tipo de Documento expandido (RG, CPF, Comprovante de Residência, Contrato de Trabalho, CTPS, Título de Eleitor, PIS/NIT, CNH, Exame Médico, Atestado, Outros). Quando "Outros" selecionado, aparece input `doc-tipo-outros` exigindo especificar manualmente qual é o documento. `uploadDocument()` sanitiza (`/[\\/:*?"<>|]/g → -`) e usa o nome custom como prefixo no Storage. `onDocTipoChange()` controla visibilidade do row. Reset após upload bem-sucedido.
- **2026-05-10**: Fix bug crítico do adiantamento quinzenal — `onPayrollEmployeeChange` agora carrega o payroll salvo (via `loadPayrollRecord`) quando existe, ou chama `_resetPayrollFieldsOnly` (novo helper) quando não existe. Antes o `payroll-adiantamento-ativo` "vazava" entre colaboradores: setado em A para "sim", ao abrir B continuava "sim" (mesmo bug com bonus, HE, faltas etc.). Reset inclui adiantamento, bonus, HE, HE corrido, faltas, encargos, atrasos, acúmulo, insalubridade. Campos vindos do cadastro (VT, VR, PIX, horários) continuam sendo setados depois.
- **2026-05-08**: 3º status na escala — **Corrido** (hora corrida, sem refeição). Ciclo do badge: Trabalho → Corrido → Folga → Trabalho. Quando tipo='corrido': entrada/saída visíveis e editáveis (preenchidos com defaults), refeição zerada e esmaecida (.4 opacity). Helper `_escalaTipoBadge(tipo)` centraliza renderização das 3 badges (verde briefcase / roxo person-running / laranja umbrella-beach). `onEscalaCellEdit` adiciona regra: se corrido e usuário digita em campo de refeição, auto-converte para trabalho normal. `applyBulkRefeicao` continua filtrando `tipo==='trabalho'`, então pula corridos automaticamente. Útil para o caso de domingo trabalhado sozinho (sem rendido) sem precisar setar `semRefeicao` global no cadastro.
- **2026-05-08**: HE Corrido — hora corrida vira hora extra com adicional configurável por dia. Ao marcar Corrido na Escala, abre modal `modal-corrido-perc` com botões 50/60/70/100 + input custom. `setCorridoPerc(perc)` grava em `row.dataset.hePerc` e `_escalaTipoBadge('corrido', 60)` mostra "🏃 Corrido +60%". `cancelCorridoPerc()` reverte para o tipo anterior se usuário cancelar. `_collectEscalaDias` salva `hePercDia` apenas em dias corridos. **Sincronização com Folha de Ponto:** `recalculate()` lê `State.escalas` do colaborador no mês corrente, agrupa minutos corridos por % (buckets) — cada bucket vira `(min/60) * (salBase/220) * (1+perc/100)`. Duração da refeição = `(emp.horarioRefFim - emp.horarioRefIni)` ou 60min default. Resultado preenche os 3 campos read-only `payroll-he-corrido-min/detalhe/valor` em novo bloco roxo dentro do card "Horas Extras". `heCorridoValor` adicionado a `totalBruto` (junto de heValEnc) e a `totalLiquidoFinal`. `savePayroll` persiste `heCorridoMin / heCorridoDetalhe / heCorridoValor`. `loadPayrollRecord` restaura. `printFolhaPonto` e `_buildFolhaHtmlFromRecord` (lote PDF) mostram linha "HE Hora Corrida — N min a +X%" no demonstrativo financeiro. Caixa-zerada quando colaborador não tem corridos. Detalhe formato: `Σmin a +%` (ex.: "1h00 a +50% · 1h00 a +100%" se mistura).
- **2026-05-08**: Revisão de HE com tolerância CLT — sistema detecta divergências entre ponto batido e horário esperado, aplica Súmula 366 TST (5min/batida, 10min/dia), e exige aprovação manual acima da tolerância.
  - **Origem da batida:** cada campo (entrada/saida/intIni/intFim) ganha sufixo `_origem` = 'app' (batido no PWA) ou 'manual' (lançado pelo operador). PWA grava `_origem='app'` automaticamente em `ponto.html`. Modal Ponto Manual: `onPontoManualEdit(input)` marca como 'manual' ao editar, `_updatePontoOrigemMarker()` exibe asterisco `*` laranja ao lado do input.
  - **Helpers:** `_getExpectedDay(emp, mes, ano, dia)` retorna horário esperado priorizando `State.escalas` salva, fallback para `emp.horarioEntrada/Saida/RefIni/Fim`. `_detectHEDivergencia(real, expected)` calcula excesso de entrada/saída/almoço encurtado e retorna `{totalMin, motivos[], precisaRevisao}` — precisaRevisao=true se totalMin > 10. `_effectiveMinLiq(real, expected)` decide qual minLiquidos usar no cálculo de HE: dentro da tolerância → expected (CLT ignora); acima e aprovado → real (conta); acima e pendente/abonado → expected (zera indevida).
  - **calcResumoManual/applyPontoManual:** trocaram fórmula direta por `_effectiveMinLiq` + chama `_updateHEReviewBadge` por card. Resumo do modal agora tem linha extra "X dia(s) com HE acima da tolerância — revisar agora".
  - **Schema heReview** salvo em `pontoManualDias[d].heReview = {status: 'pendente|aprovado|abonado', perc, observacao, aprovadoPor, aprovadoEm}`.
  - **Modal "Revisar HE do mês"** (`modal-he-review`): abre via `openHEReview()`, lista linhas com divergência > 10min/dia, cada linha tem 3 botões (Aprovar / **Editar** / Pendente) + select de % (50/60/70/100) + observação livre + audit (quem aprovou e quando). `saveHEReview()` grava no Firestore, recalcula folha imediatamente, registra no `accessLog` (HE_REVIEW_SAVED).
  - **Botão "Editar" (substitui antigo "Abonar")**: clicar abre formulário inline com 4 inputs (entrada/saida/intIni/intFim) pré-preenchidos com os valores atuais. `_startHEReviewEdit/_cancelHEReviewEdit/_applyHEReviewEdit` controlam o ciclo. Ao Aplicar, recalcula divergência com novos valores: se ≤ 10min agora, dia some da lista no save (heReview limpo); se > 10min, mantém na lista para nova decisão. Campos editados são salvos com `_origem='manual'` no `pontoManualDias[d]` — refletem com asterisco no Ponto Manual. Records legados com `status='abonado'` continuam funcionais (são tratados visualmente como pendente).
  - **Permissão `aprovaHE`** em MODULOS_LABELS + getUserModules (master sempre, operador não por default, perfis customizados configuráveis via checkbox no modal-perfil). Botão `btn-revisar-he` no card "Horas Extras" da Folha de Ponto fica `hidden` se sem permissão (`applyUserSession` toggla).
  - **Dashboard:** novo card laranja "Pendentes de revisar HE" mostra contagem (`heRevisaoEmps`, `heRevisaoDias`) baseada em `_detectHEDivergencia` de todos os payrolls do mês. Clique vai pra `_dashGotoHEReview()` que abre Folha de Ponto pré-filtrada e dispara `openHEReview()` no 1º colaborador pendente.
- **2026-05-15**: Leitura de documentos com IA no cadastro de colaborador — nova caixa "Preenchimento automático com IA" no topo da aba Dados Pessoais do `modal-employee`. O gestor seleciona múltiplas fotos/PDFs de documentos (RG, CPF, CNH, CTPS, PIS/NIT, Título de Eleitor, comprovante de residência); cada arquivo vira uma chamada Gemini via o Cloudflare Worker existente (`callGeminiCadastro`), os resultados são mesclados (1ª ocorrência não-nula vence) e aplicados aos campos das abas Dados Pessoais e Endereço por `applyCadastroExtraction` — selects casados por value/text, máscaras de CPF/celular/CEP reaplicadas, campos preenchidos piscam em amarelo (`.ia-filled-flash`). Funções: `onCadastroDocsSelected`, `_renderCadastroDocList`, `removeCadastroDoc`, `processCadastroDocs`, `callGeminiCadastro`, `applyCadastroExtraction`, `_resetCadastroImport` (chamada em `openEmployeeModal`). Escopo: só dados pessoais/endereço — salário, escala, posto, benefícios e encargos seguem manuais (não existem em documentos).
- **2026-05-15**: Memórias do projeto unificadas — os 4 arquivos da auto-memória interna do Claude (`MEMORY.md`, `user_profile.md`, `project_state.md`, `project_files.md`) foram consolidados neste `CLAUDE.md` e removidos. A partir daqui, este arquivo é a **única** fonte de memória/contexto do projeto.
- **2026-05-15**: Atrasos justificáveis e abonáveis na Folha de Ponto — cartão "Atrasos" ganhou select `payroll-atraso-tipo` (`imotivado`|`motivado`), campo livre `payroll-atraso-justificativa` e checkbox `payroll-atraso-abonado`. Abonado → `recalculate()` zera `descontoAtraso` (registra o atraso mas não desconta) + nota verde `#atraso-abono-note`. `savePayroll` persiste `atrasoTipo`/`atrasoAbonado`/`atrasoJustificativa`; `loadPayrollRecord` restaura; `_resetPayrollFieldsOnly`/`clearPayrollForm`/`_lockPayrollForm` atualizados. Folha impressa mostra "Atraso Abonado — N min (motivado/imotivado · justificativa)" em verde quando abonado, ou "Desconto Atraso" em vermelho quando não. Retrocompatível (registros antigos assumem imotivado/não-abonado).
- **2026-05-15**: Disciplina de horário no app de ponto (Fase 3) — ao bater o ponto, `analisarHorario(prox, now)` compara com o horário previsto do cadastro (`_horarioEsperado`); fora da tolerância de 5 min (`TOLERANCIA_MIN`) mostra o overlay `#aviso-overlay` (**apenas aviso, não bloqueia**) com mensagem e seleção de motivo obrigatória. Saída além do horário → aviso de hora extra. Confirmando, a batida é gravada em `pontoManualDias[dia]` com `{prox}_foraHorario:true` e `{prox}_motivo`. Cancelando, não registra. Funções em `ponto.html`: `timeToMin`, `_horarioEsperado`, `analisarHorario`, `mostrarAvisoHorario`. `ponto-sw.js` CACHE → v5. Conclui as 3 fases do conjunto Rescisão / Parâmetros Legais / Disciplina.
- **2026-05-15**: Módulo de Rescisão / TRCT (Fase 2) — nova seção `rescisao` no menu (permissão configurável por perfil), coleção `rescisoes`. Motor `_calcRescisao(r)` calcula por tipo (`RESCISAO_TIPOS`: sem justa causa, pedido demissão, justa causa, acordo 484-A, fim de contrato, indireta, aposentadoria, falecimento): saldo de salário, aviso prévio (30+3/ano via params), 13º e férias proporcionais (avos via `_contaAvos`, projeção pelo aviso indenizado), férias vencidas+1/3, indenização adicional, INSS/IRRF (saldo e 13º separados), FGTS do mês e multa 40%/20% (saldo FGTS = campo manual). `modal-rescisao` recalcula ao vivo; fechamento trava o cálculo e marca o colaborador inativo; reabertura disponível. `printTRCT(id)` gera o Termo impresso. Alerta no Dashboard para o prazo do art. 477 (10 dias). Funções: `renderRescisoes`, `openRescisaoModal`, `recalcRescisaoModal`, `saveRescisao`, `fecharRescisao`, `reabrirRescisao`, `confirmDeleteRescisao`, `printTRCT`. **Falta a Fase 3:** disciplina de horário no app de ponto.
- **2026-05-15**: Módulo de Parâmetros Legais (Fase 1 do módulo de Rescisão) — tela em Configurações (master) que edita as tabelas oficiais: INSS (4 faixas), IRRF (5 faixas + dedução/dependente), FGTS (alíquota + multas 40%/20%), salário mínimo, teto INSS e regras de aviso prévio. Constante `PARAMS_LEGAIS_DEFAULTS` (valores 2026), `State.parametrosLegais`, doc `configuracoes/parametrosLegais`, helper `_pl()`. `calcINSS`/`calcIRRF`/`calcFGTS` reescritas para ler de `_pl()` (defaults = 2026 → retrocompatível). Funções `loadParametrosLegais`/`openParametrosLegais`/`saveParametrosLegais`, modal `modal-parametros-legais`. Log `PARAMS_LEGAIS_UPDATED`. **Próximas fases:** 2) Módulo de Rescisão/TRCT; 3) disciplina de horário no app de ponto.
- **2026-05-15**: Atraso automático na Folha de Ponto — `calcResumoManual` e `applyPontoManual` passam a computar o atraso do mês a partir do ponto diário, de forma simétrica ao HE. Por dia trabalhado (com horário esperado e tipo≠folga): `faltaDia = _liqMin(expectedDay) − effLiq`; se passar de 10min (tolerância CLT Art. 58) soma em `totalAtrasoMin`. `applyPontoManual` preenche `payroll-atraso-min` automaticamente e o modal Ponto Manual ganhou o item "X de atraso" no resumo (`#ponto-resumo-atraso`). Novo helper `_liqMin(dia)`. O valor preenchido continua editável e pode ser abonado/justificado pelo gestor.
- **2026-05-15**: Node.js 24.15.0 LTS instalado na máquina do usuário (via `winget install OpenJS.NodeJS.LTS`). Passa a fazer parte do fluxo: rodar `node --check <arquivo>.js` antes de cada `git push` para validar a sintaxe e evitar publicar código quebrado.
- **2026-05-15**: Banco de Horas — nova coleção `bancoHoras` + módulo completo. (1) **CCT** ganhou seção Banco de Horas: `bancoValidadeMeses` (12) e `bancoAvisoDias` (30). (2) **Folha de Ponto** — cartão Horas Extras ganhou seletor `payroll-he-destino` (`folha`|`banco`). Quando `banco`: `recalculate()` zera `payroll-he-valor` (não entra em totalBruto/totalLiquido) e mostra nota `#he-banco-note`; `savePayroll()` salva `heDestino` e chama `_syncBancoFromPayroll()` que faz upsert/delete do crédito `bh_folha_{payrollId}` (1:1, validade = último dia da competência + N meses). Excluir a folha remove o crédito. (3) **Modal `modal-banco-horas`** por colaborador (botão no cartão HE) — saldo, próxima expiração, extrato, e form de baixa manual (`addBancoDebito` cria débito; `removeBancoLancamento` só remove manuais). (4) **Dashboard** — `renderAlerts()` avisa quando a leva FIFO mais antiga está a ≤`bancoAvisoDias` de expirar (vermelho se já expirada). Helpers: `bancoSaldo`, `bancoProximaExpiracao` (FIFO), `_syncBancoFromPayroll`, `_ultimoDiaMesISO`, `_addMonthsISO`, `_fmtHoras`. Retrocompatível: folhas sem `heDestino` assumem `folha`. Folha impressa mostra saldo real do banco. Log: `BANCO_HORAS_DEBITO`.

---

## Sobre o usuário (Donizete)

- **Nome:** Donizete Romão — dono da **D.R. Global Multi Services** (portaria/vigilância de condomínios)
- **Porte da empresa:** ~100 funcionários ativos
- **Perfil técnico:** não programa — precisa de instruções claras, objetivas e passo a passo
- **Ambiente:** Windows 11, Google Chrome
- **Contas:** Google / Firebase / Google Cloud / Drive em `zett.romao@gmail.com` · GitHub `zett-romao`
- **Fluxo de trabalho:** Claude edita os arquivos locais e faz `git push` → GitHub Pages publica automaticamente (o usuário só confere o site depois)

## Estilo de comunicação que o usuário prefere

- Português direto, sem rodeios
- Diagnósticos curtos antes de propor solução
- Passo a passo numerado quando há trabalho de UI
- Honestidade sobre risco e trade-offs (ex: "isso pode quebrar X", "essa abordagem é hacky mas resolve")
- Confirmar antes de ações destrutivas (delete branch, force push, etc.)
- Não rodar comandos sem necessidade — terminal é caro de contexto

E-mail do usuário: `zett.romao@gmail.com`
