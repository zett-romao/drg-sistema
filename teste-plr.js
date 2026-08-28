// Teste do motor da PLR (app.js, bloco #plr): leitura da relação do contador,
// casamento com o cadastro, semáforo por linha e trava anti-duplo pagamento.
//
// As funções NÃO são copiadas aqui: o teste recorta o bloco do próprio app.js e
// executa. Se alguém mexer na regra lá, o teste acusa aqui. Dados são fictícios
// de propósito (LGPD) — o que importa é o LAYOUT do relatório, não as pessoas.
//
// Rodar:  node teste-plr.js
const fs = require('fs');

const APP = fs.readFileSync(__dirname + '/app.js', 'utf8');
const ini = APP.indexOf('function _plrDigitos(');
const fim = APP.indexOf('function openPlrModal(');
if (ini < 0 || fim < 0) { console.error('FALHA: bloco PLR nao encontrado no app.js'); process.exit(1); }
const BLOCO = APP.slice(ini, fim);

// ── Relação fictícia no MESMO layout do relatório do contador ────────────────
// (código, nome, CPF, valor) + o lixo que vem junto: cabeçalho, CNPJ da empresa,
// paginação, data/hora, rodapé de conferência e a linha do sistema contábil.
const PESSOAS = [
  ['145', 'ADAO PEREIRA DA COSTA',        '111.111.111-11', '133,50'],
  ['156', 'BENEDITA SOUZA DOS ANJOS',     '222.222.222-22',  '74,90'],
  ['147', 'CARLOS EDUARDO MOTA',          '333.333.333-33', '104,20'],
  ['105', 'DANIELA ROCHA LIMA',           '444.444.444-44', '162,80'],
  ['185', 'EDUARDO NUNES DE SA',          '555.555.555-55',  '16,30'],
  ['94',  'FABIANA MARTINS SILVA',        '666.666.666-66', '162,80'],
  ['128', 'GILBERTO ANDRADE',             '777.777.777-77', '162,80'],
  ['139', 'HELENA CARDOSO PINTO',         '888.888.888-88', '133,50'],
  ['37',  'IVAN DE OLIVEIRA RAMOS',       '999.999.999-99', '162,80'],
  ['150', 'JOANA DARC MACIEL',            '123.456.789-01',  '74,90'],
  ['186', 'KATIA REGINA DO VALE',         '234.567.890-12',  '16,30'],
  ['148', 'LUIS ANTONIO FERRAZ',          '345.678.901-23', '133,50'],
];
const TOTAL = PESSOAS.reduce((s, p) => s + parseFloat(p[3].replace(',', '.')), 0);

const TXT = [
  'RELACAO GERAL DOS LIQUIDOS',
  'Codigo Nome do empregado CPF Valor',
  'Empresa: EMPRESA FICTICIA LTDA',
  'CNPJ: 49.698.112/0001-57',
  'Calculo: Participacao de lucros',
  'Competencia: 08/2026',
  'Pagina:', 'Emissao:', 'Horas:', '1 / 1', '21/08/2026', '15:58:54',
  'Empregados',
  ...PESSOAS.map(p => `${p[0]} ${p[1]} ${p[2]} ${p[3]}`),
  `Empregados: ${PESSOAS.length} Estagiarios: 0 Contribuintes: 0 Total da Empresa: ${TOTAL.toFixed(2).replace('.', ',')}`,
  'BARUERI, 21/08/2026 Responsavel:',
  'Sistema licenciado para CONTABILIDADE FICTICIA',
].join('\n');

// ── Cadastro sintético: todo mundo existe, ativo, chave PIX = CPF ────────────
const State = { employees: [], solicitacoes: [] };
PESSOAS.forEach(p => State.employees.push({
  id: 'e' + p[0], nome: p[1], cpf: p[2], registro: p[0],
  chavePix: p[2], chavePixTipo: 'CPF', status: 'ativo',
}));
const byName = n => State.employees.find(e => e.nome === n);

// Os casos que doem, plantados de propósito:
byName('HELENA CARDOSO PINTO').chavePix = '';                    // sem chave PIX
byName('IVAN DE OLIVEIRA RAMOS').status = 'demitido';            // desligado
byName('IVAN DE OLIVEIRA RAMOS').dataDemissao = '2026-06-30';
byName('JOANA DARC MACIEL').cpf = '12345678901';                 // CPF sem mascara
byName('CARLOS EDUARDO MOTA').nome = 'CARLOS E. MOTA';           // nome divergente
byName('KATIA REGINA DO VALE').cpf = '';                         // sem CPF -> cai no nome
State.employees.splice(State.employees.findIndex(e => e.nome === 'LUIS ANTONIO FERRAZ'), 1); // fora do cadastro

// ── Stubs do que o bloco usa do resto do app ────────────────────────────────
const CAMPOS = { 'plr-mes': '8', 'plr-ano': '2026', 'plr-parcela': '1', 'plr-data': '2026-08-28' };
const val = id => CAMPOS[id] || '';
const currentMes = () => 8, currentAno = () => 2026;
const detectPixKeyType = k => (String(k).includes('@') ? 'EMAIL' : 'CPF');
const canEditModule = () => true;

let _plrData = [], _plrArquivo = null, _plrArquivoNome = '';
eval(BLOCO);   // eslint-disable-line no-eval

