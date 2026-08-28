// Teste do EXCLUIR SOLICITACAO (app.js, bloco #excluir-solicitacao): quem pode
// sumir da lista de Aprovacoes, quem NUNCA pode, e o que sobra no log depois que
// a linha some. As funcoes sao recortadas do proprio app.js — mexeu na regra la,
// o teste acusa aqui. Dados ficticios (o repo e publico).
//
// Pedido do dono (28/08/2026), na tela com 68 recusadas listadas: "deveria ter a
// opcao de excluir, ne? coloque o botao ali do lado do relancar".
//
// Rodar:  node teste-excluir-pagamento.js
const fs = require('fs');

const APP  = fs.readFileSync(__dirname + '/app.js', 'utf8');
const HTML = fs.readFileSync(__dirname + '/index.html', 'utf8');
const UIJS = fs.readFileSync(__dirname + '/drg-ui.js', 'utf8');
const UICSS= fs.readFileSync(__dirname + '/drg-ui.css', 'utf8');

function bloco(de, ate) {
  const i = APP.indexOf(de), f = APP.indexOf(ate, i);
  if (i < 0 || f < 0) { console.error('FALHA: nao achei o bloco "' + de + '" no app.js'); process.exit(1); }
  return APP.slice(i, f);
}

// ── As funcoes de verdade, recortadas do app.js ─────────────────────────────
let MODULOS = {};
const api = new Function('getUserModules', 'Auth', 'fmtMoney',
  bloco('function _aprPodeExcluirStatus', 'function _aprListaSelecionavel')
  + bloco('function _aprBotoesLinha', 'function _aprovacaoStatusBadge')
  + bloco('function _aprMotivoDe', 'async function excluirSolicitacao')
  + '; return { _aprPodeExcluirStatus, _aprBotoesLinha, _aprMotivoDe, _aprResumoLog };'
)(() => MODULOS, { currentUser: { username: 'usuario.teste' } }, v => 'R$ ' + (+v || 0).toFixed(2));

const sol = (status, extra) => Object.assign({
  id: 'sol_9', employeeId: 'e1', employeeNome: 'FULANA DE TAL FICTICIA',
  valor: 837, pixKey: 'ficticia@example.com', status,
  scheduleDate: '2026-08-03', competencia: '2026-08',
  criadoPorNome: 'lancador.teste', criadoEm: '2026-08-03T10:00:00.000Z',
  aprovadoPorNome: 'aprovador.teste',
}, extra || {});

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };

// ── 1. O que pode sumir: so o que NUNCA virou dinheiro ──────────────────────
MODULOS = { pagamentosLancar: true, pagamentosAprovar: true };
['recusado', 'estornado', 'erro'].forEach(st =>
  ok(api._aprPodeExcluirStatus(sol(st)) === true, `${st} deveria poder ser excluido (nunca virou dinheiro)`));

// 🔒 PAGO nao se exclui: o PIX saiu da conta e a linha e a prova do que foi
//    pago. Pagamento indevido se resolve em "Estornar", nao sumindo com ele.
ok(api._aprPodeExcluirStatus(sol('pago')) === false,
  'PAGO nao pode ser excluido — o dinheiro saiu da conta e a linha e a prova');
ok(api._aprBotoesLinha(sol('pago')) === '', 'linha PAGA nao pode nem exibir o botao de excluir');

// 🔒 PENDENTE tambem nao: ela esta na fila de decisao de outra pessoa. Quem nao
//    quer que siga usa "Recusar", que deixa motivo e autor no registro.
ok(api._aprPodeExcluirStatus(sol('pendente')) === false,
  'PENDENTE nao pode ser excluida — para isso existe "Recusar", que registra o motivo');
ok(api._aprBotoesLinha(sol('pendente')) === '', 'linha PENDENTE nao pode exibir o botao de excluir');

// ── 2. Quem pode excluir: mesma permissao de quem lanca ─────────────────────
MODULOS = { pagamentosAprovar: true };            // aprova, mas nao lanca
ok(api._aprPodeExcluirStatus(sol('recusado')) === false,
  'sem a permissao de LANCAR ninguem exclui');
ok(api._aprBotoesLinha(sol('recusado')) === '',
  'e o botao nem aparece — botao que so recusa DEPOIS do clique e botao mentiroso');

