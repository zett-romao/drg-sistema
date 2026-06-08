// =====================================================================
// drg-monitor-worker.js — ROBÔ DE FALTAS (Cloudflare Worker + Cron). #monitor-faltas-cron
// Roda no cron (ex.: a cada 10 min). Lê de configuracoes/monitorexpectativas_{ymd}
// (quem entra hoje, gravado pelo app) + payrolls (batidas em pontoManualDias) e,
// passados +15min do horário sem entrada, dispara Web Push aos supervisores inscritos
// (configuracoes/pushsub_*). Dedupe diário em configuracoes/monitorpushstate_{ymd}.
//
// ENV (Settings → Variables / Secrets do Worker):
//   FIREBASE_SERVICE_ACCOUNT  → JSON da conta de serviço (mesmo do drg-aprovacao)
//   VAPID_PUBLIC              → chave pública VAPID (base64url, 65 bytes)
//   VAPID_PRIVATE            → chave privada VAPID (base64url, 32 bytes)
//   VAPID_SUBJECT            → "mailto:voce@exemplo.com"
// CRON TRIGGER: */10 * * * *  (a cada 10 min)
// =====================================================================

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(rodar(env)); },
  // Permite disparo manual p/ teste: GET https://<worker>/?run=1
  async fetch(req, env) {
    const u = new URL(req.url);
    // CORS p/ chamadas do navegador (ponto.html → /notificar-pedido). #janela-notif
    if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:_corsMon() });
    if (u.pathname === '/notificar-pedido' && req.method === 'POST') {
      const r = await notificarPedido(req, env);
      return new Response(JSON.stringify(r), { headers:{ 'content-type':'application/json', ..._corsMon() } });
    }
    if (u.searchParams.get('run')  === '1') {
      if(!_manualRunAllowed(req, env, u)) return new Response('forbidden', {status:403});
      const r = await rodar(env); return new Response(JSON.stringify(r), {headers:{'content-type':'application/json'}});
    }
    if (u.searchParams.get('test') === '1') {
      if(!_manualRunAllowed(req, env, u)) return new Response('forbidden', {status:403});
      const r = await enviarTeste(env); return new Response(JSON.stringify(r), {headers:{'content-type':'application/json'}});
    }
    return new Response('drg-monitor-worker ok', {status:200});
  }
};

// Teste de entrega: manda uma notificação de teste a TODOS os inscritos (ignora faltas/dedupe).
function _manualRunAllowed(req, env, url){
  const secret=String(env.MONITOR_RUN_SECRET||'');
  if(!secret) return false;
  const got=String(req.headers.get('x-monitor-secret')||url.searchParams.get('secret')||'');
  return !!got && got===secret;
}

async function enviarTeste(env){
  const cfgs=await fsListCol(env,'configuracoes');
  const subs=cfgs.filter(c=>c.id.startsWith('pushsub_') && c.data && c.data.sub && c.data.sub.endpoint);
  let enviados=0; const status=[];
  for(const s of subs){ const st=await enviarPush(env,s.data.sub); status.push(st); if(st===201||st===200) enviados++; }
  return {ok:true, teste:true, inscritos:subs.length, enviados, status};
}

