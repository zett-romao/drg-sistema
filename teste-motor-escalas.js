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