// ── Execução ────────────────────────────────────────────────────────────────
const p = _plrParse(TXT);
_plrData = p.linhas.map(l => ({ ...l, valor: l.valorArq, editado: false, manual: false,
  empId: '', empNome: '', matricula: '', pixKey: '', keyType: '', matchPor: '',
  status: 'nao-id', selecionado: false, forcarSelect: false }));
_plrArquivo = { totalArq: p.totalArq, countArq: p.countArq };
_plrCasar();

const soma = a => a.reduce((s, r) => s + (+r.valor || 0), 0);
const sel = () => _plrData.filter(r => r.selecionado && _plrSelecionavel(r));
const linha = nome => _plrData.find(r => r.nomeArq === nome);
const bloqueado = TOTAL - soma(sel());

const cont = (campo) => _plrData.reduce((a, r) => { const k = r[campo] || '(nenhum)'; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log('== LEITURA ==');
console.log('linhas lidas .....', _plrData.length, `(esperado ${PESSOAS.length})`);
console.log('rodape ...........', p.countArq, 'empregados ·', p.totalArq.toFixed(2));
console.log('soma das linhas ..', soma(_plrData).toFixed(2));
console.log('lixo descartado ..', p.ignoradas, 'linha(s)');
console.log('casamento ........', cont('matchPor'));
console.log('situacao .........', cont('status'));
console.log('vai lancar .......', sel().length, 'linhas ·', soma(sel()).toFixed(2),
            '· retido', bloqueado.toFixed(2));

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };

ok(_plrData.length === PESSOAS.length, `leu ${_plrData.length} linhas, esperado ${PESSOAS.length}`);
ok(p.countArq === PESSOAS.length, 'nao capturou o numero de empregados do rodape');
ok(Math.abs(p.totalArq - TOTAL) < 0.005, 'nao capturou o total do rodape');
ok(Math.abs(soma(_plrData) - TOTAL) < 0.005, 'a soma das linhas lidas nao bate com o rodape');
// O CNPJ do cabecalho tem 11 digitos no meio: nao pode virar pagamento.
ok(!_plrData.some(r => r.cpf === '49698112000'), 'CNPJ do cabecalho virou linha de pagamento');

ok(linha('HELENA CARDOSO PINTO').status === 'sem-pix', 'sem chave PIX nao foi barrado');
ok(linha('IVAN DE OLIVEIRA RAMOS').status === 'desligado', 'desligado nao foi sinalizado');
ok(!linha('IVAN DE OLIVEIRA RAMOS').selecionado, 'desligado veio MARCADO — tem de ser marcado a mao');
ok(linha('CARLOS EDUARDO MOTA').status === 'divergencia', 'nome divergente nao foi sinalizado');
ok(!linha('CARLOS EDUARDO MOTA').selecionado, 'nome divergente veio MARCADO — precisa de confirmacao');
ok(linha('JOANA DARC MACIEL').matchPor === 'CPF', 'CPF sem mascara no cadastro nao casou');
ok(linha('KATIA REGINA DO VALE').matchPor === 'nome', 'fallback por nome unico falhou');
ok(linha('LUIS ANTONIO FERRAZ').status === 'nao-id', 'quem nao esta no cadastro deveria cair em nao identificado');
ok(linha('ADAO PEREIRA DA COSTA').selecionado, 'linha limpa nao veio pre-marcada');
ok(sel().length === PESSOAS.length - 4, `selecionadas ${sel().length}, esperado ${PESSOAS.length - 4}`);

// A conferencia de totais tem de explicar a diferenca inteira pelos 4 retidos.
const esperadoRetido = ['HELENA CARDOSO PINTO','IVAN DE OLIVEIRA RAMOS','CARLOS EDUARDO MOTA','LUIS ANTONIO FERRAZ']
  .reduce((s, n) => s + linha(n).valor, 0);
ok(Math.abs(bloqueado - esperadoRetido) < 0.005, 'a diferenca apurada nao corresponde as linhas retidas');

// A chave usada e SEMPRE a do cadastro — nunca a que viesse no arquivo. #plr
ok(_plrData.filter(r => r.empId).every(r => {
  const e = State.employees.find(x => x.id === r.empId);
  return r.pixKey === String(e.chavePix || '').trim();
}), 'alguma linha usou chave diferente da cadastrada no colaborador');

// Trava anti-duplo pagamento: reimportar o mesmo arquivo nao pode passar nada.
State.solicitacoes = sel().map(r => ({ origem: 'plr', employeeId: r.empId,
  competencia: _plrCompetencia(), status: 'pendente' }));
_plrCasar();
ok(sel().length === 0, `reimportar o mesmo arquivo deixou ${sel().length} linha(s) passar — dedup furou`);

// Recusado/estornado NAO travam: esses precisam ser refeitos.
State.solicitacoes = State.solicitacoes.map(s => ({ ...s, status: 'recusado' }));
_plrCasar();
ok(sel().length === PESSOAS.length - 4, 'solicitacao recusada travou o relancamento — nao devia');

// Parcela diferente e competencia diferente: nao se bloqueiam.
State.solicitacoes = sel().map(r => ({ origem: 'plr', employeeId: r.empId,
  competencia: 'PLR_2026-08_P2', status: 'pago' }));
_plrCasar();
ok(sel().length === PESSOAS.length - 4, 'a 2a parcela bloqueou a 1a — as parcelas sao independentes');

console.log('\n' + (falhas.length ? 'FALHAS:\n - ' + falhas.join('\n - ') : 'OK — todos os testes da PLR passaram'));
process.exit(falhas.length ? 1 : 0);