// ───────── util base64url ─────────
function b64urlToBytes(s){ const pad='='.repeat((4-s.length%4)%4); const b=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/')); const out=new Uint8Array(b.length); for(let i=0;i<b.length;i++) out[i]=b.charCodeAt(i); return out; }
function bytesToB64url(buf){ const b=new Uint8Array(buf); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function strToB64url(str){ return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

// ───────── Firebase: OAuth via conta de serviço (RS256) ─────────
let _token=null;
// Aceita FIREBASE_SERVICE_ACCOUNT como Text (string JSON) OU como JSON (objeto). #robusto
function getSA(env){ const s=env.FIREBASE_SERVICE_ACCOUNT; return typeof s==='string'?JSON.parse(s):s; }
async function getAccessToken(env){
  if(_token && _token.exp>Date.now()+60000) return _token.v;
  const sa=getSA(env);
  const now=Math.floor(Date.now()/1000);
  const header=strToB64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=strToB64url(JSON.stringify({
    iss:sa.client_email, scope:'https://www.googleapis.com/auth/datastore',
    aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600
  }));
  const unsigned=`${header}.${claim}`;
  const pem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/,'').replace(/-----END PRIVATE KEY-----/,'').replace(/\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8', b64urlToBytes(pem.replace(/\+/g,'-').replace(/\//g,'_')), {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt=`${unsigned}.${bytesToB64url(sig)}`;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`});
  const data=await res.json();
  if(!data.access_token) throw new Error('OAuth falhou: '+JSON.stringify(data));
  _token={v:data.access_token, exp:Date.now()+ (data.expires_in||3600)*1000};
  return _token.v;
}
function projectId(env){ return getSA(env).project_id; }
function fsBase(env){ return `https://firestore.googleapis.com/v1/projects/${projectId(env)}/databases/(default)/documents`; }

// Converte um doc REST do Firestore p/ objeto JS simples (campos comuns).
function fsVal(v){
  if(v==null) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return parseInt(v.integerValue);
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('timestampValue' in v) return v.timestampValue;
  if('nullValue' in v) return null;
  if('mapValue' in v) return fsMap(v.mapValue.fields||{});
  if('arrayValue' in v) return (v.arrayValue.values||[]).map(fsVal);
  return null;
}
function fsMap(fields){ const o={}; for(const k in fields) o[k]=fsVal(fields[k]); return o; }

async function fsGetDoc(env,col,id){
  const t=await getAccessToken(env);
  const res=await fetch(`${fsBase(env)}/${col}/${encodeURIComponent(id)}`,{headers:{authorization:'Bearer '+t}});
  if(res.status===404) return null;
  if(!res.ok) throw new Error('fsGet '+res.status);
  const j=await res.json(); return fsMap(j.fields||{});
}
async function fsListCol(env,col){
  const t=await getAccessToken(env); const out=[]; let pageToken='';
  do{
    const url=`${fsBase(env)}/${col}?pageSize=300${pageToken?`&pageToken=${pageToken}`:''}`;
    const res=await fetch(url,{headers:{authorization:'Bearer '+t}});
    if(!res.ok) throw new Error('fsList '+res.status);
    const j=await res.json();
    (j.documents||[]).forEach(d=>{ const id=d.name.split('/').pop(); out.push({id, data:fsMap(d.fields||{})}); });
    pageToken=j.nextPageToken||'';
  } while(pageToken);
  return out;
}
async function fsRunQuery(env,col,field1,v1,field2,v2){
  const t=await getAccessToken(env);
  const q={structuredQuery:{from:[{collectionId:col}],where:{compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:field1},op:'EQUAL',value:{integerValue:String(v1)}}},
    {fieldFilter:{field:{fieldPath:field2},op:'EQUAL',value:{integerValue:String(v2)}}}
  ]}}}};
  const res=await fetch(`${fsBase(env)}:runQuery`,{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify(q)});
  if(!res.ok) throw new Error('fsQuery '+res.status+' '+(await res.text()).slice(0,200));
  const arr=await res.json();
  return arr.filter(x=>x.document).map(x=>fsMap(x.document.fields||{}));
}
async function fsSaveDoc(env,col,id,obj){
  // grava via REST com merge simples (sobrescreve o doc — usamos só p/ pushstate)
  const t=await getAccessToken(env);
  const fields=toFields(obj);
  const res=await fetch(`${fsBase(env)}/${col}/${encodeURIComponent(id)}`,{method:'PATCH',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify({fields})});
  if(!res.ok) throw new Error('fsSave '+res.status);
}
function toFields(o){ const f={}; for(const k in o){ const v=o[k];
  if(typeof v==='string') f[k]={stringValue:v};
  else if(typeof v==='boolean') f[k]={booleanValue:v};
  else if(typeof v==='number') f[k]=Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  else if(Array.isArray(v)) f[k]={arrayValue:{values:v.map(x=>({stringValue:String(x)}))}};
  else if(v==null) f[k]={nullValue:null};
  else f[k]={stringValue:JSON.stringify(v)};
 } return f; }

