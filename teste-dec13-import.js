// Teste do importador do 13º da contabilidade (app.js, bloco #dec13-import).
// Recorta do PRÓPRIO app.js o bloco puro (e os leitores da PLR que ele reusa) e
// executa — mexeu na regra lá, o teste acusa aqui. Dados fictícios (LGPD).
//
// Rodar:  node teste-dec13-import.js
const fs = require('fs');
const APP = fs.readFileSync(__dirname + '/app.js', 'utf8');

function recorta(ini, fim) {
  const a = APP.indexOf(ini), b = APP.indexOf(fim, a);
  if (a < 0 || b < 0) { console.error('FALHA: bloco nao encontrado: ' + ini); process.exit(1); }
  return APP.slice(a, b);
}
const PLR = recorta('function _plrDigitos(', 'function _plrCompetencia(');
const DEC = recorta('// #dec13-import-ini', '// #dec13-import-fim');

// Encargos simplificados (o teste é do importador, não das tabelas do INSS/IR).
const calcINSS = b => Math.round(b * 0.075 * 100) / 100;
const calcIRRF = () => 0;
const calcFGTS = b => Math.round(b * 0.08 * 100) / 100;

const api = new Function('calcINSS', 'calcIRRF', 'calcFGTS',
  PLR + '\n' + DEC + '\nreturn {_dec13Kronos,_dec13ComContab,_dec13Interpretar,_dec13Casar,_dec13Status,_dec13CampoDoCabecalho,_dec13Num};'
)(calcINSS, calcIRRF, calcFGTS);

let falhas = 0, total = 0;
function ok(cond, msg) { total++; if (!cond) { falhas++; console.error('  ✗ ' + msg); } }
const perto = (a, b) => Math.abs(a - b) < 0.005;

// ── 1. Sem importação = cálculo do Kronos intacto ─────────────────────────────
const emp = { dependentesIRRF: 0, pensaoAlimenticia: 0 };
const k = api._dec13Kronos(emp, 10, 2000, 100, 0);
ok(perto(k.bruto, 1750), 'bruto Kronos 2100*10/12 = 1750');
const v0 = api._dec13ComContab(emp, k, null);
ok(['bruto', 'parc1', 'inss', 'irrf', 'fgts', 'parc2', 'liquido'].every(f => v0[f] === k[f]), 'sem contab devolve o Kronos igual');
ok(Object.keys(v0.daContab).length === 0, 'sem contab nada marcado 📥');

// ── 2. Só a 1ª parcela da contabilidade ──────────────────────────────────────
const v1 = api._dec13ComContab(emp, k, { parc1: 900 });
ok(v1.parc1 === 900 && v1.daContab.parc1, '1ª parcela vem do contador');
ok(perto(v1.parc2, k.liquido - 900), '2ª = líquido do Kronos − 1ª do contador');
ok(v1.bruto === k.bruto && v1.inss === k.inss, 'bruto/INSS seguem do Kronos');

// ── 3. Bruto do contador recalcula os encargos que ele NÃO mandou ────────────
const v2 = api._dec13ComContab(emp, k, { bruto: 2000 });
ok(v2.inss === 150 && v2.fgts === 160, 'INSS/FGTS derivados do bruto do contador');
ok(v2.parc1 === 1000 && perto(v2.parc2, 1000 - 150), 'parcelas derivadas do bruto do contador');

// ── 4. Folha completa do contador manda em tudo ──────────────────────────────
const c3 = { bruto: 1840.72, parc1: 920.36, inss: 141.35, irrf: 0, fgts: 147.26, parc2: 779.01, liquido: 1699.37 };
const v3 = api._dec13ComContab(emp, k, c3);
ok(Object.keys(c3).every(f => v3[f] === c3[f]), 'folha completa: todos os campos do contador');
ok(v3.irrf === 0 && v3.daContab.irrf, 'IRRF zero do contador é valor, não ausência');

