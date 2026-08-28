// Teste do DOSSIÊ DE PAGAMENTO (app.js, bloco #dossie): qual documento justifica
// cada pagamento, o recibo montado a partir do REGISTRO (nao da tela) e o valor
// por extenso. As funcoes sao recortadas do proprio app.js — mexeu na regra la,
// o teste acusa aqui. Dados ficticios (o repo e publico).
//
// Rodar:  node teste-dossie.js
const fs = require('fs');

const APP = fs.readFileSync(__dirname + '/app.js', 'utf8');
const ini = APP.indexOf('function _valorExtenso(');
const fim = APP.indexOf('function verDocumentoPagamento(');
if (ini < 0 || fim < 0) { console.error('FALHA: bloco do dossie nao encontrado no app.js'); process.exit(1); }
const BLOCO = APP.slice(ini, fim);

// ── Stubs do que o bloco usa do resto do app ────────────────────────────────
const APP_VERSION = 'DRG-Kronos teste';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtMoney = v => 'R$ ' + (+v || 0).toFixed(2).replace('.', ',');
const formatDateBr = iso => String(iso || '').split('-').reverse().join('/');
const _e = f => ({ nomeEmpresa: 'EMPRESA FICTICIA LTDA', cnpj: '00.000.000/0001-00' })[f] || '';
const _empresaEnderecoLinha = () => 'Rua Ficticia, 1 - Barueri/SP';
const PAG_STATUS_CONFIRMADO = ['done', 'confirmed', 'received', 'completed', 'pago-manual'];
const PAG_TXT_AGUARDA = 'Ordem enviada - aguardando autorização.';
const _reciboOficialUmHTML = (emp, p) => `<html>HOLERITE ${esc(emp.nome)} ${p.mes}/${p.ano}</html>`;
const _trctHtml = (r, emp, o) => `<html>TRCT ${esc(emp.nome)} liquido ${(o && o.liquido) || 0}</html>`;
const _calcRescisao = () => ({ liquido: 4321 });
const _melhorPayroll = (empId, mes, ano) =>
  (State.payrolls || []).find(p => p.employeeId === empId && p.mes === mes && p.ano === ano) || null;

const EMP = {
  id: 'e1', nome: 'ADAO PEREIRA DA COSTA', cpf: '111.111.111-11', registro: '145',
  cargo: 'Porteiro', dataAdmissao: '2024-03-01', salarioBase: 2000, chavePix: '111.111.111-11',
};
const State = {
  employees: [EMP],
  payrolls: [{ id: 'pay_e1_2026_08', employeeId: 'e1', mes: 8, ano: 2026 }],
  ferias: [{ id: 'f1', employeeId: 'e1', ano: 2026, inicio: '2026-07-01', fim: '2026-07-30',
             abonoDias: 0, salFruicao: 2000, terco: 666.67, abono: 0, totalBruto: 2666.67,
             inss: 200, irrf: 0, totalLiquido: 2466.67 }],
  decimoTerceiro: [{ id: 'd1', employeeId: 'e1', ano: 2026, mesesDireito: 12, bruto: 2000,
                     parc1: 1000, parc2: 800, parc1Data: '2026-11-30', parc2Data: '2026-12-20',
                     inss: 180, irrf: 20, fgts: 160, liquido: 1800 }],
  rescisoes: [{ id: 'r1', employeeId: 'e1', dataDemissao: '2026-05-10', calc: { liquido: 4321 } }],
  beneficioRecibos: [{ id: 'b1', employeeId: 'e1', competencia: 'BEN_2026-08-01_2026-08-07',
                       reciboHtml: '<html>RECIBO BENEFICIO</html>' }],
  solicitacoes: [],
};

eval(BLOCO);   // eslint-disable-line no-eval

const falhas = [];
const ok = (c, m) => { if (!c) falhas.push(m); };

