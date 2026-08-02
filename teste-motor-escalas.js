// Cruza o motor do GESTOR (app.js _getExpectedDay) com o do APP (ponto.html _jornadaHoje)
// para TODA escala x TODO dia da semana. Divergencia = bug (regra do motor unico).
const fs=require('fs'), vm=require('vm');
const {URLSearchParams}=require('url');
const mk=()=>{const stub=new Proxy(function(){},{get:()=>stub,set:()=>true,apply:()=>stub,construct:()=>stub});
 const sb={console,Date,Math,JSON,Object,Array,String,Number,Boolean,RegExp,Error,parseInt,parseFloat,isNaN,
  setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},Promise,Set,Map,Intl,URLSearchParams,
  localStorage:stub,document:stub,navigator:{onLine:true},firebase:stub,location:stub,fetch:()=>Promise.resolve(stub),
  alert:()=>{},confirm:()=>true,prompt:()=>'x',addEventListener:()=>{},crypto:stub};
 sb.window=sb;sb.globalThis=sb;sb.self=sb;vm.createContext(sb);return sb;};

// --- GESTOR
const G=mk();
try{ vm.runInContext(fs.readFileSync('app.js','utf8'),G,{filename:'app.js'}); }catch(e){ console.log('app.js:',e.message); }
vm.runInContext('try{State.employees=[];State.feriados=[];State.escalasModelos=[];State.payrolls=[];State.escalas=[];}catch(e){console.log("State:",e.message);}',G);
// --- PONTO
const P=mk();
const html=fs.readFileSync('ponto.html','utf8');
const inl=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
try{ vm.runInContext(inl[inl.length-1],P,{filename:'ponto.js'}); }catch(e){ console.log('ponto:',e.message); }
vm.runInContext('currentPayroll={pontoManualDias:[]}; _escModelosPonto=[];',P);

const ESCALAS=['5x2A','5x2B','6x1A','6x1B','6x1C','6x1ALT','12x36','12x36-07-19','12x36-06-18','12x36-19-07','12x36-18-06',
 '6x1ALT-0900-1720','6x1ALT-0800-1620','6x1ALT-0800-1700-S16','6x1ALT-0700-1600-S11',
 '6x1LIV-0800-1700-S16','6x1LIV-0800-1700-S12','6x1LIV-0700-1600-S11','6x1LIV-0900-1720','5x2LIV-0730-1630-S15'];
// Semana de 2026-07-13 (seg) a 2026-07-19 (dom)
const DIAS=[13,14,15,16,17,18,19], NOME=['seg','ter','qua','qui','sex','sáb','dom'];
let divergencias=0, linhas=0;
for(const esc of ESCALAS){
  const emp={id:'e1',nome:'T',escala:esc,horarioEntrada:'08:00',horarioSaida:'17:00',horarioRefIni:'',horarioRefFim:'',
    dataAdmissao:'2026-01-05',alternadaPrimeiraFolga:'sab',ciclo12x36Inicio:'2026-07-13'};
  const out=[];
  for(let i=0;i<7;i++){
    const dia=DIAS[i];
    // GESTOR
    G.__e=emp;
    let g; try{ g=vm.runInContext(`(function(){const x=_getExpectedDay(__e,7,2026,${dia});return {tipo:x&&x.tipo,ent:(x&&x.entrada)||'',sai:(x&&x.saida)||'',dur:(x&&x.duracaoMinFds)||0};})()`,G); }catch(e){ g={erro:e.message}; }
    // APP (congela hoje no dia)
    P.__e=emp;
    const D=P.Date; const alvo=new Date(2026,6,dia,9,0,0);
    P.Date=class extends D{constructor(...a){if(a.length===0)super(alvo.getTime());else super(...a);} static now(){return alvo.getTime();}};
    let p; try{ p=vm.runInContext(`(function(){currentEmp=__e;const j=_jornadaHoje(__e);const f=_ehDiaDeFolga(__e,new Date());return {folga:!!(j.folga||f),ent:j.entrada||'',sai:j.saida||'',dur:j.duracaoMinFds||0};})()`,P); }catch(e){ p={erro:e.message}; }
    P.Date=D;
    linhas++;
    const gFolga=(g.tipo==='folga'), gEnt=g.ent, gSai=g.sai;
    // EXCECOES ESPERADAS (por design, nao sao divergencia):
    // (a) FDS livre/opcional: o gestor projeta FOLGA no fds (resolve pela batida) — o app TEM
    //     de deixar bater (folga=false), senao a batida nasce pendente toda semana.
    // (b) 6x1ALT / 6x1B: ciclo deslizante ancorado na colecao `escalas` (staff-only) — o app
    //     NAO decide folga (abstem-se). Falha segura: nunca bloqueia, nunca pende falso.
    const fdsResolve=/^(6x1LIV|5x2LIV)/.test(esc) && (i===5||i===6);
    const ciclo6x1  =/^(6x1ALT|6x1B)/.test(esc);
    let okFolga, okHora, nota='';
    if(fdsResolve){ okFolga=(p.folga===false); okHora=true; nota=' (fds resolve pela batida)'; }
    else if(ciclo6x1 && gFolga){ okFolga=(p.folga===false); okHora=true; nota=' (app se abstem — ancora e staff-only)'; }
    else { okFolga=(gFolga===p.folga); okHora = gFolga ? true : (gEnt===p.ent && gSai===p.sai); }
    const ok = okFolga && okHora && !g.erro && !p.erro;
    if(!ok){ divergencias++;
      out.push(`   ✗ ${NOME[i]}: gestor[${g.tipo||g.erro} ${gEnt}-${gSai}] × app[${p.folga?'folga':'trab'} ${p.ent}-${p.sai}${p.erro?' ERRO:'+p.erro:''}]`);
    } else if(nota && (gFolga!==p.folga)){
      out.push(`   ~ ${NOME[i]}: gestor[folga] × app[trab]${nota}`);
    }
  }
  const bad=out.filter(l=>l.startsWith('   ✗')).length; console.log((bad?'✗ ':'✓ ')+esc.padEnd(24)+(bad?'':'confere nos 7 dias'));
  out.forEach(l=>console.log(l));
}
console.log(`\n${linhas} dias comparados · ${divergencias} divergência(s)`);