// ───────── VAPID (ES256) + Web Push vazio ─────────
async function vapidAuth(env, endpoint){
  const aud=new URL(endpoint).origin;
  const now=Math.floor(Date.now()/1000);
  const header=strToB64url(JSON.stringify({typ:'JWT',alg:'ES256'}));
  const payload=strToB64url(JSON.stringify({aud, exp:now+12*3600, sub:env.VAPID_SUBJECT}));
  const unsigned=`${header}.${payload}`;
  // monta JWK a partir das chaves VAPID (pub = 0x04|x|y ; priv = d)
  const pub=b64urlToBytes(env.VAPID_PUBLIC); // 65 bytes
  const x=bytesToB64url(pub.slice(1,33)), y=bytesToB64url(pub.slice(33,65)), d=env.VAPID_PRIVATE;
  const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x,y,d,ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, new TextEncoder().encode(unsigned));
  const jwt=`${unsigned}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`;
}
async function enviarPush(env, sub){
  try{
    const auth=await vapidAuth(env, sub.endpoint);
    const res=await fetch(sub.endpoint,{method:'POST',headers:{authorization:auth,'ttl':'3600'}});
    return res.status; // 201 = ok; 404/410 = inscrição morta
  }catch(e){ return 'erro:'+(e&&e.message||e); }
}

// ───────── Janela de notificações + disparo de pedido (push instantâneo) ───────── #janela-notif
function _corsMon(){ return { 'access-control-allow-origin':'*', 'access-control-allow-methods':'POST, OPTIONS', 'access-control-allow-headers':'content-type' }; }
function _hmW(s){ const p=String(s||'').split(':'); return (parseInt(p[0])||0)*60+(parseInt(p[1])||0); }
// `now` (Date em BRT, leitura via getUTC*) está dentro da janela? Trata virada de meia-noite.
function _inJanelaW(janela, d){
  const wd=d.getUTCDay(), now=d.getUTCHours()*60+d.getUTCMinutes();
  const dias=(janela&&janela.dias)||[];
  const hoje=dias[wd];
  if(hoje && hoje.on){ const ini=_hmW(hoje.ini), fim=_hmW(hoje.fim);
    if(fim>ini){ if(now>=ini && now<fim) return true; } else { if(now>=ini) return true; } }
  const prev=dias[(wd+6)%7];
  if(prev && prev.on){ const ini=_hmW(prev.ini), fim=_hmW(prev.fim); if(fim<=ini && now<fim) return true; }
  return false;
}
function _janelaPermiteAgoraW(janela, tipo, d){
  if(!janela || !janela.ativa) return true;       // sem restrição = recebe sempre
  if(_inJanelaW(janela, d)) return true;
  const e=janela.excecoes||{};
  if(tipo==='folga'      && e.folga)      return true;
  if(tipo==='foraJanela' && e.foraJanela) return true;
  if(tipo==='falta'      && e.falta)      return true;
  return false;                                    // fora da janela e sem exceção → segura
}
// POST /notificar-pedido { pedidoId } — colaborador criou um pedido; avisa os
// supervisores responsáveis pelo posto, respeitando a janela de cada um.
async function notificarPedido(req, env){
  let body={}; try{ body=await req.json(); }catch(_){}
  const pedidoId=String(body.pedidoId||'').trim();
  if(!pedidoId) return { ok:false, erro:'pedidoId ausente' };
  const ped=await fsGetDoc(env,'autorizacoesPonto',pedidoId);
  if(!ped) return { ok:false, erro:'pedido não encontrado' };
  if(ped.status && ped.status!=='pendente') return { ok:true, msg:'pedido não está pendente' };
  const posto=ped.posto||'';
  const tipo=(ped.ehFolga || ped.tipoBloqueio==='folga') ? 'folga' : 'foraJanela';
  const d=brtNow();
  const cfgs=await fsListCol(env,'configuracoes');
  const subs=cfgs.filter(c=>c.id.startsWith('psup_') && c.data && c.data.sub && c.data.sub.endpoint);
  let enviados=0, segurados=0, foraEscopo=0;
  for(const s of subs){
    const postos=s.data.postos;
    const escopo=(Array.isArray(postos)&&postos.length)?postos:null;   // null/[] = todos os postos
    if(escopo && posto && !escopo.includes(posto)){ foraEscopo++; continue; }
    if(_janelaPermiteAgoraW(s.data.janelaNotif, tipo, d)){
      const st=await enviarPush(env, s.data.sub);
      if(st===201||st===200) enviados++;
    } else { segurados++; }
  }
  return { ok:true, enviados, segurados, foraEscopo, supervisores:subs.length, tipo, posto };
}