// ── Valor por extenso (recibo trabalhista sem isso e meio recibo) ───────────
const extenso = [
  [0, 'zero real'],
  [1, 'um real'],
  [1.01, 'um real e um centavo'],
  [2, 'dois reais'],
  [16.30, 'dezesseis reais e trinta centavos'],
  [100, 'cem reais'],
  [133.50, 'cento e trinta e três reais e cinquenta centavos'],
  [1000, 'mil reais'],
  [2000, 'dois mil reais'],
  [6953.55, 'seis mil novecentos e cinquenta e três reais e cinquenta e cinco centavos'],
  [1000000, 'um milhão de reais'],
  [1100, 'mil e cem reais'],
  [1500000, 'um milhão e quinhentos mil reais'],
];
console.log('== VALOR POR EXTENSO ==');
extenso.forEach(([v, esperado]) => {
  const got = _valorExtenso(v);
  console.log(`  ${String(v).padStart(9)} -> ${got}`);
  ok(got === esperado, `_valorExtenso(${v}) = "${got}", esperado "${esperado}"`);
});

// ── Que documento justifica cada pagamento ─────────────────────────────────
console.log('\n== VINCULO PAGAMENTO -> DOCUMENTO ==');
const sol = (o) => Object.assign({ id: 's1', employeeId: 'e1', employeeNome: EMP.nome, valor: 100,
  status: 'pago', competencia: '', origem: 'avulso', pixKey: '111.111.111-11', keyType: 'CPF' }, o);

ok(_pagDocRef(sol({ origem: 'folha', payrollId: 'pay_e1_2026_08' })).tipo === 'folha', 'origem folha nao virou documento de folha');
ok(_pagDocRef(sol({ origem: 'lote', payrollId: 'p' })).tipo === 'folha', 'origem lote nao virou documento de folha');
ok(_pagDocRef(sol({ origem: 'beneficio-manual' })).tipo === 'beneficio', 'origem beneficio-manual nao virou beneficio');
ok(_pagDocRef(sol({ origem: 'plr' })).tipo === 'plr', 'origem plr nao virou plr');
ok(_pagDocRef(sol({ origem: 'avulso', docTipo: 'ferias', docId: 'f1' })).tipo === 'ferias',
   'docTipo gravado nao venceu a deducao pela origem');

const casos = [
  ['salario por payrollId', sol({ origem: 'folha', payrollId: 'pay_e1_2026_08' }), 'Holerite 08/2026'],
  ['salario achado pela competencia', sol({ origem: 'lote', payrollId: '', competencia: '08/2026' }), 'Holerite 08/2026'],
  ['ferias', sol({ docTipo: 'ferias', docId: 'f1' }), 'Recibo de Férias 2026'],
  ['13o', sol({ docTipo: 'decimoterceiro', docId: 'd1' }), 'Recibo 13º 2026'],
  ['rescisao', sol({ docTipo: 'rescisao', docId: 'r1' }), 'TRCT — Rescisão'],
  ['beneficio', sol({ origem: 'beneficio', competencia: 'BEN_2026-08-01_2026-08-07' }), 'Recibo de Benefícios'],
  ['PLR', sol({ origem: 'plr', competencia: 'PLR_2026-08_P1' }), 'Recibo — PLR — Participação nos Lucros'],
];
casos.forEach(([nome, s, titulo]) => {
  const info = _pagDocInfo(s);
  console.log(`  ${nome.padEnd(30)} -> ${info.falta ? 'FALTA: ' + info.falta : info.titulo}`);
  ok(!info.falta, `${nome}: veio "falta: ${info.falta}"`);
  ok(info.titulo === titulo, `${nome}: titulo "${info.titulo}", esperado "${titulo}"`);
  const doc = _pagDocumento(s);
  ok(!doc.falta && /^<(!DOCTYPE|html)/i.test(String(doc.html).trim()), `${nome}: nao gerou HTML`);
});

// Registro que nao existe tem de DIZER que falta — auditoria nao pode achar que esta completo.
ok(_pagDocInfo(sol({ docTipo: 'ferias', docId: 'nao-existe' })).falta === 'registro de férias não encontrado',
   'ferias inexistente nao acusou falta');
ok(_pagDocInfo(sol({ origem: 'folha', payrollId: '', competencia: '01/2020' })).falta === 'folha da competência não encontrada',
   'folha inexistente nao acusou falta');
ok(/removido do cadastro/.test(_pagDocInfo(sol({ employeeId: 'fantasma' })).falta || ''),
   'colaborador removido nao acusou falta');

