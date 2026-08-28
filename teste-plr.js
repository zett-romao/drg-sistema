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

// ── Leitor de PDF ───────────────────────────────────────────────────────────
// Monta um PDF sintético com as TRES armadilhas do relatorio real:
//   1) marcador "stream" terminado em CR sozinho (fora da spec, mas e o que o
//      gerador do contador usa) — exigir \n devolve zero objeto;
//   2) /Length indireto e byte de sobra antes de "endstream" — sem cortar no
//      /Length o DecompressionStream recusa tudo com "trailing junk";
//   3) fonte Identity-H (ToUnicode) e colunas escritas FORA DE ORDEM no papel.
const zlib = require('zlib');
const PDF_BLOCO = APP.slice(APP.indexOf('async function _pdfInflate('), APP.indexOf('function _plrDigitos('));
eval(PDF_BLOCO);   // eslint-disable-line no-eval

function montarPdfFicticio() {
  // codigo do glifo = caractere - 0x1F (bfrange cobre de 0x0001 a 0x00E0)
  const hexOf = s => s.split('').map(c => (c.charCodeAt(0) - 0x1f).toString(16).padStart(4, '0')).join('');
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '1 beginbfrange <0001> <00e0> <0020> endbfrange',
    'endcmap end end',
  ].join('\n');
  // Cada celula tem seu proprio Tm; a ordem em que sao escritas NAO e a ordem
  // que se le (valor antes do nome, codigo por ultimo).
  const cel = (x, y, txt) => `1 0 0 1 ${x} ${y} Tm <${hexOf(txt)}> Tj`;
  const conteudo = [
    'BT', '/F1 9 Tf',
    cel(200, 700, 'RELACAO GERAL DOS LIQUIDOS'),
    cel(400, 660, '133,50'), cel(60, 660, 'ADAO PEREIRA DA COSTA'), cel(250, 660, '111.111.111-11'), cel(20, 660, '145'),
    cel(400, 640, '74,90'), cel(60, 640, 'BENEDITA SOUZA DOS ANJOS'), cel(250, 640, '222.222.222-22'), cel(20, 640, '156'),
    cel(20, 600, 'Empregados: 2 Total da Empresa: 208,40'),
    'ET',
  ].join('\r');

  const zc = zlib.deflateSync(Buffer.from(cmap, 'latin1'));
  const zk = zlib.deflateSync(Buffer.from(conteudo, 'latin1'));
  const partes = [
    Buffer.from('%PDF-1.3\n', 'latin1'),
    Buffer.from('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', 'latin1'),
    Buffer.from('2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n', 'latin1'),
    Buffer.from('3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font <</F1 4 0 R >> >> /Contents 6 0 R >> endobj\n', 'latin1'),
    Buffer.from('4 0 obj << /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 5 0 R >> endobj\n', 'latin1'),
    Buffer.from(`5 0 obj << /Filter /FlateDecode /Length ${zc.length} >>\r\nstream\r`, 'latin1'), zc,
    Buffer.from('\r\nendstream endobj\n', 'latin1'),
    Buffer.from('6 0 obj << /Filter /FlateDecode /Length 7 0 R >>\rstream\r', 'latin1'), zk,   // CR sozinho + /Length indireto
    Buffer.from('\r\nendstream endobj\n', 'latin1'),
    Buffer.from(`7 0 obj ${zk.length} endobj\n`, 'latin1'),
    Buffer.from('trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ];
  return Buffer.concat(partes);
}

(async () => {
  const pdfFalhas = [];
  const okp = (c, m) => { if (!c) pdfFalhas.push(m); };
  try {
    const buf = montarPdfFicticio();
    const texto = await _pdfParaTexto(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const linhas = texto.split('\n');
    console.log('\n== LEITOR DE PDF ==');
    linhas.forEach(l => console.log('  ', JSON.stringify(l)));

    okp(linhas.length === 4, `extraiu ${linhas.length} linhas do PDF, esperado 4`);
    okp(/^145 ADAO PEREIRA DA COSTA 111\.111\.111-11 133,50$/.test(linhas[1] || ''),
        'a linha nao foi remontada na ordem do papel (colunas fora de ordem)');
    okp((linhas[0] || '').includes('RELACAO GERAL'), 'cabecalho perdido');

    const pp = _plrParse(texto);
    okp(pp.linhas.length === 2, `_plrParse leu ${pp.linhas.length} linhas do PDF, esperado 2`);
    okp(pp.countArq === 2 && Math.abs(pp.totalArq - 208.40) < 0.005, 'rodape do PDF nao foi capturado');
    okp(pp.linhas[0] && pp.linhas[0].cpf === '11111111111' && pp.linhas[0].valorArq === 133.5,
        'codigo/CPF/valor errados na leitura do PDF');

    // Arquivo que nao e PDF tem de falhar dizendo o porque, nao devolver vazio.
    try { await _pdfParaTexto(Buffer.from('isto nao e um pdf').buffer); pdfFalhas.push('aceitou arquivo que nao e PDF'); }
    catch (e) { okp(/não parece um PDF/.test(e.message), 'mensagem de arquivo invalido pouco clara'); }
  } catch (e) {
    pdfFalhas.push('leitor de PDF lancou excecao: ' + e.message);
  }

  falhas.push(...pdfFalhas);
  console.log('\n' + (falhas.length ? 'FALHAS:\n - ' + falhas.join('\n - ') : 'OK — todos os testes da PLR passaram'));
  process.exit(falhas.length ? 1 : 0);
})();