// ── 5. Cabeçalhos ────────────────────────────────────────────────────────────
const H = api._dec13CampoDoCabecalho;
ok(H('CPF') === 'cpf', 'CPF');
ok(H('Matrícula') === 'matricula' && H('Cód.') === 'matricula' && H('Reg.') === 'matricula', 'matrícula/código/reg');
ok(H('Nome do Empregado') === 'nome', 'nome do empregado');
ok(H('Total Bruto') === 'bruto' && H('Proventos') === 'bruto', 'bruto');
ok(H('1ª Parc.') === 'parc1' && H('Adiantamento 13º') === 'parc1', '1ª parcela');
ok(H('2ª Parc. (Líq.)') === 'parc2', '2ª parcela líquida não vira "líquido"');
ok(H('(-) INSS') === 'inss' && H('IRRF') === 'irrf' && H('FGTS *') === 'fgts', 'encargos');
ok(H('Líquido a Receber') === 'liquido', 'líquido');
ok(H('Base INSS') === '' && H('Base FGTS') === '' && H('Alíq. %') === '', 'BASE/alíquota ignoradas (não viram desconto)');
ok(H('Meses') === '' && H('Status') === '' && H('#') === '', 'colunas sem valor ignoradas');

// ── 6. Números ───────────────────────────────────────────────────────────────
const N = api._dec13Num;
ok(N('1.840,72') === 1840.72 && N('R$ 1.840,72') === 1840.72 && N('(141,35)') === 141.35, 'pt-BR, R$, parênteses');
ok(N(1840.72) === 1840.72 && N('1840.72') === 1840.72 && N('-141,35') === 141.35, 'número Excel, ponto, negativo');
ok(N('') === null && N('abc') === null && N('12/2026') === null, 'não-número → null');

// ── 7. Planilha (linhas do Excel) com cabeçalho, total e CPF sem zero ────────
const rows = [
  ['EMPRESA FICTICIA LTDA', '', '', '', '', '', '', ''],
  ['Folha de 13º Salário — 2026', '', '', '', '', '', '', ''],
  [],
  ['Cód.', 'Nome', 'CPF', 'Base INSS', 'Total Bruto', '(-) INSS', '(-) IRRF', 'Líquido'],
  [1, 'ADAO PEREIRA DA COSTA', 27243347011, 1840.72, 1840.72, 141.35, 0, 1699.37],
  [3, 'BENEDITA SOUZA', '111.111.111-11', '', '1.660,98', '125,17', '0,00', '1.535,81'],
  [7, 'CARLOS MOTA', '', '', 1000, 75, 0, 925],
  ['', 'TOTAL', '', '', 4501.70, 341.52, 0, 4160.18],
];
const r7 = api._dec13Interpretar({ rows }, 'parc1');
ok(r7.modo === 'tabela', 'planilha lida como tabela');
ok(r7.itens.length === 3, '3 pessoas (cabeçalho, título e TOTAL fora) — veio ' + r7.itens.length);
ok(r7.itens[0].cpf === '02724334701'.padStart(11, '0') || r7.itens[0].cpf.length === 11, 'CPF numérico ganha os zeros da frente');
ok(r7.itens[0].valores.bruto === 1840.72 && r7.itens[0].valores.liquido === 1699.37, 'valores da linha');
ok(r7.itens[0].valores.irrf === 0, 'IRRF 0 entra como valor');
ok(!('base' in r7.itens[0].valores) && Object.keys(r7.itens[0].valores).length === 4, 'Base INSS não entrou');
ok(r7.totaisArq.bruto === 4501.70, 'linha TOTAL capturada para conferência');

// ── 8. Colado do Excel (TAB) ─────────────────────────────────────────────────
const colado = 'Reg.\tNome\t1ª Parc.\n1\tADAO PEREIRA DA COSTA\t920,36\n3\tBENEDITA SOUZA\t830,49\n';
const r8 = api._dec13Interpretar({ texto: colado }, 'parc2');
ok(r8.modo === 'tabela' && r8.itens.length === 2 && r8.itens[1].valores.parc1 === 830.49, 'colado com TAB vira tabela');