// ───────── tempo BRT (UTC-3, sem horário de verão) ─────────
function brtNow(){ return new Date(Date.now() - 3*3600*1000); } // usar getUTC* p/ ler o "relógio de parede" BRT
function ymdDe(d){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
function competenciaDe(d){ let mes=d.getUTCMonth()+1, ano=d.getUTCFullYear(); if(d.getUTCDate()>=26){ mes++; if(mes>12){mes=1;ano++;} } return {mes,ano}; }
function toMin(hhmm){ const p=String(hhmm||'').split(':'); const h=parseInt(p[0]),m=parseInt(p[1]); return (isNaN(h)||isNaN(m))?null:h*60+m; }

// ───────── núcleo ─────────
async function rodar(env){
  const d=brtNow();
  const ymd=ymdDe(d);
  const nowMin=d.getUTCHours()*60+d.getUTCMinutes();
  const exp=await fsGetDoc(env,'configuracoes','monitorexpectativas_'+ymd);
  if(!exp || !Array.isArray(exp.esperados) || !exp.esperados.length) return {ok:true, msg:'sem expectativas hoje', ymd};
  const tol=parseInt(exp.tolerancia)||15;
  const comp=competenciaDe(d);
  const diaHoje=d.getUTCDate();
  // batidas de hoje: payrolls da competência → pontoManualDias[dia==hoje].entrada
  const payrolls=await fsRunQuery(env,'payrolls','mes',comp.mes,'ano',comp.ano);
  const bateu={};
  payrolls.forEach(p=>{ (p.pontoManualDias||[]).forEach(x=>{ if(x && x.dia===diaHoje && x.entrada) bateu[p.employeeId]=true; }); });
  // resoluções do supervisor hoje (informada/abonada) → não alerta
  const resolvDoc=await fsGetDoc(env,'configuracoes','monitorfaltas_'+ymd);
  const resolv=(resolvDoc&&resolvDoc.resolvidos)||{};
  // faltantes = esperados, passou +tol, sem batida, sem resolução
  const faltantes=exp.esperados.filter(e=>{
    const em=toMin(e.entrada); if(em==null) return false;
    if(nowMin < em+tol) return false;
    if(bateu[e.empId]) return false;
    const r=resolv[e.empId]; if(r && (r.status==='informada'||r.status==='abonada')) return false;
    return true;
  });  // mantém objetos {empId, posto, ...}
  if(!faltantes.length) return {ok:true, msg:'ninguém faltando agora', ymd, nowMin};
  // dedupe: só notifica faltante NOVO (por empId) ainda não notificado hoje
  const stDoc=await fsGetDoc(env,'configuracoes','monitorpushstate_'+ymd);
  const jaNotif=(stDoc&&Array.isArray(stDoc.notificados))?stDoc.notificados:[];
  const novos=faltantes.filter(e=>!jaNotif.includes(e.empId));
  if(!novos.length) return {ok:true, msg:'sem novidades (já notificado)', ymd, faltantes:faltantes.length};
  // envia push RESPEITANDO o escopo de postos de cada supervisor inscrito (pushsub_.postos)
  const cfgs=await fsListCol(env,'configuracoes');
  const subs=cfgs.filter(c=>c.id.startsWith('pushsub_') && c.data && c.data.sub && c.data.sub.endpoint);
  let enviados=0; const notificadosAgora=new Set();
  for(const s of subs){
    const postos=s.data.postos;
    const escopo=(Array.isArray(postos) && postos.length)?postos:null;  // null/[] = todos os postos
    const relevantes=escopo?novos.filter(f=>escopo.includes(f.posto)):novos;
    if(!relevantes.length) continue;                                    // nada do escopo desse supervisor
    const st=await enviarPush(env,s.data.sub);
    if(st===201||st===200){ enviados++; relevantes.forEach(f=>notificadosAgora.add(f.empId)); }
  }
  // marca notificado só os faltantes realmente ENTREGUES a algum supervisor no escopo
  if(notificadosAgora.size>0){
    const acc=Array.from(new Set([...jaNotif, ...notificadosAgora]));
    await fsSaveDoc(env,'configuracoes','monitorpushstate_'+ymd,{ ymd, notificados:acc, atualizadoEm:new Date().toISOString() });
  }
  return {ok:true, ymd, faltantesNovos:novos.length, inscritos:subs.length, enviados};
}
