// 🏢 Faturamento dos condomínios: monta a fatura do contrato (NFS-e, nota de débito, retenções, vencimento). Rodar: node teste-faturar-condominios.js
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
const ini = src.indexOf('const FAT_SERVICOS');
const fim = src.indexOf('// ── Aba "Faturar condomínios"');
const codigo = src.slice(ini, fim);
let ok = 0, falha = 0;
const checa = (c, m) => { if (c) { ok++; console.log('  OK   ' + m); } else { falha++; console.log('  FALHA ' + m); } };
const State = { postos: [
  { id: 'p1', razaoSocial: 'Cond. Alfa', cep: '06454-000', endereco: 'Alameda Rio Negro', numero: '100', bairro: 'Alphaville', cidade: 'Barueri', estado: 'SP' },
  { id: 'p2', razaoSocial: 'Cond. Beta', cep: '', endereco: '' } ] };
const DB = { getDoc: async () => null };
const fetch = async () => ({ json: async () => ({ ibge: '3505708' }) });
const run = new Function('State', 'DB', 'fetch', codigo + '\nreturn { _fatMontar, _fatVencimento, _fatParam, FAT_PADRAO, setCfg: (c) => { _fatCfg = c; } };');
const K = run(State, DB, fetch);
(async () => {
  K.setCfg(Object.assign({}, K.FAT_PADRAO, { codServico: '170500000', nbs: '123456789', indOp: '654321', cClassTrib: '200001', cst: '200', retencoes: { inss: 11, irrf: 0, pis: 0, cofins: 0, csll: 0 } }));
  checa(K._fatVencimento('2026-10', { vencimentoMes: 'seguinte', diaVencimento: 10 }) === '2026-11-10', 'vencimento: dia 10 do mês seguinte');
  checa(K._fatVencimento('2026-01', { vencimentoMes: 'seguinte', diaVencimento: 31 }) === '2026-02-28', 'vencimento dia 31 em fevereiro → 28');
  checa(K._fatVencimento('2026-12', { vencimentoMes: 'seguinte', diaVencimento: 5 }) === '2027-01-05', 'virada de ano');
  const c1 = { id: 'c1', razaoSocial: 'Condominio Alfa', cnpj: '12.345.678/0001-95', postoId: 'p1', objeto: 'Portaria 24h', valorMensal: 12000, email: 'a@a.com',
    faturamento: { ativo: true, servicos: ['portaria', 'limpeza', 'jardinagem'], valorNotaDebito: 2000 } };
  const m1 = await K._fatMontar(c1, '2026-10');
  const p = m1.payload;
  checa(p.ref === 'kronos:contrato:c1:2026-10' && p.competencia === '2026-10' && p.vencimento === '2026-11-10', 'ref, competência e vencimento');
  checa(p.itens.length === 2 && p.itens[0].valor === 10000 && p.itens[0].tipo === 'servico' && p.itens[1].valor === 2000 && p.itens[1].tipo === 'reembolso' && p.total === 12000,
    'NFS-e = mensal − nota de débito (10.000 + 2.000 = 12.000)');
  checa(/portaria, limpeza e jardinagem/.test(p.itens[0].descricao) && /10\/2026/.test(p.nfse.historico) && /Condominio Alfa/.test(p.nfse.historico), 'histórico com serviços, condomínio e competência');
  checa(p.nfse.retencoes && p.nfse.retencoes.inss === 1100, 'INSS 11% sobre a NFS-e = 1.100');
  checa(m1.resumo.liquido === 10900, 'boleto líquido = 12.000 − 1.100');
  checa(p.nfse.emitir === true && p.nfse.servico.codServico === '170500000' && p.nfse.local.ibge === '3505708' && p.nfse.local.cep === '06454000', 'com códigos e endereço do posto: NFS-e automática com local da prestação');
  checa(p.cobranca.multa === 2 && p.cobranca.juros === 1 && p.boleto === true, 'multa 2% e juros 1% a.m. (padrão), boleto ligado');
  const c2 = { id: 'c2', razaoSocial: 'Condominio Beta', cnpj: '', postoId: 'p2', valorMensal: 5000, faturamento: { ativo: true, servicos: ['zeladoria'] } };
  const m2 = await K._fatMontar(c2, '2026-10');
  checa(m2.pend.some((x) => /CNPJ/.test(x)), 'sem CNPJ: pendência que bloqueia o envio');
  checa(m2.payload.nfse.emitir === false && m2.avisos.some((x) => /endereço do posto/.test(x)), 'posto sem endereço: NFS-e vira manual (avisa)');
  K.setCfg(Object.assign({}, K.FAT_PADRAO));
  const m3 = await K._fatMontar(c1, '2026-10');
  checa(m3.payload.nfse.emitir === false && !m3.payload.nfse.servico && m3.avisos.some((x) => /5 códigos/.test(x)), 'sem códigos fiscais: NFS-e manual, sem mandar código de software');
  const c4 = Object.assign({}, c1, { faturamento: Object.assign({}, c1.faturamento, { multa: 0, retencoes: { inss: '' } }) });
  K.setCfg(Object.assign({}, K.FAT_PADRAO, { retencoes: { inss: 11 } }));
  const m4 = await K._fatMontar(c4, '2026-10');
  checa(m4.payload.cobranca.multa === 0 && m4.payload.nfse.retencoes.inss === 1100, 'contrato manda (multa 0) e campo vazio cai no padrão (INSS 11%)');
  console.log(falha ? `REPROVADO ${falha}` : `APROVADO (${ok})`);
  process.exit(falha ? 1 : 0);
})();