// ── 3. O botao, ao lado do Relancar (foi onde ele pediu) ────────────────────
MODULOS = { pagamentosLancar: true, pagamentosAprovar: true };
const linha = api._aprBotoesLinha(sol('recusado'));
ok(/Relançar/.test(linha) && /Excluir/.test(linha), 'a linha decidida tem os DOIS botoes');
ok(linha.indexOf('Relançar') < linha.indexOf('Excluir'), 'o Excluir vem depois do Relancar');
ok(/display:flex/.test(linha), 'os dois ficam lado a lado, nao empilhados');
ok(/excluirSolicitacao\('sol_9',this\)/.test(linha),
  'o botao passa a si mesmo — e ele que trava e vira "Excluindo..." (regra n 1)');

// ── 4. 🔒 A linha some, o FATO nao ──────────────────────────────────────────
// Sem valor, chave PIX e id no log, "sumiu um lancamento de R$ 837,00" nao se
// apura seis meses depois — e e exatamente quando se pergunta.
const log = api._aprResumoLog(sol('recusado', { motivoRecusa: 'chave pix invalida' }));
[['nome', /FULANA DE TAL/], ['valor', /R\$ 837\.00/], ['chave PIX', /ficticia@example\.com/],
 ['competencia', /comp\. 2026-08/], ['quem lancou', /lancador\.teste/],
 ['quem decidiu', /aprovador\.teste/], ['motivo', /chave pix invalida/], ['id', /id sol_9/]
].forEach(([o, re]) => ok(re.test(log), `o log da exclusao perdeu ${o} — sem isso a exclusao nao se apura`));

// ── 5. O caminho da exclusao ────────────────────────────────────────────────
const regiao = bloco('async function excluirSolicitacao', '// ============================================');
// 🔒 A pergunta e do APP, nunca o confirm() do navegador: o nativo pode estar
//    silenciado ("impedir que esta pagina crie caixas de dialogo") e devolver
//    false sozinho — o botao mais destrutivo da tela viraria um clique mudo.
ok((regiao.match(/await drgConfirmar\(/g) || []).length === 2,
  'as duas exclusoes (linha e lote) tem de perguntar pelo drgConfirmar do app');
ok(!/[^g]confirm\(/.test(regiao.replace(/drgConfirmar/g, 'X')),
  'nenhuma exclusao pode cair no confirm() nativo — ele pode estar silenciado');
// Regra n 1: trava ANTES do await. Clique repetido aqui e exclusao repetida.
ok(/btn\.disabled=true/.test(regiao) && /Excluindo\.\.\./.test(regiao),
  'o botao tem de travar e dizer "Excluindo..." antes do await');
// O log ANTES do apagar: se a gravacao do log falhar, a linha ainda esta la.
ok(regiao.indexOf("Auth.log('PAGAMENTO_EXCLUIDO'") < regiao.indexOf("DB.remove('solicitacoesPagamento'"),
  'o log tem de ser gravado ANTES de apagar a solicitacao');
ok(/PAGAMENTO_EXCLUIDO:\s*\{label:/.test(APP),
  'o evento PAGAMENTO_EXCLUIDO precisa de rotulo no log de acesso, senao sai como codigo cru');

// ── 6. A tela ───────────────────────────────────────────────────────────────
ok(/id="btn-apr-lote-excluir"[^>]*onclick="excluirLote\(\)"/.test(HTML),
  'a barra de selecao precisa do "Excluir selecionados" (68 linhas nao se limpam de uma em uma)');
ok(/id="apr-lote-excluir-n"/.test(HTML), 'com o contador do que esta selecionado');
ok(/global\.drgConfirmar = drgConfirmar/.test(UIJS), 'drgConfirmar tem de estar publicado no window');
ok(/\.drg-conf-ov/.test(UICSS), 'e o CSS do modal tem de existir, senao a pergunta sai sem caixa');
ok(/drg-ui\.js\?v=3/.test(HTML) && /drg-ui\.css\?v=3/.test(HTML),
  'o cache-buster do kit de UI tem de subir junto com o drgConfirmar novo');

console.log('\n' + (falhas.length
  ? 'FALHAS:\n - ' + falhas.join('\n - ')
  : 'OK — excluir solicitacao: so o que nunca virou dinheiro, e o log guarda o que sumiu'));
process.exit(falhas.length ? 1 : 0);