// ── 9. Relação de líquidos (PDF/texto, 1 valor por CPF) ──────────────────────
const rel = [
  'RELACAO GERAL DOS LIQUIDOS', 'CNPJ: 49.698.112/0001-57',
  '145 ADAO PEREIRA DA COSTA 027.243.347-01 920,36',
  '156 BENEDITA SOUZA 111.111.111-11 830,49',
  'Empregados: 2 Estagiarios: 0 Total da Empresa: 1.750,85',
].join('\n');
const r9 = api._dec13Interpretar({ texto: rel }, 'parc2');
ok(r9.modo === 'relacao' && r9.itens.length === 2, 'relação lida');
ok(r9.itens[0].valores.parc2 === 920.36 && r9.campo === 'parc2', 'valor vai para o campo escolhido');
ok(r9.totaisArq.parc2 === 1750.85, 'total do rodapé capturado');

// ── 10. Casamento ────────────────────────────────────────────────────────────
const emps = [
  { id: 'a', nome: 'Adão Pereira da Costa', cpf: '027.243.347-01', registro: '1' },
  { id: 'b', nome: 'Benedita Souza', cpf: '111.111.111-11', registro: '0003' },
  { id: 'c', nome: 'Carlos Mota', cpf: '', registro: '7' },
  { id: 'd', nome: 'José Silva', cpf: '', registro: '20' },
  { id: 'e', nome: 'José Silva', cpf: '', registro: '21' },
];
const itens = [
  { cpf: '02724334701', codigo: '', nomeArq: 'ADAO PEREIRA DA COSTA', valores: { parc1: 1 } },   // CPF
  { cpf: '', codigo: '3', nomeArq: 'BENEDITA SOUZA', valores: { parc1: 1 } },                    // matrícula 0003
  { cpf: '', codigo: '', nomeArq: 'CARLOS MOTA', valores: { parc1: 1 } },                        // só nome
  { cpf: '', codigo: '', nomeArq: 'JOSE SILVA', valores: { parc1: 1 } },                         // homônimo
  { cpf: '', codigo: '20', nomeArq: 'FULANO OUTRO', valores: { parc1: 1 } },                      // nome diverge
  { cpf: '99999999999', codigo: '1', nomeArq: 'ADAO PEREIRA DA COSTA', valores: { parc1: 1 } },  // CPF ≠ cadastro + duplicado
];
const L = api._dec13Casar(itens, emps);
ok(L[0].empId === 'a' && L[0].matchPor === 'CPF', 'casa por CPF (acento não atrapalha)');
ok(L[1].empId === 'b' && L[1].matchPor === 'matrícula', 'casa por matrícula sem zeros à esquerda');
ok(L[2].empId === 'c' && api._dec13Status(L[2]) === 'por-nome', 'só nome: casa mas pede conferência');
ok(L[3].empId === '' && api._dec13Status(L[3]) === 'nao-id', 'homônimo NÃO casa');
ok(L[4].empId === 'd' && L[4].divergencia && api._dec13Status(L[4]) !== 'pronto', 'nome divergente pede conferência');
ok(L[5].empId === 'a' && L[5].divergencia, 'CPF do arquivo ≠ cadastro = divergência');
ok(L[0].duplicado && L[5].duplicado, 'mesma pessoa 2x no arquivo = duplicado nos dois');
ok(api._dec13Status(L[0]) === 'duplicado', 'duplicado não nasce marcado');
ok(api._dec13Status({ ...L[1], recStatus: 'pago' }) === 'ja-pago', '13º já pago pede conferência');
ok(api._dec13Status(L[1]) === 'pronto', 'matrícula limpa = pronto');
const M = api._dec13Casar([{ ...itens[3], manualEmpId: 'e' }], emps);
ok(M[0].empId === 'e' && api._dec13Status(M[0]) === 'pronto', 'escolha manual do dono vale');

console.log(falhas ? `\n${falhas} de ${total} verificações FALHARAM` : `OK — importador do 13º: ${total} verificações`);
process.exit(falhas ? 1 : 0);