// ── Competencia legivel ────────────────────────────────────────────────────
console.log('\n== COMPETENCIA LEGIVEL ==');
const comps = [
  ['PLR_2026-08_P1', '08/2026 · 1ª parcela'],
  ['PLR_2026-08_PU', '08/2026 · parcela única'],
  ['BEN_2026-08-01_2026-08-07', '01/08/2026 a 07/08/2026'],
  ['BHVENC_2026-08-20', '20/08/2026'],
  ['08/2026', '08/2026'],
  ['', '—'],
];
comps.forEach(([c, esperado]) => {
  const got = _pagCompetenciaLabel({ competencia: c });
  console.log(`  ${(c || '(vazio)').padEnd(28)} -> ${got}`);
  ok(got === esperado, `_pagCompetenciaLabel("${c}") = "${got}", esperado "${esperado}"`);
});

// ── Recibo montado do REGISTRO (a raiz do "documento solto") ───────────────
console.log('\n== RECIBO A PARTIR DO REGISTRO ==');
const htmlFer = _reciboFeriasHTML(EMP, State.ferias[0]);
ok(htmlFer.includes('R$ 2466,67'), 'recibo de ferias nao trouxe o liquido do registro');
ok(htmlFer.includes('30 dias'), 'recibo de ferias nao calculou os dias de gozo pelas datas');
ok(/por extenso/.test(htmlFer), 'recibo de ferias sem valor por extenso');
ok(htmlFer.includes(EMP.cpf), 'recibo de ferias sem o CPF do colaborador');

// diasGozo gravado manda; sem ele, calcula pelas datas; sem datas, 30.
ok(_feriasDiasGozo({ diasGozo: 20, inicio: '2026-07-01', fim: '2026-07-30' }) === 20, 'diasGozo gravado deveria vencer');
ok(_feriasDiasGozo({ inicio: '2026-07-01', fim: '2026-07-20' }) === 20, 'dias de gozo pelas datas errou');
ok(_feriasDiasGozo({}) === 30, 'sem datas deveria assumir 30 dias');

const html13 = _recibo13HTML(EMP, State.decimoTerceiro[0]);
ok(html13.includes('R$ 1800,00'), 'recibo de 13o nao trouxe o liquido do registro');
ok(html13.includes('30/11/2026') && html13.includes('20/12/2026'), 'recibo de 13o perdeu as datas das parcelas');

// O recibo generico e o que amarra recibo <-> dinheiro.
const htmlPg = _reciboPagamentoHTML(sol({ origem: 'plr', competencia: 'PLR_2026-08_P1', valor: 133.5,
  asaasTransferId: 'tr_999', status: 'pago', asaasStatus: 'done' }), EMP);
ok(htmlPg.includes('R$ 133,50'), 'recibo generico sem o valor');
ok(htmlPg.includes('cento e trinta e três reais e cinquenta centavos'), 'recibo generico sem valor por extenso');
ok(htmlPg.includes('tr_999'), 'recibo generico sem o ID da transferencia');
ok(htmlPg.includes('111.111.111-11'), 'recibo generico sem a chave PIX usada');
ok(htmlPg.includes('08/2026 · 1ª parcela'), 'recibo generico sem a competencia legivel');

// 🔒 Pago no sistema != dinheiro na conta: o recibo tem de repetir o aviso.
const htmlAguarda = _reciboPagamentoHTML(sol({ status: 'pago', asaasStatus: 'pending', valor: 10 }), EMP);
ok(htmlAguarda.includes(PAG_TXT_AGUARDA), 'recibo de pagamento nao confirmado omitiu "aguardando autorizacao"');
const htmlPago = _reciboPagamentoHTML(sol({ status: 'pago', asaasStatus: 'done', valor: 10 }), EMP);
ok(!htmlPago.includes(PAG_TXT_AGUARDA), 'recibo de pagamento confirmado ainda diz "aguardando autorizacao"');

console.log('\n' + (falhas.length ? 'FALHAS:\n - ' + falhas.join('\n - ') : 'OK — todos os testes do dossie passaram'));
process.exit(falhas.length ? 1 : 0);