// ── Bloco 12x36 SEM ancora no cadastro (regressao do bug Carlos 0083, 2026-07-17) ──
// A fixture principal SEMPRE crava ciclo12x36Inicio, entao os dois motores nunca chegam
// ao fallback onde divergiam. Aqui a ancora fica VAZIA: o gestor ancora no 1o dia batido
// (payrolls, staff-only); o app NAO pode replicar isso. INVARIANTE: o app pode se abster
// (nao decidir), mas JAMAIS pode dizer FOLGA num dia que o gestor diz TRABALHO — isso
// bloquearia um plantao real e a batida nasceria pendente. #ancora-12x36 #motor-unico
{
  const empSA={id:'sa',nome:'SemAncora',escala:'12x36-07-19',horarioEntrada:'07:00',horarioSaida:'19:00',
    horarioRefIni:'',horarioRefFim:'',dataAdmissao:'2026-05-04'};  // par; 1a batida real 05/05 (impar)
  const pay=[{employeeId:'sa',mes:5,ano:2026,pontoManualDias:[{dia:5,entrada:'07:00',saida:'19:00'}]}];
  G.__pay=pay; vm.runInContext('State.payrolls=__pay;',G);
  let nocivas=0, checados=0;
  for(const dia of [13,14,15,16,17,18,19,20,21]){
    G.__e=empSA;
    let g; try{ g=vm.runInContext(`(function(){const x=_getExpectedDay(__e,7,2026,${dia});return {folga:!!(x&&x.tipo==='folga')};})()`,G); }catch(e){ g={erro:e.message}; }
    P.__e=empSA;
    const D=P.Date, alvo=new Date(2026,6,dia,9,0,0);
    P.Date=class extends D{constructor(...a){if(a.length===0)super(alvo.getTime());else super(...a);} static now(){return alvo.getTime();}};
    let p; try{ p=vm.runInContext(`(function(){currentEmp=__e;return {folga:!!_ehDiaDeFolga(__e,new Date())};})()`,P); }catch(e){ p={erro:e.message}; }
    P.Date=D;
    checados++;
    if(p.folga && !g.folga){ nocivas++; console.log(`   ✗ 12x36 s/ancora ${dia}/07: gestor[trabalho] × app[FOLGA] — plantao real bloqueado`); }
  }
  vm.runInContext('State.payrolls=[];',G);
  if(nocivas){ divergencias+=nocivas; console.log(`✗ 12x36 sem ancora        ${nocivas} bloqueio(s) nocivo(s) de ${checados} dias`); }
  else console.log(`✓ 12x36 sem ancora        app nunca bloqueia plantao (falha segura) · ${checados} dias`);
}
// ── Bloco JANELA SEMPRE (regra do dono 2026-08-02) ────────────────────────────
// "Nao abrir o ponto antes de 5 min do horario de entrada de QUALQUER escala, nem
// depois de 5 min do horario de saida — fora disso so com autorizacao do supervisor."
// A trava nao pode DESLIGAR em caso nenhum. Ela desligava quando `_horarioEsperado`
// devolvia '' (dia marcado folga, modelo de escala ilegivel) e `analisarHorario` caia
// no `if(!esp) return {tipo:'ok'}` — foi como a Maria Helena (0050) gravou 12:30 no
// campo de ENTRADA em 02/08. Aqui checamos o COMPORTAMENTO, nao o horario:
//   entrada 6 min ANTES  -> tem de bloquear ('antesDaJanela')
//   entrada 6 min DEPOIS -> atraso, bate normal (Sumula 366 apura na folha)
//   saida   6 min DEPOIS -> tem de bloquear ('horaExtra')
//   saida   6 min ANTES  -> saiu antes, bate normal
// Unica excecao legitima: fim de semana por DURACAO (`fdsDuracaoMin`, regra travada
// 02/07) — esse dia nao tem relogio, nao ha o que ancorar. #janela-sempre
{
  let falhas=0, casos=0;
  // Sonda: roda analisarHorario com o relogio cravado em (esperado + delta).
  const sonda=(emp, dia, prox, delta, extra)=>{
    P.__e=emp;
    const D=P.Date, alvo=new Date(2026,6,dia,12,0,0);
    P.Date=class extends D{constructor(...a){if(a.length===0)super(alvo.getTime());else super(...a);} static now(){return alvo.getTime();}};
    let r;
    try{
      r=vm.runInContext(`(function(){
        currentEmp=__e; currentPayroll={pontoManualDias:[]}; ${extra||''}
        const esp=_horarioEsperado('${prox}');
        if(!esp) return {esp:'', tipo:'SEM-ANCORA'};
        const m=timeToMin(esp)+(${delta});
        const n=new Date(2026,6,${dia},Math.floor(m/60),m%60,0);
        return {esp:esp, tipo:analisarHorario('${prox}', n).tipo};
      })()`,P);
    }catch(e){ r={erro:e.message}; }
    P.Date=D;
    return r;
  };
  const exige=(rot, emp, dia, prox, delta, esperado, tolerarSemAncora)=>{
    casos++;
    const r=sonda(emp, dia, prox, delta, emp.__extra);
    if(r.erro){ falhas++; console.log(`   ✗ ${rot} — ERRO: ${r.erro}`); return; }
    if(r.tipo==='SEM-ANCORA'){
      if(tolerarSemAncora) return;
      falhas++; console.log(`   ✗ ${rot} — JANELA DESLIGADA (sem horario de ancora)`); return;
    }
    if(r.tipo!==esperado){ falhas++; console.log(`   ✗ ${rot} — esperava '${esperado}', veio '${r.tipo}' (ancora ${r.esp})`); }
  };
  // (1) Todas as escalas do sistema, os 7 dias da semana — inclusive nos dias que a
  //     escala chama de folga (a janela tem de continuar de pe).
  for(const esc of ESCALAS){
    const emp={id:'w1',nome:'W',escala:esc,horarioEntrada:'08:00',horarioSaida:'17:00',horarioRefIni:'',horarioRefFim:'',
      dataAdmissao:'2026-01-05',alternadaPrimeiraFolga:'sab',ciclo12x36Inicio:'2026-07-13'};
    for(let i=0;i<7;i++){
      const dia=DIAS[i], rot=`${esc} ${NOME[i]}`;
      // fds por DURACAO (5x2LIV/6x1LIV no sab/dom) e a unica excecao com horario vazio
      const fdsDur=/^(6x1LIV|5x2LIV)/.test(esc) && (i===5||i===6);
      exige(`${rot} entrada -6min`, emp, dia, 'entrada', -6, 'antesDaJanela', fdsDur);
      exige(`${rot} entrada +6min`, emp, dia, 'entrada', +6, 'ok',            fdsDur);
      exige(`${rot} saida   +6min`, emp, dia, 'saida',   +6, 'horaExtra',     fdsDur);
      exige(`${rot} saida   -6min`, emp, dia, 'saida',   -6, 'ok',            fdsDur);
    }
  }
  // (2) Casos patologicos — onde a janela desligava antes do conserto de 02/08.
  const patos=[
    ['dia avulso marcado FOLGA',
     {id:'w2',escala:'12x36-07-19',horarioEntrada:'07:00',horarioSaida:'19:00',dataAdmissao:'2026-01-05',
      ciclo12x36Inicio:'2026-07-13',overridesHorario:[{id:'o1',data:'2026-07-15',tipo:'folga'}]}, 15],
    ['modelo de escala ILEGIVEL (m_ nao carregado)',
     {id:'w3',escala:'m_naoexiste',horarioEntrada:'07:00',horarioSaida:'19:00',dataAdmissao:'2026-01-05'}, 15],
    ['escala vazia, so horario no cadastro',
     {id:'w4',escala:'',horarioEntrada:'07:00',horarioSaida:'19:00',dataAdmissao:'2026-01-05'}, 15],
    ['periodo de mudanca vencido (sem vigencia no dia)',
     {id:'w5',escala:'12x36-07-19',horarioEntrada:'07:00',horarioSaida:'19:00',dataAdmissao:'2026-01-05',
      ciclo12x36Inicio:'2026-07-13',historicoEscalas:[{de:'2026-06-01',ate:'2026-06-30',escala:'6x1A'}]}, 15],
  ];
  for(const [rot,emp,dia] of patos){
    exige(`${rot} — entrada -6min`, emp, dia, 'entrada', -6, 'antesDaJanela');
    exige(`${rot} — saida   +6min`, emp, dia, 'saida',   +6, 'horaExtra');
  }
  if(falhas){ divergencias+=falhas; console.log(`✗ janela sempre ativa     ${falhas} falha(s) de ${casos} casos`); }
  else console.log(`✓ janela sempre ativa     ±5min vale em toda escala e todo dia · ${casos} casos`);
}

console.log(`\nTOTAL · ${divergencias} divergência(s)`);
process.exit(divergencias?1:0);
