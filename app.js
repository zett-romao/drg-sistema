/* ============================================
   D.R. Global Multi Services — Sistema de Gestão
   app.js  (v4 — Firebase Firestore)
   ============================================ */

'use strict';

// ============================================
// VERSÃO DO SISTEMA — altere APENAS aqui
// ============================================
const APP_VERSION = 'DRG-Kronos 3.0';

// ============================================
// MÓDULO DB — CAMADA FIRESTORE
// ============================================
const DB = {
  fs: null,
  storage: null,
  _unsubs: [],

  isConfigured() {
    return FIREBASE_CONFIG.apiKey !== 'COLE_AQUI';
  },

  init() {
    if (!this.isConfigured()) return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.fs = firebase.firestore();
      return true;
    } catch (e) {
      console.error('Firebase init:', e);
      return false;
    }
  },

  initStorage() {
    if (this.storage) return true;
    try {
      this.storage = firebase.storage();
      return true;
    } catch(e) {
      console.warn('Storage não disponível:', e);
      return false;
    }
  },

  // Salva/atualiza um documento (merge)
  async save(col, record) {
    if (!this.fs) return;
    await this.fs.collection(col).doc(record.id).set(record);
  },

  // Exclui um documento
  async remove(col, id) {
    if (!this.fs) return;
    await this.fs.collection(col).doc(id).delete();
  },

  // Leitura única de uma coleção
  async getAll(col) {
    if (!this.fs) return [];
    const snap = await this.fs.collection(col).get();
    return snap.docs.map(d => d.data());
  },

  // Listener em tempo real — retorna função de cancelamento
  listen(col, callback, orderByField = null, limitN = null) {
    if (!this.fs) return () => {};
    let ref = this.fs.collection(col);
    if (orderByField) ref = ref.orderBy(orderByField, 'desc');
    if (limitN)       ref = ref.limit(limitN);
    const unsub = ref.onSnapshot(snap => {
      callback(snap.docs.map(d => d.data()));
    }, err => console.error(`Listener ${col}:`, err));
    this._unsubs.push(unsub);
    return unsub;
  },

  stopAll() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  },

  // Migração: importa dados do localStorage para o Firestore (uma única vez)
  async migrateFromLocalStorage() {
    try {
      const emp = JSON.parse(localStorage.getItem('drg_employees') || '[]');
      const pay = JSON.parse(localStorage.getItem('drg_payrolls')  || '[]');
      const usr = JSON.parse(localStorage.getItem('drg_users')     || '[]');
      const log = JSON.parse(localStorage.getItem('drg_access_log')|| '[]');

      if (emp.length + pay.length + usr.length === 0) return false;

      const tasks = [
        ...emp.map(r => this.save('employees', r)),
        ...pay.map(r => this.save('payrolls',  r)),
        ...usr.map(r => this.save('users',     r)),
        ...log.slice(0, 200).map(r => this.save('accessLog', r))
      ];
      await Promise.all(tasks);

      // Limpa localStorage após migração bem-sucedida
      ['drg_employees','drg_payrolls','drg_users','drg_access_log'].forEach(k =>
        localStorage.removeItem(k)
      );
      return true;
    } catch (e) {
      console.error('Migração:', e);
      return false;
    }
  }
};

// ============================================
// ESTADO GLOBAL
// ============================================
const EMPRESA_DEFAULTS = {
  nomeEmpresa:         'D.R. Global Multi Services',
  cnpj:                '47.619.085/0001-98',
  descricao:           'Gestão de Portaria e Segurança',
  subdesc:             'Sistema de Gestão de Colaboradores',
  logoUrl:             '',
  modoContabilidade:   'ambas'   // 'interna' | 'externa' | 'ambas'
};

const State = {
  employees: [],
  payrolls:  [],
  perfis:    [],
  postos:    [],
  contratos: [],
  escalas:   [],
  cct: null,
  empresa: {...EMPRESA_DEFAULTS},
  decimoTerceiro: [],
  ferias:         [],
  currentSection: 'dashboard',
  sectionHistory: [],          // pilha de navegação para o botão Voltar
  editingEmployeeId: null,
  currentPdfFile: null,
  currentPdfText: '',
  employeeFilter: 'all'
};

// ============================================
// CONFIGURAÇÃO DA EMPRESA
// ============================================
function _e(field){ return (State.empresa&&State.empresa[field]) || EMPRESA_DEFAULTS[field] || ''; }

async function loadEmpresaConfig(){
  try {
    const doc = await DB.fs.collection('configuracoes').doc('empresa').get();
    if(doc.exists){
      State.empresa = { ...EMPRESA_DEFAULTS, ...doc.data() };
    }
  } catch(e){ /* sem dados — usa defaults */ }
  applyEmpresaConfig();
}

function applyEmpresaConfig(){
  const e = State.empresa;
  const nome    = e.nomeEmpresa || EMPRESA_DEFAULTS.nomeEmpresa;
  const logo    = e.logoUrl     || 'logo.png';
  const subdesc = e.subdesc     || EMPRESA_DEFAULTS.subdesc;

  // título da aba
  document.title = nome + ' — Sistema de Gestão';

  // logos
  ['empresa-logo-loading','empresa-logo-setup','empresa-logo-login',
   'empresa-logo-sidebar','empresa-logo-cont','empresa-logo-report'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.src=logo; el.alt=nome; }
  });

  // textos de nome
  ['empresa-nome-login','empresa-nome-cont','empresa-nome-report'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent=nome;
  });

  // sidebar brand (tem estrutura especial)
  const sideNome=document.getElementById('empresa-nome-sidebar');
  if(sideNome) sideNome.textContent=nome;

  // subtítulo login e sidebar
  const descLogin=document.getElementById('empresa-desc-login');
  if(descLogin) descLogin.textContent=subdesc;
  const descSide=document.getElementById('empresa-desc-sidebar');
  if(descSide) descSide.textContent=subdesc;

  // dashboard welcome
  const dWelcome=document.getElementById('dashboard-welcome-empresa');
  if(dWelcome) dWelcome.textContent='Bem-vindo ao sistema de gestão de colaboradores ' + nome;

  // footer relatório
  const repFoot=document.getElementById('empresa-footer-report');
  if(repFoot) repFoot.textContent=nome + ' — Sistema de Gestão de Colaboradores';

  // licença lock
  const supNome=document.getElementById('empresa-suporte-nome');
  if(supNome) supNome.textContent=nome;
  const licFoot=document.getElementById('empresa-footer-licenca');
  if(licFoot) licFoot.textContent=nome + ' — Sistema de Gestão';

  // formulário de configurações (se estiver visível)
  if(document.getElementById('cfg-nome-empresa')){
    setVal('cfg-nome-empresa',       e.nomeEmpresa||'');
    setVal('cfg-cnpj',               e.cnpj||'');
    setVal('cfg-descricao',          e.descricao||'');
    setVal('cfg-logo-url',           e.logoUrl||'');
    setVal('cfg-subdesc',            e.subdesc||'');
    setVal('cfg-modo-contabilidade', e.modoContabilidade||'ambas');
  }

  // Banners de modo de contabilidade nas seções
  _applyModoBanners(e.modoContabilidade||'ambas');
}

function _applyModoBanners(modo){
  const banners = {
    'pag-modo-banner':  document.getElementById('pag-modo-banner'),
    'cont-modo-banner': document.getElementById('cont-modo-banner'),
  };
  const modoLabels = {
    interna: { label:'Contabilidade Interna', cor:'#1B5E20', bg:'#E8F5E9', icon:'fa-house' },
    externa: { label:'Contabilidade Externa',  cor:'#1565C0', bg:'#E3F2FD', icon:'fa-building' },
    ambas:   { label:'Interna + Externa',      cor:'#4A148C', bg:'#F3E5F5', icon:'fa-code-branch' },
  };
  const m = modoLabels[modo] || modoLabels.ambas;

  const pagBanner = document.getElementById('pag-modo-banner');
  if(pagBanner){
    const hidden = modo === 'externa';
    pagBanner.style.display = hidden ? 'none' : '';
    if(!hidden) pagBanner.innerHTML =
      modo === 'interna'
        ? `<i class="fa-solid fa-circle-check" style="color:${m.cor}"></i> <strong>Modo Contabilidade Interna</strong> — Você gerencia a folha de pagamento internamente. Use esta seção para acompanhar encargos, INSS, IRRF e FGTS de cada colaborador.`
        : `<i class="fa-solid fa-code-branch" style="color:${m.cor}"></i> <strong>Modo Ambas</strong> — Pagamentos para gestão interna. Use Contabilidade para exportar dados à contabilidade externa.`;
  }

  const contBanner = document.getElementById('cont-modo-banner');
  if(contBanner){
    const hidden = modo === 'interna';
    contBanner.style.display = hidden ? 'none' : '';
    if(!hidden) contBanner.innerHTML =
      modo === 'externa'
        ? `<i class="fa-solid fa-circle-check" style="color:${m.cor}"></i> <strong>Modo Contabilidade Externa</strong> — Exporte a planilha mensal e envie ao seu contador. Ele é responsável pelo cálculo de INSS, FGTS e IRRF.`
        : `<i class="fa-solid fa-code-branch" style="color:${m.cor}"></i> <strong>Modo Ambas</strong> — Contabilidade para exportação ao contador externo. Use Pagamentos para gestão interna de encargos.`;
  }
}

async function saveEmpresaConfig(){
  if(Auth.currentUser?.role!=='master'){ toast('Apenas o master pode alterar as configurações','error'); return; }
  const dados = {
    nomeEmpresa:       val('cfg-nome-empresa').trim() || EMPRESA_DEFAULTS.nomeEmpresa,
    cnpj:              val('cfg-cnpj').trim(),
    descricao:         val('cfg-descricao').trim(),
    logoUrl:           val('cfg-logo-url').trim(),
    subdesc:           val('cfg-subdesc').trim(),
    modoContabilidade: val('cfg-modo-contabilidade') || 'ambas',
    updatedAt:         new Date().toISOString()
  };
  try {
    await DB.fs.collection('configuracoes').doc('empresa').set(dados, {merge:true});
    State.empresa = { ...EMPRESA_DEFAULTS, ...dados };
    applyEmpresaConfig();
    _applyModoBanners(dados.modoContabilidade||'ambas');
    toast('Configurações salvas com sucesso!','success');
  } catch(e){
    toast('Erro ao salvar configurações: ' + e.message,'error');
  }
}

function renderConfiguracoes(){
  const e = State.empresa;
  setVal('cfg-nome-empresa',       e.nomeEmpresa||'');
  setVal('cfg-cnpj',               e.cnpj||'');
  setVal('cfg-descricao',          e.descricao||'');
  setVal('cfg-logo-url',           e.logoUrl||'');
  setVal('cfg-subdesc',            e.subdesc||'');
  setVal('cfg-modo-contabilidade', e.modoContabilidade||'ambas');
}

// ============================================
// MÓDULO AUTH
// ============================================
const Auth = {
  users:      [],
  accessLog:  [],
  currentUser: null,

  async hashPassword(pw) {
    const data = new TextEncoder().encode(pw);
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  async ensureDefaultUser() {
    if (this.users.length > 0) return;
    const hash = await this.hashPassword('admin@drg123');
    const u = {
      id: 'master-default', username: 'admin', passwordHash: hash,
      role: 'master', active: true,
      createdAt: new Date().toISOString(), lastLogin: null, forceChange: true
    };
    await DB.save('users', u);
    this.users = [u];
  },

  log(type, username, details = '') {
    const entry = {
      id: genId(),
      timestamp: new Date().toISOString(),
      type,
      username: username || (this.currentUser ? this.currentUser.username : 'sistema'),
      details
    };
    this.accessLog.unshift(entry);
    DB.save('accessLog', entry).catch(console.error);
  },

  saveSession(user) {
    sessionStorage.setItem('drg_session', JSON.stringify({ userId: user.id }));
    this.currentUser = user;
  },
  loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem('drg_session') || 'null');
      if (!s) return null;
      return this.users.find(u => u.id === s.userId && u.active) || null;
    } catch { return null; }
  },
  clearSession() {
    sessionStorage.removeItem('drg_session');
    this.currentUser = null;
  }
};

// ============================================
// AUTO-BACKUP (grava arquivo local a cada 5min)
// ============================================
const AutoBackup = {
  fileHandle: null, intervalId: null, countdownId: null,
  nextIn: 300, INTERVAL: 300,
  _DB_NAME: 'drg_backup_db', _STORE: 'handles', _KEY: 'autobackup_handle',

  isSupported() { return typeof window.showSaveFilePicker === 'function'; },

  // Persiste o file handle no IndexedDB para restaurar na próxima sessão
  async _saveHandle(handle) {
    try {
      const db = await this._openIDB();
      const tx = db.transaction(this._STORE, 'readwrite');
      tx.objectStore(this._STORE).put(handle, this._KEY);
      await new Promise(r => { tx.oncomplete = r; });
      db.close();
    } catch(e) { console.warn('AutoBackup: não foi possível salvar handle', e); }
  },

  async _loadHandle() {
    try {
      const db = await this._openIDB();
      const tx = db.transaction(this._STORE, 'readonly');
      const req = tx.objectStore(this._STORE).get(this._KEY);
      const handle = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = rej; });
      db.close();
      return handle || null;
    } catch(e) { return null; }
  },

  async _clearHandle() {
    try {
      const db = await this._openIDB();
      const tx = db.transaction(this._STORE, 'readwrite');
      tx.objectStore(this._STORE).delete(this._KEY);
      await new Promise(r => { tx.oncomplete = r; });
      db.close();
    } catch(e) {}
  },

  _openIDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this._DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this._STORE);
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  },

  // Tenta restaurar o backup automaticamente ao abrir o sistema
  async tryRestore() {
    if (!this.isSupported()) return;
    const handle = await this._loadHandle();
    if (!handle) return;
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.fileHandle = handle;
        this.start();
        return;
      }
      // Chrome reseta permissões ao fechar o navegador — aguarda primeiro clique do usuário
      const resume = async () => {
        document.removeEventListener('click', resume);
        try {
          const perm2 = await handle.requestPermission({ mode: 'readwrite' });
          if (perm2 === 'granted') {
            this.fileHandle = handle;
            this.start();
            toast('Auto-backup reativado automaticamente!');
          } else {
            await this._clearHandle();
          }
        } catch(e) { await this._clearHandle(); }
      };
      document.addEventListener('click', resume);
      // Avisa o usuário discretamente
      setTimeout(() => toast('Auto-backup configurado — clique em qualquer lugar para reativar.', 'warning'), 1500);
    } catch(e) {
      await this._clearHandle();
    }
  },

  async setup() {
    if (!this.isSupported()) {
      toast('Seu navegador não suporta auto-backup em arquivo. Use Chrome ou Edge.','warning');
      return;
    }
    try {
      const date = new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: `DRGlobal_autobackup_${date}.json`,
        types: [{ description:'JSON Backup', accept:{'application/json':['.json']} }]
      });
      await this._saveHandle(this.fileHandle);
      this.start();
      toast('Auto-backup configurado! Salvando a cada 5 minutos.');
      Auth.log('BACKUP_AUTO_CONFIG', null, 'Auto-backup ativado');
    } catch(e) { if (e.name !== 'AbortError') toast('Erro ao configurar auto-backup.','error'); }
  },

  start() {
    if (!this.fileHandle) return;
    this.nextIn = this.INTERVAL;
    this.write();
    clearInterval(this.intervalId); clearInterval(this.countdownId);
    this.intervalId  = setInterval(() => this.write(), this.INTERVAL * 1000);
    this.countdownId = setInterval(() => this.tick(), 1000);
    document.getElementById('auto-backup-status').classList.remove('hidden');
    const btn = document.getElementById('btn-auto-backup');
    btn.classList.add('active');
    document.getElementById('auto-backup-label').textContent = 'Auto-backup: ativo';
  },

  tick() {
    this.nextIn--;
    if (this.nextIn <= 0) this.nextIn = this.INTERVAL;
    const m = String(Math.floor(this.nextIn/60)), s = String(this.nextIn%60).padStart(2,'0');
    const el = document.getElementById('ab-next-label');
    if (el) el.textContent = `Próximo em ${m}:${s}`;
  },

  async write() {
    if (!this.fileHandle) return;
    try {
      const backup = buildBackupObject();
      const writable = await this.fileHandle.createWritable();
      await writable.write(JSON.stringify(backup, null, 2));
      await writable.close();
      this.nextIn = this.INTERVAL;
      Auth.log('BACKUP_AUTO', null, this.fileHandle.name);
    } catch(e) { console.error('Auto-backup write:', e); }
  },

  async stop() {
    clearInterval(this.intervalId); clearInterval(this.countdownId);
    this.fileHandle = null;
    await this._clearHandle();
    document.getElementById('auto-backup-status').classList.add('hidden');
    const btn = document.getElementById('btn-auto-backup');
    btn.classList.remove('active');
    document.getElementById('auto-backup-label').textContent = 'Auto-backup: desligado';
  }
};

// ============================================
// UTILITÁRIOS
// ============================================
const MESES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function genId()    { return Date.now().toString(36) + Math.random().toString(36).substr(2,8); }
function fmtMoney(v){ return 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(iso){ if(!iso) return '—'; return new Date(iso).toLocaleDateString('pt-BR'); }
function fmtDateTime(iso){ if(!iso) return '—'; return new Date(iso).toLocaleString('pt-BR'); }
function formatDateBr(iso){ if(!iso) return '—'; const [y,m,d]=(iso||'').split('-'); return d&&m&&y?`${d}/${m}/${y}`:'—'; }
function initials(name){
  if(!name) return '?';
  const p = name.trim().split(' ');
  return p.length>=2?(p[0][0]+p[p.length-1][0]).toUpperCase():p[0][0].toUpperCase();
}
function currentMes(){ return new Date().getMonth()+1; }
function currentAno(){ return new Date().getFullYear(); }

function toast(msg, type='success'){
  const icons={success:'fa-circle-check',error:'fa-circle-xmark',warning:'fa-triangle-exclamation',info:'fa-circle-info'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<i class="fa-solid ${icons[type]||icons.success}"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}

function val(id)    { const el=document.getElementById(id); return el?el.value.trim():''; }
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=(v==null)?'':v; }
function numVal(id) { return parseFloat(val(id))||0; }

// Remove valores `undefined` de objetos/arrays aninhados antes de salvar no Firestore
// (Firestore rejeita undefined com FirebaseError: Function setDoc() called with invalid data).
function _sanitizeForFirestore(value){
  if(value === undefined) return null;
  if(value === null) return null;
  if(Array.isArray(value)) return value.map(_sanitizeForFirestore);
  if(typeof value === 'object'){
    const out = {};
    Object.keys(value).forEach(k => {
      const v = value[k];
      if(v === undefined) return; // omite chaves com undefined
      out[k] = _sanitizeForFirestore(v);
    });
    return out;
  }
  return value;
}

function setBtnLoading(btn, loading, defaultHTML){
  if(!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...'
    : defaultHTML;
}

function togglePassVisibility(inputId, btn){
  const input=document.getElementById(inputId); if(!input) return;
  const isPass=input.type==='password';
  input.type=isPass?'text':'password';
  btn.innerHTML=isPass?'<i class="fa-solid fa-eye-slash"></i>':'<i class="fa-solid fa-eye"></i>';
}

function buildBackupObject(){
  return {
    version:'3.0', exportedAt:new Date().toISOString(),
    exportedBy: Auth.currentUser?Auth.currentUser.username:'sistema',
    employees:State.employees, payrolls:State.payrolls,
    users:Auth.users, accessLog:Auth.accessLog
  };
}

function updateDbInfo(){
  const el=document.getElementById('db-info'); if(!el) return;
  el.innerHTML=
    `${State.employees.length} colaboradores · ${State.payrolls.length} lançamentos<br>`+
    `<span style="color:#A5D6A7;font-size:10px">● Firebase Firestore</span>`;
}

function toggleDbPanel(){
  const panel=document.getElementById('db-panel-extra');
  const chev=document.getElementById('db-chevron');
  if(!panel) return;
  const open=panel.style.display!=='none';
  panel.style.display=open?'none':'block';
  if(chev) chev.style.transform=open?'':'rotate(180deg)';
}

// ============================================
// LOADING SCREEN
// ============================================
function showLoading(msg='Conectando...'){
  document.getElementById('loading-msg').textContent=msg;
  document.getElementById('loading-screen').classList.remove('hidden');
  document.getElementById('loading-screen').style.display='flex';
}
function hideLoading(){
  document.getElementById('loading-screen').style.display='none';
}
function showSetup(){
  hideLoading();
  document.getElementById('setup-screen').classList.remove('hidden');
}

// ============================================
// NAVEGAÇÃO
// ============================================
let _navigatingBack=false;

function goBack(){
  if(State.sectionHistory.length===0) return;
  _navigatingBack=true;
  const prev=State.sectionHistory.pop();
  showSection(prev);
  _navigatingBack=false;
}

function _updateBackBtn(){
  const btn=document.getElementById('btn-voltar');
  if(btn) btn.classList.toggle('hidden', State.sectionHistory.length===0);
}

function showSection(name){
  if(!Auth.currentUser) return;
  const mods=getUserModules(Auth.currentUser);
  if(name==='users'          && !mods.users && !mods.log) return;
  if(name==='employees'      && !mods.employees)    return;
  if(name==='payroll'        && !mods.payroll)      return;
  if(name==='escalas'        && !mods.escalas)      return;
  if(name==='pagamentos'     && !mods.pagamentos)      return;
  if(name==='decimoterceiro' && !mods.decimoterceiro)  return;
  if(name==='ferias'         && !mods.ferias)          return;
  if(name==='contabilidade'  && !mods.contabilidade)   return;
  if(name==='postos'         && !mods.postos)       return;
  if(name==='contratos'      && !mods.contratos)    return;
  if(name==='configuracoes'  && Auth.currentUser?.role!=='master') return;
  // Empilha seção atual antes de trocar (exceto se estiver voltando ou já está na mesma seção)
  if(!_navigatingBack && State.currentSection && State.currentSection!==name){
    State.sectionHistory.push(State.currentSection);
    if(State.sectionHistory.length>30) State.sectionHistory.shift(); // cap
  }
  _updateBackBtn();
  // Limpa qualquer modal flutuante que possa bloquear cliques
  const floatingModal=document.getElementById('modal-stat-detail');
  if(floatingModal) floatingModal.remove();
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));
  const section=document.getElementById('section-'+name);
  const navBtn=document.getElementById('nav-'+name);
  if(section) section.classList.add('active');
  if(navBtn)  navBtn.classList.add('active');
  const titles={dashboard:'Dashboard',employees:'Colaboradores',payroll:'Folha de Ponto',escalas:'Escalas',
                pagamentos:'Pagamentos',decimoterceiro:'13º Salário',ferias:'Férias',
                contabilidade:'Contabilidade',users:'Usuários & Acessos',postos:'Postos de Trabalho',contratos:'Contratos',configuracoes:'Configurações'};
  document.getElementById('topbar-title').textContent=titles[name]||name;
  State.currentSection=name;
  if(name==='employees') renderEmployeeTable();
  if(name==='payroll')   { initPayrollSection(); renderPayrollStats(); }
  if(name==='escalas')   renderEscalas();
  if(name==='dashboard') renderDashboard();
  if(name==='pagamentos')      { _applyModoBanners(State.empresa?.modoContabilidade||'ambas'); renderPagamentos(); }
  if(name==='decimoterceiro')  renderDecimoTerceiro();
  if(name==='ferias')          renderFeriasModulo();
  if(name==='contabilidade')   { _applyModoBanners(State.empresa?.modoContabilidade||'ambas'); renderContabilidade(); }
  if(name==='configuracoes')  renderConfiguracoes();
  if(name==='postos')    renderPostosTable();
  if(name==='contratos') { renderContratosTable(); populateContratoPostoSelect(); }
  if(name==='users'){
    renderUsersTable(); renderPerfisTable(); renderLogTable();
    // Se usuário só tem acesso ao log (não a gestão de usuários), ocultar cards de usuários e perfis
    const userCard=document.querySelector('#section-users .card:first-child');
    const perfilCard=document.querySelector('#section-users .card:nth-child(2)');
    const pageHeader=document.querySelector('#section-users .page-header');
    const logOnly=!mods.users && mods.log;
    if(userCard)   userCard.style.display   = logOnly?'none':'';
    if(perfilCard) perfilCard.style.display  = logOnly?'none':'';
    if(pageHeader) pageHeader.style.display  = logOnly?'none':'';
  }
  // Fechar menu automaticamente no celular ao navegar
  if(window.innerWidth<=768) closeSidebarMobile();
}

function toggleSidebar(){
  const sidebar=document.getElementById('sidebar');
  const overlay=document.getElementById('sidebar-overlay');
  if(window.innerWidth<=768){
    // Mobile: abre/fecha como drawer lateral
    const isOpen=sidebar.classList.toggle('mobile-open');
    if(overlay) overlay.classList.toggle('active', isOpen);
    document.body.style.overflow=isOpen?'hidden':'';
  } else {
    // Desktop: colapsa/expande normalmente
    sidebar.classList.toggle('collapsed');
  }
}
function closeSidebarMobile(){
  const sidebar=document.getElementById('sidebar');
  const overlay=document.getElementById('sidebar-overlay');
  sidebar.classList.remove('mobile-open');
  if(overlay) overlay.classList.remove('active');
  document.body.style.overflow='';
}

// ============================================
// LOGIN / LOGOUT
// ============================================
async function doLogin(event){
  event.preventDefault();
  const username=val('login-username'), password=val('login-password');
  const errorEl=document.getElementById('login-error');
  const errorMsg=document.getElementById('login-error-msg');
  errorEl.classList.add('hidden');

  const btn=document.getElementById('login-btn');
  btn.disabled=true;
  btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';

  try {
    if(!username||!password){
      errorMsg.textContent='Preencha usuário e senha.';
      errorEl.classList.remove('hidden'); return;
    }
    const user=Auth.users.find(u=>u.username===username);
    if(!user||!user.active){
      Auth.log('LOGIN_FAILED',username,'Usuário não encontrado ou inativo');
      errorMsg.textContent='Usuário inválido ou sem acesso.';
      errorEl.classList.remove('hidden'); return;
    }
    const hash=await Auth.hashPassword(password);
    if(hash!==user.passwordHash){
      Auth.log('LOGIN_FAILED',username,'Senha incorreta');
      errorMsg.textContent='Senha incorreta.';
      errorEl.classList.remove('hidden'); return;
    }
    user.lastLogin=new Date().toISOString();
    await DB.save('users',user);
    Auth.saveSession(user);
    Auth.log('LOGIN_SUCCESS',username,`Perfil: ${roleLabel(user.role)}`);
    document.getElementById('login-screen').classList.add('hidden');
    setVal('login-username',''); setVal('login-password','');
    errorEl.classList.add('hidden');
    applyUserSession(user);
    if(user.forceChange) setTimeout(()=>openChangePasswordModal(true),600);
  } finally {
    btn.disabled=false;
    btn.innerHTML='<i class="fa-solid fa-right-to-bracket"></i> Entrar';
  }
}

function doLogout(){
  Auth.log('LOGOUT', Auth.currentUser?Auth.currentUser.username:'');
  Auth.clearSession();
  document.getElementById('login-screen').classList.remove('hidden');
  AutoBackup.stop();
}

// ============================================
// RECUPERAÇÃO DE ACESSO
// ============================================
const RECOVERY_CODE = 'DRGlobal@Master2025';

function openRecoveryModal(){
  const modal=document.getElementById('modal-recovery');
  if(!modal) return;
  modal.classList.remove('hidden');
  setVal('recovery-code','');
  document.getElementById('recovery-error').classList.add('hidden');
  document.getElementById('recovery-success').classList.add('hidden');
  const btn=document.getElementById('recovery-btn');
  if(btn){ btn.style.display=''; btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-unlock"></i> Restaurar Acesso'; }
}

async function doRecovery(){
  const code=val('recovery-code');
  const errEl=document.getElementById('recovery-error');
  const errMsg=document.getElementById('recovery-error-msg');
  const successEl=document.getElementById('recovery-success');
  errEl.classList.add('hidden');
  successEl.classList.add('hidden');
  if(!code){ errMsg.textContent='Digite o código de recuperação.'; errEl.classList.remove('hidden'); return; }
  if(code!==RECOVERY_CODE){ errMsg.textContent='Código incorreto. Tente novamente.'; errEl.classList.remove('hidden'); return; }
  const btn=document.getElementById('recovery-btn');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i> Restaurando...'; }
  try {
    const newPass='Admin@DRGlobal25';
    const hash=await Auth.hashPassword(newPass);
    const masterUser={
      id:'master-default',
      username:'admin',
      passwordHash:hash,
      role:'master',
      active:true,
      forceChange:true,
      createdAt:new Date().toISOString(),
      lastLogin:null
    };
    await DB.save('users', masterUser);
    // Também reativar qualquer outro master existente
    const masters=(Auth.users||[]).filter(u=>u.role==='master'&&u.id!=='master-default');
    await Promise.all(masters.map(u=>DB.save('users',{...u, active:true})));
    document.getElementById('recovery-new-user').textContent='admin';
    document.getElementById('recovery-new-pass').textContent='Admin@DRGlobal25';
    successEl.classList.remove('hidden');
    if(btn){ btn.style.display='none'; }
  } catch(e){
    errMsg.textContent='Erro ao restaurar acesso. Verifique a conexão com o Firebase.';
    errEl.classList.remove('hidden');
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-unlock"></i> Restaurar Acesso'; }
  }
}

function roleLabel(role){
  if(role==='master')  return 'Master';
  if(role==='operador') return 'Operador';
  if(role && role.startsWith('p_')){
    const perfilId=role.replace('p_','');
    const perfil=(State.perfis||[]).find(p=>p.id===perfilId);
    return perfil?perfil.nome:'Perfil Custom.';
  }
  return 'Operador';
}

function applyUserSession(user){
  document.getElementById('su-avatar').textContent=initials(user.username);
  document.getElementById('su-name').textContent=user.username;
  document.getElementById('su-role').textContent=roleLabel(user.role);
  const mods=getUserModules(user);
  // Usuários & Acessos: master ou quem tem acesso ao log
  const usersLi=document.getElementById('nav-users-li');
  if(usersLi) usersLi.classList.toggle('hidden', !mods.users && !mods.log);
  // Colaboradores: quem tem acesso ao módulo employees
  const empLi=document.getElementById('nav-employees-li');
  if(empLi) empLi.classList.toggle('hidden', !mods.employees);
  // Postos de Trabalho: master ou gestor
  const postosLi=document.getElementById('nav-postos-li');
  if(postosLi) postosLi.classList.toggle('hidden', !mods.postos);
  const escLi=document.getElementById('nav-escalas-li');
  if(escLi) escLi.classList.toggle('hidden', !mods.escalas);
  // Botão Revisar HE no card Horas Extras
  const btnHE=document.getElementById('btn-revisar-he');
  if(btnHE) btnHE.classList.toggle('hidden', !(mods.aprovaHE || user.role==='master'));
  const pagLi=document.getElementById('nav-pagamentos-li');
  if(pagLi) pagLi.classList.toggle('hidden', !mods.pagamentos);
  const decLi=document.getElementById('nav-decimoterceiro-li');
  if(decLi) decLi.classList.toggle('hidden', !mods.decimoterceiro);
  const ferLi=document.getElementById('nav-ferias-li');
  if(ferLi) ferLi.classList.toggle('hidden', !mods.ferias);
  const contLi=document.getElementById('nav-contabilidade-li');
  if(contLi) contLi.classList.toggle('hidden', !mods.contabilidade);
  const contratosLi=document.getElementById('nav-contratos-li');
  if(contratosLi) contratosLi.classList.toggle('hidden', !mods.contratos);
  const cfgLi=document.getElementById('nav-configuracoes-li');
  if(cfgLi) cfgLi.classList.toggle('hidden', user.role!=='master');
  showSection('dashboard');
  updateDbInfo();
}

// ============================================
// ALTERAR SENHA
// ============================================
function openChangePasswordModal(forced=false){
  document.getElementById('modal-change-pass').classList.remove('hidden');
  document.getElementById('change-pass-warn').style.display=forced?'':'none';
  document.getElementById('change-pass-close').style.display=forced?'none':'';
  document.getElementById('change-pass-cancel-btn').style.display=forced?'none':'';
  ['cp-current','cp-new','cp-confirm'].forEach(id=>setVal(id,''));
}

async function changePassword(){
  const user=Auth.currentUser; if(!user) return;
  const current=val('cp-current'), newPass=val('cp-new'), confirm=val('cp-confirm');
  if((await Auth.hashPassword(current))!==user.passwordHash){ toast('Senha atual incorreta.','error'); return; }
  if(newPass.length<6){ toast('Mínimo 6 caracteres.','error'); return; }
  if(newPass!==confirm){ toast('Senhas não coincidem.','error'); return; }
  user.passwordHash=await Auth.hashPassword(newPass);
  user.forceChange=false;
  await DB.save('users',user);
  Auth.log('PASSWORD_CHANGED',user.username);
  closeModal('modal-change-pass');
  toast('Senha alterada com sucesso!');
}

// ============================================
// GERENCIAMENTO DE USUÁRIOS
// ============================================
function openUserModal(id=null){
  if(Auth.currentUser?.role!=='master') return;
  // Atualizar opções de perfil com perfis customizados
  const roleSelect=document.getElementById('usr-role');
  roleSelect.innerHTML=`
    <option value="operador">Operador — só Folha de Ponto e Relatórios</option>
    <option value="master">Master — Acesso Total</option>`;
  (State.perfis||[]).forEach(p=>{
    const opt=document.createElement('option');
    opt.value='p_'+p.id; opt.textContent='Perfil: '+p.nome;
    roleSelect.appendChild(opt);
  });
  document.getElementById('modal-user').classList.remove('hidden');
  const editNote=document.getElementById('usr-edit-note');
  const titleEl=document.getElementById('modal-user-title');
  if(id){
    const u=Auth.users.find(u=>u.id===id); if(!u) return;
    titleEl.innerHTML='<i class="fa-solid fa-user-pen"></i> Editar Usuário';
    setVal('usr-id',u.id); setVal('usr-username',u.username);
    setVal('usr-role',u.role||'operador'); setVal('usr-active',String(u.active));
    setVal('usr-password',''); setVal('usr-password-confirm','');
    editNote.style.display='';
  } else {
    titleEl.innerHTML='<i class="fa-solid fa-user-plus"></i> Novo Usuário';
    ['usr-id','usr-username','usr-password','usr-password-confirm'].forEach(i=>setVal(i,''));
    setVal('usr-role','operador'); setVal('usr-active','true');
    editNote.style.display='none';
  }
}

async function saveUser(){
  if(Auth.currentUser?.role!=='master') return;
  const id=val('usr-id'), username=val('usr-username').toLowerCase().replace(/\s+/g,'.'),
        role=val('usr-role'), active=val('usr-active')==='true',
        password=val('usr-password'), confirm=val('usr-password-confirm');
  if(!username){ toast('Usuário obrigatório.','error'); return; }
  if(Auth.users.find(u=>u.username===username&&u.id!==id)){ toast('Usuário já existe.','error'); return; }
  const btn=document.querySelector('#modal-user .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    if(id){
      const user=Auth.users.find(u=>u.id===id); if(!user) return;
      if(password){
        if(password.length<6){ toast('Mínimo 6 caracteres.','error'); return; }
        if(password!==confirm){ toast('Senhas não coincidem.','error'); return; }
        user.passwordHash=await Auth.hashPassword(password);
        user.forceChange=false;
      }
      user.username=username; user.role=role; user.active=active;
      await DB.save('users',user);
      Auth.log('USER_UPDATED',Auth.currentUser.username,`Editado: ${username}`);
      toast(`Usuário "${username}" atualizado.`);
    } else {
      if(!password){ toast('Informe uma senha.','error'); return; }
      if(password.length<6){ toast('Mínimo 6 caracteres.','error'); return; }
      if(password!==confirm){ toast('Senhas não coincidem.','error'); return; }
      const hash=await Auth.hashPassword(password);
      const newUser={id:genId(),username,passwordHash:hash,role,active,
                     createdAt:new Date().toISOString(),lastLogin:null,forceChange:false};
      await DB.save('users',newUser);
      Auth.log('USER_CREATED',Auth.currentUser.username,`Criado: ${username} (${role})`);
      toast(`Usuário "${username}" criado!`);
    }
    closeModal('modal-user');
  } finally {
    setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar');
  }
}

function renderUsersTable(){
  const tbody=document.getElementById('users-tbody'); if(!tbody) return;
  tbody.innerHTML=Auth.users.map(u=>{
    const roleCls=u.role==='master'?'badge-master':u.role&&u.role.startsWith('p_')?'badge-gestor':'badge-operador';
    const isMaster=Auth.currentUser?.role==='master';
    const logToggle=u.role!=='master'&&isMaster?`<button class="btn-icon ${u.showLog?'btn-primary-icon':'btn-outline'}" onclick="toggleShowLog('${u.id}')" title="${u.showLog?'Revogar acesso ao log':'Dar acesso ao log'}"><i class="fa-solid fa-list-check"></i></button>`:'';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="recent-avatar" style="width:30px;height:30px;font-size:11px">${initials(u.username)}</div>
        <strong>${u.username}</strong>
        ${u.id==='master-default'?'<span class="badge badge-muted" style="font-size:10px">padrão</span>':''}
      </div></td>
      <td><span class="badge ${roleCls}">${roleLabel(u.role)}</span></td>
      <td>${fmtDateTime(u.lastLogin)}</td>
      <td><span class="badge ${u.active?'badge-success':'badge-danger'}">${u.active?'Ativo':'Inativo'}</span></td>
      <td><div class="actions-cell">
        ${logToggle}
        <button class="btn-icon btn-warning-icon" onclick="openUserModal('${u.id}')" title="Editar"><i class="fa-solid fa-pencil"></i></button>
        ${u.id!==Auth.currentUser?.id?`<button class="btn-icon btn-danger-icon" onclick="confirmDeleteUser('${u.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function confirmDeleteUser(id){
  const u=Auth.users.find(u=>u.id===id); if(!u) return;
  if(u.id==='master-default'){ toast('O usuário padrão não pode ser removido.','warning'); return; }
  document.getElementById('confirm-message').textContent=`Excluir o usuário "${u.username}"?`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    await DB.remove('users',id);
    Auth.log('USER_DELETED',Auth.currentUser.username,`Removido: ${u.username}`);
    closeModal('modal-confirm');
    toast(`Usuário "${u.username}" excluído.`,'warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// LOG DE ACESSOS
// ============================================
const LOG_TYPES={
  LOGIN_SUCCESS:       {label:'Login',                cls:'ev-login',      icon:'fa-right-to-bracket'},
  LOGIN_FAILED:        {label:'Login falhou',         cls:'ev-failed',     icon:'fa-triangle-exclamation'},
  LOGOUT:              {label:'Logout',               cls:'ev-logout',     icon:'fa-right-from-bracket'},
  USER_CREATED:        {label:'Usuário criado',       cls:'ev-user',       icon:'fa-user-plus'},
  USER_UPDATED:        {label:'Usuário editado',      cls:'ev-user',       icon:'fa-user-pen'},
  USER_DELETED:        {label:'Usuário excluído',     cls:'ev-user',       icon:'fa-user-minus'},
  PASSWORD_CHANGED:    {label:'Senha alterada',       cls:'ev-user',       icon:'fa-key'},
  BACKUP_AUTO:         {label:'Backup automático',    cls:'ev-backup',     icon:'fa-rotate'},
  BACKUP_AUTO_CONFIG:  {label:'Auto-backup ativado',  cls:'ev-backup',     icon:'fa-gear'},
  BACKUP_MANUAL:       {label:'Backup manual',        cls:'ev-backup',     icon:'fa-file-arrow-down'},
  BACKUP_IMPORT:       {label:'Backup importado',     cls:'ev-backup',     icon:'fa-file-arrow-up'},
  EMPLOYEE_CREATED:    {label:'Colaborador cadastrado',cls:'ev-employee',  icon:'fa-user-plus'},
  EMPLOYEE_UPDATED:    {label:'Colaborador editado',  cls:'ev-employee',   icon:'fa-user-pen'},
  EMPLOYEE_DELETED:    {label:'Colaborador excluído', cls:'ev-employee',   icon:'fa-user-minus'},
  PAYROLL_CREATED:     {label:'Folha cadastrada',     cls:'ev-payroll',    icon:'fa-file-invoice-dollar'},
  PAYROLL_UPDATED:     {label:'Folha atualizada',     cls:'ev-payroll',    icon:'fa-file-pen'},
  PAYROLL_DELETED:     {label:'Folha excluída',       cls:'ev-payroll',    icon:'fa-file-circle-minus'},
  POSTO_CREATED:       {label:'Posto cadastrado',     cls:'ev-posto',      icon:'fa-building-circle-check'},
  POSTO_UPDATED:       {label:'Posto editado',        cls:'ev-posto',      icon:'fa-building-circle-arrow-right'},
  POSTO_DELETED:       {label:'Posto excluído',       cls:'ev-posto',      icon:'fa-building-circle-xmark'},
  CONTRATO_CREATED:    {label:'Contrato cadastrado',  cls:'ev-contrato',   icon:'fa-file-signature'},
  CONTRATO_UPDATED:    {label:'Contrato editado',     cls:'ev-contrato',   icon:'fa-file-pen'},
  CONTRATO_DELETED:    {label:'Contrato excluído',    cls:'ev-contrato',   icon:'fa-file-circle-minus'},
};

function renderLogTable(){
  const tbody=document.getElementById('log-tbody');
  const emptyEl=document.getElementById('log-empty');
  const tableEl=document.getElementById('log-table'); if(!tbody) return;
  if(Auth.accessLog.length===0){
    tableEl.style.display='none'; emptyEl.classList.remove('hidden'); return;
  }
  tableEl.style.display=''; emptyEl.classList.add('hidden');
  tbody.innerHTML=Auth.accessLog.slice(0,200).map(e=>{
    const info=LOG_TYPES[e.type]||{label:e.type,cls:'ev-system',icon:'fa-circle-dot'};
    return `<tr>
      <td style="white-space:nowrap;font-size:12px">${fmtDateTime(e.timestamp)}</td>
      <td><strong>${e.username||'—'}</strong></td>
      <td><span class="ev-badge ${info.cls}"><i class="fa-solid ${info.icon}"></i> ${info.label}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${e.details||''}</td>
    </tr>`;
  }).join('');
}

function exportLog(){
  const rows=['Data/Hora,Usuário,Evento,Detalhes'];
  Auth.accessLog.forEach(e=>{
    const info=LOG_TYPES[e.type]||{label:e.type};
    const esc=s=>`"${(s||'').replace(/"/g,'""')}"`;
    rows.push([fmtDateTime(e.timestamp),e.username,info.label,e.details].map(esc).join(','));
  });
  const blob=new Blob(['﻿'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const date=new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
  const a=document.createElement('a');
  a.href=url; a.download=`DRGlobal_log_${date}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('Log exportado em CSV.');
}

function confirmClearLog(){
  document.getElementById('confirm-message').textContent='Limpar todo o log de acessos?';
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Limpar Log';
  btn.onclick=async()=>{
    const ids=Auth.accessLog.map(e=>e.id);
    await Promise.all(ids.map(id=>DB.remove('accessLog',id)));
    closeModal('modal-confirm');
    toast('Log limpo.','warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// EXPORTAR / IMPORTAR MANUAL
// ============================================
async function exportDatabase(){
  const backup=buildBackupObject();
  const json=JSON.stringify(backup,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const date=new Date().toLocaleDateString('pt-BR').replace(/\//g,'-');
  const a=document.createElement('a');
  a.href=url; a.download=`DRGlobal_backup_${date}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  Auth.log('BACKUP_MANUAL',null,`DRGlobal_backup_${date}.json`);
  toast('Backup exportado com sucesso!');
}

function importDatabase(event){
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async function(e){
    try {
      const backup=JSON.parse(e.target.result);
      if(!backup.employees||!backup.payrolls){ toast('Arquivo inválido.','error'); return; }
      const empCount=backup.employees.length, payCount=backup.payrolls.length,
            usrCount=(backup.users||[]).length;
      document.getElementById('confirm-message').textContent=
        `Importar backup de ${fmtDate(backup.exportedAt)}? `+
        `${empCount} colaboradores, ${payCount} lançamentos, ${usrCount} usuários. `+
        `Os dados atuais serão substituídos.`;
      const btn=document.getElementById('confirm-ok-btn');
      btn.innerHTML='<i class="fa-solid fa-file-import"></i> Importar';
      btn.onclick=async()=>{
        setBtnLoading(btn,true,'');
        try {
          const tasks=[
            ...backup.employees.map(r=>DB.save('employees',r)),
            ...backup.payrolls.map(r=>DB.save('payrolls',r)),
            ...(backup.users||[]).map(r=>DB.save('users',r)),
            ...(backup.accessLog||[]).slice(0,200).map(r=>DB.save('accessLog',r))
          ];
          await Promise.all(tasks);
          closeModal('modal-confirm');
          Auth.log('BACKUP_IMPORT',null,file.name);
          toast(`Importado: ${empCount} colaboradores, ${payCount} lançamentos.`);
        } finally {
          setBtnLoading(btn,false,'<i class="fa-solid fa-trash"></i> Excluir');
        }
      };
      document.getElementById('modal-confirm').classList.remove('hidden');
    } catch{ toast('Erro ao ler o arquivo.','error'); }
    event.target.value='';
  };
  reader.readAsText(file);
}

async function setupAutoBackup(){
  if(AutoBackup.fileHandle){ await AutoBackup.stop(); toast('Auto-backup desativado.','warning'); }
  else { AutoBackup.setup(); }
}

// ============================================
// DASHBOARD
// ============================================
function renderDashboard(){
  const mes=currentMes(), ano=currentAno();
  const payThisMonth=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano);
  const totalEsp     =payThisMonth.reduce((s,p)=>s+(p.remuneracao||0),0);
  const totalLiqFinal=payThisMonth.reduce((s,p)=>s+(p.totalLiquidoFinal||p.remuneracao||0),0);
  const totalINSS    =payThisMonth.reduce((s,p)=>s+(p.inss||0),0);
  const totalFGTS    =payThisMonth.reduce((s,p)=>s+(p.fgts||0),0);
  const ativos=State.employees.filter(e=>(e.status||'ativo')==='ativo').length;
  const inativos=State.employees.filter(e=>(e.status||'ativo')==='inativo').length;
  const afastados=State.employees.filter(e=>(e.status||'ativo')==='afastado').length;
  const licMaternidade=State.employees.filter(e=>(e.status||'ativo')==='licenca-maternidade').length;
  const totalPostos=(State.postos||[]).length;
  const escalasMes=(State.escalas||[]).filter(es=>es.mes==mes&&es.ano==ano).length;
  const escalasPend=Math.max(0, ativos-escalasMes);
  // Benefícios a pagar — hoje e esta semana
  const hojeISO = new Date().toISOString().substring(0,10);
  const semana  = _semanaDe(hojeISO);
  const colabsHoje   = _colabsTrabalhandoEm(hojeISO);
  const colabsSemana = (State.employees||[]).filter(e => (e.status||'ativo')==='ativo' &&
    _diasTrabalhadosNoIntervalo(e, semana.inicio, semana.fim) > 0);
  let totalBenHoje = 0, totalBenSemana = 0;
  colabsHoje.forEach(e => {
    const b = _calcBeneficiosColab(e, hojeISO, hojeISO, 'dia');
    totalBenHoje += b.total;
  });
  colabsSemana.forEach(e => {
    const b = _calcBeneficiosColab(e, semana.inicio, semana.fim, 'semana');
    totalBenSemana += b.total;
  });
  // HE Pendente de revisão: percorre payrolls do mês e conta dias com divergência > tolerância e status pendente
  let heRevisaoEmps = 0, heRevisaoDias = 0;
  payThisMonth.forEach(p => {
    const emp = State.employees.find(e=>e.id===p.employeeId);
    if(!emp || !p.pontoManualDias) return;
    let hasPendente = false;
    p.pontoManualDias.forEach(d => {
      if(!d.entrada || !d.saida) return;
      const exp = _getExpectedDay(emp, p.mes, p.ano, d.dia);
      if(!exp || !exp.entrada) return;
      const detec = _detectHEDivergencia(d, exp);
      if(detec.precisaRevisao && (d.heReview?.status||'pendente')==='pendente'){
        heRevisaoDias++;
        hasPendente = true;
      }
    });
    if(hasPendente) heRevisaoEmps++;
  });
  const stats=document.getElementById('dashboard-stats'); if(!stats) return;
  const cctInfo=State.cct?`<div class="stat-card" style="border-color:#7B1FA2;border-left-width:4px"><div class="stat-icon" style="background:#F3E5F5;color:#7B1FA2"><i class="fa-solid fa-file-contract"></i></div><div><div class="stat-value" style="font-size:14px">CCT vigente</div><div class="stat-label">desde ${formatDateBr(State.cct.vigencia)}</div></div></div>`:'';
  stats.innerHTML=`
    <div class="stat-card blue" style="cursor:pointer" onclick="showSection('employees');setEmployeeFilter('ativo')" title="Ver colaboradores ativos">
      <div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
      <div><div class="stat-value">${ativos}</div><div class="stat-label">Colaboradores ativos</div></div></div>
    <div class="stat-card teal" style="cursor:pointer" onclick="showSection('employees');setEmployeeFilter('afastado')" title="Ver afastados INSS">
      <div class="stat-icon"><i class="fa-solid fa-user-clock"></i></div>
      <div><div class="stat-value">${afastados}</div><div class="stat-label">Afastados INSS</div></div></div>
    ${licMaternidade>0?`<div class="stat-card" style="border-color:#E91E63;border-left-width:4px;cursor:pointer" onclick="showSection('employees');setEmployeeFilter('licenca-maternidade')" title="Ver licenças maternidade">
      <div class="stat-icon" style="background:#FCE4EC;color:#E91E63"><i class="fa-solid fa-baby"></i></div>
      <div><div class="stat-value" style="color:#E91E63">${licMaternidade}</div><div class="stat-label">Licença Maternidade</div></div></div>`:''}
    <div class="stat-card" style="border-color:#9E9E9E;border-left-width:4px;cursor:pointer" onclick="showSection('employees');setEmployeeFilter('inativo')" title="Ver colaboradores inativos">
      <div class="stat-icon" style="background:#F5F5F5;color:#757575"><i class="fa-solid fa-user-slash"></i></div>
      <div><div class="stat-value">${inativos}</div><div class="stat-label">Colaboradores inativos</div></div></div>
    <div class="stat-card" style="border-color:#1565C0;border-left-width:4px;cursor:pointer" onclick="showSection('postos')" title="Ver postos de trabalho">
      <div class="stat-icon" style="background:#E3F2FD;color:#1565C0"><i class="fa-solid fa-building"></i></div>
      <div><div class="stat-value" style="color:#1565C0">${totalPostos}</div><div class="stat-label">Postos de trabalho</div></div></div>
    ${heRevisaoEmps>0?`<div class="stat-card" style="border-color:#E65100;border-left-width:4px;cursor:pointer" onclick="_dashGotoHEReview()" title="Colaboradores com HE acima da tolerância CLT aguardando revisão">
      <div class="stat-icon" style="background:#FFF3E0;color:#E65100"><i class="fa-solid fa-magnifying-glass"></i></div>
      <div>
        <div class="stat-value" style="color:#E65100">${heRevisaoEmps}</div>
        <div class="stat-label">Pendentes de revisar HE</div>
        <div style="font-size:10px;color:#E65100;margin-top:2px"><i class="fa-solid fa-triangle-exclamation"></i> ${heRevisaoDias} dia(s) — clique pra revisar</div>
      </div></div>`:''}
    ${(colabsHoje.length>0||colabsSemana.length>0)?`<div class="stat-card" style="border-color:#0288D1;border-left-width:4px;cursor:pointer" onclick="openBeneficiosPagar()" title="Ver benefícios a pagar hoje e nesta semana">
      <div class="stat-icon" style="background:#E1F5FE;color:#0288D1"><i class="fa-solid fa-money-check-dollar"></i></div>
      <div>
        <div class="stat-value" style="color:#0288D1;font-size:14px">Benefícios a pagar</div>
        <div class="stat-label">Hoje: <strong>${colabsHoje.length}</strong> colab. (${fmtMoney(totalBenHoje)})</div>
        <div style="font-size:10px;color:#01579B;margin-top:2px"><i class="fa-solid fa-calendar-week"></i> Semana: <strong>${colabsSemana.length}</strong> colab. (${fmtMoney(totalBenSemana)})</div>
      </div></div>`:''}
    <div class="stat-card" style="border-color:#6A1B9A;border-left-width:4px;cursor:pointer" onclick="showSection('escalas')" title="Ver escalas do mês">
      <div class="stat-icon" style="background:#F3E5F5;color:#6A1B9A"><i class="fa-solid fa-calendar-days"></i></div>
      <div>
        <div class="stat-value" style="color:#6A1B9A">${escalasMes}</div>
        <div class="stat-label">Escalas — ${MESES[mes]}/${ano}</div>
        ${escalasPend>0?`<div style="font-size:10px;color:#E65100;margin-top:2px"><i class="fa-solid fa-triangle-exclamation"></i> ${escalasPend} pendente(s) de revisão</div>`:'<div style="font-size:10px;color:#1B5E20;margin-top:2px"><i class="fa-solid fa-check-circle"></i> Todas projetadas</div>'}
      </div></div>
    ${(()=>{
      const modo=State.empresa?.modoContabilidade||'ambas';
      const usaInterna=modo==='interna'||modo==='ambas';
      const usaExterna=modo==='externa'||modo==='ambas';
      let card='';
      if(usaInterna){
        // Card Pagamentos (líquido final com encargos)
        const encargosCalc=totalINSS>0;
        card+=`<div class="stat-card" style="border-color:#1B5E20;border-left-width:4px;cursor:pointer" onclick="showSection('pagamentos')" title="Ver pagamentos do mês">
          <div class="stat-icon" style="background:#E8F5E9;color:#1B5E20"><i class="fa-solid fa-money-bill-wave"></i></div>
          <div>
            <div class="stat-value" style="color:#1B5E20">${fmtMoney(usaExterna&&!encargosCalc?totalEsp:totalLiqFinal)}</div>
            <div class="stat-label">Folha ${MESES[mes]} — ${payThisMonth.length} holerite(s)</div>
            ${encargosCalc?`<div style="font-size:10px;color:#666;margin-top:2px">INSS ${fmtMoney(totalINSS)} · FGTS ${fmtMoney(totalFGTS)}</div>`:''}
          </div></div>`;
      }
      if(usaExterna&&!usaInterna){
        // Card Contabilidade (remuneração bruta para enviar ao contador)
        card+=`<div class="stat-card amber" style="cursor:pointer" onclick="showSection('contabilidade')" title="Ver planilha de contabilidade">
          <div class="stat-icon"><i class="fa-solid fa-calculator"></i></div>
          <div>
            <div class="stat-value">${fmtMoney(totalEsp)}</div>
            <div class="stat-label">Remunerações ${MESES[mes]} — ${payThisMonth.length} folha(s)</div>
            <div style="font-size:10px;color:#777;margin-top:2px">Exportar para contador externo</div>
          </div></div>`;
      }
      return card;
    })()}
    <div class="stat-card green" style="cursor:pointer" onclick="showSection('payroll')" title="Ver folha de ponto">
      <div class="stat-icon"><i class="fa-solid fa-file-circle-check"></i></div>
      <div><div class="stat-value">${payThisMonth.length}</div><div class="stat-label">Folhas lançadas em ${MESES[mes]}</div></div></div>
    <div class="stat-card" style="border-color:#2E7D32;border-left-width:4px;cursor:pointer" onclick="showSection('contratos')" title="Ver contratos">
      <div class="stat-icon" style="background:#F1F8E9;color:#2E7D32"><i class="fa-solid fa-file-signature"></i></div>
      <div><div class="stat-value" style="color:#2E7D32">${(State.contratos||[]).filter(c=>!c.status||c.status!=='inativo').length}</div><div class="stat-label">Contratos ativos</div></div></div>
    ${cctInfo}
  `;
  renderBirthdays();
  renderAlerts();
  const recEl=document.getElementById('recent-payrolls'); if(!recEl) return;
  const recent=[...State.payrolls].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,6);
  if(recent.length===0){
    recEl.innerHTML=`<div class="empty-state small"><i class="fa-solid fa-file-circle-xmark"></i><p>Nenhum lançamento recente</p></div>`;
  } else {
    recEl.innerHTML=recent.map(p=>{
      const emp=State.employees.find(e=>e.id===p.employeeId); if(!emp) return '';
      const totalFaltas='faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0);
      return `<div class="recent-item">
        <div class="recent-avatar">${initials(emp.nome)}</div>
        <div><div class="recent-name">${emp.nome}</div>
             <div class="recent-period">${MESES[p.mes]}/${p.ano} — ${p.diasTrabalhados}d / ${totalFaltas} falta(s)</div></div>
        <div class="recent-value">${fmtMoney(p.remuneracao)}</div>
      </div>`;
    }).join('');
  }
}

function formatDateBr(iso){
  if(!iso) return '—';
  // Para datas no formato YYYY-MM-DD sem hora
  if(iso.length===10) { const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; }
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ============================================
// STATS DA FOLHA DE PONTO
// ============================================
function renderPayrollStats(){
  const grid=document.getElementById('payroll-stats-grid'); if(!grid) return;
  const mes=currentMes(), ano=currentAno();
  const payThisMonth=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano);
  const tR=payThisMonth.reduce((s,p)=>s+(p.remuneracao||0),0);
  const tVT=payThisMonth.reduce((s,p)=>s+(p.valeTransporte||0),0);
  const tVR=payThisMonth.reduce((s,p)=>s+(p.valeRefeicao||0),0);
  const tVA=payThisMonth.reduce((s,p)=>s+(p.valeAlimentacaoLiquido||0),0);
  const tHE=payThisMonth.reduce((s,p)=>s+(p.horasExtrasValor||0),0);
  const tB=payThisMonth.reduce((s,p)=>s+(p.bonificacao||0),0);
  const tAN=payThisMonth.reduce((s,p)=>s+(p.adNoturno||0),0);
  const tAdiant=payThisMonth.reduce((s,p)=>s+(p.adiantamento||0),0);
  const tTotal=tR+tVT+tVR+tVA+tHE+tB+tAN;
  const sc='cursor:pointer;transition:box-shadow .15s' , sh='onmouseover="this.style.boxShadow=\'0 4px 16px #0002\'" onmouseout="this.style.boxShadow=\'\'"';
  grid.innerHTML=`
    <div class="stat-card green" style="${sc}" onclick="showPayrollStatDetail('_all','Folhas Lançadas','#2E7D32')" ${sh}>
      <div class="stat-icon"><i class="fa-solid fa-file-circle-check"></i></div>
      <div><div class="stat-value">${payThisMonth.length}</div><div class="stat-label">Folhas lançadas — ${MESES[mes]}</div></div></div>
    <div class="stat-card amber" style="${sc}" onclick="showPayrollStatDetail('remuneracao','Total Remunerações','#F9A825')" ${sh}>
      <div class="stat-icon"><i class="fa-solid fa-money-bill-wave"></i></div>
      <div><div class="stat-value">${fmtMoney(tR)}</div><div class="stat-label">Total Remunerações</div></div></div>
    <div class="stat-card" style="border-color:#0288D1;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('valeTransporte','Vale Transporte','#0288D1')" ${sh}>
      <div class="stat-icon" style="background:#E1F5FE;color:#0288D1"><i class="fa-solid fa-bus"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tVT)}</div><div class="stat-label">Vale Transporte</div></div></div>
    <div class="stat-card" style="border-color:#E65100;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('valeRefeicao','Vale Refeição','#E65100')" ${sh}>
      <div class="stat-icon" style="background:#FBE9E7;color:#E65100"><i class="fa-solid fa-utensils"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tVR)}</div><div class="stat-label">Vale Refeição</div></div></div>
    <div class="stat-card" style="border-color:#2E7D32;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('valeAlimentacaoLiquido','Vale Alimentação','#2E7D32')" ${sh}>
      <div class="stat-icon" style="background:#E8F5E9;color:#2E7D32"><i class="fa-solid fa-basket-shopping"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tVA)}</div><div class="stat-label">Vale Alimentação</div></div></div>
    <div class="stat-card" style="border-color:#5C6BC0;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('horasExtrasValor','Horas Extras','#5C6BC0')" ${sh}>
      <div class="stat-icon" style="background:#E8EAF6;color:#5C6BC0"><i class="fa-solid fa-clock-rotate-left"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tHE)}</div><div class="stat-label">Horas Extras</div></div></div>
    <div class="stat-card" style="border-color:#F57C00;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('bonificacao','Bonificação','#F57C00')" ${sh}>
      <div class="stat-icon" style="background:#FFF3E0;color:#F57C00"><i class="fa-solid fa-star"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tB)}</div><div class="stat-label">Bonificação</div></div></div>
    <div class="stat-card" style="border-color:#00796B;border-left-width:4px;${sc}" onclick="showPayrollStatDetail('adiantamento','Adiantamentos','#00796B')" ${sh}>
      <div class="stat-icon" style="background:#E0F2F1;color:#00796B"><i class="fa-solid fa-hand-holding-dollar"></i></div>
      <div><div class="stat-value" style="font-size:15px">${fmtMoney(tAdiant)}</div><div class="stat-label">Adiantamentos</div></div></div>
    <div class="stat-card blue" style="${sc}" onclick="showPayrollStatDetail('_total','Total Geral do Mês','#1565C0')" ${sh}>
      <div class="stat-icon"><i class="fa-solid fa-calculator"></i></div>
      <div><div class="stat-value">${fmtMoney(tTotal)}</div><div class="stat-label">Total Geral do Mês</div></div></div>
  `;
}

function showPayrollStatDetail(fieldKey, label, color){
  const mes=currentMes(), ano=currentAno();
  const payThisMonth=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano);
  let items=[];
  if(fieldKey==='_all'){
    items=payThisMonth.map(p=>{
      const emp=State.employees.find(e=>e.id===p.employeeId); if(!emp) return null;
      return {empId:p.employeeId,nome:emp.nome,setor:emp.setor||'—',value:p.remuneracao||0,valueLabel:fmtMoney(p.remuneracao||0)};
    }).filter(Boolean);
  } else if(fieldKey==='_total'){
    items=payThisMonth.map(p=>{
      const emp=State.employees.find(e=>e.id===p.employeeId); if(!emp) return null;
      const t=(p.remuneracao||0)+(p.valeTransporte||0)+(p.valeRefeicao||0)+(p.valeAlimentacaoLiquido||0)+(p.horasExtrasValor||0)+(p.bonificacao||0)+(p.adNoturno||0);
      return {empId:p.employeeId,nome:emp.nome,setor:emp.setor||'—',value:t,valueLabel:fmtMoney(t)};
    }).filter(i=>i&&i.value>0);
  } else {
    items=payThisMonth.map(p=>{
      const emp=State.employees.find(e=>e.id===p.employeeId); if(!emp) return null;
      const v=p[fieldKey]||0; if(v<=0) return null;
      return {empId:p.employeeId,nome:emp.nome,setor:emp.setor||'—',value:v,valueLabel:fmtMoney(v)};
    }).filter(Boolean);
  }
  items.sort((a,b)=>b.value-a.value);
  const _closeStatDetail=()=>{ const m=document.getElementById('modal-stat-detail'); if(m) m.remove(); };
  _closeStatDetail();
  const modal=document.createElement('div');
  modal.id='modal-stat-detail';
  modal.style.cssText='position:fixed;inset:0;background:rgba(10,20,40,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;animation:fadeIn .15s ease';
  modal.addEventListener('click',e=>{ if(e.target===modal) _closeStatDetail(); });
  const bodyRows = items.length===0
    ? `<div style="text-align:center;padding:40px;color:#aaa"><i class="fa-solid fa-inbox" style="font-size:36px;margin-bottom:12px;display:block"></i><div style="font-size:14px">Nenhum registro neste mês</div></div>`
    : items.map(it=>`
      <div onclick="document.getElementById('modal-stat-detail').remove();openPayrollForEmployee('${it.empId}')"
           style="display:flex;align-items:center;gap:14px;padding:12px 20px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .12s"
           onmouseover="this.style.background='${color}10'" onmouseout="this.style.background=''">
        <div style="width:40px;height:40px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;letter-spacing:-.5px">${initials(it.nome)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:#1a1a2e;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.nome}</div>
          <div style="font-size:12px;color:#9e9e9e;margin-top:1px">${it.setor}</div>
        </div>
        <div style="font-weight:700;color:${color};font-size:15px;white-space:nowrap;margin-right:4px">${it.valueLabel}</div>
        <i class="fa-solid fa-arrow-right" style="color:#d0d0d0;font-size:12px"></i>
      </div>`).join('');
  modal.innerHTML=`
    <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.25);overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:2px solid ${color}30;background:${color}08">
        <div>
          <div style="font-size:17px;font-weight:700;color:#1a1a2e">${label}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${MESES[mes]}/${ano} · ${items.length} colaborador${items.length!==1?'es':''}</div>
        </div>
        <button onclick="document.getElementById('modal-stat-detail').remove()" style="border:none;background:${color}15;color:${color};width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1">${bodyRows}</div>
    </div>`;
  document.body.appendChild(modal);
}

// ============================================
// CONTABILIDADE
// ============================================
// ============================================================
// MÓDULO PAGAMENTOS
// ============================================================
function renderPagamentos(){
  const mes=parseInt(val('pag-mes')||currentMes());
  const ano=parseInt(val('pag-ano')||currentAno());
  const statusFilt=val('pag-status-filter')||'ativo';

  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));
  if(emps.length===0){ toast('Nenhum colaborador encontrado.','warning'); return; }

  const mesLabel=MESES[mes]||'';
  const folhasMes=State.payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  const folhaMap={};
  folhasMes.forEach(p=>{ folhaMap[p.employeeId]=p; });

  // Totais
  let tBruto=0,tINSS=0,tIRRF=0,tFGTS=0,tLiquido=0,comFolha=0,semFolhaCount=0;
  emps.forEach(e=>{
    const p=folhaMap[e.id];
    if(p){
      comFolha++;
      tBruto  +=(p.totalBruto||0);
      tINSS   +=(p.inss||0);
      tIRRF   +=(p.irrf||0);
      tFGTS   +=(p.fgts||0);
      tLiquido+=(p.totalLiquidoFinal||p.remuneracao||0);
    } else { semFolhaCount++; }
  });

  // Stats grid
  const statsEl=document.getElementById('pag-stats');
  if(statsEl){
    const scrollToTable=`document.getElementById('pag-table-card').scrollIntoView({behavior:'smooth',block:'start'})`;
    statsEl.innerHTML=`
      <div class="stat-card" style="cursor:pointer" onclick="${scrollToTable}">
        <div class="stat-icon" style="background:rgba(27,94,32,0.1)"><i class="fa-solid fa-sack-dollar" style="color:var(--success)"></i></div>
        <div class="stat-info"><div class="stat-label">Total da Folha</div><div class="stat-value" style="color:var(--success)">${fmtMoney(tLiquido)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(192,57,43,0.1)"><i class="fa-solid fa-building-columns" style="color:#c0392b"></i></div>
        <div class="stat-info"><div class="stat-label">Total INSS</div><div class="stat-value" style="color:#c0392b">${fmtMoney(tINSS)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(192,57,43,0.1)"><i class="fa-solid fa-file-invoice" style="color:#c0392b"></i></div>
        <div class="stat-info"><div class="stat-label">Total IRRF</div><div class="stat-value" style="color:#c0392b">${fmtMoney(tIRRF)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(21,101,192,0.1)"><i class="fa-solid fa-piggy-bank" style="color:#1565C0"></i></div>
        <div class="stat-info"><div class="stat-label">FGTS Empregador</div><div class="stat-value" style="color:#1565C0">${fmtMoney(tFGTS)}</div></div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="${scrollToTable}">
        <div class="stat-icon" style="background:rgba(27,94,32,0.1)"><i class="fa-solid fa-circle-check" style="color:var(--success)"></i></div>
        <div class="stat-info"><div class="stat-label">Com Holerite</div><div class="stat-value" style="color:var(--success)">${comFolha}</div></div>
      </div>
      <div class="stat-card" style="cursor:pointer" onclick="${scrollToTable}">
        <div class="stat-icon" style="background:rgba(239,83,80,0.1)"><i class="fa-solid fa-circle-xmark" style="color:var(--danger)"></i></div>
        <div class="stat-info"><div class="stat-label">Sem Holerite</div><div class="stat-value" style="color:${semFolhaCount>0?'var(--danger)':'#999'}">${semFolhaCount}</div></div>
      </div>
    `;
  }

  // Tabela
  const card=document.getElementById('pag-table-card');
  const tbody=document.getElementById('pag-tbody');
  const tfoot=document.getElementById('pag-tfoot');
  const title=document.getElementById('pag-table-title');
  if(!tbody) return;
  if(title) title.innerHTML=`<i class="fa-solid fa-money-check-dollar"></i> Holerites — ${mesLabel} / ${ano} <small style="font-size:12px;font-weight:400;color:#666">(${emps.length} colaborador(es))</small>`;

  const rows=emps.map((e,i)=>{
    const p=folhaMap[e.id];
    const bruto   =p?(p.totalBruto||0):0;
    const inss    =p?(p.inss||0):0;
    const irrf    =p?(p.irrf||0):0;
    const fgts    =p?(p.fgts||0):0;
    const liq     =p?(p.totalLiquidoFinal||p.remuneracao||0):0;
    const statusStr=p?p.status:'sem folha';
    const badge=statusStr==='fechada'
      ?`<span class="badge" style="background:#E8F5E9;color:#1B5E20;border:1px solid #A5D6A7;padding:2px 8px;border-radius:12px;font-size:11px">✓ Fechada</span>`
      :statusStr==='aberta'
        ?`<span class="badge" style="background:#FFF3E0;color:#E65100;border:1px solid #FFCC80;padding:2px 8px;border-radius:12px;font-size:11px">⏳ Aberta</span>`
        :`<span class="badge" style="background:#FFEBEE;color:#c0392b;border:1px solid #FFCDD2;padding:2px 8px;border-radius:12px;font-size:11px">— Sem folha</span>`;
    const rowBg=i%2===0?'#ffffff':'#EEF2FF';
    const border=!p?'border-left:3px solid #EF9A9A':'';
    return `<tr style="background:${rowBg};${border}">
      <td>${i+1}</td>
      <td style="font-size:11px">${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td style="font-size:11px">${e.cargo||'—'}</td>
      <td>${e.salarioBase?fmtMoney(e.salarioBase):'—'}</td>
      <td style="font-weight:600">${bruto?fmtMoney(bruto):'<span style="color:#ccc">—</span>'}</td>
      <td style="color:#c0392b">${inss?'('+fmtMoney(inss)+')':'—'}</td>
      <td style="color:#c0392b">${irrf?'('+fmtMoney(irrf)+')':'—'}</td>
      <td style="color:#1565C0">${fgts?fmtMoney(fgts):'—'}</td>
      <td style="font-weight:700;color:#1B5E20">${liq?fmtMoney(liq):'<span style="color:#ccc">—</span>'}</td>
      <td>${badge}</td>
      <td><button class="btn-icon" onclick="openPayrollForEmployee('${e.id}')" title="Abrir folha de ponto"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></td>
    </tr>`;
  }).join('');
  tbody.innerHTML=rows;

  // Rodapé com totais
  tfoot.innerHTML=`<tr style="background:#EEF4FF;font-weight:700;font-size:12px">
    <td colspan="5" style="padding:8px 10px">TOTAIS — ${comFolha} de ${emps.length} com holerite</td>
    <td>${fmtMoney(tBruto)}</td>
    <td style="color:#c0392b">(${fmtMoney(tINSS)})</td>
    <td style="color:#c0392b">(${fmtMoney(tIRRF)})</td>
    <td style="color:#1565C0">${fmtMoney(tFGTS)}</td>
    <td style="color:var(--success)">${fmtMoney(tLiquido)}</td>
    <td colspan="2"></td>
  </tr>`;

  if(card) card.style.display='';
}

function exportPagamentosCsv(){
  const mes=parseInt(val('pag-mes')||currentMes());
  const ano=parseInt(val('pag-ano')||currentAno());
  const statusFilt=val('pag-status-filter')||'ativo';
  const mesLabel=MESES[mes]||'';
  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));
  const folhaMap={};
  State.payrolls.filter(p=>p.mes===mes&&p.ano===ano).forEach(p=>{ folhaMap[p.employeeId]=p; });
  const header=['#','Registro','Nome','Cargo','Salario Base','Total Bruto','INSS','IRRF','FGTS','Liquido Final','Status'];
  const rows=emps.map((e,i)=>{
    const p=folhaMap[e.id];
    const fmt=v=>v?(v.toFixed(2).replace('.',',')):'-';
    return [i+1, e.registro||'', e.nome, e.cargo||'', fmt(e.salarioBase),
      fmt(p?.totalBruto), fmt(p?.inss), fmt(p?.irrf), fmt(p?.fgts),
      fmt(p?.totalLiquidoFinal||p?.remuneracao), p?p.status:'sem folha'].join(';');
  });
  const csv='﻿'+[header.join(';'),...rows].join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`pagamentos_${mes.toString().padStart(2,'0')}_${ano}.csv`;
  a.click();
}

function printPagamentos(){
  const mes=parseInt(val('pag-mes')||currentMes());
  const ano=parseInt(val('pag-ano')||currentAno());
  const mesLabel=MESES[mes]||'';
  const table=document.getElementById('pag-table');
  if(!table){ toast('Carregue os dados primeiro.','warning'); return; }
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Pagamentos ${mesLabel}/${ano}</title>
    <style>body{font-family:Arial,sans-serif;font-size:10px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px}
    th{background:#1a3a6b;color:#fff}tr:nth-child(even){background:#f5f5f5}
    h2{color:#1a3a6b}</style></head><body>
    <h2>${_e('nomeEmpresa')} — Pagamentos ${mesLabel} / ${ano}</h2>
    ${table.outerHTML}</body></html>`);
  w.document.close();
  w.print();
}

// ============================================
// MÓDULO 13º SALÁRIO
// ============================================
function renderDecimoTerceiro(){
  const ano=parseInt(val('dec-ano')||currentAno());
  const statusFilt=val('dec-status-filter')||'ativo';
  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));

  const recMap={};
  (State.decimoTerceiro||[]).filter(r=>r.ano===ano).forEach(r=>{ recMap[r.employeeId]=r; });

  const tbody=document.getElementById('dec-tbody');
  if(!tbody) return;
  if(emps.length===0){ tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:20px">Nenhum colaborador.</td></tr>'; return; }

  let totalBruto=0,totalINSS=0,totalIRRF=0,totalFGTS=0,totalLiq=0;
  const rows=emps.map((emp,i)=>{
    const admissao=emp.admissao||'';
    let mesesDir=0;
    if(admissao){
      const adm=new Date(admissao.split('/').reverse().join('-'));
      const anoAdm=adm.getFullYear(), mesAdm=adm.getMonth()+1, diaAdm=adm.getDate();
      if(anoAdm<ano) mesesDir=12;
      else if(anoAdm===ano) mesesDir=12-mesAdm+(diaAdm<=15?1:0);
    }
    const salBase=parseFloat(emp.salario||0);
    const bruto=Math.round(salBase*mesesDir/12*100)/100;
    const parc1=Math.round(bruto/2*100)/100;
    const inss=calcINSS(bruto);
    const irrf=calcIRRF(bruto/2,emp.dependentesIRRF||0,emp.pensaoAlimenticia||0,0,inss);
    const fgts=calcFGTS(bruto);
    const parc2=Math.round((bruto/2-inss-irrf)*100)/100;
    const liq=Math.round((bruto-inss-irrf)*100)/100;
    totalBruto+=bruto; totalINSS+=inss; totalIRRF+=irrf; totalFGTS+=fgts; totalLiq+=liq;
    const rec=recMap[emp.id]||{};
    const status=rec.status||'pendente';
    const badge=status==='pago'?'<span class="badge badge-success">Pago</span>':status==='parcial'?'<span class="badge badge-warning">Parcial</span>':'<span class="badge badge-muted">Pendente</span>';
    return `<tr>
      <td>${i+1}</td><td>${emp.registro||'—'}</td><td>${emp.nome}</td>
      <td style="text-align:center">${mesesDir}/12</td>
      <td>${fmtMoney(bruto)}</td><td>${fmtMoney(parc1)}</td>
      <td style="color:#c0392b">(${fmtMoney(inss)})</td>
      <td style="color:#c0392b">(${fmtMoney(irrf)})</td>
      <td style="color:#1a3a6b">${fmtMoney(fgts)}</td>
      <td>${fmtMoney(parc2)}</td><td>${badge}</td>
      <td><button class="btn btn-sm btn-outline-primary" onclick="openDecimoTerceiro('${emp.id}')"><i class="fa-solid fa-pen-to-square"></i></button></td>
    </tr>`;
  });
  tbody.innerHTML=rows.join('');
  const tfoot=document.getElementById('dec-tfoot');
  if(tfoot) tfoot.innerHTML=`<tr style="font-weight:600;background:#f0f4ff">
    <td colspan="4" style="text-align:right">TOTAIS</td>
    <td>${fmtMoney(totalBruto)}</td><td>—</td>
    <td style="color:#c0392b">(${fmtMoney(totalINSS)})</td>
    <td style="color:#c0392b">(${fmtMoney(totalIRRF)})</td>
    <td style="color:#1a3a6b">${fmtMoney(totalFGTS)}</td>
    <td>${fmtMoney(totalLiq)}</td><td colspan="2"></td>
  </tr>`;
}

function openDecimoTerceiro(empId){
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=parseInt(val('dec-ano')||currentAno());
  const rec=(State.decimoTerceiro||[]).find(r=>r.employeeId===empId&&r.ano===ano)||{};
  const admissao=emp.admissao||'';
  let mesesDir=0;
  if(admissao){
    const adm=new Date(admissao.split('/').reverse().join('-'));
    const anoAdm=adm.getFullYear(), mesAdm=adm.getMonth()+1, diaAdm=adm.getDate();
    if(anoAdm<ano) mesesDir=12;
    else if(anoAdm===ano) mesesDir=12-mesAdm+(diaAdm<=15?1:0);
  }
  setVal('dec-modal-emp-id',empId);
  setVal('dec-modal-ano',ano);
  setVal('dec-modal-nome',emp.nome);
  setVal('dec-modal-cargo',emp.cargo||'—');
  setVal('dec-modal-admissao',emp.admissao||'—');
  setVal('dec-modal-meses-dir',mesesDir);
  setVal('dec-modal-sal-base',(parseFloat(emp.salario||0)).toFixed(2));
  setVal('dec-modal-status',rec.status||'pendente');
  setVal('dec-modal-obs',rec.obs||'');
  setVal('dec-modal-parc1-data',rec.parc1Data||'');
  setVal('dec-modal-parc2-data',rec.parc2Data||'');
  _calcDecTercPreview(emp,mesesDir);
  document.getElementById('modal-decimo-terceiro').classList.remove('hidden');
}

function _calcDecTercPreview(emp,mesesDir){
  if(!emp){ const id=val('dec-modal-emp-id'); emp=State.employees.find(e=>e.id===id); if(!emp) return; }
  if(mesesDir===undefined) mesesDir=parseInt(val('dec-modal-meses-dir')||12);
  const salBase=parseFloat(emp.salario||0);
  const bruto=Math.round(salBase*mesesDir/12*100)/100;
  const parc1=Math.round(bruto/2*100)/100;
  const inss=calcINSS(bruto);
  const irrf=calcIRRF(bruto/2,emp.dependentesIRRF||0,emp.pensaoAlimenticia||0,0,inss);
  const fgts=calcFGTS(bruto);
  const parc2=Math.round((bruto/2-inss-irrf)*100)/100;
  const liq=Math.round((bruto-inss-irrf)*100)/100;
  setVal('dec-modal-bruto',bruto.toFixed(2));
  setVal('dec-modal-parc1',parc1.toFixed(2));
  setVal('dec-modal-inss',inss.toFixed(2));
  setVal('dec-modal-irrf',irrf.toFixed(2));
  setVal('dec-modal-fgts',fgts.toFixed(2));
  setVal('dec-modal-parc2',parc2.toFixed(2));
  setVal('dec-modal-liquido',liq.toFixed(2));
}

async function saveDecimoTerceiro(){
  const empId=val('dec-modal-emp-id'); if(!empId) return;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=parseInt(val('dec-modal-ano')||currentAno());
  const rec={
    id:`${empId}_${ano}`,
    employeeId:empId, nomeEmp:emp.nome, ano,
    status:val('dec-modal-status')||'pendente',
    obs:val('dec-modal-obs')||'',
    parc1Data:val('dec-modal-parc1-data')||'',
    parc2Data:val('dec-modal-parc2-data')||'',
    bruto:parseFloat(val('dec-modal-bruto')||0),
    parc1:parseFloat(val('dec-modal-parc1')||0),
    parc2:parseFloat(val('dec-modal-parc2')||0),
    inss:parseFloat(val('dec-modal-inss')||0),
    irrf:parseFloat(val('dec-modal-irrf')||0),
    fgts:parseFloat(val('dec-modal-fgts')||0),
    liquido:parseFloat(val('dec-modal-liquido')||0),
    updatedAt:new Date().toISOString()
  };
  const btn=document.querySelector('#modal-decimo-terceiro .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    await DB.save('decimoTerceiro',rec);
    closeModal('modal-decimo-terceiro');
    toast('13º Salário salvo!');
    Auth.log('DEC_TERCEIRO_SAVED',Auth.currentUser.username,`${emp.nome} / ${ano}`);
  } catch(e){ toast('Erro ao salvar.','error'); }
  finally{ setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar'); }
}

function printDecimoTerceiro(){
  const empId=val('dec-modal-emp-id'); if(!empId) return;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=val('dec-modal-ano')||currentAno();
  const mesesDir=val('dec-modal-meses-dir')||12;
  const bruto=parseFloat(val('dec-modal-bruto')||0);
  const parc1=parseFloat(val('dec-modal-parc1')||0);
  const parc2=parseFloat(val('dec-modal-parc2')||0);
  const inss=parseFloat(val('dec-modal-inss')||0);
  const irrf=parseFloat(val('dec-modal-irrf')||0);
  const fgts=parseFloat(val('dec-modal-fgts')||0);
  const liq=parseFloat(val('dec-modal-liquido')||0);
  const p1data=val('dec-modal-parc1-data')||'—';
  const p2data=val('dec-modal-parc2-data')||'—';
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Recibo 13º Salário — ${emp.nome}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px}
  h2{color:#1a3a6b;margin-bottom:4px}.empresa{color:#555;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #ccc;padding:5px 8px}
  th{background:#1a3a6b;color:#fff;text-align:left}.prov{color:#1a7a1a}.desc{color:#c0392b}
  .total-row{font-weight:700;background:#f0f4ff}
  .assinatura{margin-top:40px;display:flex;justify-content:space-between}
  .assinatura div{text-align:center;width:45%}.assinatura hr{margin-bottom:4px}
  @media print{body{padding:10px}}</style></head><body>
  <h2>RECIBO DE 13º SALÁRIO — ${ano}</h2>
  <div class="empresa">${_e('nomeEmpresa')} — CNPJ: ${_e('cnpj')||'—'}</div>
  <table>
    <tr><th colspan="2">Dados do Colaborador</th></tr>
    <tr><td><strong>Nome:</strong> ${emp.nome}</td><td><strong>Registro:</strong> ${emp.registro||'—'}</td></tr>
    <tr><td><strong>Cargo:</strong> ${emp.cargo||'—'}</td><td><strong>Admissão:</strong> ${emp.admissao||'—'}</td></tr>
    <tr><td><strong>Meses Trabalhados:</strong> ${mesesDir}/12</td><td><strong>Sal. Base:</strong> ${fmtMoney(parseFloat(emp.salario||0))}</td></tr>
  </table>
  <table>
    <tr><th>PARCELA</th><th>VALOR</th><th>DATA PGTO</th></tr>
    <tr><td>1ª Parcela (50% s/ descontos)</td><td class="prov">${fmtMoney(parc1)}</td><td>${p1data}</td></tr>
    <tr><td>2ª Parcela (líquido)</td><td class="prov">${fmtMoney(parc2)}</td><td>${p2data}</td></tr>
    <tr class="total-row"><td>Total Bruto (referência)</td><td>${fmtMoney(bruto)}</td><td>—</td></tr>
  </table>
  <table>
    <tr><th>ENCARGOS</th><th>VALOR</th></tr>
    <tr><td class="desc">(-) INSS (sobre total bruto)</td><td class="desc">(${fmtMoney(inss)})</td></tr>
    <tr><td class="desc">(-) IRRF (sobre 2ª parcela)</td><td class="desc">(${fmtMoney(irrf)})</td></tr>
    <tr><td style="font-size:11px;color:#1a3a6b">(*) FGTS — Encargo Patronal (8%)</td><td style="color:#1a3a6b">${fmtMoney(fgts)}</td></tr>
    <tr class="total-row"><td>TOTAL LÍQUIDO A RECEBER</td><td>${fmtMoney(liq)}</td></tr>
  </table>
  <div class="assinatura">
    <div><hr>Assinatura do Colaborador<br><small>${emp.nome}</small></div>
    <div><hr>Responsável / Empresa<br><small>${_e('nomeEmpresa')}</small></div>
  </div>
  <p style="text-align:center;font-size:10px;color:#999;margin-top:30px">Gerado por ${APP_VERSION} em ${new Date().toLocaleDateString('pt-BR')}</p>
  </body></html>`);
  w.document.close(); w.print();
}

function printDecimoTerceiroLista(){
  const ano=val('dec-ano')||currentAno();
  const table=document.querySelector('#section-decimoterceiro table');
  if(!table){ toast('Nenhuma tabela para imprimir.','warning'); return; }
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>13º Salário ${ano}</title>
  <style>body{font-family:Arial,sans-serif;font-size:10px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px}
  th{background:#1a3a6b;color:#fff}tr:nth-child(even){background:#f5f5f5}
  h2{color:#1a3a6b}</style></head><body>
  <h2>${_e('nomeEmpresa')} — 13º Salário ${ano}</h2>
  ${table.outerHTML}</body></html>`);
  w.document.close(); w.print();
}

// ============================================
// MÓDULO FÉRIAS
// ============================================
function renderFeriasModulo(){
  const ano=parseInt(val('fer-mod-ano')||currentAno());
  const statusFilt=val('fer-mod-status-filter')||'ativo';
  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));

  const recMap={};
  (State.ferias||[]).filter(r=>r.ano===ano).forEach(r=>{
    if(!recMap[r.employeeId]) recMap[r.employeeId]=[];
    recMap[r.employeeId].push(r);
  });

  const tbody=document.getElementById('fer-mod-tbody');
  if(!tbody) return;
  if(emps.length===0){ tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px">Nenhum colaborador.</td></tr>'; return; }

  const rows=emps.map((emp,i)=>{
    const recs=recMap[emp.id]||[];
    const admissao=emp.admissao||'';
    let periodoAquis='—', direitoAno='—';
    if(admissao){
      const adm=new Date(admissao.split('/').reverse().join('-'));
      const anoAdm=adm.getFullYear(), mesAdm=adm.getMonth(), diaAdm=adm.getDate();
      const periodos=ano-anoAdm;
      if(periodos>=1){
        const ini=new Date(anoAdm+periodos-1,mesAdm,diaAdm);
        const fim=new Date(anoAdm+periodos,mesAdm,diaAdm-1);
        periodoAquis=`${ini.toLocaleDateString('pt-BR')} – ${fim.toLocaleDateString('pt-BR')}`;
        direitoAno=`${anoAdm+periodos}`;
      }
    }
    const rec=recs.length>0?recs[recs.length-1]:{};
    const status=rec.status||'pendente';
    const badge=status==='gozadas'?'<span class="badge badge-success">Gozadas</span>':status==='agendadas'?'<span class="badge badge-warning">Agendadas</span>':'<span class="badge badge-muted">Pendente</span>';
    return `<tr>
      <td>${i+1}</td><td>${emp.registro||'—'}</td><td>${emp.nome}</td><td>${emp.cargo||'—'}</td>
      <td style="font-size:11px">${periodoAquis}</td><td style="text-align:center">${direitoAno}</td>
      <td>${badge}</td>
      <td><button class="btn btn-sm btn-outline-primary" onclick="openFeriasModulo('${emp.id}')"><i class="fa-solid fa-pen-to-square"></i></button></td>
    </tr>`;
  });
  tbody.innerHTML=rows.join('');
}

function openFeriasModulo(empId){
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=parseInt(val('fer-mod-ano')||currentAno());
  const recs=(State.ferias||[]).filter(r=>r.employeeId===empId&&r.ano===ano);
  const rec=recs.length>0?recs[recs.length-1]:{};
  setVal('fer-modal-emp-id',empId);
  setVal('fer-modal-ano',ano);
  setVal('fer-modal-nome',emp.nome);
  setVal('fer-modal-cargo',emp.cargo||'—');
  setVal('fer-modal-admissao',emp.admissao||'—');
  setVal('fer-modal-sal-base',(parseFloat(emp.salario||0)).toFixed(2));
  setVal('fer-modal-inicio',rec.inicio||'');
  setVal('fer-modal-fim',rec.fim||'');
  setVal('fer-modal-abono-dias',rec.abonoDias||0);
  setVal('fer-modal-status',rec.status||'pendente');
  setVal('fer-modal-obs',rec.obs||'');
  calcFeriasModuloPreview();
  document.getElementById('modal-ferias-modulo').classList.remove('hidden');
}

function calcFeriasModuloPreview(){
  const empId=val('fer-modal-emp-id');
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const salBase=parseFloat(emp.salario||0);
  const abonoDias=Math.min(10,Math.max(0,parseInt(val('fer-modal-abono-dias')||0)));
  const diasGozo=30-abonoDias;
  const abono=Math.round(salBase/30*abonoDias*100)/100;
  const salFruicao=Math.round(salBase*diasGozo/30*100)/100;
  const terco=Math.round(salFruicao/3*100)/100;
  const totalBruto=Math.round((salFruicao+terco+abono)*100)/100;
  const inss=calcINSS(salFruicao+terco);
  const irrf=calcIRRF(salFruicao+terco,emp.dependentesIRRF||0,emp.pensaoAlimenticia||0,0,inss);
  const totalLiq=Math.round((totalBruto-inss-irrf)*100)/100;
  const abonoBox=document.getElementById('fer-abono-box');
  if(abonoBox) abonoBox.classList.toggle('hidden',abonoDias===0);
  setVal('fer-modal-dias-gozo',diasGozo);
  setVal('fer-modal-sal-fruicao',salFruicao.toFixed(2));
  setVal('fer-modal-terco',terco.toFixed(2));
  setVal('fer-modal-abono-val',abono.toFixed(2));
  setVal('fer-modal-total-bruto',totalBruto.toFixed(2));
  setVal('fer-modal-inss',inss.toFixed(2));
  setVal('fer-modal-irrf',irrf.toFixed(2));
  setVal('fer-modal-total-liquido',totalLiq.toFixed(2));
}

async function saveFeriasModulo(){
  const empId=val('fer-modal-emp-id'); if(!empId) return;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=parseInt(val('fer-modal-ano')||currentAno());
  const inicio=val('fer-modal-inicio'), fim=val('fer-modal-fim');
  if(!inicio||!fim){ toast('Informe as datas de início e fim.','error'); return; }
  const abonoDias=parseInt(val('fer-modal-abono-dias')||0);
  const rec={
    id:`${empId}_${ano}_${inicio.replace(/[\/\-]/g,'')}`,
    employeeId:empId, nomeEmp:emp.nome, ano, inicio, fim, abonoDias,
    status:val('fer-modal-status')||'pendente',
    obs:val('fer-modal-obs')||'',
    salFruicao:parseFloat(val('fer-modal-sal-fruicao')||0),
    terco:parseFloat(val('fer-modal-terco')||0),
    abono:parseFloat(val('fer-modal-abono-val')||0),
    totalBruto:parseFloat(val('fer-modal-total-bruto')||0),
    inss:parseFloat(val('fer-modal-inss')||0),
    irrf:parseFloat(val('fer-modal-irrf')||0),
    totalLiquido:parseFloat(val('fer-modal-total-liquido')||0),
    updatedAt:new Date().toISOString()
  };
  const btn=document.querySelector('#modal-ferias-modulo .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    await DB.save('ferias',rec);
    closeModal('modal-ferias-modulo');
    toast('Férias salvas!');
    Auth.log('FERIAS_SAVED',Auth.currentUser.username,`${emp.nome} / ${inicio}–${fim}`);
  } catch(e){ toast('Erro ao salvar.','error'); }
  finally{ setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar'); }
}

function printFeriasModulo(){
  const empId=val('fer-modal-emp-id'); if(!empId) return;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ano=val('fer-modal-ano')||currentAno();
  const inicio=val('fer-modal-inicio')||'—', fim=val('fer-modal-fim')||'—';
  const abonoDias=val('fer-modal-abono-dias')||0;
  const diasGozo=val('fer-modal-dias-gozo')||30;
  const salFruicao=parseFloat(val('fer-modal-sal-fruicao')||0);
  const terco=parseFloat(val('fer-modal-terco')||0);
  const abono=parseFloat(val('fer-modal-abono-val')||0);
  const totalBruto=parseFloat(val('fer-modal-total-bruto')||0);
  const inss=parseFloat(val('fer-modal-inss')||0);
  const irrf=parseFloat(val('fer-modal-irrf')||0);
  const totalLiq=parseFloat(val('fer-modal-total-liquido')||0);
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Recibo de Férias — ${emp.nome}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:20px}
  h2{color:#1a3a6b;margin-bottom:4px}.empresa{color:#555;font-size:11px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #ccc;padding:5px 8px}
  th{background:#1a3a6b;color:#fff;text-align:left}.prov{color:#1a7a1a}.desc{color:#c0392b}
  .total-row{font-weight:700;background:#f0f4ff}.nota{font-size:10px;color:#555;margin-top:4px}
  .assinatura{margin-top:40px;display:flex;justify-content:space-between}
  .assinatura div{text-align:center;width:45%}.assinatura hr{margin-bottom:4px}
  @media print{body{padding:10px}}</style></head><body>
  <h2>RECIBO DE FÉRIAS — ${ano}</h2>
  <div class="empresa">${_e('nomeEmpresa')} — CNPJ: ${_e('cnpj')||'—'}</div>
  <table>
    <tr><th colspan="2">Dados do Colaborador</th></tr>
    <tr><td><strong>Nome:</strong> ${emp.nome}</td><td><strong>Registro:</strong> ${emp.registro||'—'}</td></tr>
    <tr><td><strong>Cargo:</strong> ${emp.cargo||'—'}</td><td><strong>Admissão:</strong> ${emp.admissao||'—'}</td></tr>
    <tr><td><strong>Período de Gozo:</strong> ${inicio} a ${fim}</td><td><strong>Dias de Gozo:</strong> ${diasGozo} dias</td></tr>
    ${parseInt(abonoDias)>0?`<tr><td><strong>Abono Pecuniário:</strong> ${abonoDias} dias</td><td><strong>Sal. Base:</strong> ${fmtMoney(parseFloat(emp.salario||0))}</td></tr>`:`<tr><td colspan="2"><strong>Sal. Base:</strong> ${fmtMoney(parseFloat(emp.salario||0))}</td></tr>`}
  </table>
  <table>
    <tr><th>DEMONSTRATIVO FINANCEIRO</th><th>VALOR</th></tr>
    <tr><td class="prov">(+) Salário de Fruição (${diasGozo} dias)</td><td class="prov">${fmtMoney(salFruicao)}</td></tr>
    <tr><td class="prov">(+) 1/3 Constitucional</td><td class="prov">${fmtMoney(terco)}</td></tr>
    ${parseInt(abonoDias)>0?`<tr><td class="prov">(+) Abono Pecuniário (${abonoDias} dias — isento INSS)</td><td class="prov">${fmtMoney(abono)}</td></tr>`:''}
    <tr class="total-row"><td>Total Bruto</td><td>${fmtMoney(totalBruto)}</td></tr>
    <tr><td class="desc">(-) INSS</td><td class="desc">(${fmtMoney(inss)})</td></tr>
    <tr><td class="desc">(-) IRRF</td><td class="desc">(${fmtMoney(irrf)})</td></tr>
    <tr class="total-row"><td>TOTAL LÍQUIDO A RECEBER</td><td>${fmtMoney(totalLiq)}</td></tr>
  </table>
  <p class="nota">* Abono pecuniário não integra base de INSS (art. 144 da CLT). IRRF calculado sobre fruição + 1/3.</p>
  <div class="assinatura">
    <div><hr>Assinatura do Colaborador<br><small>${emp.nome}</small></div>
    <div><hr>Responsável / Empresa<br><small>${_e('nomeEmpresa')}</small></div>
  </div>
  <p style="text-align:center;font-size:10px;color:#999;margin-top:30px">Gerado por ${APP_VERSION} em ${new Date().toLocaleDateString('pt-BR')}</p>
  </body></html>`);
  w.document.close(); w.print();
}

function renderContabilidade(){
  const mes=parseInt(val('cont-mes')||currentMes());
  const ano=parseInt(val('cont-ano')||currentAno());
  const statusFilt=val('cont-status-filter')||'ativo';

  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));

  const card=document.getElementById('cont-table-card');
  const semFolhaCard=document.getElementById('cont-sem-folha-card');
  const tbody=document.getElementById('cont-tbody');
  const tfoot=document.getElementById('cont-tfoot');
  const stats=document.getElementById('cont-stats');
  const title=document.getElementById('cont-table-title');
  if(!tbody) return;

  if(emps.length===0){
    toast('Nenhum colaborador encontrado.','warning'); return;
  }

  // Mapear folhas do mês
  const folhasMes=State.payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  const folhaMap={};
  folhasMes.forEach(p=>{ folhaMap[p.employeeId]=p; });

  // Totais
  let tR=0,tVT=0,tVR=0,tVA=0,tHE=0,tB=0,tAN=0,tIns=0,tAcu=0,tAdiant=0,tTotal=0;
  let semFolha=[];

  const rows=emps.map((e,i)=>{
    const p=folhaMap[e.id];
    if(!p){ semFolha.push(e); }
    const rem=p?p.remuneracao||0:0;
    const vt=p?p.valeTransporte||0:0;
    const vr=p?p.valeRefeicao||0:0;
    const va=p?p.valeAlimentacaoLiquido||0:0;
    const he=p?p.horasExtrasValor||0:0;
    const bon=p?p.bonificacao||0:0;
    const an=p?p.adNoturno||0:0;
    const ins=p?p.insalubridade||0:0;
    const acu=p?p.acumulo||0:0;
    const adiant=p?p.adiantamento||0:0;
    const totalFaltas=p?('faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0)):0;
    const especie=rem+an+ins+acu+he+bon;
    tR+=rem; tVT+=vt; tVR+=vr; tVA+=va; tHE+=he; tB+=bon; tAN+=an; tIns+=ins; tAcu+=acu; tAdiant+=adiant;
    tTotal+=especie+vt+vr+va;
    const rowBg=i%2===0?'#ffffff':'#EEF2FF';
    const semFolhaBorder=!p?'border-left:3px solid #EF9A9A':'';
    return `<tr style="background:${rowBg};${semFolhaBorder}">
      <td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td style="font-size:11px">${e.cpf||'—'}</td>
      <td style="font-size:11px">${e.setor||'—'}</td>
      <td style="font-size:10px;max-width:120px;white-space:normal">${e.posto||'—'}</td>
      <td style="font-size:11px">${escalaLabel(e.escala||'5x2A')}</td>
      <td style="font-size:11px">${formatDateBr(e.dataAdmissao)}</td>
      <td>${e.salarioBase?fmtMoney(e.salarioBase):'—'}</td>
      <td style="text-align:center">${p?p.diasTrabalhados||0:'—'}</td>
      <td style="text-align:center;color:${totalFaltas>0?'var(--danger)':'inherit'}">${p?totalFaltas:'—'}</td>
      <td style="font-weight:700">${p?fmtMoney(rem):'<span style="color:#ccc">S/ folha</span>'}</td>
      <td>${vt?fmtMoney(vt):'—'}</td>
      <td>${vr?fmtMoney(vr):'—'}</td>
      <td>${va?fmtMoney(va):'—'}</td>
      <td>${he?fmtMoney(he):'—'}</td>
      <td>${bon?fmtMoney(bon):'—'}</td>
      <td>${an?fmtMoney(an):'—'}</td>
      <td>${ins?fmtMoney(ins):'—'}</td>
      <td>${acu?fmtMoney(acu):'—'}</td>
      <td>${adiant?fmtMoney(adiant):'—'}</td>
      <td style="font-weight:700;color:#1B5E20">${p?fmtMoney(especie):'—'}</td>
      <td style="font-size:11px">${e.chavePix||'—'}</td>
      <td style="font-size:11px">${p&&p.observacoes?p.observacoes:''}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML=rows;
  tfoot.innerHTML=`<tr style="background:#EEF4FF;font-weight:700">
    <td colspan="11" style="padding:8px 10px">TOTAIS — ${emps.length} colaborador(es)</td>
    <td>${fmtMoney(tR)}</td>
    <td>${fmtMoney(tVT)}</td>
    <td>${fmtMoney(tVR)}</td>
    <td>${fmtMoney(tVA)}</td>
    <td>${fmtMoney(tHE)}</td>
    <td>${fmtMoney(tB)}</td>
    <td>${fmtMoney(tAN)}</td>
    <td>${fmtMoney(tIns)}</td>
    <td>${fmtMoney(tAcu)}</td>
    <td>${fmtMoney(tAdiant)}</td>
    <td style="color:#1B5E20">${fmtMoney(tTotal)}</td>
    <td colspan="2"></td>
  </tr>`;

  // Título
  if(title) title.innerHTML=`<i class="fa-solid fa-table"></i> Planilha de Contabilidade — ${MESES[mes]}/${ano}`;
  const subEl=document.getElementById('cont-report-subtitle');
  const dateEl=document.getElementById('cont-report-date');
  if(subEl) subEl.textContent=`Competência: ${MESES[mes]}/${ano} · ${emps.length} colaborador(es)`;
  if(dateEl) dateEl.textContent=`Gerado em ${new Date().toLocaleString('pt-BR')}`;

  // Stats
  if(stats) stats.innerHTML=`
    <div class="stat-card blue"><div class="stat-icon"><i class="fa-solid fa-users"></i></div>
      <div><div class="stat-value">${emps.length}</div><div class="stat-label">Colaboradores</div></div></div>
    <div class="stat-card green"><div class="stat-icon"><i class="fa-solid fa-file-circle-check"></i></div>
      <div><div class="stat-value">${folhasMes.filter(f=>emps.find(e=>e.id===f.employeeId)).length}</div><div class="stat-label">Com folha lançada</div></div></div>
    <div class="stat-card amber"><div class="stat-icon"><i class="fa-solid fa-money-bill-wave"></i></div>
      <div><div class="stat-value">${fmtMoney(tR)}</div><div class="stat-label">Total Remunerações</div></div></div>
    <div class="stat-card" style="border-color:#1565C0;border-left-width:4px"><div class="stat-icon" style="background:#E3F2FD;color:#1565C0"><i class="fa-solid fa-wallet"></i></div>
      <div><div class="stat-value" style="font-size:14px">${fmtMoney(tTotal)}</div><div class="stat-label">Total Geral</div></div></div>
  `;

  if(card) card.style.display='';

  // Colaboradores sem folha
  if(semFolha.length>0){
    if(semFolhaCard) semFolhaCard.style.display='';
    const semFolhaList=document.getElementById('cont-sem-folha-list');
    if(semFolhaList) semFolhaList.innerHTML=semFolha.map(e=>`
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f5f5f5">
        <div style="width:36px;height:36px;border-radius:50%;background:#EEF4FF;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary)">${initials(e.nome)}</div>
        <div>
          <div style="font-weight:600">${e.nome}</div>
          <div style="font-size:12px;color:var(--text-muted)">${e.posto||'—'} · Reg. ${e.registro?String(e.registro).padStart(4,'0'):'—'}</div>
        </div>
        <button class="btn btn-outline" style="margin-left:auto;font-size:12px" onclick="showSection('payroll')">
          <i class="fa-solid fa-file-invoice-dollar"></i> Lançar Folha
        </button>
      </div>`).join('');
  } else {
    if(semFolhaCard) semFolhaCard.style.display='none';
  }

  toast(`Planilha de ${MESES[mes]}/${ano} carregada — ${emps.length} colaborador(es).`);
}

function exportContabilidadeCsv(){
  const mes=parseInt(val('cont-mes')||currentMes());
  const ano=parseInt(val('cont-ano')||currentAno());
  const statusFilt=val('cont-status-filter')||'ativo';
  let emps=[...State.employees];
  if(statusFilt!=='all') emps=emps.filter(e=>(e.status||'ativo')===statusFilt);
  emps.sort((a,b)=>a.nome.localeCompare(b.nome));
  const folhasMes=State.payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  const folhaMap={};
  folhasMes.forEach(p=>{ folhaMap[p.employeeId]=p; });

  const headers=['Nº','Matrícula','Nome','CPF','Setor','Posto','Escala','Admissão','Sal.Base','Dias','Faltas','Remuneração','VT/AM','VR','VA','HE','Bonificação','Ad.Noturno','Insalub.','Acúmulo','Adiantamento','Total Espécie','Chave PIX'];
  const rows=emps.map((e,i)=>{
    const p=folhaMap[e.id];
    const rem=p?p.remuneracao||0:0;
    const totalFaltas=p?('faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0)):0;
    const especie=rem+(p?p.adNoturno||0:0)+(p?p.insalubridade||0:0)+(p?p.acumulo||0:0)+(p?p.horasExtrasValor||0:0)+(p?p.bonificacao||0:0);
    return [
      i+1,
      e.registro?String(e.registro).padStart(4,'0'):'',
      e.nome, e.cpf||'', e.setor||'', e.posto||'',
      escalaLabel(e.escala||'5x2A'), e.dataAdmissao||'',
      e.salarioBase||0,
      p?p.diasTrabalhados||0:'', p?totalFaltas:'',
      rem, p?p.valeTransporte||0:0, p?p.valeRefeicao||0:0, p?p.valeAlimentacaoLiquido||0:0,
      p?p.horasExtrasValor||0:0, p?p.bonificacao||0:0, p?p.adNoturno||0:0, p?p.insalubridade||0:0, p?p.acumulo||0:0, p?p.adiantamento||0:0,
      especie, e.chavePix||''
    ].map(v=>typeof v==='string'&&v.includes(',')? `"${v}"`:v);
  });

  const csv=[headers,...rows].map(r=>r.join(';')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`Contabilidade_${MESES[mes]}_${ano}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado com sucesso!');
}

function printContabilidade(){
  const printArea=document.getElementById('cont-printable');
  const header=printArea?.querySelector('.cont-report-header');
  if(header) header.style.display='flex';
  window.print();
  if(header) header.style.display='none';
}

// ============================================
// ANIVERSARIANTES & ALERTAS — DASHBOARD
// ============================================
function renderBirthdays(){
  const el=document.getElementById('dashboard-birthdays'); if(!el) return;
  const hoje=new Date();
  const mesAtual=hoje.getMonth()+1;
  const diaAtual=hoje.getDate();
  const ativos=State.employees.filter(e=>(e.status||'ativo')==='ativo'&&e.dataNascimento);
  const aniversariantes=ativos.filter(e=>{
    const [,m,d]=(e.dataNascimento||'').split('-');
    return parseInt(m)===mesAtual;
  }).sort((a,b)=>{
    const da=parseInt((a.dataNascimento||'').split('-')[2]);
    const db=parseInt((b.dataNascimento||'').split('-')[2]);
    return da-db;
  });
  if(aniversariantes.length===0){
    el.innerHTML=`<div class="empty-state small"><i class="fa-solid fa-cake-candles"></i><p>Nenhum aniversariante em ${MESES[mesAtual]}</p></div>`;
    return;
  }
  el.innerHTML=aniversariantes.map(e=>{
    const dia=parseInt((e.dataNascimento||'').split('-')[2]);
    const isHoje=dia===diaAtual;
    const idade=mesAtual>parseInt((e.dataNascimento||'').split('-')[1])
      ?hoje.getFullYear()-parseInt((e.dataNascimento||'').split('-')[0])
      :hoje.getFullYear()-parseInt((e.dataNascimento||'').split('-')[0]);
    return `<div class="birthday-item${isHoje?' birthday-hoje':''}">
      <div class="birthday-dia">${String(dia).padStart(2,'0')}</div>
      <div class="birthday-info">
        <div class="birthday-nome">${e.nome}${isHoje?' 🎂':''}</div>
        <div class="birthday-sub">${idade} anos${e.posto?' · '+e.posto:''}</div>
      </div>
      ${e.celular?`<a href="https://wa.me/55${(e.celular||'').replace(/\D/g,'')}" target="_blank" class="btn-icon btn-whatsapp-icon" title="Parabéns pelo WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>`:''}
    </div>`;
  }).join('');
}

function renderAlerts(){
  const el=document.getElementById('dashboard-alerts'); if(!el) return;
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const alerts=[];
  State.employees.filter(e=>(e.status||'ativo')==='ativo').forEach(e=>{
    // Exame médico vencendo em até 30 dias
    if(e.exameVencimento){
      const venc=new Date(e.exameVencimento+'T00:00:00');
      const diff=Math.round((venc-hoje)/(1000*60*60*24));
      if(diff<=30){
        const cor=diff<0?'var(--danger)':diff<=7?'#E65100':'#F57F17';
        const txt=diff<0?`Vencido há ${Math.abs(diff)} dias`:diff===0?'Vence hoje':`Vence em ${diff} dias`;
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:${cor}"><i class="fa-solid fa-stethoscope"></i></div><div><div class="alert-nome">${e.nome}</div><div class="alert-sub">Exame médico — ${txt} (${formatDateBr(e.exameVencimento)})</div></div></div>`);
      }
    }
    // Férias: verificar programadas futuras e pendentes
    if(e.dataAdmissao){
      const admissao=new Date(e.dataAdmissao+'T00:00:00');
      const mesesAdmitido=Math.floor((hoje-admissao)/(1000*60*60*24*30));
      const ferias=(e.ferias||[]);

      // Férias futuras programadas (início ainda não chegou)
      const futuras=ferias
        .filter(f=>new Date(f.inicio+'T00:00:00')>hoje)
        .sort((a,b)=>a.inicio.localeCompare(b.inicio));

      // Férias em andamento (começou mas ainda não terminou)
      const emAndamento=ferias.filter(f=>{
        const ini=new Date(f.inicio+'T00:00:00');
        const fim=new Date(f.fim+'T00:00:00');
        return ini<=hoje&&fim>=hoje;
      });

      if(emAndamento.length>0){
        const f=emAndamento[0];
        const fimDate=new Date(f.fim+'T00:00:00');
        const diasRestantes=Math.round((fimDate-hoje)/(1000*60*60*24));
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:#2E7D32"><i class="fa-solid fa-umbrella-beach"></i></div><div><div class="alert-nome">${e.nome}</div><div class="alert-sub" style="color:#2E7D32;font-weight:600">🏖️ Em férias agora — retorna em ${diasRestantes} dia(s) (${formatDateBr(f.fim)})</div></div></div>`);
      } else if(futuras.length>0){
        const prox=futuras[0];
        const iniDate=new Date(prox.inicio+'T00:00:00');
        const diasParaIniciar=Math.round((iniDate-hoje)/(1000*60*60*24));
        const cor=diasParaIniciar<=7?'#E65100':diasParaIniciar<=30?'#F57F17':'#5C6BC0';
        const txtInicio=diasParaIniciar===0?'Começa hoje':`Começa em ${diasParaIniciar} dia(s)`;
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:${cor}"><i class="fa-solid fa-umbrella-beach"></i></div><div><div class="alert-nome">${e.nome}</div><div class="alert-sub"><strong>${txtInicio}</strong> (${formatDateBr(prox.inicio)}) → término ${formatDateBr(prox.fim)} · ${prox.dias} dias</div></div></div>`);
      } else if(mesesAdmitido>=11){
        // Sem férias programadas — verificar se já venceu o prazo
        const feriasPassadas=ferias.filter(f=>new Date(f.fim+'T00:00:00')<hoje).sort((a,b)=>b.fim.localeCompare(a.fim));
        const ultimaFim=feriasPassadas.length>0?new Date(feriasPassadas[0].fim+'T00:00:00'):admissao;
        const mesesSemFerias=Math.floor((hoje-ultimaFim)/(1000*60*60*24*30));
        if(mesesSemFerias>=11){
          const urgente=mesesSemFerias>=12;
          const cor=urgente?'var(--danger)':'#E65100';
          const txt=urgente?`⚠️ Férias VENCIDAS — ${mesesSemFerias} meses`:`Férias a vencer — ${mesesSemFerias} meses — programe agora`;
          alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:${cor}"><i class="fa-solid fa-umbrella-beach"></i></div><div><div class="alert-nome">${e.nome}</div><div class="alert-sub" style="color:${cor};font-weight:${urgente?'700':'400'}">${txt}</div></div><button class="btn-icon btn-primary-icon" onclick="showSection('employees');openEmployeeModal('${e.id}');setTimeout(()=>switchTab('tab-ferias'),300)" title="Programar férias"><i class="fa-solid fa-calendar-plus"></i></button></div></div>`);
        }
      }
    }
  });
  // PLR: parcelas com data limite/aviso/atraso
  if(State.cct){
    const plrAvisoDias=State.cct.plrAvisoDias||30;
    [1,2].forEach(idx=>{
      const valor=State.cct[`plrP${idx}Valor`]||0;
      const dataLimite=State.cct[`plrP${idx}DataLimite`]||'';
      const dataPago=State.cct[`plrP${idx}DataPagamento`]||'';
      if(!valor||!dataLimite) return; // parcela não configurada
      const limite=new Date(dataLimite+'T00:00:00');
      const diff=Math.round((limite-hoje)/(1000*60*60*24));
      const labelParc=idx===1?'1ª Parcela':'2ª Parcela';
      if(dataPago){
        // Pago — alerta verde informativo
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:#2E7D32"><i class="fa-solid fa-circle-check"></i></div><div><div class="alert-nome">PLR — ${labelParc}</div><div class="alert-sub" style="color:#2E7D32;font-weight:600">✅ Paga em ${formatDateBr(dataPago)} — ${fmtMoney(valor)}</div></div></div>`);
      } else if(diff<0){
        // Vencida e não paga — vermelho
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i></div><div><div class="alert-nome">PLR — ${labelParc}</div><div class="alert-sub" style="color:var(--danger);font-weight:700">⚠️ VENCIDA há ${Math.abs(diff)} dia(s) — ${fmtMoney(valor)} (limite ${formatDateBr(dataLimite)})</div></div><button class="btn-icon btn-success-icon" onclick="markPlrPaid(${idx})" title="Marcar como paga"><i class="fa-solid fa-check"></i></button></div>`);
      } else if(diff<=plrAvisoDias){
        // Próxima do vencimento — amarelo
        const cor=diff<=7?'#E65100':'#F57F17';
        const txt=diff===0?'Vence HOJE':`Vence em ${diff} dia(s)`;
        alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:${cor}"><i class="fa-solid fa-gift"></i></div><div><div class="alert-nome">PLR — ${labelParc}</div><div class="alert-sub" style="color:${cor};font-weight:600">${txt} — ${fmtMoney(valor)} (limite ${formatDateBr(dataLimite)})</div></div><button class="btn-icon btn-success-icon" onclick="markPlrPaid(${idx})" title="Marcar como paga"><i class="fa-solid fa-check"></i></button></div>`);
      }
    });
    // Aviso geral: PLR não configurada (parcela 1 sem data ou valor)
    if(!State.cct.plrP1DataLimite && !State.cct.plrP1Valor && !State.cct.plrP2DataLimite){
      alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:#5C6BC0"><i class="fa-solid fa-circle-info"></i></div><div><div class="alert-nome">PLR não configurado</div><div class="alert-sub">Acesse o menu de CCT para definir parcelas e datas do PLR.</div></div><button class="btn-icon" onclick="openCctModal()" title="Configurar"><i class="fa-solid fa-arrow-right"></i></button></div>`);
    }
  }

  // Contratos: reajuste nos próximos 30 dias
  const mods2=getUserModules(Auth.currentUser);
  if(mods2.contratos){
    (State.contratos||[]).filter(c=>c.status!=='inativo').forEach(c=>{
      if(c.dataReajuste){
        const reaj=new Date(c.dataReajuste+'T00:00:00');
        // Ajustar para o ano corrente ou próximo
        const reajEsteAno=new Date(hoje.getFullYear(), reaj.getMonth(), reaj.getDate());
        const reajProxAno=new Date(hoje.getFullYear()+1, reaj.getMonth(), reaj.getDate());
        const dataRef=reajEsteAno>=hoje?reajEsteAno:reajProxAno;
        const diff=Math.round((dataRef-hoje)/(1000*60*60*24));
        if(diff<=30){
          const cor=diff<=7?'#C62828':'#E65100';
          const txt=diff===0?'Reajuste HOJE':diff<0?`Reajuste há ${Math.abs(diff)} dias`:`Reajuste em ${diff} dias`;
          alerts.push(`<div class="alert-item"><div class="alert-icon" style="color:${cor}"><i class="fa-solid fa-file-signature"></i></div><div><div class="alert-nome">${c.postoNome||'Contrato'}</div><div class="alert-sub">Reajuste contratual — ${txt} (${formatDateBr(c.dataReajuste)})</div></div><button class="btn-icon" onclick="showSection('contratos')" title="Ver contratos" style="margin-left:auto"><i class="fa-solid fa-arrow-right"></i></button></div>`);
        }
      }
    });
  }
  if(alerts.length===0){
    el.innerHTML=`<div class="empty-state small"><i class="fa-solid fa-circle-check" style="color:var(--success)"></i><p>Nenhum alerta no momento</p></div>`;
  } else {
    el.innerHTML=alerts.join('');
  }
}

// ============================================
// WHATSAPP
// ============================================
function openWhatsApp(celularLimpo, nome){
  const num='55'+celularLimpo;
  const msg=encodeURIComponent(`Olá ${nome}, tudo bem?`);
  window.open(`https://wa.me/${num}?text=${msg}`,'_blank');
}

// ============================================
// FOTO DO COLABORADOR
// ============================================
function previewEmployeePhoto(input){
  const file=input.files[0]; if(!file) return;
  if(file.size>2*1024*1024){ toast('Foto muito grande. Máx. 2MB.','error'); return; }
  const reader=new FileReader();
  reader.onload=e=>{
    const prev=document.getElementById('emp-photo-preview');
    prev.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    document.getElementById('btn-remove-photo').style.display='';
  };
  reader.readAsDataURL(file);
}

function removeEmployeePhoto(){
  const prev=document.getElementById('emp-photo-preview');
  prev.innerHTML='<i class="fa-solid fa-user"></i>';
  const fi=document.getElementById('emp-photo-file'); if(fi) fi.value='';
  document.getElementById('btn-remove-photo').style.display='none';
  // Marcar que foto foi removida
  prev.dataset.removed='true';
}

function loadEmployeePhoto(empId, fotoUrl){
  const prev=document.getElementById('emp-photo-preview'); if(!prev) return;
  prev.dataset.removed='';
  const fi=document.getElementById('emp-photo-file'); if(fi) fi.value='';
  if(fotoUrl){
    prev.innerHTML=`<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    document.getElementById('btn-remove-photo').style.display='';
  } else {
    prev.innerHTML='<i class="fa-solid fa-user"></i>';
    document.getElementById('btn-remove-photo').style.display='none';
  }
}

async function uploadEmployeePhoto(empId){
  const fileInput=document.getElementById('emp-photo-file');
  const prev=document.getElementById('emp-photo-preview');
  // Remover foto
  if(prev.dataset.removed==='true'){
    DB.initStorage();
    if(DB.storage){
      try { await DB.storage.ref(`employees/${empId}/foto`).delete(); } catch(e){}
    }
    return null;
  }
  const file=fileInput?fileInput.files[0]:null;
  if(!file) return undefined; // undefined = não mudou
  DB.initStorage();
  if(!DB.storage){ toast('Storage não disponível para foto.','warning'); return undefined; }
  const ref=DB.storage.ref(`employees/${empId}/foto`);
  await ref.put(file, {contentType:file.type});
  return await ref.getDownloadURL();
}

// ============================================
// DEPENDENTES (cadastro do colaborador)
// ============================================
function renderDependentes(deps){
  const list = document.getElementById('emp-dependentes-list');
  if(!list) return;
  list.innerHTML = '';
  (deps||[]).forEach((dep, idx) => list.appendChild(_createDependenteRow(dep, idx)));
}

function _createDependenteRow(dep, idx){
  const div = document.createElement('div');
  div.className = 'dep-row';
  div.dataset.idx = idx;
  div.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:8px 10px;display:grid;grid-template-columns:2fr 1.2fr 1fr auto;gap:8px;align-items:end;background:#FAFBFC';
  const nomeVal = (dep?.nome || '').replace(/"/g,'&quot;');
  const cpfVal  = dep?.cpf || '';
  const nascVal = dep?.dataNasc || '';
  div.innerHTML = `
    <div><label style="font-size:11px;color:var(--text-muted);font-weight:600">Nome do dependente</label>
      <input type="text" class="dep-nome" value="${nomeVal}" placeholder="Nome completo"></div>
    <div><label style="font-size:11px;color:var(--text-muted);font-weight:600">CPF</label>
      <input type="text" class="dep-cpf" value="${cpfVal}" placeholder="000.000.000-00" oninput="maskCpf(this)"></div>
    <div><label style="font-size:11px;color:var(--text-muted);font-weight:600">Data Nasc.</label>
      <input type="date" class="dep-nasc" value="${nascVal}"></div>
    <div><button type="button" class="btn-icon btn-danger-icon" onclick="removeDependente(this)" title="Remover dependente"><i class="fa-solid fa-trash"></i></button></div>
  `;
  return div;
}

function addDependente(){
  const list = document.getElementById('emp-dependentes-list');
  if(!list) return;
  const idx = list.children.length;
  list.appendChild(_createDependenteRow(null, idx));
}

function removeDependente(btn){
  const row = btn.closest('.dep-row');
  if(row) row.remove();
}

function collectDependentes(){
  const list = document.getElementById('emp-dependentes-list');
  if(!list) return [];
  const deps = [];
  list.querySelectorAll('.dep-row').forEach(row => {
    const nome = row.querySelector('.dep-nome')?.value?.trim();
    const cpf  = row.querySelector('.dep-cpf')?.value?.trim();
    const dataNasc = row.querySelector('.dep-nasc')?.value;
    if(nome) deps.push({ nome, cpf: cpf||'', dataNasc: dataNasc||'' });
  });
  return deps;
}

// ============================================
// FÉRIAS
// ============================================
function renderFeriasList(ferias){
  const el=document.getElementById('ferias-list'); if(!el) return;
  if(!ferias||ferias.length===0){
    el.innerHTML='<div class="empty-state small"><i class="fa-solid fa-umbrella-beach"></i><p>Nenhum período registrado</p></div>';
    return;
  }
  const sorted=[...ferias].sort((a,b)=>b.inicio.localeCompare(a.inicio));
  el.innerHTML=sorted.map(f=>`
    <div class="ferias-item">
      <div class="ferias-icon"><i class="fa-solid fa-umbrella-beach" style="color:#5C6BC0"></i></div>
      <div class="ferias-info">
        <div class="ferias-periodo">${formatDateBr(f.inicio)} → ${formatDateBr(f.fim)} <span class="badge badge-muted">${f.dias} dias</span></div>
        <div class="ferias-sub">${f.tipo||'Férias'}${f.obs?' · '+f.obs:''}</div>
      </div>
      <button class="btn-icon btn-danger-icon" onclick="removeFerias('${f.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
  // Input de dias no formulário de férias
  document.getElementById('ferias-inicio').addEventListener('change',calcFeriasDias);
  document.getElementById('ferias-fim').addEventListener('change',calcFeriasDias);
}

function calcFeriasDias(){
  const ini=val('ferias-inicio'), fim=val('ferias-fim');
  if(ini&&fim){
    const d=Math.round((new Date(fim)-new Date(ini))/(1000*60*60*24))+1;
    setVal('ferias-dias',d>0?d:'');
  }
}

async function addFerias(){
  const empId=val('emp-id');
  if(!empId){ toast('Salve o colaborador primeiro.','warning'); return; }
  const inicio=val('ferias-inicio'), fim=val('ferias-fim');
  if(!inicio||!fim){ toast('Informe início e fim das férias.','error'); return; }
  if(fim<inicio){ toast('Fim deve ser após o início.','error'); return; }
  const dias=Math.round((new Date(fim)-new Date(inicio))/(1000*60*60*24))+1;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ferias=[...(emp.ferias||[]),{id:genId(),inicio,fim,dias,tipo:val('ferias-tipo')||'Férias',obs:val('ferias-obs')}];
  await DB.save('employees',{...emp,ferias,updatedAt:new Date().toISOString()});
  State.employees=State.employees.map(e=>e.id===empId?{...e,ferias}:e);
  renderFeriasList(ferias);
  setVal('ferias-inicio',''); setVal('ferias-fim',''); setVal('ferias-dias',''); setVal('ferias-obs','');
  toast('Férias registradas!');
}

async function removeFerias(feriasId){
  const empId=val('emp-id'); if(!empId) return;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const ferias=(emp.ferias||[]).filter(f=>f.id!==feriasId);
  await DB.save('employees',{...emp,ferias,updatedAt:new Date().toISOString()});
  State.employees=State.employees.map(e=>e.id===empId?{...e,ferias}:e);
  renderFeriasList(ferias);
  toast('Registro removido.','warning');
}

// ============================================
// HISTÓRICO DE SALÁRIO
// ============================================
function renderHistoricoSalario(hist){
  const wrap=document.getElementById('historico-salario-wrap');
  const listEl=document.getElementById('historico-salario-list');
  if(!wrap||!listEl) return;
  if(!hist||hist.length===0){ wrap.style.display='none'; return; }
  wrap.style.display='';
  const sorted=[...hist].sort((a,b)=>b.data.localeCompare(a.data)).slice(0,6);
  listEl.innerHTML=sorted.map((h,i)=>`
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
      <span>${formatDateBr(h.data)}</span>
      <span style="font-weight:600;color:var(--success)">${fmtMoney(h.valor)}</span>
      ${i===0?'<span class="badge badge-success" style="font-size:10px">Atual</span>':'<span></span>'}
    </div>
  `).join('');
}

// ============================================
// EXPORTAR RELATÓRIO CSV
// ============================================
function exportReportCsv(){
  const mes=parseInt(val('report-mes')), ano=parseInt(val('report-ano'));
  if(!mes||!ano){ toast('Gere o relatório primeiro.','warning'); return; }
  const records=State.payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  if(records.length===0){ toast('Nenhum dado para exportar.','warning'); return; }
  const cols=['Nº','Nome','Posto','Escala','Dias Trabalhados','Faltas','Remuneração (R$)',
    'VT (R$)','VR (R$)','VA Líquido (R$)','Adic. Noturno (R$)','Bonificação (R$)','Chave PIX'];
  const rows=[cols.join(';')];
  records.forEach((p,i)=>{
    const emp=State.employees.find(e=>e.id===p.employeeId);
    const nome=emp?emp.nome:'(removido)';
    const posto=emp?(emp.posto||'—'):'—';
    const escala=emp?escalaLabel(emp.escala||'5x2A'):'—';
    const pix=emp?(emp.chavePix||'—'):'—';
    const totalFaltas='faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0);
    const num=emp&&emp.registro?String(emp.registro).padStart(4,'0'):String(i+1);
    rows.push([num,nome,posto,escala,p.diasTrabalhados,totalFaltas,
      (p.remuneracao||0).toFixed(2),(p.valeTransporte||0).toFixed(2),
      (p.valeRefeicao||0).toFixed(2),(p.valeAlimentacaoLiquido||0).toFixed(2),
      (p.adNoturno||0).toFixed(2),(p.bonificacao||0).toFixed(2),pix].join(';'));
  });
  const blob=new Blob(['﻿'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`DRGlobal_relatorio_${MESES[mes]}_${ano}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast('Relatório exportado em CSV!');
}

// ============================================
// COLABORADORES — CRUD
// ============================================
function setEmployeeFilter(filter){
  State.employeeFilter = filter;
  // Limpa a busca ao trocar o filtro de status (evita 0 resultados por conflito)
  const searchEl=document.getElementById('employee-search');
  if(searchEl) searchEl.value='';
  document.querySelectorAll('.status-filter-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderEmployeeTable();
}

function statusBadge(status){
  const s = status||'ativo';
  if(s==='ativo')               return '<span class="badge badge-status-ativo">Ativo</span>';
  if(s==='inativo')             return '<span class="badge badge-status-inativo">Inativo</span>';
  if(s==='afastado')            return '<span class="badge badge-status-afastado">Afastado INSS</span>';
  if(s==='licenca-maternidade') return '<span class="badge" style="background:#FCE4EC;color:#C2185B;font-weight:700">Lic. Maternidade</span>';
  return `<span class="badge badge-muted">${s}</span>`;
}

function renderEmployeeTable(){
  const query=(document.getElementById('employee-search')?.value||'').toLowerCase();
  let list=State.employees;
  if(query) list=list.filter(e=>
    (e.nome||'').toLowerCase().includes(query)||
    (e.cpf||'').toLowerCase().includes(query)||
    (e.rg||'').toLowerCase().includes(query)||
    (e.posto||'').toLowerCase().includes(query)||
    (e.setor||'').toLowerCase().includes(query)||
    String(e.registro||'').includes(query)
  );
  if(State.employeeFilter!=='all') list=list.filter(e=>(e.status||'ativo')===State.employeeFilter);
  const tbody=document.getElementById('employee-tbody');
  const empty=document.getElementById('employee-empty');
  const countEl=document.getElementById('employee-count');
  countEl.textContent=`${list.length} de ${State.employees.length} colaborador${State.employees.length!==1?'es':''}`;
  if(list.length===0){
    tbody.innerHTML=''; document.getElementById('employee-table').style.display='none';
    empty.style.display=''; return;
  }
  document.getElementById('employee-table').style.display=''; empty.style.display='none';
  const isLicenca = State.employeeFilter === 'licenca-maternidade';
  // Atualiza cabeçalhos dinamicamente conforme filtro
  const th6 = document.getElementById('emp-th-col6');
  const th7 = document.getElementById('emp-th-col7');
  if(th6) th6.textContent = isLicenca ? 'Início Licença' : 'Admissão';
  if(th7) th7.textContent = isLicenca ? 'Prev. Retorno'  : 'CPF';
  tbody.innerHTML=list.map((e)=>{
    const celularLimpo=(e.celular||'').replace(/\D/g,'');
    const whatsBtn=celularLimpo?`<button class="btn-icon btn-whatsapp-icon" onclick="openWhatsApp('${celularLimpo}','${e.nome.split(' ')[0]}')" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>`:'';
    const col6 = isLicenca
      ? `<strong style="color:#C2185B">${formatDateBr(e.licencaMaternidadeInicio)||'—'}</strong>`
      : (e.dataAdmissao ? formatDateBr(e.dataAdmissao) : '—');
    const col7 = isLicenca
      ? `<strong style="color:#C2185B">${formatDateBr(e.licencaMaternidadeTermino)||'—'}</strong>`
      : `<span class="td-mono">${e.cpf||'—'}</span>`;
    return `<tr>
      <td><span class="badge badge-muted">${e.registro?String(e.registro).padStart(4,'0'):'—'}</span></td>
      <td><div style="display:flex;align-items:center;gap:8px">
        ${e.fotoUrl?`<img src="${e.fotoUrl}" class="emp-table-photo" alt="">`:`<div class="emp-table-initials">${initials(e.nome)}</div>`}
        <span class="td-name">${e.nome}</span>
      </div></td>
      <td>${statusBadge(e.status)}</td>
      <td><span class="td-escala">${escalaLabel(e.escala||'5x2A')}</span></td>
      <td><span style="font-size:12px;color:var(--text-muted)">${e.posto||'—'}</span></td>
      <td>${col6}</td>
      <td>${col7}</td>
      <td><span class="td-pix">${e.chavePix||'—'}</span></td>
      <td><div class="actions-cell">
        ${whatsBtn}
        <button class="btn-icon btn-primary-icon" onclick="openPayrollForEmployee('${e.id}')" title="Lançar Folha"><i class="fa-solid fa-file-invoice-dollar"></i></button>
        <button class="btn-icon btn-warning-icon" onclick="openEmployeeModal('${e.id}')" title="Editar"><i class="fa-solid fa-pencil"></i></button>
        <button class="btn-icon btn-danger-icon" onclick="confirmDeleteEmployee('${e.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

function onDemissaoChange(){
  const demissao=val('emp-data-demissao');
  if(demissao){ setVal('emp-status','inativo'); }
}

function onEscalaChange(){
  const escala=val('emp-escala');
  const row=document.getElementById('turno-noturno-row');
  if(row) row.style.display=(escalaFamilia(escala)==='12x36')?'':'none';
}

function onEmpStatusChange(){
  const status=val('emp-status');
  const rowLic=document.getElementById('row-licenca-maternidade');
  if(rowLic) rowLic.style.display=(status==='licenca-maternidade')?'':'none';
}

// Habilita/desabilita os inputs de horário de refeição conforme flag "semRefeicao"
function onSemRefeicaoChange(){
  const chk=document.getElementById('emp-sem-refeicao');
  const ini=document.getElementById('emp-horario-ref-ini');
  const fim=document.getElementById('emp-horario-ref-fim');
  if(!chk) return;
  const sem=chk.checked;
  if(ini){ ini.disabled=sem; if(sem) ini.value=''; ini.style.opacity=sem?'.45':'1'; }
  if(fim){ fim.disabled=sem; if(sem) fim.value=''; fim.style.opacity=sem?'.45':'1'; }
}

function _toggleOpcaoLicencaMaternidade(mostrar){
  const opt=document.getElementById('opt-licenca-maternidade');
  if(!opt) return;
  opt.style.display=mostrar?'':'none';
  // Se estiver escondendo e estava selecionada, volta para 'ativo'
  if(!mostrar && val('emp-status')==='licenca-maternidade'){
    setVal('emp-status','ativo');
    onEmpStatusChange();
  }
}

function getNextRegistro(){
  if(State.employees.length===0) return 1;
  const max=State.employees.reduce((m,e)=>Math.max(m,parseInt(e.registro)||0),0);
  return max+1;
}

// ============================================
// ENCARGOS & IRRF — LISTAS DINÂMICAS
// ============================================
function renderOutrosItens(items, tipo){
  const container=document.getElementById(`emp-outros-${tipo}`);
  if(!container) return;
  container.innerHTML=(items||[]).map((item,i)=>`
    <div class="outro-item-row" id="${tipo}-row-${i}">
      <input type="text" placeholder="Descrição (ex: Adiantamento salarial)" value="${(item.descricao||'').replace(/"/g,'&quot;')}" id="${tipo}-desc-${i}">
      <input type="number" placeholder="0,00" value="${item.valor||0}" min="0" step="0.01" id="${tipo}-val-${i}">
      <button type="button" class="btn-icon btn-danger-icon" onclick="removeOutroItem('${tipo}',${i})" title="Remover">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`).join('');
}

function addOutroItem(tipo){
  const container=document.getElementById(`emp-outros-${tipo}`);
  if(!container) return;
  const idx=container.querySelectorAll('.outro-item-row').length;
  const row=document.createElement('div');
  row.className='outro-item-row';
  row.id=`${tipo}-row-${idx}`;
  row.innerHTML=`
    <input type="text" placeholder="Descrição" id="${tipo}-desc-${idx}">
    <input type="number" placeholder="0,00" min="0" step="0.01" id="${tipo}-val-${idx}">
    <button type="button" class="btn-icon btn-danger-icon" onclick="removeOutroItem('${tipo}',${idx})" title="Remover">
      <i class="fa-solid fa-xmark"></i>
    </button>`;
  container.appendChild(row);
  row.querySelector('input[type="text"]').focus();
}

function removeOutroItem(tipo, idx){
  const row=document.getElementById(`${tipo}-row-${idx}`);
  if(row) row.remove();
}

function collectOutrosItens(tipo){
  const container=document.getElementById(`emp-outros-${tipo}`);
  if(!container) return [];
  return Array.from(container.querySelectorAll('.outro-item-row')).map(row=>{
    const inputs=row.querySelectorAll('input');
    const descricao=(inputs[0]?.value||'').trim();
    const valor=parseFloat(inputs[1]?.value)||0;
    return descricao?{descricao,valor}:null;
  }).filter(Boolean);
}

function openEmployeeModal(id=null){
  State.editingEmployeeId=id;
  document.getElementById('modal-employee').classList.remove('hidden');
  populatePostoSelect();
  switchTab('tab-pessoal');
  const titleEl=document.getElementById('modal-employee-title');
  if(id){
    const emp=State.employees.find(e=>e.id===id); if(!emp) return;
    titleEl.innerHTML='<i class="fa-solid fa-user-pen"></i> Editar Colaborador';
    _toggleOpcaoLicencaMaternidade(true); // habilita opção ao editar
    setVal('emp-registro', emp.registro ? String(emp.registro).padStart(4,'0') : '—');
    setVal('emp-id',emp.id); setVal('emp-nome',emp.nome); setVal('emp-rg',emp.rg||'');
    setVal('emp-cpf',emp.cpf); setVal('emp-titulo',emp.tituloEleitor||''); setVal('emp-pis',emp.pisNit||'');
    setVal('emp-ctps-numero',emp.ctpsNumero||''); setVal('emp-ctps-serie',emp.ctpsSerie||'');
    setVal('emp-nascimento',emp.dataNascimento||'');
    setVal('emp-email',emp.email||''); setVal('emp-celular',emp.celular||''); setVal('emp-cep',emp.cep||'');
    setVal('emp-endereco',emp.endereco||''); setVal('emp-numero',emp.numero||''); setVal('emp-complemento',emp.complemento||'');
    setVal('emp-bairro',emp.bairro||''); setVal('emp-cidade',emp.cidade||''); setVal('emp-estado',emp.estado||'SP');
    setVal('emp-tipo-transporte',emp.tipoTransporte||'vt');
    setVal('emp-vt-freq', emp.vtFreq||'diario');
    setVal('emp-vr-freq', emp.vrFreq||'diario');
    setVal('emp-vt-dia',emp.valorDiarioVt||''); setVal('emp-vr-dia',emp.valorDiarioVr||'');
    setVal('emp-va-mensal',emp.valorMensalVa||''); setVal('emp-pix',emp.chavePix||'');
    onVtFreqChange();
    onVrFreqChange();
    onTipoTransporteChange();
    // Contrato & Trabalho
    setVal('emp-data-admissao',emp.dataAdmissao||''); setVal('emp-data-demissao',emp.dataDemissao||'');
    setVal('emp-status',emp.status||'ativo'); setVal('emp-escala',emp.escala||'5x2A');
    setVal('emp-licenca-inicio',emp.licencaMaternidadeInicio||'');
    setVal('emp-licenca-termino',emp.licencaMaternidadeTermino||'');
    onEmpStatusChange();
    setVal('emp-horario-entrada',emp.horarioEntrada||''); setVal('emp-horario-saida',emp.horarioSaida||'');
    setVal('emp-horario-ref-ini',emp.horarioRefIni||''); setVal('emp-horario-ref-fim',emp.horarioRefFim||'');
    const semRefChk=document.getElementById('emp-sem-refeicao');
    if(semRefChk){ semRefChk.checked=!!(emp.semRefeicao); onSemRefeicaoChange(); }
    setVal('emp-salario-base',emp.salarioBase||'');
    setVal('emp-posto',emp.posto||'');
    setVal('emp-setor',emp.setor||'');
    setVal('emp-exame-vencimento',emp.exameVencimento||'');
    setVal('emp-insalubridade',emp.insalubridade||0);
    const acumChk=document.getElementById('emp-acumulo-funcao');
    if(acumChk) acumChk.checked=!!(emp.acumuloFuncao);
    const bonifChk=document.getElementById('emp-bonificacao-sempre-pagar');
    if(bonifChk) bonifChk.checked=!!(emp.bonificacaoSemprePagar);
    const chk=document.getElementById('emp-turno-noturno'); if(chk) chk.checked=!!(emp.turnoNoturno);
    // Aba Encargos & IRRF
    setVal('emp-dependentes-irrf', emp.dependentesIRRF||0);
    setVal('emp-pensao-alimenticia', (emp.pensaoAlimenticia||0).toFixed(2));
    setVal('emp-plano-saude', (emp.planoSaude||0).toFixed(2));
    renderOutrosItens(emp.outrosDescontos||[], 'descontos');
    renderOutrosItens(emp.outrosProventos||[], 'proventos');
    onEscalaChange();
    // Histórico de salário
    renderHistoricoSalario(emp.historicoSalario||[]);
    // Histórico de postos
    renderHistoricoPostos(emp);
    // Dependentes (cadastro)
    renderDependentes(emp.dependentes||[]);
    // Novos campos pessoais
    setVal('emp-sexo',                emp.sexo||'');
    setVal('emp-rg-expedicao',        emp.rgExpedicao||'');
    setVal('emp-rg-orgao',            emp.rgOrgao||'');
    setVal('emp-estado-civil',        emp.estadoCivil||'');
    setVal('emp-local-nascimento',    emp.localNascimento||'');
    setVal('emp-uf-nascimento',       emp.ufNascimento||'');
    setVal('emp-raca',                emp.raca||'');
    setVal('emp-mae',                 emp.nomeMae||'');
    setVal('emp-pai',                 emp.nomePai||'');
    setVal('emp-grau-instrucao',      emp.grauInstrucao||'');
    setVal('emp-instrucao-concluido', emp.instrucaoConcluido||'');
    setVal('emp-pis-data',            emp.pisData||'');
    setVal('emp-titulo-zona',         emp.tituloZona||'');
    setVal('emp-titulo-secao',        emp.tituloSecao||'');
    setVal('emp-ctps-emissao',        emp.ctpsEmissao||'');
    setVal('emp-cnh',                 emp.cnh||'');
    setVal('emp-cnh-categoria',       emp.cnhCategoria||'');
    // Foto
    loadEmployeePhoto(emp.id, emp.fotoUrl||null);
    // Férias
    renderFeriasList(emp.ferias||[]);
    // Documentos
    loadDocumentList(emp.id);
  } else {
    const nextNum = getNextRegistro();
    titleEl.innerHTML='<i class="fa-solid fa-user-plus"></i> Novo Colaborador';
    _toggleOpcaoLicencaMaternidade(false); // esconde opção ao criar novo
    setVal('emp-registro', String(nextNum).padStart(4,'0'));
    ['emp-id','emp-nome','emp-rg','emp-cpf','emp-titulo','emp-pis','emp-ctps-numero','emp-ctps-serie',
     'emp-nascimento','emp-email','emp-celular','emp-cep','emp-endereco','emp-numero','emp-complemento',
     'emp-bairro','emp-cidade','emp-vt-dia','emp-vr-dia','emp-va-mensal','emp-pix','emp-tipo-transporte',
     'emp-data-admissao','emp-data-demissao','emp-horario-entrada','emp-horario-saida',
     'emp-horario-ref-ini','emp-horario-ref-fim',
     'emp-salario-base','emp-posto','emp-setor','emp-exame-vencimento',
     'emp-licenca-inicio','emp-licenca-termino'].forEach(fid=>setVal(fid,''));
    // Resetar foto, férias e histórico de postos
    loadEmployeePhoto(null, null);
    renderFeriasList([]);
    renderHistoricoSalario([]);
    renderHistoricoPostos(null);
    renderDependentes([]);
    // Reset dos novos campos pessoais
    ['emp-sexo','emp-rg-expedicao','emp-rg-orgao','emp-estado-civil',
     'emp-local-nascimento','emp-uf-nascimento','emp-raca','emp-mae','emp-pai',
     'emp-grau-instrucao','emp-instrucao-concluido','emp-pis-data',
     'emp-titulo-zona','emp-titulo-secao','emp-ctps-emissao',
     'emp-cnh','emp-cnh-categoria'].forEach(id=>setVal(id,''));
    setVal('emp-estado','SP'); setVal('emp-status','ativo'); setVal('emp-escala','5x2A');
    setVal('emp-insalubridade',0);
    setVal('emp-vt-freq','diario'); setVal('emp-vr-freq','diario');
    onEmpStatusChange();
    onVtFreqChange(); onVrFreqChange();
    const chk=document.getElementById('emp-turno-noturno'); if(chk) chk.checked=false;
    const acumChk=document.getElementById('emp-acumulo-funcao'); if(acumChk) acumChk.checked=false;
    const bonifChk=document.getElementById('emp-bonificacao-sempre-pagar'); if(bonifChk) bonifChk.checked=false;
    const semRefChk=document.getElementById('emp-sem-refeicao'); if(semRefChk){ semRefChk.checked=false; onSemRefeicaoChange(); }
    // Encargos & IRRF — limpar para novo colaborador
    setVal('emp-dependentes-irrf',0);
    setVal('emp-pensao-alimenticia','0.00');
    setVal('emp-plano-saude','0.00');
    renderOutrosItens([],'descontos');
    renderOutrosItens([],'proventos');
    onEscalaChange();
    document.getElementById('doc-list').innerHTML=`<div class="empty-state small"><i class="fa-solid fa-folder-open"></i><p>Salve o colaborador antes de enviar documentos</p></div>`;
  }
}

async function saveEmployee(){
  const nome=val('emp-nome'), cpf=val('emp-cpf');
  if(!nome){ toast('Nome obrigatório.','error'); return; }
  if(!cpf){  toast('CPF obrigatório.','error');  return; }
  const demissao=val('emp-data-demissao');
  let status=val('emp-status')||'ativo';
  if(demissao) status='inativo'; // auto-inativar se data de demissão preenchida
  const chk=document.getElementById('emp-turno-noturno');
  const isNew = !State.editingEmployeeId;
  const data={
    id:val('emp-id')||genId(),
    registro: isNew ? getNextRegistro() : (State.employees.find(e=>e.id===State.editingEmployeeId)?.registro || getNextRegistro()),
    nome, rg:val('emp-rg'), cpf,
    tituloEleitor:val('emp-titulo'), pisNit:val('emp-pis'),
    ctpsNumero:val('emp-ctps-numero'), ctpsSerie:val('emp-ctps-serie'),
    dataNascimento:val('emp-nascimento'),
    posto:val('emp-posto'),
    setor:val('emp-setor'),
    exameVencimento:val('emp-exame-vencimento'),
    email:val('emp-email'), celular:val('emp-celular'),
    cep:val('emp-cep'), endereco:val('emp-endereco'), numero:val('emp-numero'),
    complemento:val('emp-complemento'), bairro:val('emp-bairro'),
    cidade:val('emp-cidade'), estado:val('emp-estado'),
    tipoTransporte:val('emp-tipo-transporte')||'vt',
    vtFreq: val('emp-vt-freq')||'diario',
    vrFreq: val('emp-vr-freq')||'diario',
    valorDiarioVt:numVal('emp-vt-dia'), valorDiarioVr:numVal('emp-vr-dia'),
    valorMensalVa:numVal('emp-va-mensal'),
    chavePix:val('emp-pix'),
    // Contrato & Trabalho
    dataAdmissao:val('emp-data-admissao'),
    dataDemissao:demissao,
    status,
    licencaMaternidadeInicio: status==='licenca-maternidade' ? val('emp-licenca-inicio') : '',
    licencaMaternidadeTermino: status==='licenca-maternidade' ? val('emp-licenca-termino') : '',
    escala:val('emp-escala')||'5x2A',
    horarioEntrada:val('emp-horario-entrada'),
    horarioSaida:val('emp-horario-saida'),
    horarioRefIni:val('emp-horario-ref-ini'),
    horarioRefFim:val('emp-horario-ref-fim'),
    semRefeicao:!!(document.getElementById('emp-sem-refeicao')?.checked),
    turnoNoturno:chk?chk.checked:false,
    // Novos campos pessoais (Dados Pessoais)
    sexo:               val('emp-sexo'),
    rgExpedicao:        val('emp-rg-expedicao'),
    rgOrgao:            val('emp-rg-orgao'),
    estadoCivil:        val('emp-estado-civil'),
    localNascimento:    val('emp-local-nascimento'),
    ufNascimento:       val('emp-uf-nascimento'),
    raca:               val('emp-raca'),
    nomeMae:            val('emp-mae'),
    nomePai:            val('emp-pai'),
    grauInstrucao:      val('emp-grau-instrucao'),
    instrucaoConcluido: val('emp-instrucao-concluido'),
    pisData:            val('emp-pis-data'),
    tituloZona:         val('emp-titulo-zona'),
    tituloSecao:        val('emp-titulo-secao'),
    ctpsEmissao:        val('emp-ctps-emissao'),
    cnh:                val('emp-cnh'),
    cnhCategoria:       val('emp-cnh-categoria'),
    dependentes:        collectDependentes(),
    salarioBase:numVal('emp-salario-base'),
    insalubridade:numVal('emp-insalubridade')||0,
    acumuloFuncao:!!(document.getElementById('emp-acumulo-funcao')?.checked),
    bonificacaoSemprePagar:!!(document.getElementById('emp-bonificacao-sempre-pagar')?.checked),
    // Encargos & IRRF
    dependentesIRRF:parseInt(val('emp-dependentes-irrf')||0),
    pensaoAlimenticia:numVal('emp-pensao-alimenticia')||0,
    planoSaude:numVal('emp-plano-saude')||0,
    outrosDescontos:collectOutrosItens('descontos'),
    outrosProventos:collectOutrosItens('proventos'),
    updatedAt:new Date().toISOString()
  };
  if(!State.editingEmployeeId){
    data.createdAt=new Date().toISOString();
    data.ferias=[];
    data.historicoSalario=data.salarioBase?[{data:new Date().toISOString().split('T')[0],valor:data.salarioBase}]:[];
    data.fotoUrl=null;
  } else {
    const existing=State.employees.find(e=>e.id===State.editingEmployeeId);
    if(existing){
      data.createdAt=existing.createdAt;
      data.ferias=existing.ferias||[];
      data.fotoUrl=existing.fotoUrl||null;
      // Histórico de salário: registrar mudança se o salário alterou
      const hist=existing.historicoSalario||[];
      const lastSal=hist.length>0?hist[hist.length-1].valor:null;
      if(data.salarioBase && data.salarioBase!==lastSal){
        hist.push({data:new Date().toISOString().split('T')[0],valor:data.salarioBase});
      }
      data.historicoSalario=hist;
    }
  }
  const btn=document.querySelector('#modal-employee .modal-footer .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    // Upload foto (se selecionada ou removida)
    const fotoResult=await uploadEmployeePhoto(data.id);
    if(fotoResult===null) data.fotoUrl=null;           // foi removida
    else if(fotoResult!==undefined) data.fotoUrl=fotoResult; // nova foto
    // fotoResult===undefined = não mudou (mantém o que já estava em data.fotoUrl)
    await DB.save('employees', _sanitizeForFirestore(data));
    Auth.log(State.editingEmployeeId?'EMPLOYEE_UPDATED':'EMPLOYEE_CREATED', null, `${data.nome} (CPF: ${data.cpf||'—'}, Posto: ${data.posto||'—'})`);
    closeModal('modal-employee');
    toast(State.editingEmployeeId?'Colaborador atualizado!':'Colaborador cadastrado!');
  } catch(e){
    console.error('saveEmployee erro:', e, 'data:', data);
    toast('Erro ao salvar: ' + (e?.message || e), 'error');
  }
  finally { setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar Colaborador'); }
}

function confirmDeleteEmployee(id){
  const emp=State.employees.find(e=>e.id===id); if(!emp) return;
  document.getElementById('confirm-message').textContent=`Excluir "${emp.nome}"? Todos os lançamentos também serão removidos.`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    const payIds=State.payrolls.filter(p=>p.employeeId===id).map(p=>p.id);
    await Promise.all([DB.remove('employees',id),...payIds.map(pid=>DB.remove('payrolls',pid))]);
    Auth.log('EMPLOYEE_DELETED', null, `${emp.nome} (CPF: ${emp.cpf||'—'}, Posto: ${emp.posto||'—'})`);
    closeModal('modal-confirm'); toast('Colaborador excluído.','warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// FOLHA DE PONTO
// ============================================
function initPayrollSection(){
  const sel=document.getElementById('payroll-employee');
  const currentId=sel.value;
  sel.innerHTML='<option value="">— Selecione o colaborador —</option>';
  // Somente colaboradores ativos na folha de ponto
  State.employees.filter(e=>(e.status||'ativo')==='ativo').sort((a,b)=>a.nome.localeCompare(b.nome)).forEach(e=>{
    const opt=document.createElement('option');
    opt.value=e.id; opt.textContent=e.nome;
    if(e.id===currentId) opt.selected=true;
    sel.appendChild(opt);
  });
  const mesEl=document.getElementById('payroll-mes');
  mesEl.value=mesEl.value||currentMes();
  document.getElementById('payroll-ano').value=document.getElementById('payroll-ano').value||currentAno();
  const mes=parseInt(mesEl.value), ano=parseInt(document.getElementById('payroll-ano').value);
  _autoFillPeriodoDates(mes,ano);
  _updatePainelFechamento(mes,ano);
  if(currentId) onPayrollEmployeeChange();
}

function onPayrollEmployeeChange(){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const infoEl=document.getElementById('payroll-emp-info');
  if(emp){
    // FIX: troca de colaborador deve carregar registro salvo OU resetar todos os campos
    // específicos da folha (adiantamento, bonus, faltas, HE etc.). Antes só atualizava
    // campos vindos do cadastro, deixando adiantamento ativo "vazar" entre colaboradores.
    const mes=parseInt(val('payroll-mes')||currentMes());
    const ano=parseInt(val('payroll-ano')||currentAno());
    const saved=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
    if(saved){
      // Carrega registro existente — loadPayrollRecord seta todos os campos da folha
      loadPayrollRecord(saved.id);
    } else {
      // Sem registro salvo: zera os campos específicos da folha (mas não os de cadastro)
      _resetPayrollFieldsOnly();
    }
    setVal('payroll-vt-dia',emp.valorDiarioVt||'');
    setVal('payroll-vr-dia',emp.valorDiarioVr||'');
    setVal('payroll-pix',emp.chavePix||'');
    // Atualizar card VT/AM conforme modalidade do colaborador
    _updateVtCardLabel(emp.tipoTransporte||'vt');
    // Pré-preencher horários do cadastro do colaborador
    if(emp.horarioEntrada) setVal('payroll-entrada', emp.horarioEntrada);
    if(emp.horarioSaida)   setVal('payroll-saida',   emp.horarioSaida);
    const escala=emp.escala||'5x2A';
    const noturno=emp.turnoNoturno&&escalaFamilia(escala)==='12x36';
    if(infoEl){
      infoEl.classList.remove('hidden');
      infoEl.innerHTML=`<i class="fa-solid fa-circle-info"></i> <strong>${emp.nome}</strong> — Escala: <strong>${escalaLabel(escala)}</strong> — Status: ${statusBadge(emp.status||'ativo')}${noturno?' — <span style="color:#5C6BC0"><i class="fa-solid fa-moon"></i> Turno Noturno</span>':''}`;
    }
    // Mostrar/ocultar card adicional noturno
    const noturnoCard=document.getElementById('noturno-card');
    if(noturnoCard) noturnoCard.classList.toggle('hidden',!noturno);
    if(noturno && emp.salarioBase){
      const dias=numVal('payroll-dias');
      if(dias>0) setVal('payroll-noturno',calcAdNoturno(emp.salarioBase,dias).toFixed(2));
    }
  } else {
    ['payroll-vt-dia','payroll-vr-dia','payroll-pix','payroll-noturno',
     'payroll-entrada','payroll-saida','payroll-intervalo-inicio','payroll-intervalo-fim',
     'payroll-horas-liquidas','payroll-horas-extras-dia'].forEach(id=>setVal(id,''));
    _resetPayrollFieldsOnly();
    if(infoEl) infoEl.classList.add('hidden');
    const noturnoCard=document.getElementById('noturno-card');
    if(noturnoCard) noturnoCard.classList.add('hidden');
  }
  recalculate(); renderPayrollHistory(empId);
  _updateFolhaStatusBadge();
}

// Reset apenas dos campos da folha (não toca em vt-dia/vr-dia/pix/horarios — vêm do cadastro)
function _resetPayrollFieldsOnly(){
  ['payroll-dias','payroll-faltas','payroll-faltas-justificadas','payroll-faltas-injustificadas',
   'payroll-remuneracao','payroll-vt-total','payroll-vr-total','payroll-va-total','payroll-va-liquido',
   'payroll-bonus','payroll-adiantamento-valor','payroll-atraso-min','payroll-desconto-atraso',
   'payroll-acumulo','payroll-insalubridade','payroll-horas-liquidas','payroll-horas-extras-dia',
   'payroll-he-total','payroll-he-valor','payroll-he-corrido-min','payroll-he-corrido-detalhe',
   'payroll-he-corrido-valor','payroll-outros-proventos','payroll-outros-descontos',
   'payroll-inss','payroll-irrf','payroll-fgts','payroll-pensao','payroll-plano-saude-desc',
   'payroll-total-bruto','payroll-total-liquido-final']
    .forEach(id=>setVal(id,''));
  setVal('payroll-adiantamento-ativo','nao');
  setVal('payroll-adiantamento-perc','40');
  setVal('payroll-he-perc','50');
}

function calcAdNoturno(salarioBase, dias){
  return (salarioBase/220)*0.20*7*dias;
}

// Converte "HH:MM" em minutos totais
function timeToMinutes(t){
  if(!t) return null;
  const parts=(t+'').split(':');
  if(parts.length<2) return null;
  const h=parseInt(parts[0])||0, m=parseInt(parts[1])||0;
  return h*60+m;
}
// Formata minutos em "Xh YYmin"
function minutesToStr(min){
  if(min===null||min===undefined||isNaN(min)) return '—';
  const h=Math.floor(Math.abs(min)/60), m=Math.round(Math.abs(min)%60);
  return `${h}h${String(m).padStart(2,'0')}min`;
}

// Retorna a família da escala (para cálculos)
function escalaFamilia(escala){
  if(!escala) return '5x2';
  if(escala.startsWith('5x2')) return '5x2';
  if(escala.startsWith('6x1')) return '6x1';
  if(escala==='12x36') return '12x36';
  return escala;
}

// Retorna label legível da escala
function escalaLabel(escala){
  const labels={
    '5x2A':'5x2 — Var. A (08h–18h)',
    '5x2B':'5x2 — Var. B (07h–17h)',
    '6x1A':'6x1 — Var. A (07h–16h / Sáb 4h)',
    '6x1B':'6x1 — Var. B (08h–16h20)',
    '6x1C':'6x1 — Var. C (08h–17h / Sáb 4h)',
    '12x36':'12x36'
  };
  return labels[escala]||escala||'5x2A';
}

// Calcula quantos dias de trabalho ocorrem em um mês conforme escala
function calcDiasEscala(mes, ano, escala){
  const diasNoMes=new Date(ano,mes,0).getDate();
  const fam=escalaFamilia(escala);
  if(fam==='5x2') return Math.floor(diasNoMes*5/7);
  if(fam==='6x1') return Math.floor(diasNoMes*6/7);
  if(fam==='12x36') return Math.floor(diasNoMes/2);
  return diasNoMes;
}

// ============================================
// MOTOR DE CÁLCULO CLT — conforme legislação brasileira
// Divisores: salário/30 = valor do dia | salário/220 = valor da hora
// Falta injustificada: desconto do dia (sal/30) + DSR da semana (sal/30)
// Atraso: (sal/220/60) * minutos — tolerância CLT: 5min/batida, 10min/dia
// Adicional noturno: 20% sobre hora (hora noturna = 52min30s)
// ============================================
// Atualiza label/ícone do card VT na folha conforme modalidade
function _updateVtCardLabel(tipo){
  const label   = document.getElementById('payroll-vt-label');
  const platform= document.getElementById('payroll-vt-platform');
  const icon    = document.getElementById('payroll-vt-icon');
  const diaLbl  = document.getElementById('payroll-vt-dia-label');
  const totLbl  = document.getElementById('payroll-vt-total-label');
  const card    = document.getElementById('payroll-vt-card');
  if(!label) return;
  if(tipo==='am'){
    if(label)    label.textContent='Auxílio Mobilidade (AM)';
    if(platform) platform.textContent='pago em espécie / PIX';
    if(icon)     { icon.className='fa-solid fa-motorcycle'; }
    if(diaLbl)   diaLbl.textContent='Valor diário do AM: R$';
    if(totLbl)   totLbl.textContent='Total Auxílio Mobilidade: R$';
    if(card)     { card.classList.remove('vt'); card.classList.add('am'); }
  } else if(tipo==='nao'){
    if(label)    label.textContent='Sem benefício de transporte';
    if(platform) platform.textContent='não optante';
    if(icon)     { icon.className='fa-solid fa-ban'; }
    if(diaLbl)   diaLbl.textContent='Valor diário: R$';
    if(totLbl)   totLbl.textContent='Total: R$';
    if(card)     { card.classList.remove('vt','am'); }
  } else {
    if(label)    label.textContent='Vale Transporte (VT)';
    if(platform) platform.textContent='creditado na plataforma';
    if(icon)     { icon.className='fa-solid fa-bus'; }
    if(diaLbl)   diaLbl.textContent='Valor diário do VT: R$';
    if(totLbl)   totLbl.textContent='Total Vale Transporte: R$';
    if(card)     { card.classList.add('vt'); card.classList.remove('am'); }
  }
}

// Chamada quando o select no cadastro muda
function onTipoTransporteChange(){
  const tipo=val('emp-tipo-transporte')||'vt';
  const wrap=document.getElementById('emp-vt-dia-wrap');
  const freqWrap=document.getElementById('emp-vt-freq-wrap');
  if(wrap)     wrap.style.display = tipo==='nao' ? 'none' : '';
  if(freqWrap) freqWrap.style.display = tipo==='nao' ? 'none' : '';
  _updateVtLabel();
}

// Atualiza label do campo VT/AM com base na modalidade + frequência
function _updateVtLabel(){
  const tipo = val('emp-tipo-transporte')||'vt';
  const freq = val('emp-vt-freq')||'diario';
  const lbl  = document.getElementById('emp-vt-dia-label');
  if(!lbl) return;
  const periodo = freq === 'semanal' ? 'Semanal' : 'Diário';
  const icon = tipo==='am'
    ? '<i class="fa-solid fa-motorcycle" style="color:#4fc3f7"></i>'
    : '<i class="fa-solid fa-bus" style="color:#4fc3f7"></i>';
  const nome = tipo==='am' ? 'AM' : 'VT';
  lbl.innerHTML = `${icon} Valor ${periodo} ${nome} (R$)`;
}

function onVtFreqChange(){ _updateVtLabel(); }

function onVrFreqChange(){
  const freq = val('emp-vr-freq')||'diario';
  const lbl  = document.getElementById('emp-vr-dia-label');
  if(!lbl) return;
  const periodo = freq === 'semanal' ? 'Semanal' : 'Diário';
  lbl.innerHTML = `<i class="fa-solid fa-utensils" style="color:#ff8a65"></i> Valor ${periodo} do VR (R$)`;
}

// Calcula o número de semanas trabalhadas no mês baseado na escala
// (5x2=5dias/sem, 6x1=6dias/sem, 12x36=~3.5dias/sem). Usa ceil para garantir
// que 1 dia trabalhado = 1 semana (sem benefício "fracionado").
function _semanasTrabalhadas(dias, escala){
  if(!dias || dias<=0) return 0;
  const fam = escalaFamilia(escala||'5x2A');
  const diasPorSemana = fam==='12x36' ? 3.5 : (fam==='6x1' ? 6 : 5);
  return Math.ceil(dias / diasPorSemana);
}

// ============================================
// BENEFÍCIOS A PAGAR — UI (card no dash + modais)
// ============================================
let _beneficioTabAtual = 'hoje';

function openBeneficiosPagar(){
  _beneficioTabAtual = 'hoje';
  // Ativa tab Hoje
  document.querySelectorAll('.benef-tab-btn').forEach(b => {
    if(b.dataset.tab === 'hoje'){
      b.classList.add('active');
      b.style.borderBottom = '3px solid #0288D1';
      b.style.color = '#0288D1';
    } else {
      b.classList.remove('active');
      b.style.borderBottom = '3px solid transparent';
      b.style.color = 'var(--text-muted)';
    }
  });
  renderBeneficiosLista();
  document.getElementById('modal-beneficios-pagar').classList.remove('hidden');
}

function switchBeneficioTab(tab){
  _beneficioTabAtual = tab;
  document.querySelectorAll('.benef-tab-btn').forEach(b => {
    if(b.dataset.tab === tab){
      b.classList.add('active');
      b.style.borderBottom = '3px solid #0288D1';
      b.style.color = '#0288D1';
    } else {
      b.classList.remove('active');
      b.style.borderBottom = '3px solid transparent';
      b.style.color = 'var(--text-muted)';
    }
  });
  renderBeneficiosLista();
}

function renderBeneficiosLista(){
  const tab = _beneficioTabAtual || 'hoje';
  const hojeISO = new Date().toISOString().substring(0,10);
  let ini, fim, escopo, periodoLabel;
  if(tab === 'hoje'){
    ini = fim = hojeISO;
    escopo = 'dia';
    periodoLabel = `<strong>Hoje (${new Date().toLocaleDateString('pt-BR')})</strong>`;
  } else {
    const s = _semanaDe(hojeISO);
    ini = s.inicio; fim = s.fim;
    escopo = 'semana';
    const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('pt-BR');
    periodoLabel = `<strong>Esta semana — ${fmt(s.inicio)} a ${fmt(s.fim)}</strong>`;
  }
  // Coleta colaboradores ativos com algum dia trabalhado no período
  const linhas = [];
  (State.employees||[])
    .filter(e => (e.status||'ativo') === 'ativo')
    .forEach(e => {
      const b = _calcBeneficiosColab(e, ini, fim, escopo);
      if(b.total > 0) linhas.push({ emp:e, b });
    });
  linhas.sort((a,b) => (a.emp.nome||'').localeCompare(b.emp.nome||''));
  const totalGeral = linhas.reduce((s,l)=>s+l.b.total,0);
  const totalVT    = linhas.reduce((s,l)=>s+l.b.vtValor,0);
  const totalVR    = linhas.reduce((s,l)=>s+l.b.vrValor,0);
  document.getElementById('benef-info').innerHTML =
    `${periodoLabel} &middot; <strong>${linhas.length}</strong> colaborador(es) &middot; ` +
    `VT/AM: <strong>${fmtMoney(totalVT)}</strong> &middot; VR: <strong>${fmtMoney(totalVR)}</strong> &middot; ` +
    `Total: <strong style="color:#0288D1">${fmtMoney(totalGeral)}</strong>`;
  const listEl = document.getElementById('benef-lista');
  if(!linhas.length){
    listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-check" style="color:#1B5E20"></i><p>Nenhum benefício a pagar neste período.</p></div>';
    return;
  }
  const fmtDate = iso => new Date(iso+'T12:00:00').toLocaleDateString('pt-BR');
  const periodoCol = (escopo === 'dia') ? fmtDate(ini) : `${fmtDate(ini)} → ${fmtDate(fim)}`;
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead style="background:#F5F7FB;position:sticky;top:0">
      <tr>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)">Matr.</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border)">Colaborador</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border)">Posto</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)">Período</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)">Dias</th>
        <th style="padding:6px 8px;text-align:right;border-bottom:1px solid var(--border)">VT/AM</th>
        <th style="padding:6px 8px;text-align:right;border-bottom:1px solid var(--border)">VR</th>
        <th style="padding:6px 8px;text-align:right;border-bottom:1px solid var(--border)">Total</th>
        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border)">Chave PIX</th>
        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--border)">Ações</th>
      </tr>
    </thead>
    <tbody>`;
  linhas.forEach(({emp, b}, idx) => {
    const posto = (State.postos||[]).find(p=>p.id===emp.posto)?.razaoSocial || '—';
    const bg = idx % 2 ? '#FAFBFC' : '#fff';
    const vtIcon = b.vtTipo === 'am' ? '<i class="fa-solid fa-motorcycle" style="color:#4fc3f7"></i>'
                                     : '<i class="fa-solid fa-bus" style="color:#4fc3f7"></i>';
    const matr = emp.registro ? String(emp.registro).padStart(4,'0') : '—';
    const pix  = emp.chavePix || '—';
    html += `<tr style="background:${bg};cursor:pointer" onclick="openBeneficioDetalhe('${emp.id}','${escopo}','${ini}','${fim}')">
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #EEF2F7;font-weight:700;color:var(--primary)">${matr}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF2F7"><strong style="color:var(--primary)">${emp.nome}</strong><br><small style="color:var(--text-muted)">${emp.setor||'—'}</small></td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF2F7;font-size:11px">${posto}</td>
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #EEF2F7;font-size:11px">${periodoCol}</td>
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #EEF2F7">${b.dias}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #EEF2F7">${vtIcon} ${b.vtValor>0?fmtMoney(b.vtValor):'—'}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #EEF2F7"><i class="fa-solid fa-utensils" style="color:#ff8a65"></i> ${b.vrValor>0?fmtMoney(b.vrValor):'—'}</td>
      <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #EEF2F7;font-weight:700;color:#0288D1">${fmtMoney(b.total)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #EEF2F7;font-size:11px;font-family:monospace;color:#00695C">${pix}</td>
      <td style="padding:6px 8px;text-align:center;border-bottom:1px solid #EEF2F7"><button class="btn-icon" onclick="event.stopPropagation();openBeneficioDetalhe('${emp.id}','${escopo}','${ini}','${fim}')" title="Ver planilha individual"><i class="fa-solid fa-clipboard-list" style="color:#0288D1"></i></button></td>
    </tr>`;
  });
  html += `</tbody>
    <tfoot style="background:#E8F5E9;font-weight:700">
      <tr>
        <td colspan="5" style="padding:10px;text-align:right">TOTAL GERAL</td>
        <td style="padding:10px;text-align:right">${fmtMoney(totalVT)}</td>
        <td style="padding:10px;text-align:right">${fmtMoney(totalVR)}</td>
        <td style="padding:10px;text-align:right;color:#1B5E20;font-size:14px">${fmtMoney(totalGeral)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>`;
  listEl.innerHTML = html;
}

// Estado do modal de detalhe (para os botões de export)
let _beneficioDetalheCtx = null;

function openBeneficioDetalhe(empId, escopo, dataIni, dataFim){
  const emp = State.employees.find(e=>e.id===empId);
  if(!emp){ toast('Colaborador não encontrado.','error'); return; }
  const b = _calcBeneficiosColab(emp, dataIni, dataFim, escopo);
  const posto = (State.postos||[]).find(p=>p.id===emp.posto)?.razaoSocial || '—';
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('pt-BR');
  const periodoLabel = (escopo === 'dia')
    ? `Hoje — ${fmt(dataIni)}`
    : `Semana — ${fmt(dataIni)} a ${fmt(dataFim)}`;
  document.getElementById('benef-det-nome').textContent = emp.nome;
  const matr = emp.registro ? String(emp.registro).padStart(4,'0') : '—';
  const pixDet = emp.chavePix || '—';
  document.getElementById('benef-det-info').innerHTML =
    `<strong>Matrícula:</strong> ${matr} &nbsp;|&nbsp; <strong>CPF:</strong> ${emp.cpf||'—'}<br>` +
    `<strong>Período:</strong> ${periodoLabel}<br>` +
    `<strong>Posto:</strong> ${posto} &nbsp;|&nbsp; <strong>Setor:</strong> ${emp.setor||'—'} &nbsp;|&nbsp; ` +
    `<strong>Escala:</strong> ${escalaLabel(emp.escala||'5x2A')}${emp.turnoNoturno?' (Noturno)':''}<br>` +
    `<strong>Dias trabalhados no período:</strong> ${b.dias}` +
    `${b.semanas>0?` &nbsp;|&nbsp; <strong>Semanas:</strong> ${b.semanas}`:''}<br>` +
    `<strong style="color:#00695C"><i class="fa-brands fa-pix"></i> Chave PIX:</strong> <span style="font-family:monospace">${pixDet}</span>`;
  const tbody = document.getElementById('benef-det-tbody');
  const linhas = [];
  // VT/AM
  if(b.vtTipo !== 'nao' && emp.valorDiarioVt){
    const isPeriodo = (escopo==='dia' && b.vtFreq==='diario') ||
                      (escopo==='semana' && b.vtFreq==='semanal');
    const isWeekDailySum = (escopo==='semana' && b.vtFreq==='diario');
    let mult = 1, multLabel = '×1 dia';
    if(escopo === 'dia' && b.vtFreq === 'diario'){ mult = b.dias>0?1:0; multLabel = `${b.dias>0?'×1 dia':'(não trab.)'}`; }
    else if(escopo === 'semana' && b.vtFreq === 'semanal'){ mult = b.semanas; multLabel = `×${b.semanas} sem.`; }
    else if(escopo === 'semana' && b.vtFreq === 'diario'){ mult = b.dias; multLabel = `×${b.dias} dias`; }
    else if(escopo === 'dia' && b.vtFreq === 'semanal'){ mult = 0; multLabel = '(pago semanal)'; }
    const ben = (b.vtTipo === 'am') ? 'AM — Auxílio Mobilidade' : 'VT — Vale Transporte';
    const freqLabel = (b.vtFreq === 'semanal') ? 'Semanal' : 'Diária';
    linhas.push({ rotulo: ben, freq: freqLabel, base: emp.valorDiarioVt||0, mult, multLabel, valor: b.vtValor, campoId: 'edit-vt' });
  }
  // VR
  if(emp.valorDiarioVr){
    let mult = 1, multLabel = '×1 dia';
    if(escopo === 'dia' && b.vrFreq === 'diario'){ mult = b.dias>0?1:0; multLabel = `${b.dias>0?'×1 dia':'(não trab.)'}`; }
    else if(escopo === 'semana' && b.vrFreq === 'semanal'){ mult = b.semanas; multLabel = `×${b.semanas} sem.`; }
    else if(escopo === 'semana' && b.vrFreq === 'diario'){ mult = b.dias; multLabel = `×${b.dias} dias`; }
    else if(escopo === 'dia' && b.vrFreq === 'semanal'){ mult = 0; multLabel = '(pago semanal)'; }
    const freqLabel = (b.vrFreq === 'semanal') ? 'Semanal' : 'Diária';
    linhas.push({ rotulo: 'VR — Vale Refeição', freq: freqLabel, base: emp.valorDiarioVr||0, mult, multLabel, valor: b.vrValor, campoId: 'edit-vr' });
  }
  if(!linhas.length){
    tbody.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--text-muted)">Nenhum benefício cadastrado para este período.</td></tr>';
  } else {
    tbody.innerHTML = linhas.map(l => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF2F7;font-weight:600">${l.rotulo}</td>
      <td style="padding:8px 10px;text-align:center;border-bottom:1px solid #EEF2F7;font-size:11px">${l.freq}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #EEF2F7">${fmtMoney(l.base)}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #EEF2F7;font-size:11px;color:var(--text-muted)">${l.multLabel}</td>
      <td style="padding:4px;border-bottom:1px solid #EEF2F7;text-align:right">
        <input type="number" id="${l.campoId}" value="${l.valor.toFixed(2)}" step="0.01" min="0" onchange="recalcBeneficioDetalhe()" style="width:100px;text-align:right;font-weight:700">
      </td>
    </tr>`).join('');
  }
  setVal('benef-det-obs','');
  _beneficioDetalheCtx = { emp, b, escopo, dataIni, dataFim, posto, periodoLabel };
  recalcBeneficioDetalhe();
  document.getElementById('modal-beneficio-detalhe').classList.remove('hidden');
}

function recalcBeneficioDetalhe(){
  const vt = numVal('edit-vt');
  const vr = numVal('edit-vr');
  document.getElementById('benef-det-total').textContent = fmtMoney(vt + vr);
}

// ============================================
// BENEFÍCIOS A PAGAR — Exportação (Imprimir + PDF)
// ============================================
function exportBeneficiosLista(formato){
  const tab = _beneficioTabAtual || 'hoje';
  const hojeISO = new Date().toISOString().substring(0,10);
  let ini, fim, escopo, periodoLabel, periodoCol;
  const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('pt-BR');
  if(tab === 'hoje'){
    ini = fim = hojeISO;
    escopo = 'dia';
    periodoLabel = `Hoje — ${fmt(hojeISO)}`;
    periodoCol   = fmt(hojeISO);
  } else {
    const s = _semanaDe(hojeISO);
    ini = s.inicio; fim = s.fim;
    escopo = 'semana';
    periodoLabel = `Semana — ${fmt(s.inicio)} a ${fmt(s.fim)}`;
    periodoCol   = `${fmt(s.inicio)} → ${fmt(s.fim)}`;
  }
  const linhas = [];
  (State.employees||[])
    .filter(e => (e.status||'ativo') === 'ativo')
    .forEach(e => {
      const b = _calcBeneficiosColab(e, ini, fim, escopo);
      if(b.total > 0) linhas.push({ emp:e, b });
    });
  linhas.sort((a,b) => (a.emp.nome||'').localeCompare(b.emp.nome||''));
  if(!linhas.length){ toast('Nenhum benefício a exportar.','error'); return; }
  const totalVT = linhas.reduce((s,l)=>s+l.b.vtValor,0);
  const totalVR = linhas.reduce((s,l)=>s+l.b.vrValor,0);
  const total   = totalVT + totalVR;
  let rows = '';
  linhas.forEach(({emp, b}, idx) => {
    const posto = (State.postos||[]).find(p=>p.id===emp.posto)?.razaoSocial || '—';
    const benVT = b.vtTipo === 'am' ? 'AM' : 'VT';
    const matr = emp.registro ? String(emp.registro).padStart(4,'0') : '—';
    const pix  = emp.chavePix || '—';
    rows += `<tr style="background:${idx%2?'#F8FAFF':'#fff'}">
      <td style="text-align:center">${idx+1}</td>
      <td style="text-align:center;font-weight:700">${matr}</td>
      <td><strong>${emp.nome}</strong>${emp.setor?`<br><small style="color:#666">${emp.setor}</small>`:''}</td>
      <td style="font-size:11px">${posto}</td>
      <td style="text-align:center;font-size:11px">${periodoCol}</td>
      <td style="text-align:center">${b.dias}</td>
      <td style="text-align:right">${benVT} ${fmtMoney(b.vtValor)}</td>
      <td style="text-align:right">${fmtMoney(b.vrValor)}</td>
      <td style="text-align:right;font-weight:700">${fmtMoney(b.total)}</td>
      <td style="font-family:monospace;font-size:11px;color:#00695C">${pix}</td>
    </tr>`;
  });
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>Benefícios a Pagar — ${periodoLabel}</title>
<style>
  body{font-family:Arial,sans-serif;padding:16px;color:#212529;font-size:12px}
  h1{color:#0288D1;font-size:18px;margin-bottom:4px}
  .info{font-size:11px;color:#666;margin-bottom:14px}
  table{width:100%;border-collapse:collapse}
  th{background:#0288D1;color:#fff;padding:8px;text-align:left;font-size:11px}
  td{padding:6px 8px;border-bottom:1px solid #DEE2E6}
  tfoot td{background:#E1F5FE;font-weight:700;color:#01579B}
  .tot{font-size:14px;color:#01579B}
  @media print{ body{padding:8px} h1{font-size:14px} table{font-size:10px} }
</style></head>
<body>
<h1>${_e('nomeEmpresa')} — Planilha de Benefícios a Pagar</h1>
<p class="info"><strong>Período:</strong> ${periodoLabel} &middot; <strong>${linhas.length}</strong> colaborador(es) &middot; Gerado em ${new Date().toLocaleString('pt-BR')}</p>
<table>
  <thead><tr>
    <th style="text-align:center">#</th>
    <th style="text-align:center">Matr.</th>
    <th>Colaborador</th>
    <th>Posto</th>
    <th style="text-align:center">Período</th>
    <th style="text-align:center">Dias</th>
    <th style="text-align:right">VT/AM</th>
    <th style="text-align:right">VR</th>
    <th style="text-align:right">Total</th>
    <th>Chave PIX</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td colspan="6" style="text-align:right">TOTAIS</td>
      <td style="text-align:right">${fmtMoney(totalVT)}</td>
      <td style="text-align:right">${fmtMoney(totalVR)}</td>
      <td class="tot" style="text-align:right">${fmtMoney(total)}</td>
      <td></td>
    </tr>
  </tfoot>
</table>
<p style="margin-top:14px;font-size:11px;color:#555"><strong>Uso:</strong> esta planilha lista os colaboradores com benefícios a serem pagos manualmente (PIX, espécie ou cartão). Use a coluna "Chave PIX" para conferir o destinatário.</p>
<p style="margin-top:18px;font-size:10px;color:#888;text-align:center">${_e('nomeEmpresa')} — Sistema DRG-Kronos 3.0 &middot; ${linhas.length} colaborador(es)</p>
</body></html>`;
  _abrirJanelaExport(html, formato, `Beneficios_${tab}_${new Date().toISOString().substring(0,10)}`);
}

function exportBeneficioDetalhe(formato){
  if(!_beneficioDetalheCtx){ toast('Abra um colaborador primeiro.','error'); return; }
  const ctx = _beneficioDetalheCtx;
  const vt = numVal('edit-vt');
  const vr = numVal('edit-vr');
  const obs = val('benef-det-obs');
  const total = vt + vr;
  const emp = ctx.emp;
  let rows = '';
  if(emp.valorDiarioVt && ctx.b.vtTipo !== 'nao'){
    const nome = ctx.b.vtTipo==='am'?'AM — Auxílio Mobilidade':'VT — Vale Transporte';
    rows += `<tr><td><strong>${nome}</strong></td><td style="text-align:center">${ctx.b.vtFreq==='semanal'?'Semanal':'Diária'}</td><td style="text-align:right">${fmtMoney(emp.valorDiarioVt||0)}</td><td style="text-align:right;font-weight:700">${fmtMoney(vt)}</td></tr>`;
  }
  if(emp.valorDiarioVr){
    rows += `<tr><td><strong>VR — Vale Refeição</strong></td><td style="text-align:center">${ctx.b.vrFreq==='semanal'?'Semanal':'Diária'}</td><td style="text-align:right">${fmtMoney(emp.valorDiarioVr||0)}</td><td style="text-align:right;font-weight:700">${fmtMoney(vr)}</td></tr>`;
  }
  const matrPdf = emp.registro ? String(emp.registro).padStart(4,'0') : '—';
  const pixPdf  = emp.chavePix || '—';
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>Planilha de Benefícios — ${emp.nome}</title>
<style>
  body{font-family:Arial,sans-serif;padding:16px;color:#212529;font-size:13px}
  h1{color:#0288D1;font-size:18px;margin-bottom:4px}
  h2{color:#1a3a6b;font-size:14px;margin:14px 0 6px}
  .info{font-size:12px;color:#666;margin-bottom:14px;background:#F1F5FF;padding:10px;border-radius:6px}
  .info strong{color:#0D47A1}
  .pix-box{background:#E0F2F1;border-left:3px solid #00695C;padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th{background:#0288D1;color:#fff;padding:8px;text-align:left;font-size:12px}
  td{padding:8px;border-bottom:1px solid #DEE2E6}
  tfoot td{background:#E1F5FE;font-weight:700;color:#01579B;font-size:14px}
  .ass{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:36px;font-size:11px;color:#555}
  .ass-line{border-top:1px solid #444;padding-top:6px;text-align:center}
  @media print{ body{padding:8px} h1{font-size:14px} }
</style></head>
<body>
<h1>${_e('nomeEmpresa')} — Planilha de Benefícios</h1>
<p style="font-size:11px;color:#666;margin-bottom:8px">CNPJ: ${_e('cnpj')} &middot; ${_e('descricao')}</p>
<div class="info">
  <div><strong>Matrícula:</strong> ${matrPdf} &middot; <strong>Colaborador:</strong> ${emp.nome} &middot; <strong>CPF:</strong> ${emp.cpf||'—'}</div>
  <div><strong>Posto:</strong> ${ctx.posto} &middot; <strong>Setor:</strong> ${emp.setor||'—'}</div>
  <div><strong>Escala:</strong> ${escalaLabel(emp.escala||'5x2A')}${emp.turnoNoturno?' (Noturno)':''}</div>
  <div><strong>Período:</strong> ${ctx.periodoLabel}</div>
  <div><strong>Dias trabalhados no período:</strong> ${ctx.b.dias}${ctx.b.semanas>0?` &middot; <strong>Semanas:</strong> ${ctx.b.semanas}`:''}</div>
</div>
<div class="pix-box"><strong style="color:#00695C">💸 Chave PIX para pagamento:</strong> <span style="font-family:monospace;font-size:14px">${pixPdf}</span></div>
<h2>Demonstrativo</h2>
<table>
  <thead><tr><th>Benefício</th><th style="text-align:center">Frequência</th><th style="text-align:right">Valor Base</th><th style="text-align:right">Valor a Pagar</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3" style="text-align:right">TOTAL A PAGAR</td><td style="text-align:right">${fmtMoney(total)}</td></tr></tfoot>
</table>
${obs?`<div style="background:#FFF9E6;padding:10px;border-left:3px solid #F59E0B;font-size:12px;margin-bottom:14px"><strong>Observação:</strong> ${obs}</div>`:''}
<div class="ass">
  <div class="ass-line">${_e('nomeEmpresa')}<br>Empresa / Responsável</div>
  <div class="ass-line">${emp.nome}<br>Colaborador (recebimento)</div>
</div>
<p style="margin-top:36px;font-size:10px;color:#888;text-align:center">Gerado em ${new Date().toLocaleString('pt-BR')} &middot; Sistema DRG-Kronos 3.0</p>
</body></html>`;
  _abrirJanelaExport(html, formato, `Beneficio_${emp.nome.replace(/\s+/g,'_')}_${new Date().toISOString().substring(0,10)}`);
}

// Abre nova janela com HTML para imprimir/PDF, ou dispara download .xls
function _abrirJanelaExport(html, formato, baseName){
  if(formato === 'excel'){
    // Gera arquivo .xls (Excel abre HTML como planilha)
    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName||'export'}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Planilha .xls gerada!', 'success');
    return;
  }
  if(formato === 'pdf'){
    const win = window.open('','_blank','width=900,height=700');
    if(!win){ toast('Permita pop-ups para gerar o PDF.','error'); return; }
    win.document.write(html + '<scr'+'ipt>window.onload=function(){window.print();}<\/scr'+'ipt>');
    win.document.close();
    toast('Use "Salvar como PDF" na janela de impressão.', 'info');
    return;
  }
  // print
  const win = window.open('','_blank','width=900,height=700');
  if(!win){ toast('Permita pop-ups para imprimir.','error'); return; }
  win.document.write(html + '<scr'+'ipt>window.onload=function(){window.print();}<\/scr'+'ipt>');
  win.document.close();
}

// ============================================
// BENEFÍCIOS A PAGAR — helpers
// ============================================

// Verifica se o colaborador está escalado/trabalha em uma data específica
// Prioridade: Escala salva > Escala projetada > escala contratual (5x2/6x1/12x36)
function _colabTrabalhaNoDia(emp, dataISO){
  if(!emp) return false;
  const status = emp.status || 'ativo';
  if(status !== 'ativo') return false;
  const d = new Date(dataISO + 'T12:00:00');
  if(isNaN(d.getTime())) return false;
  const mes = d.getMonth()+1, ano = d.getFullYear(), dia = d.getDate();
  // 1) Escala salva?
  const esc = (State.escalas||[]).find(e => e.employeeId===emp.id && e.mes==mes && e.ano==ano);
  if(esc?.dias?.length){
    const sav = esc.dias.find(x => x.dia===dia);
    if(sav) return sav.tipo === 'trabalho' || sav.tipo === 'corrido';
  }
  // 2) Ponto manual / batido?
  const pay = (State.payrolls||[]).find(p => p.employeeId===emp.id && p.mes==mes && p.ano==ano);
  if(pay?.pontoManualDias?.length){
    const d2 = pay.pontoManualDias.find(x => x.dia===dia);
    if(d2 && d2.entrada && d2.saida) return true;
  }
  // 3) Fallback por escala contratual
  const fam = escalaFamilia(emp.escala || '5x2A');
  const ds = d.getDay();
  if(fam === '5x2') return ds >= 1 && ds <= 5;
  if(fam === '6x1') return ds !== 0;
  // 12x36: sem dados anteriores não temos como saber — retorna true como aproximação
  return true;
}

// Lista colaboradores que trabalham em uma data específica
function _colabsTrabalhandoEm(dataISO){
  return (State.employees||[])
    .filter(e => (e.status||'ativo') === 'ativo')
    .filter(e => _colabTrabalhaNoDia(e, dataISO));
}

// Conta dias trabalhados de um colaborador num intervalo (inclusive)
function _diasTrabalhadosNoIntervalo(emp, dataInicioISO, dataFimISO){
  if(!emp) return 0;
  const ini = new Date(dataInicioISO + 'T12:00:00');
  const fim = new Date(dataFimISO + 'T12:00:00');
  if(isNaN(ini.getTime()) || isNaN(fim.getTime())) return 0;
  let count = 0;
  const cur = new Date(ini);
  while(cur <= fim){
    if(_colabTrabalhaNoDia(emp, cur.toISOString().substring(0,10))) count++;
    cur.setDate(cur.getDate()+1);
  }
  return count;
}

// Retorna data ISO do início (segunda) e fim (domingo) da semana de uma data
function _semanaDe(dataISO){
  const d = new Date(dataISO + 'T12:00:00');
  const ds = d.getDay(); // 0 dom .. 6 sab
  // Considera semana segunda → domingo (padrão BR)
  const diffSeg = (ds === 0) ? -6 : (1 - ds);
  const seg = new Date(d); seg.setDate(d.getDate() + diffSeg);
  const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
  const fmt = x => x.toISOString().substring(0,10);
  return { inicio: fmt(seg), fim: fmt(dom) };
}

// Calcula benefícios de um colaborador para um período (dia ou semana)
// Retorna { vtNome, vtValor, vtFreqLabel, vrValor, vrFreqLabel, vaValor, total, dias }
function _calcBeneficiosColab(emp, dataInicioISO, dataFimISO, escopo){
  const empE = State.employees.find(e => e.id===emp.id) || emp;
  const dias = _diasTrabalhadosNoIntervalo(empE, dataInicioISO, dataFimISO);
  const sem  = _semanasTrabalhadas(dias, empE.escala);
  const out = {
    dias,
    semanas: sem,
    vtTipo: empE.tipoTransporte || 'vt',
    vtFreq: empE.vtFreq || 'diario',
    vrFreq: empE.vrFreq || 'diario',
    vtValor: 0, vrValor: 0, total: 0
  };
  // VT/AM
  if(out.vtTipo !== 'nao' && empE.valorDiarioVt){
    if(escopo === 'dia'){
      // No escopo "dia", só conta benefício diário (semanal será mostrado em "semana")
      if(out.vtFreq === 'diario'){
        out.vtValor = (dias > 0) ? (empE.valorDiarioVt || 0) : 0;
      }
    } else if(escopo === 'semana'){
      if(out.vtFreq === 'semanal'){
        out.vtValor = (sem > 0) ? (empE.valorDiarioVt || 0) * sem : 0;
      } else {
        // Diário no escopo semana = soma dos dias trabalhados na semana
        out.vtValor = (empE.valorDiarioVt || 0) * dias;
      }
    }
  }
  // VR
  if(empE.valorDiarioVr){
    if(escopo === 'dia'){
      if(out.vrFreq === 'diario'){
        out.vrValor = (dias > 0) ? (empE.valorDiarioVr || 0) : 0;
      }
    } else if(escopo === 'semana'){
      if(out.vrFreq === 'semanal'){
        out.vrValor = (sem > 0) ? (empE.valorDiarioVr || 0) * sem : 0;
      } else {
        out.vrValor = (empE.valorDiarioVr || 0) * dias;
      }
    }
  }
  out.total = out.vtValor + out.vrValor;
  return out;
}

// ============================================================
// ENCARGOS LEGAIS — INSS / IRRF / FGTS (tabelas 2026)
// ============================================================
function calcINSS(bruto){
  // Tabela progressiva INSS 2026 (até o teto de R$ 8.157,41)
  const cap=Math.min(bruto,8157.41);
  const faixas=[
    {lim:1518.00, aliq:0.075},
    {lim:2793.88, aliq:0.09},
    {lim:4190.83, aliq:0.12},
    {lim:8157.41, aliq:0.14},
  ];
  let inss=0, ant=0;
  for(const f of faixas){
    if(cap<=ant) break;
    inss+=(Math.min(cap,f.lim)-ant)*f.aliq;
    ant=f.lim;
  }
  return Math.round(inss*100)/100;
}

function calcFGTS(bruto){
  // 8% sobre o salário bruto — custo do empregador
  return Math.round(bruto*0.08*100)/100;
}

function calcIRRF(bruto, dependentes, pensao, planoSaude, inss){
  // Base IRRF = bruto - INSS - deduções por dependente (R$ 189,59) - pensão alimentícia
  const dedDep=(dependentes||0)*189.59;
  const base=Math.max(0, bruto-(inss||0)-dedDep-(pensao||0));
  // Tabela progressiva IRRF 2026
  if(base<=2259.20) return 0;
  if(base<=2826.65) return Math.max(0, Math.round((base*0.075-169.44)*100)/100);
  if(base<=3751.05) return Math.max(0, Math.round((base*0.15 -381.44)*100)/100);
  if(base<=4664.68) return Math.max(0, Math.round((base*0.225-662.77)*100)/100);
  return Math.max(0, Math.round((base*0.275-896.00)*100)/100);
}

function recalculate(){
  const dias=numVal('payroll-dias');
  const faltasJust=numVal('payroll-faltas-justificadas');
  const faltasInjust=numVal('payroll-faltas-injustificadas');
  const totalFaltas=faltasJust+faltasInjust;
  setVal('payroll-faltas', totalFaltas);

  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const salBase=emp?(emp.salarioBase||0):numVal('payroll-remuneracao');

  // --- Descontos CLT ---
  const valorDia   = salBase/30;          // CLT: divisor 30 para faltas
  const valorHora  = salBase/220;         // CLT: divisor 220 para horas
  const valorMinuto= valorHora/60;

  // Desconto por falta injustificada: valor do dia + DSR (= 2x valor do dia)
  const descontoFaltasInj = faltasInjust * valorDia * 2;
  // Desconto por falta justificada: só o dia trabalhado (sem DSR)
  const descontoFaltasJust = faltasJust * valorDia;

  // Atrasos em minutos (campo opcional)
  const minutosAtraso = numVal('payroll-atraso-min')||0;
  // Tolerância CLT: até 10 min/dia total — se ultrapassar, desconta tudo
  const descontoAtraso = minutosAtraso>0 ? minutosAtraso*valorMinuto : 0;
  setVal('payroll-desconto-atraso', descontoAtraso>0 ? descontoAtraso.toFixed(2) : '0.00');

  // Remuneração líquida base = salário - descontos de faltas - descontos de atraso
  const remuneracaoBase = Math.max(0, salBase - descontoFaltasInj - descontoFaltasJust - descontoAtraso);

  // Sempre preencher remuneração com o cálculo automático
  if(salBase>0){
    setVal('payroll-remuneracao', remuneracaoBase.toFixed(2));
  }
  const remuneracao = remuneracaoBase; // usar valor recém-calculado diretamente

  // --- VT e VR (respeita frequência diária ou semanal definida no cadastro) ---
  const vtFreqCalc = emp?.vtFreq || 'diario';
  const vrFreqCalc = emp?.vrFreq || 'diario';
  const semCalc    = _semanasTrabalhadas(dias, emp?.escala);
  const vtMult = (vtFreqCalc === 'semanal') ? semCalc : dias;
  const vrMult = (vrFreqCalc === 'semanal') ? semCalc : dias;
  setVal('payroll-vt-total',(numVal('payroll-vt-dia')*vtMult).toFixed(2));
  setVal('payroll-vr-total',(numVal('payroll-vr-dia')*vrMult).toFixed(2));

  // --- Bonificação de Boa Permanência ---
  // Regra padrão: qualquer falta zera o benefício
  // Exceção: se o colaborador tem flag "bonificacaoSemprePagar", paga mesmo com falta
  const bonusCard=document.getElementById('bonus-card');
  const bonusInput=document.getElementById('payroll-bonus');
  const bonusAlert=document.getElementById('bonus-alert');
  const bonusAlertMsg=document.getElementById('bonus-alert-msg');
  const sempreP=!!(emp&&emp.bonificacaoSemprePagar);
  if(totalFaltas>0 && !sempreP){
    // Caso 1: tem falta E flag desligada -> bloqueia
    bonusCard.classList.add('locked'); bonusInput.disabled=true;
    setVal('payroll-bonus',''); bonusAlert.classList.remove('hidden');
    if(bonusAlertMsg) bonusAlertMsg.textContent='Colaborador possui faltas — bonificação não aplicável (qualquer falta elimina o benefício). Para alterar essa regra, ative a opção "Pagar bonificação mesmo com faltas" no cadastro do colaborador.';
  } else {
    bonusCard.classList.remove('locked'); bonusInput.disabled=false;
    if(totalFaltas>0 && sempreP){
      // Caso 2: tem falta MAS flag ligada -> permite e avisa
      bonusAlert.classList.remove('hidden');
      if(bonusAlertMsg) bonusAlertMsg.innerHTML='<strong>Bonificação liberada por configuração</strong> — colaborador marcado para receber bonificação mesmo com faltas. Edite o valor abaixo.';
    } else {
      // Caso 3: sem falta -> liberado normalmente
      bonusAlert.classList.add('hidden');
    }
    // Auto-preenche da CCT se o campo está vazio
    if(!val('payroll-bonus') && State.cct && State.cct.bonificacao>0){
      setVal('payroll-bonus', State.cct.bonificacao.toFixed(2));
    }
  }

  // --- VA proporcional / integral (CCT: perde se >3 faltas injustificadas) ---
  const vaNote=document.getElementById('va-note');
  if(emp&&(emp.valorMensalVa||0)>0){
    const vaMensal=emp.valorMensalVa||0;
    if(faltasInjust<=3){
      setVal('payroll-va-total',vaMensal.toFixed(2));
      setVal('payroll-va-liquido',vaMensal.toFixed(2));
      if(vaNote){ vaNote.classList.remove('hidden'); vaNote.innerHTML=`<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> VA integral — faltas injustificadas (${faltasInjust}) ≤ 3`; }
    } else {
      const mes=parseInt(val('payroll-mes')||currentMes()), ano=parseInt(val('payroll-ano')||currentAno());
      const diasEscala=calcDiasEscala(mes, ano, emp.escala||'5x2A');
      const vaProp=diasEscala>0?(dias/diasEscala)*vaMensal:0;
      setVal('payroll-va-total',vaProp.toFixed(2));
      setVal('payroll-va-liquido',vaProp.toFixed(2));
      if(vaNote){ vaNote.classList.remove('hidden'); vaNote.innerHTML=`<i class="fa-solid fa-triangle-exclamation" style="color:#E65100"></i> VA proporcional — ${faltasInjust} faltas injustificadas > 3 (${dias}d / ${diasEscala}d escala = ${fmtMoney(vaProp)})`; }
    }
  } else {
    if(vaNote) vaNote.classList.add('hidden');
  }

  // --- Adicional Noturno (20% sobre hora, hora noturna = 52min30s) ---
  if(emp){
    const escala=emp.escala||'5x2A';
    const noturno=emp.turnoNoturno&&escalaFamilia(escala)==='12x36';
    const noturnoCard=document.getElementById('noturno-card');
    if(noturnoCard) noturnoCard.classList.toggle('hidden',!noturno);
    if(noturno&&emp.salarioBase&&dias>0){
      // Hora noturna reduzida = 52min30s = 52.5min. Em 12h, horas noturnas variam.
      // Cálculo padrão: (salário/220) * 20% * 7h noturnas médias * dias plantão
      const adN=calcAdNoturno(emp.salarioBase,dias);
      setVal('payroll-noturno',adN.toFixed(2));
    }
  }

  // --- Acúmulo de Função (+20% sobre salário base) ---
  const acumuloCard=document.getElementById('acumulo-card');
  if(emp&&emp.acumuloFuncao&&salBase>0){
    if(acumuloCard) acumuloCard.classList.remove('hidden');
    const acumuloVal=salBase*0.20;
    setVal('payroll-acumulo',acumuloVal.toFixed(2));
  } else {
    if(acumuloCard) acumuloCard.classList.add('hidden');
    setVal('payroll-acumulo','');
  }

  // --- Insalubridade (20% / 40% / 60% sobre salário mínimo nacional) ---
  const insalubCard=document.getElementById('insalubridade-card');
  const insalubGrau=document.getElementById('insalubridade-grau');
  const insalubPerc=emp?(emp.insalubridade||0):0;
  if(insalubPerc>0){
    if(insalubCard) insalubCard.classList.remove('hidden');
    const salMin=(State.cct&&State.cct.salarioMinimo)||1518;
    const insalubVal=salMin*(insalubPerc/100);
    setVal('payroll-insalubridade',insalubVal.toFixed(2));
    if(insalubGrau){
      const grauLabel=insalubPerc===20?'(Mínimo 20%)':insalubPerc===40?'(Médio 40%)':'(Máximo 60%)';
      insalubGrau.textContent=grauLabel;
    }
  } else {
    if(insalubCard) insalubCard.classList.add('hidden');
    setVal('payroll-insalubridade','');
    if(insalubGrau) insalubGrau.textContent='';
  }

  // --- Jornada & Horas Extras ---
  const tEntrada  = timeToMinutes(val('payroll-entrada'));
  const tSaida    = timeToMinutes(val('payroll-saida'));
  const tIntIni   = timeToMinutes(val('payroll-intervalo-inicio'));
  const tIntFim   = timeToMinutes(val('payroll-intervalo-fim'));

  if(tEntrada!==null && tSaida!==null){
    // Jornada bruta (suporta virada de meia-noite)
    let minBrutos = tSaida - tEntrada;
    if(minBrutos <= 0) minBrutos += 24*60;
    // Intervalo intrajornada
    const minIntervalo = (tIntIni!==null && tIntFim!==null)
      ? Math.max(0, tIntFim - tIntIni) : 0;
    // Jornada líquida real
    const minLiquidos = Math.max(0, minBrutos - minIntervalo);

    // Jornada contratada (baseada no cadastro do colaborador)
    let minContratados = 480; // padrão: 8h
    if(emp && emp.horarioEntrada && emp.horarioSaida){
      const tEContr = timeToMinutes(emp.horarioEntrada);
      const tSContr = timeToMinutes(emp.horarioSaida);
      if(tEContr!==null && tSContr!==null){
        let minBrutosContr = tSContr - tEContr;
        if(minBrutosContr <= 0) minBrutosContr += 24*60;
        minContratados = Math.max(0, minBrutosContr - minIntervalo);
      }
    } else if(emp){
      const fam = escalaFamilia(emp.escala||'5x2A');
      if(fam==='6x1')   minContratados=440;  // 7h20min
      else if(fam==='12x36') minContratados=660; // 11h (12h - 1h intervalo)
    }

    const minExtrasDia = Math.max(0, minLiquidos - minContratados);
    const hExtrasDia   = minExtrasDia / 60;
    const hExtrasMes   = hExtrasDia * dias;

    setVal('payroll-horas-liquidas',  minutesToStr(minLiquidos));
    setVal('payroll-horas-extras-dia', minExtrasDia>0 ? minutesToStr(minExtrasDia) : '—');

    // Auto-preencher total de horas extras (editável pelo usuário)
    if(hExtrasMes > 0 || numVal('payroll-he-total')===0){
      setVal('payroll-he-total', hExtrasMes>0 ? hExtrasMes.toFixed(2) : '');
    }
  } else {
    setVal('payroll-horas-liquidas','—');
    setVal('payroll-horas-extras-dia','—');
  }

  // Valor das horas extras
  const hETotalInformado = numVal('payroll-he-total')||0;
  const percHE = parseInt(val('payroll-he-perc')||'50');
  const valorHE = hETotalInformado>0 && salBase>0
    ? hETotalInformado * (salBase/220) * (1 + percHE/100) : 0;
  setVal('payroll-he-valor', valorHE>0 ? valorHE.toFixed(2) : '0.00');

  // --- HE Corrido (calculado a partir da Escala) ---
  // Para cada dia com tipo='corrido' na escala do colaborador no mês,
  // soma minutos de refeição que viraram extra, multiplica por valor-hora e adicional do dia
  const heCorridoBlock = document.getElementById('he-corrido-block');
  let heCorridoMin = 0, heCorridoValor = 0;
  let heCorridoDetalhe = '';
  if(emp){
    const empMes = parseInt(val('payroll-mes'));
    const empAno = parseInt(val('payroll-ano'));
    const escalaDoMes = (State.escalas||[]).find(e =>
      e.employeeId===emp.id && e.mes==empMes && e.ano==empAno);
    if(escalaDoMes && Array.isArray(escalaDoMes.dias)){
      // Duração da refeição (em min) baseada no cadastro do colaborador
      let refMin = 60;
      if(emp.horarioRefIni && emp.horarioRefFim){
        let dm = timeToMinutes(emp.horarioRefFim) - timeToMinutes(emp.horarioRefIni);
        if(dm < 0) dm += 24*60;
        if(dm > 0 && dm <= 4*60) refMin = dm;
      }
      const buckets = {}; // {perc: minutos}
      escalaDoMes.dias.forEach(d => {
        if(d.tipo === 'corrido'){
          const p = parseInt(d.hePercDia)||50;
          buckets[p] = (buckets[p]||0) + refMin;
        }
      });
      Object.entries(buckets).forEach(([perc, minutos]) => {
        heCorridoMin += minutos;
        if(salBase > 0){
          heCorridoValor += (minutos/60) * (salBase/220) * (1 + parseInt(perc)/100);
        }
      });
      heCorridoDetalhe = Object.entries(buckets)
        .map(([perc, minutos]) => `${minutesToStr(minutos)} a +${perc}%`)
        .join(' · ') || '—';
    }
  }
  setVal('payroll-he-corrido-min',     heCorridoMin > 0 ? heCorridoMin : '');
  setVal('payroll-he-corrido-detalhe', heCorridoDetalhe);
  setVal('payroll-he-corrido-valor',   heCorridoValor > 0 ? heCorridoValor.toFixed(2) : '0.00');
  if(heCorridoBlock){
    heCorridoBlock.style.display = (heCorridoMin > 0) ? '' : 'none';
  }

  // --- Adiantamento quinzenal ---
  const ativoAdiant=val('payroll-adiantamento-ativo')==='sim';
  const percAdiant=parseInt(val('payroll-adiantamento-perc')||'40');
  if(ativoAdiant && remuneracao>0){
    setVal('payroll-adiantamento-valor',((remuneracao*(percAdiant/100))).toFixed(2));
  } else {
    setVal('payroll-adiantamento-valor','0.00');
  }

  // --- Encargos Legais (INSS / IRRF / FGTS) ---
  const encargosCard=document.getElementById('encargos-legais-card');
  if(emp){
    if(encargosCard) encargosCard.classList.remove('hidden');
    const heValEnc   = numVal('payroll-he-valor')||0;
    const noturnoEnc = numVal('payroll-noturno')||0;
    const acumuloEnc = numVal('payroll-acumulo')||0;
    const insalubEnc = numVal('payroll-insalubridade')||0;
    const bonusEnc   = numVal('payroll-bonus')||0;
    const outProv=(emp.outrosProventos||[]).reduce((s,i)=>s+(parseFloat(i.valor)||0),0);
    const outDesc=(emp.outrosDescontos||[]).reduce((s,i)=>s+(parseFloat(i.valor)||0),0);
    const totalBruto=remuneracao+heValEnc+heCorridoValor+noturnoEnc+acumuloEnc+insalubEnc+bonusEnc+outProv;
    const pensaoEnc  =emp.pensaoAlimenticia||0;
    const planoEnc   =emp.planoSaude||0;
    const inss=calcINSS(totalBruto);
    const fgts=calcFGTS(totalBruto);
    const irrf=calcIRRF(totalBruto,emp.dependentesIRRF||0,pensaoEnc,planoEnc,inss);
    const vtEnc   =numVal('payroll-vt-total')||0;
    const vrEnc   =numVal('payroll-vr-total')||0;
    const vaEnc   =numVal('payroll-va-liquido')||0;
    const adiantEnc=ativoAdiant?numVal('payroll-adiantamento-valor')||0:0;
    const atrasoEnc=numVal('payroll-desconto-atraso')||0;
    const totalLiqFinal=Math.max(0,totalBruto-inss-irrf-pensaoEnc-planoEnc-outDesc-adiantEnc-atrasoEnc+vtEnc+vrEnc+vaEnc);
    setVal('payroll-total-bruto',       totalBruto.toFixed(2));
    setVal('payroll-outros-proventos',  outProv.toFixed(2));
    setVal('payroll-outros-descontos',  outDesc.toFixed(2));
    setVal('payroll-inss',              inss.toFixed(2));
    setVal('payroll-irrf',              irrf.toFixed(2));
    setVal('payroll-fgts',              fgts.toFixed(2));
    setVal('payroll-plano-saude-desc',  planoEnc.toFixed(2));
    setVal('payroll-pensao',            pensaoEnc.toFixed(2));
    setVal('payroll-total-liquido-final',totalLiqFinal.toFixed(2));
  } else {
    if(encargosCard) encargosCard.classList.add('hidden');
  }
}

function renderPayrollHistory(empId){
  const histEl=document.getElementById('payroll-history');
  if(!empId){ histEl.innerHTML=`<div class="empty-state small"><i class="fa-solid fa-user-clock"></i><p>Selecione um colaborador</p></div>`; return; }
  const records=State.payrolls.filter(p=>p.employeeId===empId).sort((a,b)=>b.ano-a.ano||b.mes-a.mes);
  if(records.length===0){ histEl.innerHTML=`<div class="empty-state small"><i class="fa-solid fa-folder-open"></i><p>Sem lançamentos anteriores</p></div>`; return; }
  histEl.innerHTML=records.map(p=>{
    const totalFaltas='faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0);
    return `<div class="history-item" onclick="loadPayrollRecord('${p.id}')">
      <div class="history-period">${MESES[p.mes].substr(0,3)}/${p.ano}</div>
      <div class="history-info">
        <div class="h-name">${p.diasTrabalhados} dias / ${totalFaltas} falta(s)</div>
        <div class="h-sub">Remun.: ${fmtMoney(p.remuneracao)}</div>
      </div>
      <div class="history-actions">
        <button class="btn-icon btn-danger-icon" onclick="confirmDeletePayroll(event,'${p.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function loadPayrollRecord(id){
  const p=State.payrolls.find(r=>r.id===id); if(!p) return;
  setVal('payroll-employee',p.employeeId); setVal('payroll-mes',p.mes); setVal('payroll-ano',p.ano);
  // Período De/Até — restaura se salvo, caso contrário auto-preenche
  if(p.periodoDe) setVal('payroll-periodo-de',p.periodoDe);
  if(p.periodoAte) setVal('payroll-periodo-ate',p.periodoAte);
  if(!p.periodoDe||!p.periodoAte) _autoFillPeriodoDates(p.mes,p.ano);
  setVal('payroll-dias',p.diasTrabalhados);
  // Suporte a registros antigos (campo faltas único) e novos (divididos)
  setVal('payroll-faltas-justificadas',p.faltasJustificadas||0);
  setVal('payroll-faltas-injustificadas',p.faltasInjustificadas||(p.faltas||0));
  setVal('payroll-remuneracao',p.remuneracao); setVal('payroll-vt-dia',p.vtDia||'');
  setVal('payroll-vt-total',p.valeTransporte); setVal('payroll-vr-dia',p.vrDia||'');
  setVal('payroll-vr-total',p.valeRefeicao); setVal('payroll-va-total',p.valeAlimentacaoTotal||'');
  setVal('payroll-va-liquido',p.valeAlimentacaoLiquido||''); setVal('payroll-bonus',p.bonificacao||'');
  setVal('payroll-noturno',p.adNoturno||'');
  setVal('payroll-acumulo',p.acumuloFuncao||'');
  setVal('payroll-insalubridade',p.insalubridade||'');
  setVal('payroll-atraso-min',p.minutosAtraso||'');
  setVal('payroll-desconto-atraso',p.descontoAtraso||'');
  setVal('payroll-adiantamento-ativo',p.adiantamentoAtivo?'sim':'nao');
  setVal('payroll-adiantamento-perc',p.adiantamentoPerc||40);
  setVal('payroll-adiantamento-valor',p.adiantamentoValor||'');
  // Jornada & Horas Extras
  setVal('payroll-entrada',       p.horarioEntrada||'');
  setVal('payroll-saida',         p.horarioSaida||'');
  setVal('payroll-intervalo-inicio', p.intervaloInicio||'');
  setVal('payroll-intervalo-fim',    p.intervaloFim||'');
  setVal('payroll-he-total',  p.horasExtrasTotal||'');
  setVal('payroll-he-perc',   p.horasExtrasPerc||50);
  setVal('payroll-he-valor',  p.horasExtrasValor||'');
  setVal('payroll-he-corrido-min',     p.heCorridoMin||'');
  setVal('payroll-he-corrido-detalhe', p.heCorridoDetalhe||'');
  setVal('payroll-he-corrido-valor',   p.heCorridoValor||'');
  const emp=State.employees.find(e=>e.id===p.employeeId);
  if(emp) setVal('payroll-pix',emp.chavePix||'');
  onPayrollEmployeeChange();
}

function confirmDeletePayroll(event,id){
  event.stopPropagation();
  const p=State.payrolls.find(r=>r.id===id); if(!p) return;
  document.getElementById('confirm-message').textContent=`Excluir lançamento de ${MESES[p.mes]}/${p.ano}?`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    await DB.remove('payrolls',id);
    const empNome=(State.employees.find(e=>e.id===p.employeeId)||{}).nome||'—';
    Auth.log('PAYROLL_DELETED', null, `${empNome} — ${MESES[p.mes]}/${p.ano}`);
    closeModal('modal-confirm'); renderPayrollHistory(val('payroll-employee'));
    toast('Lançamento excluído.','warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

async function savePayroll(){
  const empId=val('payroll-employee'), mes=val('payroll-mes'), ano=val('payroll-ano');
  if(!empId){ toast('Selecione um colaborador.','error'); return; }
  if(!mes||!ano){ toast('Informe mês e ano.','error'); return; }
  // Bloquear se a folha estiver fechada
  const existingCheck=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  if(existingCheck?.status==='fechada'){
    toast('Esta folha está fechada. Clique em "Reabrir esta Folha" para editar.','error'); return;
  }
  const dias=numVal('payroll-dias');
  const faltasJust=numVal('payroll-faltas-justificadas');
  const faltasInjust=numVal('payroll-faltas-injustificadas');
  const totalFaltas=faltasJust+faltasInjust;
  const vtDia=numVal('payroll-vt-dia'), vrDia=numVal('payroll-vr-dia');
  const existing=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  // Frequência: lê do cadastro do colaborador
  const empSel = State.employees.find(e=>e.id===empId);
  const vtFreq = empSel?.vtFreq || 'diario';
  const vrFreq = empSel?.vrFreq || 'diario';
  const semanas = _semanasTrabalhadas(dias, empSel?.escala);
  const valeTransporteTotal = (vtFreq === 'semanal') ? vtDia*semanas : vtDia*dias;
  const valeRefeicaoTotal   = (vrFreq === 'semanal') ? vrDia*semanas : vrDia*dias;
  const record={
    id:existing?existing.id:genId(), employeeId:empId,
    mes:parseInt(mes), ano:parseInt(ano),
    diasTrabalhados:dias,
    faltas:totalFaltas,
    faltasJustificadas:faltasJust,
    faltasInjustificadas:faltasInjust,
    remuneracao:numVal('payroll-remuneracao'),
    vtDia, vtFreq, semanasTrabalhadas:semanas, valeTransporte:valeTransporteTotal,
    vrDia, vrFreq, valeRefeicao:valeRefeicaoTotal,
    valeAlimentacaoTotal:numVal('payroll-va-total'),
    valeAlimentacaoLiquido:numVal('payroll-va-liquido'),
    // Bonificação: zera só se houver falta E o colaborador NÃO tem flag de "sempre pagar"
    bonificacao:(function(){
      const empRec=State.employees.find(e=>e.id===empId);
      const sempreP=!!(empRec&&empRec.bonificacaoSemprePagar);
      if(totalFaltas>0 && !sempreP) return 0;
      return numVal('payroll-bonus')||0;
    })(),
    adNoturno:numVal('payroll-noturno'),
    acumuloFuncao:numVal('payroll-acumulo')||0,
    insalubridade:numVal('payroll-insalubridade')||0,
    minutosAtraso:numVal('payroll-atraso-min')||0,
    descontoAtraso:numVal('payroll-desconto-atraso')||0,
    adiantamentoAtivo:val('payroll-adiantamento-ativo')==='sim',
    adiantamentoPerc:parseInt(val('payroll-adiantamento-perc')||'40'),
    adiantamentoValor:val('payroll-adiantamento-ativo')==='sim'?numVal('payroll-adiantamento-valor'):0,
    // Jornada & Horas Extras
    horarioEntrada:val('payroll-entrada')||'',
    horarioSaida:val('payroll-saida')||'',
    intervaloInicio:val('payroll-intervalo-inicio')||'',
    intervaloFim:val('payroll-intervalo-fim')||'',
    horasLiquidasDia:val('payroll-horas-liquidas')||'',
    horasExtrasDia:val('payroll-horas-extras-dia')||'',
    horasExtrasTotal:numVal('payroll-he-total')||0,
    horasExtrasPerc:parseInt(val('payroll-he-perc')||'50'),
    horasExtrasValor:numVal('payroll-he-valor')||0,
    // HE Corrido (vinda da Escala — somatório de minutos por % de adicional)
    heCorridoMin:    numVal('payroll-he-corrido-min')||0,
    heCorridoDetalhe:val('payroll-he-corrido-detalhe')||'',
    heCorridoValor:  numVal('payroll-he-corrido-valor')||0,
    pdfName:State.currentPdfFile?State.currentPdfFile.name:(existing?existing.pdfName:''),
    // Encargos Legais
    totalBruto:          numVal('payroll-total-bruto')||0,
    outrosProventosTotal:numVal('payroll-outros-proventos')||0,
    outrosDescontosTotal:numVal('payroll-outros-descontos')||0,
    inss:                numVal('payroll-inss')||0,
    irrf:                numVal('payroll-irrf')||0,
    fgts:                numVal('payroll-fgts')||0,
    planoSaudeDesc:      numVal('payroll-plano-saude-desc')||0,
    pensaoAlimenticiaDesc:numVal('payroll-pensao')||0,
    totalLiquidoFinal:   numVal('payroll-total-liquido-final')||0,
    // Preserva os pontos do app — savePayroll nunca deve apagar pontoManualDias
    // Sanitiza: Firestore rejeita undefined; converte para null ou remove
    pontoManualDias: _sanitizeForFirestore(existing?.pontoManualDias || []),
    // Período e status
    periodoDe: val('payroll-periodo-de')||'',
    periodoAte: val('payroll-periodo-ate')||'',
    status: existing?.status||'aberta',
    updatedAt:new Date().toISOString(),
    createdAt:existing?existing.createdAt:new Date().toISOString()
  };
  const btn=document.querySelector('#section-payroll .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    // Sanitiza o record inteiro contra `undefined` (Firestore rejeita)
    const cleanRecord = _sanitizeForFirestore(record);
    await DB.save('payrolls', cleanRecord);
    const empNome=(State.employees.find(e=>e.id===empId)||{}).nome||'—';
    Auth.log(existing?'PAYROLL_UPDATED':'PAYROLL_CREATED', null, `${empNome} — ${MESES[parseInt(mes)]}/${ano}`);
    toast(existing?'Lançamento atualizado!':'Lançamento salvo!');
    clearPdf(null,true);
  } catch(e){
    console.error('savePayroll erro:', e, 'record:', record);
    toast('Erro ao salvar: ' + (e?.message || e), 'error');
  }
  finally { setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar Lançamento'); }
}

function clearPayrollForm(){
  ['payroll-dias','payroll-faltas','payroll-faltas-justificadas','payroll-faltas-injustificadas',
   'payroll-remuneracao','payroll-vt-dia','payroll-vt-total',
   'payroll-vr-dia','payroll-vr-total','payroll-va-total','payroll-va-liquido',
   'payroll-bonus','payroll-noturno','payroll-adiantamento-valor',
   'payroll-atraso-min','payroll-desconto-atraso',
   'payroll-entrada','payroll-saida','payroll-intervalo-inicio','payroll-intervalo-fim',
   'payroll-horas-liquidas','payroll-horas-extras-dia','payroll-he-total','payroll-he-valor',
   'payroll-he-corrido-min','payroll-he-corrido-detalhe','payroll-he-corrido-valor']
    .forEach(id=>setVal(id,''));
  setVal('payroll-adiantamento-ativo','nao');
  setVal('payroll-adiantamento-perc','40');
  setVal('payroll-he-perc','50');
  clearPdf(null,true); recalculate();
}

function openPayrollForEmployee(empId){
  showSection('payroll');
  setTimeout(()=>{ setVal('payroll-employee',empId); onPayrollEmployeeChange(); },80);
}

// ============================================
// FECHAMENTO DE PERÍODO
// ============================================
function _periodoKey(mes,ano){ return `${ano}_${mes}`; }

function _autoFillPeriodoDates(mes,ano){
  mes=parseInt(mes); ano=parseInt(ano);
  if(!mes||!ano) return;
  const pad=n=>String(n).padStart(2,'0');
  const ultimoDia=new Date(ano,mes,0).getDate();
  const de=`${ano}-${pad(mes)}-01`;
  const ate=`${ano}-${pad(mes)}-${pad(ultimoDia)}`;
  const deEl=document.getElementById('payroll-periodo-de');
  const ateEl=document.getElementById('payroll-periodo-ate');
  if(deEl&&!deEl.value) deEl.value=de;
  if(ateEl&&!ateEl.value) ateEl.value=ate;
  // Força preenchimento se campo estiver no mês anterior
  if(deEl&&deEl.value.substring(0,7)!==`${ano}-${pad(mes)}`) deEl.value=de;
  if(ateEl&&ateEl.value.substring(0,7)!==`${ano}-${pad(mes)}`) ateEl.value=ate;
}

function onPayrollPeriodoChange(){
  const mes=val('payroll-mes')||currentMes();
  const ano=val('payroll-ano')||currentAno();
  _autoFillPeriodoDates(mes,ano);
  _updatePainelFechamento(mes,ano);
  // Recarregar folha do colaborador selecionado para o novo período
  const empId=val('payroll-employee');
  if(empId) onPayrollEmployeeChange();
}

async function _updatePainelFechamento(mes,ano){
  mes=parseInt(mes||currentMes()); ano=parseInt(ano||currentAno());
  const key=_periodoKey(mes,ano);
  const label=document.getElementById('fechamento-periodo-label');
  const badge=document.getElementById('fechamento-status-badge');
  const btnFechar=document.getElementById('btn-fechar-periodo');
  const infoFechado=document.getElementById('fechamento-periodo-fechado-info');
  const dataInput=document.getElementById('fechamento-data-input');
  if(label) label.textContent=`${MESES[mes]} / ${ano}`;

  // Carregar config do Firestore
  let conf={};
  try{
    const snap=await DB.fs.collection('configuracoes').doc(`fechamento_${key}`).get();
    if(snap.exists) conf=snap.data();
  }catch(e){ console.warn('Conf fechamento não carregada:',e); }
  State.confFolha=State.confFolha||{};
  State.confFolha[key]=conf;

  if(dataInput) dataInput.value=conf.dataFechamento||'';
  const hoje=new Date().toISOString().substring(0,10);
  const periodoFechado=!!conf.fechado;

  if(badge){
    badge.innerHTML=periodoFechado
      ? `<span style="background:#E8EAF6;color:#5C6BC0;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700"><i class="fa-solid fa-lock"></i> Período Fechado</span>`
      : `<span style="background:#E8F5E9;color:#2E7D32;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700"><i class="fa-solid fa-lock-open"></i> Período Aberto</span>`;
  }
  if(btnFechar) btnFechar.style.display=periodoFechado?'none':'inline-flex';
  if(infoFechado){
    if(periodoFechado && conf.fechadoEm){
      infoFechado.style.display='inline';
      infoFechado.textContent=`Fechado em ${new Date(conf.fechadoEm).toLocaleDateString('pt-BR')}`;
    } else { infoFechado.style.display='none'; }
  }

  // Auto-fechamento: se hoje >= data de fechamento e não foi fechado ainda
  if(!periodoFechado && conf.dataFechamento && hoje>=conf.dataFechamento){
    await _executarFechamentoPeriodo(mes,ano,key,conf,true);
  }
}

async function configurarDataFechamento(){
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const data=document.getElementById('fechamento-data-input')?.value;
  if(!data){ toast('Informe a data de fechamento.','error'); return; }
  const key=_periodoKey(mes,ano);
  const conf=State.confFolha?.[key]||{};
  const novaConf={ ...conf, dataFechamento:data, updatedAt:new Date().toISOString() };
  try{
    await DB.fs.collection('configuracoes').doc(`fechamento_${key}`).set(novaConf,{merge:true});
    State.confFolha=State.confFolha||{};
    State.confFolha[key]=novaConf;
    toast(`Data de fechamento de ${MESES[mes]}/${ano} definida para ${new Date(data+'T12:00:00').toLocaleDateString('pt-BR')}.`);
    _updatePainelFechamento(mes,ano);
  }catch(e){ toast('Erro ao salvar data de fechamento.','error'); }
}

async function fecharPeriodo(){
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const key=_periodoKey(mes,ano);
  const qtd=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano&&p.status!=='fechada').length;
  if(qtd===0){ toast(`Nenhuma folha aberta em ${MESES[mes]}/${ano}.`,'warning'); return; }
  if(!confirm(`Fechar ${qtd} folha(s) de ${MESES[mes]}/${ano}?\n\nApós o fechamento as folhas ficam bloqueadas para edição. Você poderá reabrir individualmente se necessário.`)) return;
  await _executarFechamentoPeriodo(mes,ano,key,State.confFolha?.[key]||{},false);
}

async function _executarFechamentoPeriodo(mes,ano,key,conf,automatico){
  const folhasAbertas=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano&&p.status!=='fechada');
  const agora=new Date().toISOString();
  try{
    await Promise.all(folhasAbertas.map(p=>
      DB.fs.collection('payrolls').doc(p.id).set({status:'fechada',fechadoEm:agora},{merge:true})
    ));
    const novaConf={...conf,fechado:true,fechadoEm:agora,updatedAt:agora};
    await DB.fs.collection('configuracoes').doc(`fechamento_${key}`).set(novaConf,{merge:true});
    State.confFolha=State.confFolha||{};
    State.confFolha[key]=novaConf;
    // Atualiza State local
    folhasAbertas.forEach(p=>{ const s=State.payrolls.find(r=>r.id===p.id); if(s) s.status='fechada'; });
    const msg=automatico
      ? `Fechamento automático: ${folhasAbertas.length} folha(s) de ${MESES[mes]}/${ano} fechadas.`
      : `${folhasAbertas.length} folha(s) de ${MESES[mes]}/${ano} fechadas com sucesso.`;
    toast(msg);
    Auth.log('PAYROLL_PERIODO_FECHADO',null,`${MESES[mes]}/${ano} — ${folhasAbertas.length} folhas`);
    _updatePainelFechamento(mes,ano);
    // Atualizar status badge da folha atual se estiver carregada
    _updateFolhaStatusBadge();
  }catch(e){ toast('Erro ao fechar período.','error'); console.error(e); }
}

async function fecharFolhaIndividual(){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  if(!empId||!emp){ toast('Selecione um colaborador.','error'); return; }
  const p=State.payrolls.find(r=>r.employeeId===empId&&r.mes==mes&&r.ano==ano);
  if(!p){ toast('Salve o lançamento antes de fechar.','error'); return; }
  if(p.status==='fechada'){ toast('Esta folha já está fechada.','warning'); return; }
  if(!confirm(`Fechar a folha de ${emp.nome} — ${MESES[mes]}/${ano}?\n\nA folha ficará bloqueada para edição. Você poderá reabrir se necessário.`)) return;
  try{
    const agora=new Date().toISOString();
    await DB.fs.collection('payrolls').doc(p.id).set({status:'fechada',fechadoEm:agora},{merge:true});
    const s=State.payrolls.find(r=>r.id===p.id); if(s){ s.status='fechada'; s.fechadoEm=agora; }
    Auth.log('PAYROLL_FECHADO_INDIVIDUAL',null,`${emp.nome} — ${MESES[mes]}/${ano}`);
    toast(`Folha de ${emp.nome} fechada.`);
    _updateFolhaStatusBadge();
  }catch(e){ toast('Erro ao fechar folha.','error'); console.error(e); }
}

async function reabrirFolha(){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  if(!empId||!emp){ toast('Selecione um colaborador.','error'); return; }
  const p=State.payrolls.find(r=>r.employeeId===empId&&r.mes==mes&&r.ano==ano);
  if(!p){ toast('Folha não encontrada.','error'); return; }
  if(!confirm(`Reabrir a folha de ${emp.nome} — ${MESES[mes]}/${ano}?\n\nA folha voltará a ser editável. O período geral continuará fechado para os demais.`)) return;
  try{
    await DB.fs.collection('payrolls').doc(p.id).set({status:'aberta',reabertoEm:new Date().toISOString()},{merge:true});
    const s=State.payrolls.find(r=>r.id===p.id); if(s) s.status='aberta';
    Auth.log('PAYROLL_REABERTO',null,`${emp.nome} — ${MESES[mes]}/${ano}`);
    toast(`Folha de ${emp.nome} reaberta para edição.`);
    _updateFolhaStatusBadge();
  }catch(e){ toast('Erro ao reabrir folha.','error'); }
}

function _lockPayrollForm(isLocked){
  const form=document.querySelector('#section-payroll .payroll-form-col');
  if(!form) return;
  // Inputs e selects (exceto colaborador, mês, ano, período)
  const editIds=['payroll-dias','payroll-faltas-justificadas','payroll-faltas-injustificadas',
    'payroll-remuneracao','payroll-vt-dia','payroll-vt-total','payroll-vr-dia','payroll-vr-total',
    'payroll-va-total','payroll-va-liquido','payroll-bonus','payroll-noturno','payroll-acumulo',
    'payroll-insalubridade','payroll-atraso-min','payroll-desconto-atraso','payroll-adiantamento-ativo',
    'payroll-adiantamento-perc','payroll-adiantamento-valor','payroll-entrada','payroll-saida',
    'payroll-intervalo-inicio','payroll-intervalo-fim','payroll-he-total','payroll-he-perc',
    'payroll-he-valor','pdf-input'];
  editIds.forEach(id=>{ const el=document.getElementById(id); if(el) el.disabled=isLocked; });
  // Botões
  const saveBtn=document.querySelector('#section-payroll .btn-primary');
  if(saveBtn) saveBtn.disabled=isLocked;
  const recalcBtn=document.querySelector('#section-payroll [onclick*="recalculate"]');
  if(recalcBtn) recalcBtn.disabled=isLocked;
  // PDF upload area
  const pdfArea=document.getElementById('pdf-upload-area');
  if(pdfArea) pdfArea.style.pointerEvents=isLocked?'none':'auto';
  // Botão Reabrir
  const btnReabrir=document.getElementById('btn-reabrir-folha');
  if(btnReabrir) btnReabrir.style.display=isLocked?'inline-flex':'none';
  // Overlay visual
  const formCard=document.querySelector('#section-payroll .payroll-form-col .card-body');
  if(formCard) formCard.style.opacity=isLocked?'0.75':'1';
}

function _updateFolhaStatusBadge(){
  const empId=val('payroll-employee');
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const badge=document.getElementById('payroll-status-badge');
  if(!badge) return;
  const p=State.payrolls.find(r=>r.employeeId===empId&&r.mes==mes&&r.ano==ano);
  const fechada=p?.status==='fechada';
  const temFolha=!!p;
  badge.innerHTML=fechada
    ? `<span style="background:#E8EAF6;color:#5C6BC0;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;white-space:nowrap"><i class="fa-solid fa-lock"></i> Folha Fechada</span>`
    : (temFolha?`<span style="background:#E8F5E9;color:#2E7D32;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;white-space:nowrap"><i class="fa-solid fa-lock-open"></i> Folha Aberta</span>`:'');
  // Botão "Fechar esta Folha" — visível só quando tem folha salva e está aberta
  const btnFecharInd=document.getElementById('btn-fechar-folha-individual');
  if(btnFecharInd) btnFecharInd.style.display=(temFolha&&!fechada)?'inline-flex':'none';
  // Botão "Reabrir esta Folha" — visível só quando fechada
  const btnReabrir=document.getElementById('btn-reabrir-folha');
  if(btnReabrir) btnReabrir.style.display=fechada?'inline-flex':'none';
  _lockPayrollForm(fechada);
}

// ============================================
// PDF PROCESSING
// ============================================
function handleDragOver(e){ e.preventDefault(); document.getElementById('pdf-upload-area').classList.add('drag-over'); }
function handleDrop(e){
  e.preventDefault(); document.getElementById('pdf-upload-area').classList.remove('drag-over');
  const file=e.dataTransfer.files[0];
  if(file&&isArquivoAceito(file)) loadPdfFile(file);
  else toast('Formato não aceito. Use PDF, JPG ou PNG.','error');
}
function handlePdfSelected(event){ const file=event.target.files[0]; if(file&&isArquivoAceito(file)) loadPdfFile(file); }
function isArquivoAceito(file){
  const tipos=['application/pdf','image/jpeg','image/jpg','image/png','image/webp'];
  return tipos.includes(file.type);
}
function loadPdfFile(file){
  State.currentPdfFile=file;
  document.getElementById('pdf-placeholder').classList.add('hidden');
  document.getElementById('pdf-selected').classList.remove('hidden');
  document.getElementById('pdf-file-name').textContent=file.name;
  document.getElementById('pdf-file-size').textContent=formatBytes(file.size);
  document.getElementById('btn-process-pdf').disabled=false;
}
function clearPdf(event,silent=false){
  if(event) event.stopPropagation();
  State.currentPdfFile=null; State.currentPdfText='';
  document.getElementById('pdf-placeholder').classList.remove('hidden');
  document.getElementById('pdf-selected').classList.add('hidden');
  document.getElementById('pdf-input').value='';
  document.getElementById('btn-process-pdf').disabled=true;
  if(!silent) toast('PDF removido.','warning');
}
function formatBytes(b){ if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }

// ============================================
// LEITURA DE FOLHA DE PONTO COM GEMINI AI
// ============================================
// Usa Cloudflare Worker como proxy: a chave Gemini fica em segredo no
// servidor e nunca aparece no código público (LGPD/segurança).
const GEMINI_PROXY_URL = 'https://drg-gemini-proxy.zett-romao.workers.dev';
const GEMINI_MODEL     = 'gemini-2.5-flash';

// Converte arquivo para base64
async function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

// Regras de falta por tipo de escala de trabalho
const ESCALA_RULES = {
  '5x2A': 'Escala 5x2 — Variante A. Dias de trabalho: SEGUNDA a SEXTA (08h-18h, exceto Sex 08h-16h). Sábado e domingo: FOLGA (não é falta, não soma em "faltas"). FALTA = somente dia entre Segunda e Sexta sem registro de entrada nem saída E sem nenhuma justificativa na OBS.',
  '5x2B': 'Escala 5x2 — Variante B. Dias de trabalho: SEGUNDA a SEXTA (07h-17h, exceto Sex 07h-16h). Sábado e domingo: FOLGA (não é falta). FALTA = somente dia entre Segunda e Sexta sem registro de entrada nem saída E sem justificativa na OBS.',
  '6x1A': 'Escala 6x1 — Variante A. Dias de trabalho: SEGUNDA a SÁBADO (07h-16h, exceto Sáb 07h-11h). Domingo: FOLGA (não é falta). FALTA = somente dia entre Segunda e Sábado sem registro de entrada nem saída E sem justificativa na OBS.',
  '6x1B': 'Escala 6x1 — Variante B. Trabalha 6 dias e folga 1 (a folga roda durante a semana, não é fixa em domingo). O dia de FOLGA aparece marcado como "FOLGA", "DSR" ou linha vazia explicitamente identificada como descanso. FALTA = dia em que era para trabalhar (não marcado como folga/DSR/atestado) e está sem registro.',
  '12x36': 'Escala 12x36. O colaborador trabalha 12 horas e folga 36 horas (alternado: 1 dia trabalha / 1 dia folga). ATENÇÃO CRÍTICA: dias sem registro são FOLGAS PROGRAMADAS — NÃO são faltas automaticamente. Considere FALTA = 0 (zero) por padrão. Só conte como FALTA se a coluna OBS contiver expressamente "FALTA", "FALTOU", "AUSENTE" ou "F.I." (falta injustificada). Atestado/Férias/Afastamento NÃO são faltas.'
};

// Chama a API do Gemini com visão
async function callGemini(base64Data, mimeType, escala){
  const escalaRule=ESCALA_RULES[escala]||ESCALA_RULES['5x2A'];
  const prompt=`Você é um sistema de leitura de folha de ponto brasileira. Analise a imagem desta folha de ponto e extraia os dados com PRECISÃO MÁXIMA.

ESTRUTURA DA FOLHA: cada linha representa 1 dia do mês. As colunas geralmente são: DIA | DIA DA SEMANA | ENTRADA | INÍCIO INTERVALO | RETORNO INTERVALO | SAÍDA | RUBRICA | HORA EXTRA | OBS. A ordem pode variar levemente — adapte-se.

ESCALA DO COLABORADOR (regra crítica de negócio):
${escalaRule}

Retorne SOMENTE um JSON válido com este formato exato:
{
  "nome": "nome completo do colaborador (procure no cabeçalho) ou null",
  "cargo": "cargo/função (no cabeçalho) ou null",
  "ctps": "número da CTPS (no cabeçalho) ou null",
  "diasTrabalhados": <inteiro> dias COM registro de ENTRADA E SAÍDA preenchidos,
  "faltas": <inteiro> dias contados como FALTA segundo a regra da ESCALA acima (NUNCA conte folgas programadas, sábados/domingos de quem não trabalha neles, atestados ou férias),
  "horasExtras": <decimal> soma das horas da coluna HORA EXTRA (em horas decimais, ex: 1.5 = 1h30min). Se vazio, 0,
  "observacoes": "texto das observações relevantes encontradas (resumo curto) ou null"
}

ANTI-ENGANO — NUNCA cometa estes erros comuns:
1. NÃO conte sábado/domingo como falta se a escala for 5x2 — eles são folga.
2. NÃO conte qualquer linha vazia como falta na escala 12x36 — sem indicação explícita na OBS, falta = 0.
3. NÃO conte atestados, férias ou afastamentos como falta. Linhas com "ATESTADO", "FÉRIAS", "AFAST.", "INSS", "LICENÇA" são justificadas e ficam fora.
4. NÃO confunda "DSR" (descanso semanal remunerado) ou "FOLGA" com falta — são folgas programadas.
5. Se a folha tem campo de TOTAL no rodapé com valor de faltas, ANTES use esse total como referência se for compatível com a escala.

Sanidade obrigatória: diasTrabalhados + faltas + folgas + atestados + férias ≈ total de dias do mês visível na folha.

Retorne APENAS o JSON, sem markdown, sem comentários, sem explicação. Se um valor não puder ser determinado, use null (texto) ou 0 (números).`;

  const resp=await fetch(GEMINI_PROXY_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model: GEMINI_MODEL,
      prompt: prompt,
      mimeType: mimeType,
      base64Data: base64Data
    })
  });
  if(!resp.ok){
    const err=await resp.json().catch(()=>({error:'Resposta inválida do servidor'}));
    throw new Error(err.error?.message||err.error||'Erro na chamada Gemini via proxy');
  }
  const data=await resp.json();
  const text=data.candidates?.[0]?.content?.parts?.[0]?.text||'';
  console.log('Gemini raw response:', text);
  // Tenta parse direto (quando responseMimeType=application/json funciona)
  try {
    return JSON.parse(text);
  } catch(e) {
    // Fallback: extrai JSON do texto se vier com markdown ou outro wrapper
    const jsonMatch=text.match(/\{[\s\S]*\}/);
    if(!jsonMatch) throw new Error('Resposta da IA não reconhecida: '+text.substring(0,200));
    return JSON.parse(jsonMatch[0]);
  }
}

async function processPdf(){
  const file=State.currentPdfFile; if(!file){ toast('Nenhum arquivo selecionado.','error'); return; }
  const modal=document.getElementById('modal-pdf');
  const statusEl=document.getElementById('extraction-status');
  const resultEl=document.getElementById('extraction-result');
  const footerEl=document.getElementById('modal-pdf-footer');
  modal.classList.remove('hidden');
  statusEl.classList.remove('hidden');
  statusEl.innerHTML=`<div style="text-align:center;padding:20px">
    <div class="spinner" style="margin:0 auto 12px"></div>
    <div style="font-weight:600;color:var(--primary)">🤖 Inteligência Artificial analisando a folha...</div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">Gemini está lendo os registros linha por linha. Aguarde.</div>
  </div>`;
  resultEl.classList.add('hidden'); footerEl.classList.add('hidden');
  try {
    const base64=await fileToBase64(file);
    // Para PDF, usa o tipo do arquivo; para imagem, usa o MIME real
    let mimeType=file.type;
    if(mimeType==='application/pdf') mimeType='application/pdf';
    // Pega escala do colaborador selecionado (afeta a regra de faltas)
    const empId=val('payroll-employee');
    const emp=State.employees.find(e=>e.id===empId);
    const escala=emp?.escala||'5x2A';
    const extracted=await callGemini(base64, mimeType, escala);
    // Preencher campos do resultado
    setVal('ext-dias', extracted.diasTrabalhados||0);
    setVal('ext-faltas', extracted.faltas||0);
    setVal('ext-remuneracao','');
    // Mostrar info extra
    const nomeInfo=extracted.nome?`<br><i class="fa-solid fa-user"></i> <strong>${extracted.nome}</strong>`:'';
    const cargoInfo=extracted.cargo?` — ${extracted.cargo}`:'';
    const heInfo=extracted.horasExtras>0?`<br><i class="fa-solid fa-clock"></i> Horas extras detectadas: <strong>${extracted.horasExtras}h</strong>`:'';
    const obsInfo=extracted.observacoes?`<br><i class="fa-solid fa-note-sticky"></i> Obs: ${extracted.observacoes}`:'';
    document.getElementById('extraction-info').innerHTML=`
      <div style="color:var(--success);font-weight:700"><i class="fa-solid fa-robot"></i> Gemini AI leu a folha com sucesso!</div>
      ${nomeInfo}${cargoInfo}${heInfo}${obsInfo}
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Verifique os valores abaixo e corrija se necessário antes de aplicar.</div>`;
    // Esconder raw text (não temos mais)
    const rawBlock=document.getElementById('ext-raw-text');
    if(rawBlock) rawBlock.parentElement?.classList?.add('hidden');
    statusEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    footerEl.classList.remove('hidden');
  } catch(err){
    statusEl.innerHTML=`<div style="color:var(--danger);text-align:center;padding:20px">
      <i class="fa-solid fa-circle-xmark" style="font-size:32px;display:block;margin-bottom:10px"></i>
      <strong>Erro ao processar com IA</strong><br>
      <span style="font-size:12px">${err.message}</span><br>
      <span style="font-size:11px;color:var(--text-muted);margin-top:6px;display:block">Verifique se a chave Gemini está válida ou tente novamente.</span>
    </div>`;
    footerEl.classList.remove('hidden');
    footerEl.innerHTML='<button class="btn btn-outline" onclick="closeModal(\'modal-pdf\')">Fechar</button>';
  }
}

function applyExtraction(){
  setVal('payroll-dias',numVal('ext-dias'));
  const faltasExt=numVal('ext-faltas');
  setVal('payroll-faltas-injustificadas',faltasExt);
  setVal('payroll-faltas-justificadas',0);
  const r=numVal('ext-remuneracao'); if(r>0) setVal('payroll-remuneracao',r.toFixed(2));
  recalculate(); closeModal('modal-pdf'); toast('Dados da folha aplicados com sucesso!');
}

// ============================================
// CONTRATOS
// ============================================
let _contratoTab = 'ativos';

function switchContratoTab(tab){
  _contratoTab = tab;
  document.querySelectorAll('.contrato-tab').forEach(b=>b.classList.remove('active'));
  const el = document.getElementById('tab-contratos-'+tab);
  if(el) el.classList.add('active');
  renderContratosTable();
}

function renderContratosTable(){
  const q=(val('contratos-search')||'').toLowerCase();
  const tbody=document.getElementById('contratos-tbody'); if(!tbody) return;
  // Auto-inativar contratos com data de fim passada
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  let lista=State.contratos.filter(c=>{
    const inativo = c.status==='inativo' || (c.dataFim && new Date(c.dataFim+'T00:00:00')<=hoje);
    return _contratoTab==='ativos' ? !inativo : inativo;
  });
  if(q) lista=lista.filter(c=>
    (c.postoNome||'').toLowerCase().includes(q)||
    (c.objeto||'').toLowerCase().includes(q)
  );
  // Atualizar contagens nas abas
  const totalAtivos=State.contratos.filter(c=>!(c.status==='inativo'||(c.dataFim&&new Date(c.dataFim+'T00:00:00')<=hoje))).length;
  const totalInativos=State.contratos.length-totalAtivos;
  const ca=document.getElementById('count-contratos-ativos'); if(ca) ca.textContent=totalAtivos;
  const ci=document.getElementById('count-contratos-inativos'); if(ci) ci.textContent=totalInativos;
  if(lista.length===0){
    tbody.innerHTML=`<tr><td colspan="8" class="empty-row"><i class="fa-solid fa-file-signature"></i> Nenhum contrato ${_contratoTab==='ativos'?'ativo':'inativo'}</td></tr>`;
    return;
  }
  tbody.innerHTML=lista.map(c=>{
    // Calcular dias para reajuste
    let reajusteBadge='—';
    if(c.dataReajuste){
      const reaj=new Date(c.dataReajuste+'T00:00:00');
      const reajEste=new Date(hoje.getFullYear(),reaj.getMonth(),reaj.getDate());
      const dataRef=reajEste>=hoje?reajEste:new Date(hoje.getFullYear()+1,reaj.getMonth(),reaj.getDate());
      const diff=Math.round((dataRef-hoje)/(1000*60*60*24));
      const cor=diff<=7?'#C62828':diff<=30?'#E65100':'var(--success)';
      const label=diff===0?'Hoje':diff<=30?`${diff}d`:formatDateBr(c.dataReajuste);
      reajusteBadge=`<span style="color:${cor};font-weight:600;font-size:12px">${label}</span>`;
    }
    const arquivoBtn=c.arquivoUrl
      ?`<a href="${c.arquivoUrl}" target="_blank" class="btn-action btn-edit" title="Ver contrato"><i class="fa-solid fa-file-pdf"></i></a>`
      :`<span style="color:var(--text-muted);font-size:12px">—</span>`;
    return `<tr>
      <td><strong>${c.postoNome||'—'}</strong></td>
      <td style="font-size:12px;max-width:200px">${c.objeto||'—'}</td>
      <td style="font-weight:600;color:var(--success)">${c.valorMensal?fmtMoney(c.valorMensal):'—'}</td>
      <td style="font-size:12px">${formatDateBr(c.dataInicio)}</td>
      <td style="font-size:12px">${reajusteBadge}</td>
      <td style="font-size:12px">${c.dataFim?formatDateBr(c.dataFim):'<span style="color:var(--text-muted)">Indeterminado</span>'}</td>
      <td>${arquivoBtn}</td>
      <td>
        <button class="btn-action btn-edit" onclick="openContratoModal('${c.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-action btn-danger" onclick="confirmDeleteContrato('${c.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function populateContratoPostoSelect(){
  const sel=document.getElementById('contrato-posto'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— Selecione o posto —</option>';
  [...State.postos].sort((a,b)=>(a.razaoSocial||'').localeCompare(b.razaoSocial||'')).forEach(p=>{
    const opt=document.createElement('option');
    opt.value=p.id;
    opt.textContent=p.nomeFantasia||p.razaoSocial;
    sel.appendChild(opt);
  });
  if(cur) sel.value=cur;
}

function openContratoModal(id=null){
  populateContratoPostoSelect();
  document.getElementById('modal-contrato').classList.remove('hidden');
  const titleEl=document.getElementById('modal-contrato-title');
  const uploadStatus=document.getElementById('contrato-upload-status');
  if(uploadStatus) uploadStatus.classList.add('hidden');
  if(id){
    const c=State.contratos.find(x=>x.id===id); if(!c) return;
    titleEl.innerHTML='<i class="fa-solid fa-file-signature"></i> Editar Contrato';
    setVal('contrato-id',c.id);
    // Dados do cliente
    setVal('contrato-cnpj',          c.cnpj||'');
    setVal('contrato-razao',         c.razaoSocial||'');
    setVal('contrato-endereco',      c.endereco||'');
    setVal('contrato-email',         c.email||'');
    setVal('contrato-responsavel',   c.responsavel||'');
    setVal('contrato-cpf-responsavel', c.cpfResponsavel||'');
    // Dados do contrato
    const posto=State.postos.find(p=>(p.nomeFantasia||p.razaoSocial)===c.postoNome||p.id===c.postoId);
    setVal('contrato-posto', posto?posto.id:'');
    setVal('contrato-valor', c.valorMensal||'');
    setVal('contrato-objeto', c.objeto||'');
    setVal('contrato-inicio', c.dataInicio||'');
    setVal('contrato-reajuste', c.dataReajuste||'');
    setVal('contrato-fim', c.dataFim||'');
    setVal('contrato-obs', c.observacoes||'');
    // Limpar status CNPJ
    const cnpjSt=document.getElementById('contrato-cnpj-status');
    if(cnpjSt) cnpjSt.style.display='none';
    setVal('contrato-arquivo-url', c.arquivoUrl||'');
    setVal('contrato-arquivo-nome', c.arquivoNome||'');
    // Mostrar arquivo atual se existir
    const atualDiv=document.getElementById('contrato-arquivo-atual');
    const nomeExib=document.getElementById('contrato-arquivo-nome-exib');
    const link=document.getElementById('contrato-arquivo-link');
    if(c.arquivoUrl && atualDiv && nomeExib && link){
      atualDiv.classList.remove('hidden'); atualDiv.style.display='flex';
      nomeExib.textContent=c.arquivoNome||'Contrato anexado';
      link.href=c.arquivoUrl;
    } else if(atualDiv){
      atualDiv.classList.add('hidden'); atualDiv.style.display='none';
    }
  } else {
    titleEl.innerHTML='<i class="fa-solid fa-file-signature"></i> Novo Contrato';
    ['contrato-id','contrato-cnpj','contrato-razao','contrato-endereco','contrato-email',
     'contrato-responsavel','contrato-cpf-responsavel',
     'contrato-posto','contrato-valor','contrato-objeto','contrato-inicio',
     'contrato-reajuste','contrato-fim','contrato-obs','contrato-arquivo-url','contrato-arquivo-nome']
      .forEach(id=>setVal(id,''));
    const cnpjSt=document.getElementById('contrato-cnpj-status');
    if(cnpjSt) cnpjSt.style.display='none';
    const atualDiv=document.getElementById('contrato-arquivo-atual');
    if(atualDiv){ atualDiv.classList.add('hidden'); atualDiv.style.display='none'; }
  }
}

function removerArquivoContrato(){
  setVal('contrato-arquivo-url','');
  setVal('contrato-arquivo-nome','');
  const atualDiv=document.getElementById('contrato-arquivo-atual');
  if(atualDiv){ atualDiv.classList.add('hidden'); atualDiv.style.display='none'; }
}

async function onContratoArquivoChange(event){
  const file=event.target.files[0]; if(!file) return;
  const statusEl=document.getElementById('contrato-upload-status');
  if(statusEl){ statusEl.classList.remove('hidden'); statusEl.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando arquivo...'; }
  try {
    const contratoId=val('contrato-id')||genId();
    setVal('contrato-id', contratoId);
    const ext=file.name.split('.').pop();
    const path=`contratos/${contratoId}/contrato_${Date.now()}.${ext}`;
    const ref=firebase.storage().ref(path);
    await ref.put(file);
    const url=await ref.getDownloadURL();
    setVal('contrato-arquivo-url', url);
    setVal('contrato-arquivo-nome', file.name);
    const atualDiv=document.getElementById('contrato-arquivo-atual');
    const nomeExib=document.getElementById('contrato-arquivo-nome-exib');
    const link=document.getElementById('contrato-arquivo-link');
    if(atualDiv&&nomeExib&&link){
      atualDiv.classList.remove('hidden'); atualDiv.style.display='flex';
      nomeExib.textContent=file.name; link.href=url;
    }
    if(statusEl){ statusEl.innerHTML='<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> Arquivo enviado com sucesso!'; }
    setTimeout(()=>{ if(statusEl) statusEl.classList.add('hidden'); }, 3000);
  } catch(e){
    if(statusEl){ statusEl.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i> Erro ao enviar arquivo.'; }
  }
}

async function saveContrato(){
  const razao=val('contrato-razao').trim();
  const objeto=val('contrato-objeto').trim();
  const inicio=val('contrato-inicio');
  if(!razao){ toast('Informe a Razão Social do cliente.','error'); return; }
  if(!objeto){ toast('Informe o objeto do contrato.','error'); return; }
  if(!inicio){ toast('Informe a data de início.','error'); return; }
  const existingContratoId=val('contrato-id');
  const postoId=val('contrato-posto');
  const posto=postoId?State.postos.find(p=>p.id===postoId):null;
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const dataFim=val('contrato-fim');
  const inativo=!!(dataFim && new Date(dataFim+'T00:00:00')<=hoje);
  const id=val('contrato-id')||genId();
  const record={
    id,
    // Dados do cliente
    cnpj:           val('contrato-cnpj').trim(),
    razaoSocial:    razao,
    endereco:       val('contrato-endereco').trim(),
    email:          val('contrato-email').trim(),
    responsavel:    val('contrato-responsavel').trim(),
    cpfResponsavel: val('contrato-cpf-responsavel').trim(),
    // Dados do contrato
    postoId:        postoId||'',
    postoNome:      posto?(posto.nomeFantasia||posto.razaoSocial):razao,
    objeto,
    valorMensal:    numVal('contrato-valor'),
    dataInicio:     inicio,
    dataReajuste:   val('contrato-reajuste')||'',
    dataFim:        dataFim||'',
    observacoes:    val('contrato-obs').trim(),
    arquivoUrl:     val('contrato-arquivo-url')||'',
    arquivoNome:    val('contrato-arquivo-nome')||'',
    status:         inativo?'inativo':'ativo',
    updatedAt:      new Date().toISOString()
  };
  try {
    await DB.save('contratos', record);
    Auth.log(existingContratoId?'CONTRATO_UPDATED':'CONTRATO_CREATED', null, `${razao} — ${objeto.substring(0,60)}`);
    toast(existingContratoId?'Contrato atualizado!':'Contrato cadastrado!');
    closeModal('modal-contrato');
  } catch(e){ toast('Erro ao salvar contrato.','error'); }
}

function confirmDeleteContrato(id){
  if(!confirm('Excluir este contrato? Esta ação não pode ser desfeita.')) return;
  const c=State.contratos.find(x=>x.id===id);
  DB.remove('contratos', id).then(()=>{
    if(c) Auth.log('CONTRATO_DELETED', null, c.razaoSocial||id);
    toast('Contrato excluído.');
  }).catch(()=>toast('Erro ao excluir.','error'));
}

// ============================================
// RELATÓRIOS — NOVO SISTEMA MULTI-TIPO
// ============================================
let _currentReportType = 'financeiro';

// Configuração de todos os tipos de relatório disponíveis
const _ALL_REPORT_TYPES = [
  {type:'financeiro',      icon:'fa-money-bill-wave',   label:'Financeiro Mensal',    desc:'Salário + benefícios por mês'},
  {type:'cadastral',       icon:'fa-id-card',            label:'Cadastral Completo',   desc:'Todos os dados dos colaboradores'},
  {type:'contatos',        icon:'fa-address-book',       label:'Contatos',             desc:'Telefone, e-mail e endereço'},
  {type:'ferias-marcadas', icon:'fa-umbrella-beach',     label:'Férias Marcadas',      desc:'Colaboradores com férias programadas'},
  {type:'ferias-pendentes',icon:'fa-calendar-xmark',     label:'Férias Pendentes',     desc:'Sem férias programadas'},
  {type:'afastados',       icon:'fa-user-clock',         label:'Afastados INSS',       desc:'Colaboradores afastados pelo INSS'},
  {type:'licenca-mat',    icon:'fa-baby',               label:'Licença Maternidade',  desc:'Colaboradoras em licença maternidade'},
  {type:'setor',           icon:'fa-sitemap',            label:'Por Setor',            desc:'Portaria, Limpeza, Manutenção...'},
  {type:'posto',           icon:'fa-building',           label:'Por Posto',            desc:'Filtrar por local de trabalho'},
  {type:'individual',      icon:'fa-file-invoice',       label:'Individual',           desc:'Ficha completa do colaborador'},
  {type:'postos-cadastro', icon:'fa-building-user',      label:'Postos Cadastrados',   desc:'Lista de postos e colaboradores alocados'},
  {type:'contratos-rel',   icon:'fa-file-signature',     label:'Contratos',            desc:'Contratos ativos, valores e reajustes'},
];

function openReportsModal(allowedTypes, title){
  // Reinicia estado
  document.getElementById('report-output').classList.add('hidden');
  const btnPrint=document.getElementById('btn-print');
  const btnCsv=document.getElementById('btn-export-csv');
  if(btnPrint) btnPrint.style.display='none';
  if(btnCsv)   btnCsv.style.display='none';

  // Preenche botões de tipo
  const grid=document.getElementById('report-type-grid');
  if(grid){
    grid.innerHTML=_ALL_REPORT_TYPES
      .filter(t=>allowedTypes.includes(t.type))
      .map(t=>`<button class="report-type-btn" data-type="${t.type}" onclick="selectReportType('${t.type}')">
        <i class="fa-solid ${t.icon}"></i>
        <span>${t.label}</span>
        <small>${t.desc}</small>
      </button>`).join('');
  }

  // Título
  const titleEl=document.getElementById('modal-reports-title');
  if(titleEl) titleEl.innerHTML=`<i class="fa-solid fa-chart-bar"></i> ${title||'Relatórios'}`;

  // Auto-seleciona primeiro
  if(allowedTypes.length>0) selectReportType(allowedTypes[0]);

  // Popula select de individual (se disponível)
  initReportIndividualSelect();

  // Abre modal
  document.getElementById('modal-reports').classList.remove('hidden');
}

function selectReportType(type){
  _currentReportType = type;
  document.querySelectorAll('.report-type-btn').forEach(b=>b.classList.toggle('active', b.dataset.type===type));
  // Mostrar/ocultar grupos de filtro
  ['filter-financeiro','filter-cadastral','filter-setor','filter-posto','filter-individual','filter-postos-cadastro','filter-contratos-rel'].forEach(id=>{
    document.getElementById(id)?.classList.add('hidden');
  });
  if(type==='financeiro')       document.getElementById('filter-financeiro')?.classList.remove('hidden');
  if(type==='cadastral'||type==='contatos') document.getElementById('filter-cadastral')?.classList.remove('hidden');
  if(type==='setor')            document.getElementById('filter-setor')?.classList.remove('hidden');
  if(type==='posto')            document.getElementById('filter-posto')?.classList.remove('hidden');
  if(type==='individual')       document.getElementById('filter-individual')?.classList.remove('hidden');
  if(type==='postos-cadastro')  document.getElementById('filter-postos-cadastro')?.classList.remove('hidden');
  if(type==='contratos-rel')    document.getElementById('filter-contratos-rel')?.classList.remove('hidden');
  // Ocultar saída anterior
  document.getElementById('report-output').classList.add('hidden');
  document.getElementById('btn-print').style.display='none';
  document.getElementById('btn-export-csv').style.display='none';
}

function _reportHeader(titulo, subtitulo){
  document.getElementById('report-subtitle').textContent=titulo;
  document.getElementById('report-period-label').textContent=subtitulo||'';
  document.getElementById('report-gen-date').textContent=new Date().toLocaleString('pt-BR');
  document.getElementById('report-summary').innerHTML='';
  document.getElementById('report-body-area').innerHTML='';
  document.getElementById('report-output').classList.remove('hidden');
  document.getElementById('btn-print').style.display='';
  document.getElementById('btn-export-csv').style.display='';
  document.getElementById('report-output').scrollIntoView({behavior:'smooth'});
}

function _empTable(cols, rows, tfoot=''){
  return `<div class="table-responsive"><table class="report-table">
    <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
    ${tfoot?`<tfoot>${tfoot}</tfoot>`:''}
  </table></div>`;
}

function generateReportNew(){
  const type=_currentReportType;
  if(type==='financeiro')      _reportFinanceiro();
  else if(type==='cadastral')  _reportCadastral();
  else if(type==='contatos')   _reportContatos();
  else if(type==='ferias-marcadas')  _reportFeriasMarcadas();
  else if(type==='ferias-pendentes') _reportFeriasPendentes();
  else if(type==='afastados')   _reportAfastados();
  else if(type==='licenca-mat') _reportLicencaMaternidade();
  else if(type==='setor')           _reportSetor();
  else if(type==='posto')           _reportPosto();
  else if(type==='individual')      _reportIndividual();
  else if(type==='postos-cadastro') _reportPostosCadastro();
  else if(type==='contratos-rel')   _reportContratos();
}

// 1. Financeiro Mensal
function _reportFinanceiro(){
  const mes=parseInt(val('report-mes')), ano=parseInt(val('report-ano'));
  if(!mes||!ano){ toast('Selecione mês e ano.','error'); return; }
  const statusFilter=val('report-status-filter')||'all';
  let records=State.payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  if(statusFilter!=='all') records=records.filter(p=>{
    const emp=State.employees.find(e=>e.id===p.employeeId);
    return emp&&(emp.status||'ativo')===statusFilter;
  });
  _reportHeader('Relatório Financeiro Mensal', `${MESES[mes]} / ${ano}`);
  const tR=records.reduce((s,p)=>s+(p.remuneracao||0),0);
  const tVT=records.reduce((s,p)=>s+(p.valeTransporte||0),0);
  const tVR=records.reduce((s,p)=>s+(p.valeRefeicao||0),0);
  const tVA=records.reduce((s,p)=>s+(p.valeAlimentacaoLiquido||0),0);
  const tAN=records.reduce((s,p)=>s+(p.adNoturno||0),0);
  const tB=records.reduce((s,p)=>s+(p.bonificacao||0),0);
  const tTotal=tR+tVT+tVR+tVA+tAN+tB;
  document.getElementById('report-summary').innerHTML=`
    <div class="r-stat-card"><div class="r-stat-value">${records.length}</div><div class="r-stat-label">Colaboradores</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${fmtMoney(tR)}</div><div class="r-stat-label">Remuneração</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${fmtMoney(tVT)}</div><div class="r-stat-label">Vale Transporte</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${fmtMoney(tVR)}</div><div class="r-stat-label">Vale Refeição</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${fmtMoney(tVA)}</div><div class="r-stat-label">Vale Alimentação</div></div>
    <div class="r-stat-card" style="border-color:var(--primary)"><div class="r-stat-value" style="color:var(--primary)">${fmtMoney(tTotal)}</div><div class="r-stat-label">Total Geral</div></div>`;
  const cols=['#','Colaborador','Setor','Escala','Dias','Faltas','Remuneração','VT','VR','VA Líq.','Ad. Noturno','Bonificação','Chave PIX'];
  const rows=records.length===0?`<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum lançamento neste período</td></tr>`:
    records.map((p,i)=>{
      const emp=State.employees.find(e=>e.id===p.employeeId);
      const nome=emp?emp.nome:'(removido)', pix=emp?(emp.chavePix||'—'):'—';
      const escala=emp?escalaLabel(emp.escala||'5x2A'):'—', setor=emp?(emp.setor||'—'):'—';
      const totalFaltas='faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0);
      return `<tr><td>${i+1}</td><td><strong>${nome}</strong></td><td>${setor}</td><td>${escala}</td>
        <td>${p.diasTrabalhados}</td><td>${totalFaltas}</td><td>${fmtMoney(p.remuneracao)}</td>
        <td>${fmtMoney(p.valeTransporte)}</td><td>${fmtMoney(p.valeRefeicao)}</td>
        <td>${fmtMoney(p.valeAlimentacaoLiquido||0)}</td><td>${fmtMoney(p.adNoturno||0)}</td>
        <td>${fmtMoney(p.bonificacao||0)}</td><td>${pix}</td></tr>`;
    }).join('');
  const tfoot=`<tr><td colspan="6">TOTAIS</td><td>${fmtMoney(tR)}</td><td>${fmtMoney(tVT)}</td><td>${fmtMoney(tVR)}</td><td>${fmtMoney(tVA)}</td><td>${fmtMoney(tAN)}</td><td>${fmtMoney(tB)}</td><td></td></tr>`;
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows,tfoot);
}

// 2. Cadastral Completo
function _reportCadastral(){
  let list=_filtrarCadastral();
  _reportHeader('Relatório Cadastral Completo', `${list.length} colaborador(es)`);
  const cols=['#','Reg.','Nome','Setor','Posto','Escala','Admissão','Status','CPF','RG','CTPS Nº','PIS/NIT','Nascimento','Salário Base'];
  const rows=list.length===0?`<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador encontrado</td></tr>`:
    list.map((e,i)=>`<tr>
      <td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td>${e.setor||'—'}</td>
      <td style="font-size:11px">${e.posto||'—'}</td>
      <td>${escalaLabel(e.escala||'5x2A')}</td>
      <td>${formatDateBr(e.dataAdmissao)}</td>
      <td>${statusBadge(e.status)}</td>
      <td>${e.cpf||'—'}</td>
      <td>${e.rg||'—'}</td>
      <td>${e.ctpsNumero||'—'} / ${e.ctpsSerie||'—'}</td>
      <td>${e.pisNit||'—'}</td>
      <td>${formatDateBr(e.dataNascimento)}</td>
      <td>${e.salarioBase?fmtMoney(e.salarioBase):'—'}</td>
    </tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// 3. Contatos
function _reportContatos(){
  let list=_filtrarCadastral();
  _reportHeader('Relatório de Contatos', `${list.length} colaborador(es)`);
  const cols=['#','Nome','Setor','Posto','Celular','E-mail','CEP','Endereço','Bairro','Cidade/UF','Chave PIX'];
  const rows=list.length===0?`<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador encontrado</td></tr>`:
    list.map((e,i)=>`<tr>
      <td>${i+1}</td>
      <td><strong>${e.nome}</strong></td>
      <td>${e.setor||'—'}</td>
      <td style="font-size:11px">${e.posto||'—'}</td>
      <td>${e.celular||'—'}</td>
      <td>${e.email||'—'}</td>
      <td>${e.cep||'—'}</td>
      <td style="font-size:11px">${e.endereco||'—'}${e.numero?', '+e.numero:''}${e.complemento?' '+e.complemento:''}</td>
      <td>${e.bairro||'—'}</td>
      <td>${e.cidade||'—'}${e.estado?' / '+e.estado:''}</td>
      <td>${e.chavePix||'—'}</td>
    </tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

function _filtrarCadastral(){
  const status=val('report-cad-status')||'all';
  const setor=val('report-cad-setor')||'all';
  let list=[...State.employees].sort((a,b)=>a.nome.localeCompare(b.nome));
  if(status!=='all') list=list.filter(e=>(e.status||'ativo')===status);
  if(setor!=='all')  list=list.filter(e=>(e.setor||'')=== setor);
  return list;
}

// 4. Férias Marcadas
function _reportFeriasMarcadas(){
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const ativos=State.employees.filter(e=>(e.status||'ativo')==='ativo');
  const list=ativos.filter(e=>(e.ferias||[]).some(f=>new Date(f.fim+'T00:00:00')>=hoje))
    .sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader('Relatório de Férias Marcadas', `${list.length} colaborador(es)`);
  const cols=['#','Nome','Setor','Posto','Início','Fim','Dias','Tipo','Situação'];
  const rows=list.length===0?`<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador com férias marcadas</td></tr>`:
    list.flatMap((e,i)=>{
      const futuras=(e.ferias||[]).filter(f=>new Date(f.fim+'T00:00:00')>=hoje)
        .sort((a,b)=>a.inicio.localeCompare(b.inicio));
      return futuras.map((f,j)=>{
        const ini=new Date(f.inicio+'T00:00:00');
        const fim=new Date(f.fim+'T00:00:00');
        const emAndamento=ini<=hoje&&fim>=hoje;
        const situacao=emAndamento?`<span class="badge badge-success">Em gozo</span>`:`<span class="badge badge-muted">Programada</span>`;
        return `<tr><td>${j===0?i+1:''}</td><td>${j===0?`<strong>${e.nome}</strong>`:''}</td>
          <td>${e.setor||'—'}</td><td style="font-size:11px">${e.posto||'—'}</td>
          <td>${formatDateBr(f.inicio)}</td><td>${formatDateBr(f.fim)}</td>
          <td>${f.dias}</td><td>${f.tipo||'Férias'}</td><td>${situacao}</td></tr>`;
      });
    }).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// 5. Férias Pendentes
function _reportFeriasPendentes(){
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const list=State.employees.filter(e=>{
    if((e.status||'ativo')==='inativo') return false;
    if(!e.dataAdmissao) return false;
    const admissao=new Date(e.dataAdmissao+'T00:00:00');
    const meses=Math.floor((hoje-admissao)/(1000*60*60*24*30));
    if(meses<11) return false;
    const futuras=(e.ferias||[]).filter(f=>new Date(f.fim+'T00:00:00')>=hoje);
    return futuras.length===0;
  }).sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader('Relatório de Férias Pendentes', `${list.length} colaborador(es)`);
  const cols=['#','Nome','Setor','Posto','Admissão','Meses s/ férias','Status'];
  const rows=list.length===0?`<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador com férias pendentes</td></tr>`:
    list.map((e,i)=>{
      const admissao=new Date(e.dataAdmissao+'T00:00:00');
      const meses=Math.floor((hoje-admissao)/(1000*60*60*24*30));
      const urgente=meses>=12;
      return `<tr><td>${i+1}</td><td><strong>${e.nome}</strong></td>
        <td>${e.setor||'—'}</td><td style="font-size:11px">${e.posto||'—'}</td>
        <td>${formatDateBr(e.dataAdmissao)}</td>
        <td style="color:${urgente?'var(--danger)':'#E65100'};font-weight:700">${meses} meses</td>
        <td>${urgente?'<span class="badge badge-danger">Vencida</span>':'<span class="badge badge-muted">A vencer</span>'}</td></tr>`;
    }).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// 6. Afastados INSS
function _reportAfastados(){
  const list=State.employees.filter(e=>(e.status||'ativo')==='afastado')
    .sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader('Relatório de Afastados INSS', `${list.length} colaborador(es)`);
  const cols=['#','Reg.','Nome','Setor','Posto','Admissão','CPF','Celular'];
  const rows=list.length===0?`<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador afastado</td></tr>`:
    list.map((e,i)=>`<tr><td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td>${e.setor||'—'}</td><td style="font-size:11px">${e.posto||'—'}</td>
      <td>${formatDateBr(e.dataAdmissao)}</td>
      <td>${e.cpf||'—'}</td><td>${e.celular||'—'}</td></tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// Licença Maternidade
function _reportLicencaMaternidade(){
  const list=State.employees.filter(e=>(e.status||'ativo')==='licenca-maternidade')
    .sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader('Relatório de Licença Maternidade', `${list.length} colaboradora(s)`);
  const cols=['#','Reg.','Nome','Setor','Posto','Admissão','Início Licença','Prev. Retorno','CPF','Celular'];
  const rows=list.length===0
    ?`<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhuma colaboradora em licença maternidade</td></tr>`
    :list.map((e,i)=>`<tr><td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td>${e.setor||'—'}</td>
      <td style="font-size:11px">${e.posto||'—'}</td>
      <td>${formatDateBr(e.dataAdmissao)}</td>
      <td><strong>${formatDateBr(e.licencaMaternidadeInicio)||'—'}</strong></td>
      <td><strong>${formatDateBr(e.licencaMaternidadeTermino)||'—'}</strong></td>
      <td>${e.cpf||'—'}</td>
      <td>${e.celular||'—'}</td></tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// 7. Por Setor
function _reportSetor(){
  const setor=val('report-setor-val');
  const statusFilt=val('report-setor-status')||'all';
  if(!setor){ toast('Selecione um setor.','error'); return; }
  let list=State.employees.filter(e=>(e.setor||'')=== setor);
  if(statusFilt!=='all') list=list.filter(e=>(e.status||'ativo')===statusFilt);
  list.sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader(`Relatório por Setor — ${setor}`, `${list.length} colaborador(es)`);
  const cols=['#','Reg.','Nome','Posto','Escala','Admissão','Status','CPF','Celular','Salário Base'];
  const rows=list.length===0?`<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador neste setor</td></tr>`:
    list.map((e,i)=>`<tr><td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td style="font-size:11px">${e.posto||'—'}</td>
      <td>${escalaLabel(e.escala||'5x2A')}</td>
      <td>${formatDateBr(e.dataAdmissao)}</td>
      <td>${statusBadge(e.status)}</td>
      <td>${e.cpf||'—'}</td><td>${e.celular||'—'}</td>
      <td>${e.salarioBase?fmtMoney(e.salarioBase):'—'}</td></tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// 8. Por Posto
function _reportPosto(){
  const posto=(val('report-posto-val')||'').toLowerCase().trim();
  if(!posto){ toast('Digite o nome ou parte do nome do posto.','error'); return; }
  const list=State.employees.filter(e=>(e.posto||'').toLowerCase().includes(posto))
    .sort((a,b)=>a.nome.localeCompare(b.nome));
  _reportHeader(`Relatório por Posto — "${val('report-posto-val')}"`, `${list.length} colaborador(es)`);
  const cols=['#','Reg.','Nome','Setor','Posto','Escala','Admissão','Status','Celular'];
  const rows=list.length===0?`<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">Nenhum colaborador encontrado neste posto</td></tr>`:
    list.map((e,i)=>`<tr><td>${i+1}</td>
      <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
      <td><strong>${e.nome}</strong></td>
      <td>${e.setor||'—'}</td>
      <td style="font-size:11px">${e.posto||'—'}</td>
      <td>${escalaLabel(e.escala||'5x2A')}</td>
      <td>${formatDateBr(e.dataAdmissao)}</td>
      <td>${statusBadge(e.status)}</td>
      <td>${e.celular||'—'}</td></tr>`).join('');
  document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
}

// ---- Relatório: Postos Cadastrados ----
function _reportPostosCadastro(){
  const detalhe=val('report-postos-detalhe')||'resumo';
  const lista=[...State.postos].sort((a,b)=>(a.razaoSocial||'').localeCompare(b.razaoSocial||''));
  if(lista.length===0){ toast('Nenhum posto cadastrado.','warning'); return; }
  _reportHeader('Relatório de Postos de Trabalho', `${lista.length} posto(s) cadastrado(s)`);

  if(detalhe==='resumo'){
    const cols=['#','Razão Social / Fantasia','CNPJ','Cidade / UF','Telefone','E-mail','Colaboradores Ativos'];
    const rows=lista.map((p,i)=>{
      const ativos=State.employees.filter(e=>e.posto===p.razaoSocial&&(e.status||'ativo')==='ativo').length;
      const nome=p.nomeFantasia?`<strong>${p.nomeFantasia}</strong><br><span style="font-size:11px;color:#666">${p.razaoSocial}</span>`:p.razaoSocial;
      return `<tr>
        <td>${i+1}</td>
        <td>${nome}</td>
        <td style="font-size:12px">${p.cnpj||'—'}</td>
        <td style="font-size:12px">${p.cidade?(p.cidade+(p.estado?' / '+p.estado:'')):'—'}</td>
        <td style="font-size:12px">${p.telefone||'—'}</td>
        <td style="font-size:12px">${p.email||'—'}</td>
        <td style="text-align:center;font-weight:700;color:var(--primary)">${ativos}</td>
      </tr>`;
    }).join('');
    document.getElementById('report-body-area').innerHTML=_empTable(cols,rows);
  } else {
    // Com colaboradores alocados por posto
    let html='';
    lista.forEach(p=>{
      const colab=State.employees.filter(e=>e.posto===p.razaoSocial&&(e.status||'ativo')==='ativo')
        .sort((a,b)=>a.nome.localeCompare(b.nome));
      html+=`<div style="margin-bottom:24px">
        <div style="background:#EEF4FF;padding:10px 14px;border-radius:6px;margin-bottom:8px;border-left:4px solid var(--primary)">
          <strong style="font-size:14px">${p.nomeFantasia||p.razaoSocial}</strong>
          ${p.nomeFantasia?`<span style="font-size:12px;color:#555"> — ${p.razaoSocial}</span>`:''}
          <span style="float:right;font-size:12px;color:var(--primary);font-weight:700">${colab.length} colaborador(es)</span>
        </div>`;
      if(colab.length===0){
        html+=`<p style="font-size:13px;color:#999;padding:0 14px">Nenhum colaborador ativo alocado neste posto.</p>`;
      } else {
        html+=`<table class="data-table" style="margin:0"><thead><tr>
          <th>#</th><th>Reg.</th><th>Nome</th><th>Setor</th><th>Escala</th><th>Admissão</th><th>Celular</th>
        </tr></thead><tbody>`;
        html+=colab.map((e,i)=>`<tr>
          <td>${i+1}</td>
          <td>${e.registro?String(e.registro).padStart(4,'0'):'—'}</td>
          <td><strong>${e.nome}</strong></td>
          <td style="font-size:12px">${e.setor||'—'}</td>
          <td style="font-size:12px">${escalaLabel(e.escala||'5x2A')}</td>
          <td style="font-size:12px">${formatDateBr(e.dataAdmissao)}</td>
          <td style="font-size:12px">${e.celular||'—'}</td>
        </tr>`).join('');
        html+=`</tbody></table>`;
      }
      html+=`</div>`;
    });
    document.getElementById('report-body-area').innerHTML=`<div style="padding:16px">${html}</div>`;
  }

  document.getElementById('report-output').classList.remove('hidden');
  document.getElementById('btn-print').style.display='';
  document.getElementById('btn-export-csv').style.display='none';
}

// ---- Relatório: Contratos ----
function _reportContratos(){
  const statusFilt=val('report-contratos-status')||'ativos';
  const reajusteFilt=val('report-contratos-reajuste')||'todos';
  const hoje=new Date(); hoje.setHours(0,0,0,0);

  let lista=State.contratos.filter(c=>{
    const inativo=c.status==='inativo'||(c.dataFim&&new Date(c.dataFim+'T00:00:00')<=hoje);
    if(statusFilt==='ativos')   return !inativo;
    if(statusFilt==='inativos') return inativo;
    return true;
  });

  if(reajusteFilt!=='todos'){
    const dias=parseInt(reajusteFilt);
    lista=lista.filter(c=>{
      if(!c.dataReajuste) return false;
      const reaj=new Date(c.dataReajuste+'T00:00:00');
      const reajEste=new Date(hoje.getFullYear(),reaj.getMonth(),reaj.getDate());
      const dataRef=reajEste>=hoje?reajEste:new Date(hoje.getFullYear()+1,reaj.getMonth(),reaj.getDate());
      return Math.round((dataRef-hoje)/(1000*60*60*24))<=dias;
    });
  }

  lista.sort((a,b)=>(a.postoNome||'').localeCompare(b.postoNome||''));
  if(lista.length===0){ toast('Nenhum contrato encontrado com esses filtros.','warning'); return; }

  const totalMensal=lista.reduce((s,c)=>s+(c.valorMensal||0),0);
  const totalAnual=totalMensal*12;
  _reportHeader(
    `Relatório de Contratos — ${statusFilt==='ativos'?'Ativos':statusFilt==='inativos'?'Inativos':'Todos'}`,
    `${lista.length} contrato(s) · Receita mensal: ${fmtMoney(totalMensal)} · Anual: ${fmtMoney(totalAnual)}`
  );

  const thStyle='font-weight:600;color:var(--primary);background:#EEF4FF;border-bottom:1px solid #D0E4FF;padding:7px 10px;font-size:12px;white-space:nowrap';
  const tdStyle='border-bottom:1px solid #E8F0FE;padding:7px 10px;font-size:12px;vertical-align:top';

  let rows=lista.map(c=>{
    // Dias para reajuste
    let reajInfo='—';
    if(c.dataReajuste){
      const reaj=new Date(c.dataReajuste+'T00:00:00');
      const reajEste=new Date(hoje.getFullYear(),reaj.getMonth(),reaj.getDate());
      const dataRef=reajEste>=hoje?reajEste:new Date(hoje.getFullYear()+1,reaj.getMonth(),reaj.getDate());
      const diff=Math.round((dataRef-hoje)/(1000*60*60*24));
      const cor=diff<=7?'#C62828':diff<=30?'#E65100':'#2E7D32';
      reajInfo=`${formatDateBr(c.dataReajuste)}<br><span style="color:${cor};font-weight:700;font-size:11px">${diff===0?'Hoje':diff<=30?diff+'d':'em dia'}</span>`;
    }
    const statusBg=c.status==='inativo'||c.dataFim?'#FFF3F3':'#F1F8E9';
    const statusCor=c.status==='inativo'||c.dataFim?'#B71C1C':'#1B5E20';
    const statusTxt=c.status==='inativo'||c.dataFim?'Inativo':'Ativo';
    return `<tr>
      <td style="${tdStyle}"><strong>${c.postoNome||'—'}</strong><br><span style="font-size:11px;color:#666">${c.razaoSocial||''}</span></td>
      <td style="${tdStyle}">${c.cnpj||'—'}</td>
      <td style="${tdStyle};max-width:180px">${c.objeto||'—'}</td>
      <td style="${tdStyle};font-weight:700;color:#2E7D32">${c.valorMensal?fmtMoney(c.valorMensal):'—'}</td>
      <td style="${tdStyle}">${formatDateBr(c.dataInicio)}</td>
      <td style="${tdStyle}">${reajInfo}</td>
      <td style="${tdStyle}">${c.dataFim?formatDateBr(c.dataFim):'Indeterminado'}</td>
      <td style="${tdStyle}">${c.responsavel||'—'}${c.cpfResponsavel?`<br><span style="font-size:11px;color:#666">${c.cpfResponsavel}</span>`:''}</td>
      <td style="${tdStyle};text-align:center"><span style="background:${statusBg};color:${statusCor};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${statusTxt}</span></td>
      <td style="${tdStyle};text-align:center">${c.arquivoUrl?`<a href="${c.arquivoUrl}" target="_blank" style="color:var(--primary)"><i class="fa-solid fa-file-pdf"></i> Ver</a>`:'—'}</td>
    </tr>`;
  }).join('');

  const tfoot=`<tr style="background:#EEF4FF">
    <td style="${tdStyle}" colspan="3"><strong>TOTAL</strong></td>
    <td style="${tdStyle};font-weight:700;color:#1B5E20">${fmtMoney(totalMensal)}/mês</td>
    <td style="${tdStyle}" colspan="6"><strong>Receita anual estimada: ${fmtMoney(totalAnual)}</strong></td>
  </tr>`;

  document.getElementById('report-body-area').innerHTML=`<div style="overflow-x:auto"><table class="data-table" style="min-width:900px">
    <thead><tr>
      <th style="${thStyle}">Posto / Cliente</th>
      <th style="${thStyle}">CNPJ</th>
      <th style="${thStyle}">Objeto</th>
      <th style="${thStyle}">Valor/Mês</th>
      <th style="${thStyle}">Início</th>
      <th style="${thStyle}">Reajuste</th>
      <th style="${thStyle}">Término</th>
      <th style="${thStyle}">Responsável</th>
      <th style="${thStyle}">Status</th>
      <th style="${thStyle}">Arquivo</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${tfoot}</tfoot>
  </table></div>`;

  document.getElementById('report-output').classList.remove('hidden');
  document.getElementById('btn-print').style.display='';
  document.getElementById('btn-export-csv').style.display='none';
}

// Manter compatibilidade com chamada antiga
function generateReport(){ generateReportNew(); }
function printReport(){ window.print(); }

// ============================================
// MODAIS
// ============================================
function closeModal(id,event){
  if(event&&event.target!==document.getElementById(id)) return;
  document.getElementById(id).classList.add('hidden');
}
function switchTab(tabId){
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.modal-tab').forEach(b=>b.classList.remove('active'));
  const pane=document.getElementById(tabId);
  if(pane) pane.classList.add('active');
  // Usar data-tab-id para ativar o botão correto (dinâmico)
  const btn=document.querySelector(`.modal-tab[data-tab-id="${tabId}"]`);
  if(btn) btn.classList.add('active');
}

// ============================================
// MÁSCARAS
// ============================================
function maskCpf(el){
  let v=el.value.replace(/\D/g,'').substr(0,11);
  if(v.length>9) v=v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,'$1.$2.$3-$4');
  else if(v.length>6) v=v.replace(/(\d{3})(\d{3})(\d{1,3})/,'$1.$2.$3');
  else if(v.length>3) v=v.replace(/(\d{3})(\d{1,3})/,'$1.$2');
  el.value=v;
}
function maskPhone(el){
  let v=el.value.replace(/\D/g,'').substr(0,11);
  if(v.length>6) v=v.replace(/(\d{2})(\d{5})(\d{1,4})/,'($1) $2-$3');
  else if(v.length>2) v=v.replace(/(\d{2})(\d{1,5})/,'($1) $2');
  else if(v.length>0) v='('+v;
  el.value=v;
}
function maskCep(el){
  let v=el.value.replace(/\D/g,'').substr(0,8);
  if(v.length>5) v=v.replace(/(\d{5})(\d{1,3})/,'$1-$2');
  el.value=v;
}

async function buscarCep(cep){
  const limpo=cep.replace(/\D/g,'');
  const status=document.getElementById('cep-status');
  if(limpo.length!==8) return;
  if(status) { status.style.color='var(--text-muted)'; status.textContent='🔍 Buscando endereço...'; }
  try {
    const res=await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    const data=await res.json();
    if(data.erro){
      if(status) { status.style.color='var(--danger)'; status.textContent='⚠️ CEP não encontrado.'; }
      return;
    }
    setVal('emp-endereco', data.logradouro||'');
    setVal('emp-bairro',   data.bairro||'');
    setVal('emp-cidade',   data.localidade||'');
    setVal('emp-estado',   data.uf||'SP');
    if(status) { status.style.color='var(--success)'; status.textContent='✔ Endereço preenchido automaticamente.'; }
    // Focar no campo Número para o usuário completar
    setTimeout(()=>{ document.getElementById('emp-numero')?.focus(); },100);
    setTimeout(()=>{ if(status) status.textContent=''; },4000);
  } catch(e){
    if(status) { status.style.color='var(--danger)'; status.textContent='⚠️ Erro ao buscar CEP. Verifique a conexão.'; }
  }
}

// ============================================
// CCT — CONVENÇÃO COLETIVA DE TRABALHO
// ============================================
function openCctModal(){
  document.getElementById('modal-cct').classList.remove('hidden');
  const cct=State.cct;
  const infoEl=document.getElementById('cct-current-info');
  const infoText=document.getElementById('cct-current-text');
  if(cct&&cct.vigencia){
    infoEl.style.display='';
    infoText.textContent=`CCT atual vigente desde ${formatDateBr(cct.vigencia)} — preencha abaixo para atualizar.`;
    setVal('cct-vigencia',cct.vigencia||''); setVal('cct-salario-base',cct.salarioBase||'');
    setVal('cct-vt-diario',cct.vtDiario||''); setVal('cct-vr-diario',cct.vrDiario||'');
    setVal('cct-va-mensal',cct.vaMensal||''); setVal('cct-bonificacao',cct.bonificacao||'');
    setVal('cct-plr',cct.plr||''); setVal('cct-adicional-noturno',cct.percentualAdNoturno||20);
    setVal('cct-salario-minimo',cct.salarioMinimo||1518);
    // PLR — parcelas e lembretes
    setVal('cct-plr-anual',cct.plrValorAnual||cct.plr||'');
    setVal('cct-plr-aviso-dias',cct.plrAvisoDias||30);
    setVal('cct-plr-p1-valor',cct.plrP1Valor||'');
    setVal('cct-plr-p1-limite',cct.plrP1DataLimite||'');
    setVal('cct-plr-p1-pago',cct.plrP1DataPagamento||'');
    setVal('cct-plr-p2-valor',cct.plrP2Valor||'');
    setVal('cct-plr-p2-limite',cct.plrP2DataLimite||'');
    setVal('cct-plr-p2-pago',cct.plrP2DataPagamento||'');
  } else {
    infoEl.style.display='none';
    ['cct-vigencia','cct-salario-base','cct-vt-diario','cct-vr-diario','cct-va-mensal','cct-bonificacao','cct-plr',
     'cct-plr-anual','cct-plr-p1-valor','cct-plr-p1-limite','cct-plr-p1-pago',
     'cct-plr-p2-valor','cct-plr-p2-limite','cct-plr-p2-pago'].forEach(id=>setVal(id,''));
    setVal('cct-adicional-noturno',20);
    setVal('cct-salario-minimo',1518);
    setVal('cct-plr-aviso-dias',30);
  }
}

async function saveCct(){
  const vigencia=val('cct-vigencia');
  if(!vigencia){ toast('Informe a data de vigência.','error'); return; }
  const cct={
    id:'current', vigencia,
    salarioBase:numVal('cct-salario-base'),
    vtDiario:numVal('cct-vt-diario'),
    vrDiario:numVal('cct-vr-diario'),
    vaMensal:numVal('cct-va-mensal'),
    bonificacao:numVal('cct-bonificacao'),
    plr:numVal('cct-plr'),
    percentualAdNoturno:numVal('cct-adicional-noturno')||20,
    salarioMinimo:numVal('cct-salario-minimo')||1518,
    // PLR — parcelas e lembretes
    plrValorAnual:numVal('cct-plr-anual')||0,
    plrAvisoDias:numVal('cct-plr-aviso-dias')||30,
    plrP1Valor:numVal('cct-plr-p1-valor')||0,
    plrP1DataLimite:val('cct-plr-p1-limite')||'',
    plrP1DataPagamento:val('cct-plr-p1-pago')||'',
    plrP2Valor:numVal('cct-plr-p2-valor')||0,
    plrP2DataLimite:val('cct-plr-p2-limite')||'',
    plrP2DataPagamento:val('cct-plr-p2-pago')||'',
    updatedAt:new Date().toISOString()
  };
  const btn=document.querySelector('#modal-cct .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    await DB.save('cct',cct);
    State.cct=cct;
    closeModal('modal-cct');
    toast('CCT salva com sucesso!');
    renderDashboard();
  } catch(e){ toast('Erro ao salvar CCT.','error'); }
  finally { setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar CCT'); }
}

async function markPlrPaid(parcelaIdx){
  if(!State.cct){ toast('Configure a CCT antes de marcar parcelas.','error'); return; }
  const today=new Date().toISOString().split('T')[0];
  const labelParc=parcelaIdx===1?'1ª Parcela':'2ª Parcela';
  document.getElementById('confirm-message').innerHTML=`Marcar PLR — <strong>${labelParc}</strong> como <strong>paga em ${formatDateBr(today)}</strong>?<br><br>Você poderá editar essa data depois pelo menu CCT, se precisar.`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-check"></i> Confirmar Pagamento';
  btn.onclick=async()=>{
    setBtnLoading(btn,true,'');
    try {
      const cct={...State.cct};
      cct[`plrP${parcelaIdx}DataPagamento`]=today;
      cct.updatedAt=new Date().toISOString();
      await DB.save('cct',cct);
      State.cct=cct;
      closeModal('modal-confirm');
      toast(`PLR — ${labelParc} marcada como paga.`);
      renderDashboard();
    } catch(e){ toast('Erro ao registrar pagamento.','error'); console.error(e); }
    finally { setBtnLoading(btn,false,'<i class="fa-solid fa-check"></i> Confirmar'); }
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

async function applyCctToAll(){
  const cct={
    salarioBase:numVal('cct-salario-base'),
    vtDiario:numVal('cct-vt-diario'),
    vrDiario:numVal('cct-vr-diario'),
    vaMensal:numVal('cct-va-mensal')
  };
  if(!cct.vtDiario&&!cct.vrDiario&&!cct.vaMensal&&!cct.salarioBase){
    toast('Preencha ao menos um valor da CCT antes de aplicar.','warning'); return;
  }
  const ativos=State.employees.filter(e=>(e.status||'ativo')==='ativo');
  if(ativos.length===0){ toast('Nenhum colaborador ativo encontrado.','warning'); return; }
  document.getElementById('confirm-message').textContent=`Aplicar CCT a ${ativos.length} colaborador(es) ativo(s)? Os valores de salário, VT, VR e VA serão atualizados.`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-users-gear"></i> Aplicar';
  btn.onclick=async()=>{
    setBtnLoading(btn,true,'');
    try {
      const tasks=ativos.map(emp=>{
        const updated={...emp, updatedAt:new Date().toISOString()};
        if(cct.salarioBase) updated.salarioBase=cct.salarioBase;
        if(cct.vtDiario)    updated.valorDiarioVt=cct.vtDiario;
        if(cct.vrDiario)    updated.valorDiarioVr=cct.vrDiario;
        if(cct.vaMensal)    updated.valorMensalVa=cct.vaMensal;
        return DB.save('employees',updated);
      });
      await Promise.all(tasks);
      closeModal('modal-confirm');
      toast(`CCT aplicada a ${ativos.length} colaborador(es)!`);
    } catch(e){ toast('Erro ao aplicar CCT.','error'); }
    finally { setBtnLoading(btn,false,'<i class="fa-solid fa-trash"></i> Excluir'); }
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// DOCUMENTOS DO COLABORADOR (Firebase Storage)
// ============================================
async function loadDocumentList(empId){
  const docList=document.getElementById('doc-list'); if(!docList) return;
  DB.initStorage();
  if(!DB.storage){
    document.getElementById('doc-storage-banner').style.display='none';
    document.getElementById('doc-storage-error').classList.remove('hidden');
    return;
  }
  docList.innerHTML='<div class="empty-state small"><i class="fa-solid fa-spinner fa-spin"></i><p>Carregando documentos...</p></div>';
  try {
    const ref=DB.storage.ref(`employees/${empId}`);
    const result=await ref.listAll();
    const btnAll=document.getElementById('btn-download-all-docs');
    if(result.items.length===0){
      docList.innerHTML='<div class="empty-state small"><i class="fa-solid fa-folder-open"></i><p>Nenhum documento enviado</p></div>';
      if(btnAll) btnAll.style.display='none';
      return;
    }
    if(btnAll) btnAll.style.display='inline-flex';
    const items=await Promise.all(result.items.map(async item=>{
      const url=await item.getDownloadURL();
      const meta=await item.getMetadata();
      return {name:item.name, url, contentType:meta.contentType, timeCreated:meta.timeCreated, fullPath:item.fullPath};
    }));
    docList.innerHTML=items.map(doc=>{
      const icon=doc.contentType==='application/pdf'?'fa-file-pdf':'fa-file-image';
      const color=doc.contentType==='application/pdf'?'var(--danger)':'var(--primary)';
      const nameParts=doc.name.split('_');
      const tipo=nameParts.length>1?nameParts.slice(1).join('_').replace(/\.[^.]+$/,''):doc.name;
      return `<div class="doc-item">
        <div class="doc-icon"><i class="fa-solid ${icon}" style="color:${color}"></i></div>
        <div class="doc-info">
          <div class="doc-name">${tipo}</div>
          <div class="doc-meta">${new Date(doc.timeCreated).toLocaleDateString('pt-BR')}</div>
        </div>
        <div class="doc-actions">
          <a href="${doc.url}" target="_blank" class="btn-icon btn-primary-icon" title="Download"><i class="fa-solid fa-download"></i></a>
          <button class="btn-icon btn-danger-icon" onclick="deleteDocument('${empId}','${doc.name}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  } catch(e){
    docList.innerHTML='<div class="empty-state small"><i class="fa-solid fa-circle-xmark"></i><p>Erro ao carregar documentos.</p></div>';
    console.error('Documentos:', e);
  }
}

async function downloadAllDocuments(){
  const empId=val('emp-id');
  if(!empId){ toast('Salve o colaborador antes.','warning'); return; }
  DB.initStorage();
  if(!DB.storage){ toast('Storage não disponível.','error'); return; }
  if(typeof JSZip==='undefined'){ toast('JSZip não carregado. Verifique a conexão.','error'); return; }

  const emp=State.employees.find(e=>e.id===empId);
  const nomeEmp=(emp?emp.nome:'colaborador').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'_');
  const btn=document.getElementById('btn-download-all-docs');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Gerando ZIP...'; }

  try {
    const ref=DB.storage.ref(`employees/${empId}`);
    const result=await ref.listAll();
    // Filtra a foto (arquivo chamado exatamente 'foto')
    const docs=result.items.filter(item=>item.name!=='foto');
    if(docs.length===0){
      toast('Nenhum documento para baixar.','warning');
      return;
    }
    toast(`Compactando ${docs.length} documento(s)... aguarde.`,'info');

    const zip=new JSZip();
    // Baixar cada arquivo como blob e adicionar ao zip
    await Promise.all(docs.map(async item=>{
      const url=await item.getDownloadURL();
      const resp=await fetch(url);
      const blob=await resp.blob();
      // Nome legível: remove o timestamp do início (ex: 1234567890_RG.pdf → RG.pdf)
      const parts=item.name.split('_');
      const nomeArquivo=parts.length>1?parts.slice(1).join('_'):item.name;
      zip.file(nomeArquivo, blob);
    }));

    const content=await zip.generateAsync({type:'blob'});
    const link=document.createElement('a');
    link.href=URL.createObjectURL(content);
    link.download=`${nomeEmp}_documentos.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    toast(`ZIP com ${docs.length} documento(s) gerado com sucesso!`);
  } catch(e){
    console.error('Erro ao gerar ZIP:', e);
    toast('Erro ao gerar o arquivo ZIP.','error');
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-file-zipper"></i> Baixar Todos (.zip)'; }
  }
}

// Toggle do input "especificar outros" no upload de documentos
function onDocTipoChange(){
  const sel = val('doc-tipo');
  const row = document.getElementById('doc-tipo-outros-row');
  if(row) row.style.display = (sel === 'Outros') ? '' : 'none';
}

async function uploadDocument(){
  const empId=val('emp-id');
  if(!empId){ toast('Salve o colaborador antes de enviar documentos.','warning'); return; }
  DB.initStorage();
  if(!DB.storage){ toast('Firebase Storage não disponível.','error'); return; }
  const fileInput=document.getElementById('doc-file');
  const file=fileInput?fileInput.files[0]:null;
  if(!file){ toast('Selecione um arquivo.','error'); return; }
  let tipo=val('doc-tipo')||'Outros';
  // Se "Outros", usa o nome customizado especificado pelo operador
  if(tipo === 'Outros'){
    const custom = val('doc-tipo-outros');
    if(!custom || !custom.trim()){
      toast('Especifique qual é o documento ao escolher "Outros".', 'error');
      return;
    }
    // Sanitiza para uso como nome de arquivo (sem caracteres problemáticos)
    tipo = custom.trim().replace(/[\\/:*?"<>|]/g, '-').substring(0, 60);
  }
  const timestamp=Date.now();
  const ext=file.name.split('.').pop();
  const storageName=`${timestamp}_${tipo}.${ext}`;
  const btn=document.getElementById('btn-upload-doc');
  setBtnLoading(btn,true,'');
  try {
    const ref=DB.storage.ref(`employees/${empId}/${storageName}`);
    await ref.put(file);
    toast('Documento enviado com sucesso!');
    if(fileInput) fileInput.value='';
    // Limpa o campo "especificar outros" e volta o select para o padrão
    setVal('doc-tipo-outros','');
    onDocTipoChange();
    await loadDocumentList(empId);
  } catch(e){
    toast('Erro ao enviar documento.','error'); console.error(e);
  } finally {
    setBtnLoading(btn,false,'<i class="fa-solid fa-cloud-arrow-up"></i> Enviar Documento');
  }
}

async function deleteDocument(empId, fileName){
  if(!DB.storage) return;
  document.getElementById('confirm-message').textContent=`Excluir o documento "${fileName.split('_').slice(1).join('_')}"?`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    try {
      await DB.storage.ref(`employees/${empId}/${fileName}`).delete();
      closeModal('modal-confirm');
      toast('Documento excluído.','warning');
      await loadDocumentList(empId);
    } catch(e){ toast('Erro ao excluir documento.','error'); closeModal('modal-confirm'); }
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// PREENCHER PONTO MANUALMENTE
// ============================================

// Helper: detecta se o turno cruza meia-noite (saída no dia seguinte)
function _shiftCrossesMidnight(entrada, saida){
  if(!entrada||!saida) return false;
  return timeToMinutes(saida) < timeToMinutes(entrada);
}

// ============================================
// HE REVIEW — Tolerância CLT + detecção de divergência
// ============================================
// Tolerância CLT: 5min por batida, 10min por dia (Art. 58 §1º + Súmula 366 TST)
const HE_TOLERANCIA_BATIDA_MIN = 5;
const HE_TOLERANCIA_DIA_MIN    = 10;

// Retorna o "esperado" para um dia: prioriza escala salva, depois cadastro contratual
function _getExpectedDay(emp, mes, ano, dia){
  if(!emp) return null;
  // 1) Tenta escala salva
  const esc = (State.escalas||[]).find(e => e.employeeId===emp.id && e.mes==mes && e.ano==ano);
  if(esc?.dias?.length){
    const d = esc.dias.find(x => x.dia===dia);
    if(d){
      return {
        tipo: d.tipo || 'trabalho',
        entrada: d.entrada || '',
        saida:   d.saida   || '',
        intIni:  d.intIni  || '',
        intFim:  d.intFim  || ''
      };
    }
  }
  // 2) Fallback: horários contratuais do cadastro (assume trabalho em dia útil)
  const diaSem = new Date(ano, mes-1, dia).getDay();
  const isWknd = diaSem===0 || diaSem===6;
  const fam = escalaFamilia(emp.escala||'5x2A');
  // Para 5x2 e fins de semana, sem horário esperado (é folga)
  if(fam==='5x2' && isWknd) return { tipo:'folga', entrada:'', saida:'', intIni:'', intFim:'' };
  if(fam==='6x1' && diaSem===0) return { tipo:'folga', entrada:'', saida:'', intIni:'', intFim:'' };
  return {
    tipo:'trabalho',
    entrada: emp.horarioEntrada || '',
    saida:   emp.horarioSaida   || '',
    intIni:  emp.semRefeicao ? '' : (emp.horarioRefIni || '12:00'),
    intFim:  emp.semRefeicao ? '' : (emp.horarioRefFim || '13:00')
  };
}

// Detecta divergência de um dia real vs esperado. Retorna motivos + total minutos de excesso.
function _detectHEDivergencia(realDay, expectedDay){
  const out = { totalMin:0, motivos:[], precisaRevisao:false };
  if(!realDay || !expectedDay) return out;
  if(!realDay.entrada || !realDay.saida || !expectedDay.entrada || !expectedDay.saida) return out;
  if(expectedDay.tipo === 'folga') return out; // dia de folga sem expected — só vira HE se aprovado manualmente
  const ent  = timeToMinutes(realDay.entrada);
  const eEnt = timeToMinutes(expectedDay.entrada);
  // Excesso de ENTRADA (entrou antes do contratual)
  if(ent < eEnt){
    const d = eEnt - ent;
    out.totalMin += d;
    if(d > HE_TOLERANCIA_BATIDA_MIN) out.motivos.push(`Entrou ${d}min antes`);
  }
  // Excesso de SAÍDA (saiu depois)
  let sai  = timeToMinutes(realDay.saida);
  let eSai = timeToMinutes(expectedDay.saida);
  if(_shiftCrossesMidnight(realDay.entrada, realDay.saida) && sai <= ent) sai += 24*60;
  if(_shiftCrossesMidnight(expectedDay.entrada, expectedDay.saida) && eSai <= eEnt) eSai += 24*60;
  if(sai > eSai){
    const d = sai - eSai;
    out.totalMin += d;
    if(d > HE_TOLERANCIA_BATIDA_MIN) out.motivos.push(`Saiu ${d}min depois`);
  }
  // Almoço encurtado (real menor que esperado)
  if(realDay.intIni && realDay.intFim && expectedDay.intIni && expectedDay.intFim){
    const realDur = _calcIntervaloMin(realDay.intIni, realDay.intFim, realDay.entrada, realDay.saida);
    const expDur  = _calcIntervaloMin(expectedDay.intIni, expectedDay.intFim, expectedDay.entrada, expectedDay.saida);
    if(realDur < expDur){
      const d = expDur - realDur;
      out.totalMin += d;
      if(d > HE_TOLERANCIA_BATIDA_MIN) out.motivos.push(`Almoço ${d}min mais curto`);
    }
  }
  // Súmula 366 TST: total > 10min/dia → precisa de revisão; senão CLT permite ignorar
  out.precisaRevisao = out.totalMin > HE_TOLERANCIA_DIA_MIN;
  return out;
}

// Decide qual conjunto de minutos usar no cálculo:
// - dentro da tolerância CLT → usa expected (CLT permite ignorar)
// - acima da tolerância:
//     * aprovado → usa real (HE conta)
//     * pendente/abonado → usa expected (HE não conta até revisar)
function _effectiveMinLiq(realDay, expectedDay, contratosMin){
  const _liq = (d) => {
    if(!d || !d.entrada || !d.saida) return 0;
    let mb = timeToMinutes(d.saida) - timeToMinutes(d.entrada);
    if(mb <= 0) mb += 24*60;
    const mi = _calcIntervaloMin(d.intIni, d.intFim, d.entrada, d.saida);
    return Math.max(0, mb - mi);
  };
  const realLiq = _liq(realDay);
  if(!expectedDay || !expectedDay.entrada) return realLiq; // sem expected, usa real
  const detec = _detectHEDivergencia(realDay, expectedDay);
  const reviewStatus = realDay.heReview?.status || null;
  const useReal = (!detec.precisaRevisao) || (reviewStatus === 'aprovado');
  if(useReal) return realLiq;
  // HE indevida não aprovada → usa expected (zera o excesso)
  return _liq(expectedDay);
}

// Helper: calcula minutos de intervalo, tratando intervalo cross-midnight
// (ex: intIni 23:30, intFim 00:30 num turno noturno → 60min, antes retornava 0)
// Só aplica +24h se o turno também cruza meia-noite (evita inflar HE em typos diurnos)
function _calcIntervaloMin(intIni, intFim, entrada, saida){
  if(!intIni||!intFim) return 0;
  let mi = timeToMinutes(intFim) - timeToMinutes(intIni);
  if(mi < 0 && _shiftCrossesMidnight(entrada, saida)) mi += 24*60;
  return Math.max(0, mi);
}

// Helper: detecta se o intervalo cruza meia-noite (para mostrar "(+1)" no fim)
function _intervaloCrossesMidnight(intIni, intFim, entrada, saida){
  if(!intIni||!intFim) return false;
  if(timeToMinutes(intFim) >= timeToMinutes(intIni)) return false;
  return _shiftCrossesMidnight(entrada, saida);
}

async function openPontoManual(){
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const diasNoMes=new Date(ano,mes,0).getDate();
  const nomesDia=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  // Título
  const tituloEl=document.getElementById('ponto-manual-titulo');
  if(tituloEl) tituloEl.innerHTML=`<i class="fa-solid fa-keyboard"></i> Ponto Manual — ${MESES[mes]}/${ano}${emp?` <span style="font-size:13px;font-weight:400;opacity:.8">· ${emp.nome}</span>`:''}`;
  const grid=document.getElementById('ponto-manual-grid'); if(!grid) return;
  let cards='';
  for(let d=1;d<=diasNoMes;d++){
    const date=new Date(ano,mes-1,d);
    const diaSem=date.getDay();
    const isWeekend=diaSem===0||diaSem===6;
    const isSun=diaSem===0;
    const bgCard=isSun?'#FFF3E0':isWeekend?'#F9FBE7':'#fff';
    const borderCard=isSun?'#FFB74D':isWeekend?'#C5E1A5':'var(--border)';
    const diasLabel=nomesDia[diaSem];
    const diaFormatado=String(d).padStart(2,'0');
    const opStyle=isWeekend?'opacity:.45':'';
    cards+=`<div style="border:1px solid ${borderCard};border-radius:8px;padding:8px 12px;background:${bgCard};display:flex;flex-direction:column;gap:6px" data-dia="${d}" data-semana="${diaSem}">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="min-width:42px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:var(--primary);line-height:1">${diaFormatado}</div>
          <div style="font-size:10px;color:${isWeekend?'#FB8C00':'var(--text-muted)'};font-weight:600;text-transform:uppercase">${diasLabel}</div>
        </div>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4px 6px">
          <div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Entrada</div>
            <input type="time" class="pm-entrada pm-input" style="${opStyle}" onchange="onPontoManualEdit(this);calcResumoManual()">
          </div>
          <div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Saída</div>
            <input type="time" class="pm-saida pm-input" style="${opStyle}" onchange="onPontoManualEdit(this);calcResumoManual()">
            <div class="pm-saida-nextday" style="display:none;font-size:9px;color:#FB8C00;font-weight:600;margin-top:2px">⚠ Saída no dia seguinte</div>
          </div>
          <div>
            <div style="font-size:10px;color:#F59E0B;margin-bottom:2px">🍽 Int. Início</div>
            <input type="time" class="pm-int-ini pm-input" style="${opStyle}" onchange="onPontoManualEdit(this);calcResumoManual()">
          </div>
          <div>
            <div style="font-size:10px;color:#F59E0B;margin-bottom:2px">🍽 Int. Fim</div>
            <input type="time" class="pm-int-fim pm-input" style="${opStyle}" onchange="onPontoManualEdit(this);calcResumoManual()">
            <div class="pm-intfim-nextday" style="display:none;font-size:9px;color:#FB8C00;font-weight:600;margin-top:2px">⚠ Fim no dia seguinte</div>
          </div>
        </div>
      </div>
      <div class="pm-geo-row" style="display:none;padding-top:5px;border-top:1px dashed #ddd;gap:5px;flex-wrap:wrap;align-items:center"></div>
    </div>`;
  }
  grid.innerHTML=cards;
  // Busca direta no Firestore para garantir dados frescos do app de ponto
  let payrollSalvo = State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  try {
    const snap = await DB.fs.collection('payrolls')
      .where('employeeId','==',empId)
      .where('mes','==',mes)
      .where('ano','==',ano)
      .limit(1).get();
    if(!snap.empty){
      payrollSalvo = snap.docs[0].data();
      // Sincroniza State para manter cache atualizado
      const idx = State.payrolls.findIndex(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
      if(idx>=0) State.payrolls[idx]=payrollSalvo;
      else State.payrolls.push(payrollSalvo);
    }
  } catch(e){ console.warn('openPontoManual: fallback para cache local',e); }
  if(payrollSalvo?.pontoManualDias?.length){
    payrollSalvo.pontoManualDias.forEach(d=>{
      const card=document.querySelector(`#ponto-manual-grid [data-dia="${d.dia}"]`);
      if(!card) return;
      const entEl=card.querySelector('.pm-entrada');
      const saiEl=card.querySelector('.pm-saida');
      const iniEl=card.querySelector('.pm-int-ini');
      const fimEl=card.querySelector('.pm-int-fim');
      if(entEl) entEl.value=d.entrada||'';
      if(saiEl) saiEl.value=d.saida||'';
      if(iniEl) iniEl.value=d.intIni||'';
      if(fimEl) fimEl.value=d.intFim||'';
      // Marca origem e visual (app vs editado pelo operador)
      ['entrada','saida','intIni','intFim'].forEach(k=>{
        const sel=k==='entrada'?'.pm-entrada':k==='saida'?'.pm-saida':k==='intIni'?'.pm-int-ini':'.pm-int-fim';
        const inp=card.querySelector(sel);
        if(!inp) return;
        const origem = d[k+'_origem'] || (d[k+'_geo'] ? 'app' : (d[k] ? 'manual' : ''));
        if(origem){ inp.dataset.origem = origem; _updatePontoOrigemMarker(inp); }
        // Geo (📍 — só de batidas do app)
        const geo=d[k+'_geo'];
        if(!geo) return;
        const existing=inp.parentElement.querySelector('.geo-badge');
        if(existing) existing.remove();
        const badge=document.createElement('a');
        badge.className='geo-badge';
        badge.href=`https://maps.google.com/?q=${geo.lat},${geo.lng}`;
        badge.target='_blank';
        badge.title=`Localização registrada pelo app · Precisão: ${geo.acc}m`;
        badge.innerHTML='📍';
        badge.style.cssText='font-size:12px;text-decoration:none;cursor:pointer;margin-left:4px';
        inp.parentElement.appendChild(badge);
      });
    });
  }
  // Mostrar resumo
  document.getElementById('ponto-manual-resumo').style.display='flex';
  calcResumoManual();
  document.getElementById('modal-ponto-manual').classList.remove('hidden');
}

function _getPontoManualCards(){
  return document.querySelectorAll('#ponto-manual-grid [data-dia]');
}

// Marca campo como editado pelo operador (origem='manual') + atualiza visual
function onPontoManualEdit(input){
  if(!input) return;
  // Só marca como manual se houver valor (limpar volta a estado vazio)
  if(input.value){
    input.dataset.origem = 'manual';
  } else {
    delete input.dataset.origem;
  }
  _updatePontoOrigemMarker(input);
}

// Atualiza marcador visual (asterisco laranja) ao lado do input
function _updatePontoOrigemMarker(input){
  if(!input) return;
  const parent = input.parentElement;
  if(!parent) return;
  const existing = parent.querySelector('.pm-origem-mark');
  if(existing) existing.remove();
  if(input.dataset.origem === 'manual' && input.value){
    const mark = document.createElement('span');
    mark.className = 'pm-origem-mark';
    mark.title = 'Editado pelo operador (origem manual)';
    mark.textContent = '*';
    mark.style.cssText = 'color:#E65100;font-weight:700;font-size:13px;margin-left:4px;vertical-align:middle';
    parent.appendChild(mark);
  }
}

function _collectPontoManualDias(){
  const dias=[];
  _getPontoManualCards().forEach(card=>{
    const e  = card.querySelector('.pm-entrada');
    const s  = card.querySelector('.pm-saida');
    const ii = card.querySelector('.pm-int-ini');
    const if_= card.querySelector('.pm-int-fim');
    // Preserva campos auxiliares já existentes no payroll (geo, origem para campos que não foram tocados)
    const dia = parseInt(card.dataset.dia);
    const empId = val('payroll-employee');
    const mesL = parseInt(val('payroll-mes'));
    const anoL = parseInt(val('payroll-ano'));
    const existingPayroll = State.payrolls.find(p=>p.employeeId===empId&&p.mes==mesL&&p.ano==anoL);
    const existingDay = existingPayroll?.pontoManualDias?.find(d=>d.dia===dia) || {};
    const obj = {
      dia,
      diaSem:  parseInt(card.dataset.semana),
      entrada: e?.value || '',
      saida:   s?.value || '',
      intIni:  ii?.value || '',
      intFim:  if_?.value || ''
    };
    // Origem por campo (app = batido no PWA, manual = lançado pelo operador)
    [['entrada',e],['saida',s],['intIni',ii],['intFim',if_]].forEach(([k,inp])=>{
      if(!inp) return;
      if(inp.value){
        // Se input tem dataset.origem usa, senão preserva o salvo, senão 'manual'
        const o = inp.dataset.origem || existingDay[k+'_origem'] || 'manual';
        obj[k+'_origem'] = o;
      }
      // Preserva geo do PWA (mesmo se operador edita, geo original é histórica)
      if(existingDay[k+'_geo']) obj[k+'_geo'] = existingDay[k+'_geo'];
    });
    // Preserva heReview do dia (decisão de aprovação)
    if(existingDay.heReview) obj.heReview = existingDay.heReview;
    dias.push(obj);
  });
  return dias;
}

async function savePontoManualRascunho(){
  const empId=val('payroll-employee');
  if(!empId){ toast('Selecione um colaborador na folha de ponto primeiro.','error'); return; }
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const dias=_collectPontoManualDias();
  const existing=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  const record=existing
    ? {...existing, pontoManualDias:dias, updatedAt:new Date().toISOString()}
    : { id:genId(), employeeId:empId, mes, ano, pontoManualDias:dias,
        updatedAt:new Date().toISOString(), createdAt:new Date().toISOString() };
  const btn=document.getElementById('btn-salvar-rascunho-ponto');
  if(btn) setBtnLoading(btn,true,'');
  try {
    await DB.save('payrolls', record);
    toast('Rascunho do ponto salvo! Os horários serão carregados na próxima vez que abrir.');
  } catch(e){ toast('Erro ao salvar rascunho.','error'); console.error(e); }
  finally { if(btn) setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar Rascunho'); }
}

function calcResumoManual(){
  const cards=_getPontoManualCards();
  let diasTrabalhados=0, faltas=0, totalHEmin=0, pendentes=0;
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const mes=parseInt(val('payroll-mes'));
  const ano=parseInt(val('payroll-ano'));
  const fam=emp?escalaFamilia(emp.escala||'5x2A'):'5x2';
  const is12x36=fam==='12x36';
  let minContratados=480;
  if(fam==='6x1') minContratados=440;
  else if(fam==='12x36') minContratados=660;
  const existingPayroll=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  cards.forEach(card=>{
    const dia=parseInt(card.dataset.dia);
    const diaSem=parseInt(card.dataset.semana);
    const entrada=card.querySelector('.pm-entrada')?.value;
    const saida=card.querySelector('.pm-saida')?.value;
    const intIni=card.querySelector('.pm-int-ini')?.value;
    const intFim=card.querySelector('.pm-int-fim')?.value;
    const isWeekend=diaSem===0||diaSem===6;
    // Toggle dicas visuais "no dia seguinte"
    const saidaHint=card.querySelector('.pm-saida-nextday');
    if(saidaHint) saidaHint.style.display=_shiftCrossesMidnight(entrada,saida)?'block':'none';
    const intHint=card.querySelector('.pm-intfim-nextday');
    if(intHint) intHint.style.display=_intervaloCrossesMidnight(intIni,intFim,entrada,saida)?'block':'none';
    if(entrada&&saida){
      diasTrabalhados++;
      const realDay={dia,diaSem,entrada,saida,intIni,intFim};
      const existingDay=existingPayroll?.pontoManualDias?.find(d=>d.dia===dia);
      if(existingDay?.heReview) realDay.heReview=existingDay.heReview;
      const expectedDay=emp?_getExpectedDay(emp,mes,ano,dia):null;
      const effLiq=_effectiveMinLiq(realDay,expectedDay,minContratados);
      totalHEmin+=Math.max(0,effLiq-minContratados);
      const detec=_detectHEDivergencia(realDay,expectedDay);
      const reviewStatus=realDay.heReview?.status||'pendente';
      if(detec.precisaRevisao && reviewStatus==='pendente') pendentes++;
      _updateHEReviewBadge(card,detec,realDay.heReview);
    } else if(!isWeekend&&!is12x36&&!entrada&&!saida) faltas++;
  });
  const diasEl=document.getElementById('ponto-resumo-dias');
  const faltasEl=document.getElementById('ponto-resumo-faltas');
  const heEl=document.getElementById('ponto-resumo-he');
  const pendEl=document.getElementById('ponto-resumo-he-pendente');
  if(diasEl)   diasEl.textContent=diasTrabalhados;
  if(faltasEl) faltasEl.textContent=faltas;
  if(heEl)     heEl.textContent=totalHEmin>0?minutesToStr(totalHEmin):'0h';
  if(pendEl){
    if(pendentes>0){
      pendEl.style.display='';
      pendEl.innerHTML=`<i class="fa-solid fa-triangle-exclamation" style="color:#E65100"></i> <strong>${pendentes} dia(s)</strong> com HE acima da tolerância — <a href="#" onclick="openHEReview();return false" style="color:#E65100;font-weight:700;text-decoration:underline">revisar agora</a>`;
    } else {
      pendEl.style.display='none';
    }
  }
}

// ============================================
// HE REVIEW — Painel de revisão das divergências
// ============================================

// Helper: payroll do colaborador tem algum dia com HE pendente acima da tolerância?
function _payrollTemPendente(payroll){
  if(!payroll || !payroll.pontoManualDias) return false;
  const emp = State.employees.find(e=>e.id===payroll.employeeId);
  if(!emp) return false;
  return payroll.pontoManualDias.some(d => {
    if(!d.entrada || !d.saida) return false;
    const exp = _getExpectedDay(emp, payroll.mes, payroll.ano, d.dia);
    if(!exp || !exp.entrada) return false;
    const detec = _detectHEDivergencia(d, exp);
    return detec.precisaRevisao && (d.heReview?.status||'pendente')==='pendente';
  });
}

// Conta colaboradores com HE pendente no mês
function _countAllPendentes(mes, ano){
  return (State.payrolls||[])
    .filter(p => p.mes==mes && p.ano==ano)
    .filter(_payrollTemPendente)
    .length;
}

// Acha o próximo payroll com pendentes, pulando empId
function _findNextPendentePayroll(mes, ano, excludeEmpId){
  const payrolls = (State.payrolls||[]).filter(p => p.mes==mes && p.ano==ano);
  // Primeiro tenta outro colaborador
  for(const p of payrolls){
    if(p.employeeId === excludeEmpId) continue;
    if(_payrollTemPendente(p)) return p;
  }
  return null;
}

// Atalho do Dashboard: vai para Folha de Ponto e abre review do 1º colaborador com pendência
function _dashGotoHEReview(){
  const mes = currentMes(), ano = currentAno();
  const payThisMonth = State.payrolls.filter(p=>p.mes==mes&&p.ano==ano);
  for(const p of payThisMonth){
    const emp = State.employees.find(e=>e.id===p.employeeId);
    if(!emp || !p.pontoManualDias) continue;
    const hasPendente = (p.pontoManualDias||[]).some(d => {
      if(!d.entrada || !d.saida) return false;
      const exp = _getExpectedDay(emp, p.mes, p.ano, d.dia);
      if(!exp || !exp.entrada) return false;
      const detec = _detectHEDivergencia(d, exp);
      return detec.precisaRevisao && (d.heReview?.status||'pendente')==='pendente';
    });
    if(hasPendente){
      showSection('payroll');
      setTimeout(() => {
        setVal('payroll-employee', p.employeeId);
        setVal('payroll-mes', p.mes);
        setVal('payroll-ano', p.ano);
        loadPayrollRecord(p.id);
        setTimeout(openHEReview, 300);
      }, 100);
      return;
    }
  }
  toast('Nenhuma HE pendente encontrada.', 'success');
}

// Abre o modal de revisão de HE para o colaborador/mes/ano selecionados
async function openHEReview(){
  // Verifica permissão
  const mods = getUserModules(Auth.currentUser);
  if(!mods.aprovaHE && Auth.currentUser?.role !== 'master'){
    toast('Você não tem permissão para revisar/aprovar horas extras.', 'error');
    return;
  }
  const empId = val('payroll-employee');
  if(!empId){ toast('Selecione um colaborador na Folha de Ponto primeiro.', 'error'); return; }
  const emp = State.employees.find(e=>e.id===empId);
  if(!emp){ toast('Colaborador não encontrado.', 'error'); return; }
  const mes = parseInt(val('payroll-mes')||currentMes());
  const ano = parseInt(val('payroll-ano')||currentAno());
  // Pega payroll diretamente do State (já tem os dias mais recentes do PWA)
  // Se modal Ponto Manual está aberto, prioriza os dados do DOM (mais recentes ainda)
  const cardsAbertos = _getPontoManualCards();
  let dias = [];
  if(cardsAbertos.length){
    // Coleta do DOM, preservando heReview existente
    dias = _collectPontoManualDias();
  } else {
    const payroll = State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
    dias = payroll?.pontoManualDias || [];
  }
  // Filtra dias com divergência > tolerância
  const linhas = [];
  dias.forEach(d => {
    if(!d.entrada || !d.saida) return;
    const expected = _getExpectedDay(emp, mes, ano, d.dia);
    if(!expected || !expected.entrada) return;
    const detec = _detectHEDivergencia(d, expected);
    if(!detec.precisaRevisao) return;
    linhas.push({ d, expected, detec });
  });
  document.getElementById('he-review-info').innerHTML =
    `<strong>${emp.nome}</strong> &middot; ${MESES[mes]}/${ano} &middot; <strong>${linhas.length}</strong> dia(s) com divergência acima de 10min/dia`;
  const listEl = document.getElementById('he-review-list');
  if(!linhas.length){
    listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-check" style="color:#1B5E20"></i><p>Nenhuma divergência acima da tolerância CLT neste mês.</p></div>';
  } else {
    listEl.innerHTML = linhas.map(({d,expected,detec}) => _renderHEReviewRow(d, expected, detec)).join('');
  }
  document.getElementById('modal-he-review').classList.remove('hidden');
}

function _renderHEReviewRow(d, expected, detec){
  // Legacy 'abonado' migrado para 'pendente' visual (mantém valor antigo no dataset pra compat)
  const rawStatus = d.heReview?.status || 'pendente';
  const status = (rawStatus === 'abonado') ? 'pendente' : rawStatus;
  const perc   = d.heReview?.perc   || 50;
  const obs    = d.heReview?.observacao || '';
  const sem    = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.diaSem];
  const aprovado = d.heReview?.aprovadoPor ? `<small style="color:#1B5E20">por <strong>${d.heReview.aprovadoPor}</strong> em ${d.heReview.aprovadoEm ? new Date(d.heReview.aprovadoEm).toLocaleDateString('pt-BR') : '—'}</small>` : '';
  // Dados auxiliares (esperado + real) no dataset para o modo edição
  return `<div class="he-review-card" data-dia="${d.dia}" data-diasem="${d.diaSem}" data-tipo-saved="${status}"
       data-real-entrada="${d.entrada||''}" data-real-saida="${d.saida||''}" data-real-intini="${d.intIni||''}" data-real-intfim="${d.intFim||''}"
       data-exp-entrada="${expected.entrada||''}" data-exp-saida="${expected.saida||''}" data-exp-intini="${expected.intIni||''}" data-exp-intfim="${expected.intFim||''}"
       style="border:1.5px solid #E0E0E0;border-radius:8px;padding:10px 14px;margin-bottom:10px;background:#fff">
    <div class="he-review-display" style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;font-size:14px;color:#E65100">Dia ${String(d.dia).padStart(2,'0')} (${sem}) — ${detec.totalMin}min de excesso</div>
        <div style="font-size:12px;color:#666;margin-top:3px"><strong>Esperado:</strong> ${expected.entrada}–${expected.saida}${expected.intIni?` (ref. ${expected.intIni}–${expected.intFim})`:''}</div>
        <div style="font-size:12px;color:#666"><strong>Real:</strong> ${d.entrada}–${d.saida}${d.intIni?` (ref. ${d.intIni}–${d.intFim})`:''}</div>
        <div style="font-size:11px;color:#E65100;margin-top:3px"><i class="fa-solid fa-list"></i> ${(detec.motivos||['—']).join(' · ')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;min-width:280px">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button type="button" class="btn-he-action" data-act="aprovado" onclick="_selectHEReview(this,'aprovado')" style="flex:1;padding:6px 10px;border:1.5px solid ${status==='aprovado'?'#1B5E20':'#CFD8DC'};background:${status==='aprovado'?'#E8F5E9':'#fff'};color:${status==='aprovado'?'#1B5E20':'#666'};border-radius:4px;cursor:pointer;font-weight:600;font-size:12px"><i class="fa-solid fa-circle-check"></i> Aprovar</button>
          <button type="button" class="btn-he-action" onclick="_startHEReviewEdit(this)" style="flex:1;padding:6px 10px;border:1.5px solid #1565C0;background:#E3F2FD;color:#0D47A1;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px" title="Editar os horários reais deste dia"><i class="fa-solid fa-pen-to-square"></i> Editar</button>
          <button type="button" class="btn-he-action" data-act="pendente" onclick="_selectHEReview(this,'pendente')" style="flex:1;padding:6px 10px;border:1.5px solid ${status==='pendente'?'#E65100':'#CFD8DC'};background:${status==='pendente'?'#FFF3E0':'#fff'};color:${status==='pendente'?'#E65100':'#666'};border-radius:4px;cursor:pointer;font-weight:600;font-size:12px"><i class="fa-solid fa-clock"></i> Pendente</button>
        </div>
        <div class="he-perc-row" style="display:${status==='aprovado'?'flex':'none'};gap:4px;align-items:center">
          <label style="font-size:11px;color:#666;font-weight:600">% HE:</label>
          <select class="he-perc-select" style="flex:1;padding:4px;font-size:12px">
            <option value="50" ${perc==50?'selected':''}>50% — dias úteis</option>
            <option value="60" ${perc==60?'selected':''}>60%</option>
            <option value="70" ${perc==70?'selected':''}>70%</option>
            <option value="100" ${perc==100?'selected':''}>100% — domingo/feriado</option>
          </select>
        </div>
        <input type="text" class="he-obs" placeholder="Justificativa / observação (opcional)" value="${obs.replace(/"/g,'&quot;')}" style="font-size:11px;padding:4px 6px;border:1px solid #CFD8DC;border-radius:4px">
        ${aprovado?`<div style="font-size:10px;text-align:right">${aprovado}</div>`:''}
      </div>
    </div>
    <div class="he-review-edit" style="display:none;background:#F1F5FF;padding:10px;border-radius:6px;margin-top:8px">
      <div style="font-size:12px;font-weight:700;color:#0D47A1;margin-bottom:8px"><i class="fa-solid fa-pen-to-square"></i> Editar horários reais do dia ${String(d.dia).padStart(2,'0')} (${sem})</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 10px">
        <div><label style="font-size:10px;color:#666;font-weight:600">Entrada</label><input type="time" class="he-edit-entrada" value="${d.entrada||''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #CFD8DC;border-radius:4px"></div>
        <div><label style="font-size:10px;color:#666;font-weight:600">Saída</label><input type="time" class="he-edit-saida" value="${d.saida||''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #CFD8DC;border-radius:4px"></div>
        <div><label style="font-size:10px;color:#F59E0B;font-weight:600">🍽 Início Refeição</label><input type="time" class="he-edit-intini" value="${d.intIni||''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #CFD8DC;border-radius:4px"></div>
        <div><label style="font-size:10px;color:#F59E0B;font-weight:600">🍽 Retorno Refeição</label><input type="time" class="he-edit-intfim" value="${d.intFim||''}" style="width:100%;padding:4px;font-size:12px;border:1px solid #CFD8DC;border-radius:4px"></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
        <button type="button" class="btn btn-outline" onclick="_cancelHEReviewEdit(this)" style="padding:6px 14px;font-size:12px"><i class="fa-solid fa-xmark"></i> Cancelar</button>
        <button type="button" class="btn btn-primary" onclick="_applyHEReviewEdit(this)" style="padding:6px 14px;font-size:12px;background:#1565C0"><i class="fa-solid fa-check"></i> Aplicar edição</button>
      </div>
      <div style="font-size:10px;color:#666;margin-top:6px"><i class="fa-solid fa-info-circle"></i> Os horários serão marcados como editados pelo operador (asterisco no Ponto Manual). O sistema recalcula a divergência automaticamente.</div>
    </div>
  </div>`;
}

function _startHEReviewEdit(btn){
  const card = btn.closest('.he-review-card');
  if(!card) return;
  card.querySelector('.he-review-display').style.display = 'none';
  card.querySelector('.he-review-edit').style.display = '';
}

function _cancelHEReviewEdit(btn){
  const card = btn.closest('.he-review-card');
  if(!card) return;
  // Restaura inputs aos valores originais (em caso de cancelar após editar mas não aplicar)
  card.querySelector('.he-edit-entrada').value = card.dataset.realEntrada || '';
  card.querySelector('.he-edit-saida').value   = card.dataset.realSaida   || '';
  card.querySelector('.he-edit-intini').value  = card.dataset.realIntini  || '';
  card.querySelector('.he-edit-intfim').value  = card.dataset.realIntfim  || '';
  card.querySelector('.he-review-edit').style.display = 'none';
  card.querySelector('.he-review-display').style.display = 'flex';
}

// Aplica edição inline: atualiza dataset + sinaliza pendente de save, recalcula divergência exibida
function _applyHEReviewEdit(btn){
  const card = btn.closest('.he-review-card');
  if(!card) return;
  const newE = card.querySelector('.he-edit-entrada').value;
  const newS = card.querySelector('.he-edit-saida').value;
  const newII = card.querySelector('.he-edit-intini').value;
  const newIF = card.querySelector('.he-edit-intfim').value;
  // Marca como dirty para o saveHEReview persistir as edições
  card.dataset.edited = '1';
  card.dataset.realEntrada = newE;
  card.dataset.realSaida   = newS;
  card.dataset.realIntini  = newII;
  card.dataset.realIntfim  = newIF;
  // Recalcula divergência com os novos valores
  const expected = {
    tipo: 'trabalho',
    entrada: card.dataset.expEntrada || '',
    saida:   card.dataset.expSaida   || '',
    intIni:  card.dataset.expIntini  || '',
    intFim:  card.dataset.expIntfim  || ''
  };
  const real = { entrada:newE, saida:newS, intIni:newII, intFim:newIF };
  const detec = _detectHEDivergencia(real, expected);
  // Atualiza visual do display (resumo)
  const display = card.querySelector('.he-review-display');
  const realRow = display.querySelector('div > div:nth-child(3)'); // 3rd div é "Real: ..."
  if(realRow){
    realRow.innerHTML = `<strong>Real (editado *):</strong> ${newE}–${newS}${newII?` (ref. ${newII}–${newIF})`:''}`;
  }
  const motRow = display.querySelector('div > div:nth-child(4)');
  if(motRow){
    motRow.innerHTML = `<i class="fa-solid fa-list"></i> ${(detec.motivos||['Dentro da tolerância CLT']).join(' · ')}`;
  }
  const tituloRow = display.querySelector('div > div:first-child');
  if(tituloRow){
    if(detec.precisaRevisao){
      tituloRow.innerHTML = `Dia ${card.dataset.dia} — ${detec.totalMin}min de excesso <small style="color:#0D47A1">(editado)</small>`;
    } else {
      tituloRow.innerHTML = `Dia ${card.dataset.dia} <small style="color:#1B5E20">— dentro da tolerância após edição ✓</small>`;
    }
  }
  // Esconde edit, mostra display
  card.querySelector('.he-review-edit').style.display = 'none';
  display.style.display = 'flex';
  toast('Edição aplicada. Clique em "Salvar revisão" para persistir.', 'info');
}

function _selectHEReview(btn, action){
  const card = btn.closest('.he-review-card');
  if(!card) return;
  card.dataset.tipoSaved = action;
  // Atualiza visual apenas dos botões de status (Aprovar/Pendente) — Editar fica intacto
  card.querySelectorAll('.btn-he-action[data-act]').forEach(b => {
    const a = b.dataset.act;
    const isSel = a === action;
    let cor, bg;
    if(a==='aprovado'){ cor='#1B5E20'; bg='#E8F5E9'; }
    else                { cor='#E65100'; bg='#FFF3E0'; } // pendente
    b.style.borderColor = isSel ? cor : '#CFD8DC';
    b.style.background  = isSel ? bg  : '#fff';
    b.style.color       = isSel ? cor : '#666';
  });
  // Mostra/esconde linha do %
  const percRow = card.querySelector('.he-perc-row');
  if(percRow) percRow.style.display = (action === 'aprovado') ? 'flex' : 'none';
}

async function saveHEReview(){
  const mods = getUserModules(Auth.currentUser);
  if(!mods.aprovaHE && Auth.currentUser?.role !== 'master'){
    toast('Sem permissão.', 'error');
    return;
  }
  const empId = val('payroll-employee');
  const mes = parseInt(val('payroll-mes'));
  const ano = parseInt(val('payroll-ano'));
  // Coleta decisões + edições do modal
  const decisoes = {};
  const edicoes  = {};
  document.querySelectorAll('#he-review-list .he-review-card').forEach(card => {
    const dia = parseInt(card.dataset.dia);
    const status = card.dataset.tipoSaved || 'pendente';
    const percSel = card.querySelector('.he-perc-select');
    const obs = card.querySelector('.he-obs')?.value || '';
    decisoes[dia] = {
      status,
      perc: status==='aprovado' ? (parseInt(percSel?.value)||50) : null,
      observacao: obs,
      aprovadoPor: (status==='aprovado') ? Auth.currentUser?.username : null,
      aprovadoEm:  (status==='aprovado') ? new Date().toISOString() : null
    };
    // Se foi editado inline, coleta os novos horários
    if(card.dataset.edited === '1'){
      edicoes[dia] = {
        entrada: card.dataset.realEntrada || '',
        saida:   card.dataset.realSaida   || '',
        intIni:  card.dataset.realIntini  || '',
        intFim:  card.dataset.realIntfim  || ''
      };
    }
  });
  // Aplica nas pontoManualDias do payroll
  const payroll = State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  if(!payroll){ toast('Folha de Ponto não encontrada — salve o ponto antes.', 'error'); return; }
  const newDias = (payroll.pontoManualDias||[]).map(d => {
    const dec = decisoes[d.dia];
    const ed  = edicoes[d.dia];
    let out = { ...d };
    if(ed){
      // Aplica edição inline + marca origem='manual' nos campos editados
      ['entrada','saida','intIni','intFim'].forEach(k => {
        if(ed[k] !== d[k]){
          out[k] = ed[k];
          out[k+'_origem'] = 'manual';
        }
      });
      // Após edição, recalcula divergência com os novos valores
      const emp = State.employees.find(e=>e.id===empId);
      const expected = emp ? _getExpectedDay(emp, mes, ano, d.dia) : null;
      const detec = expected ? _detectHEDivergencia(out, expected) : { precisaRevisao:false };
      // Se não há mais divergência > 10min, limpa heReview (não precisa mais revisar)
      if(!detec.precisaRevisao){
        delete out.heReview;
        return out;
      }
    }
    if(dec){
      out.heReview = dec;
    }
    return out;
  });
  // Se modal Ponto Manual está aberto, atualiza os dados em memória direto
  if(_getPontoManualCards().length){
    // Aplica também no payroll do State
    payroll.pontoManualDias = newDias;
  }
  const btn = document.querySelector('#modal-he-review .btn-primary');
  if(btn) setBtnLoading(btn, true, '');
  try {
    const updated = { ...payroll, pontoManualDias: newDias, updatedAt: new Date().toISOString() };
    await DB.save('payrolls', updated);
    // Atualiza State.payrolls em memória pra refletir mudança imediata
    const idx = State.payrolls.findIndex(p=>p.id===updated.id);
    if(idx >= 0) State.payrolls[idx] = updated;
    Auth.log('HE_REVIEW_SAVED', null, `${MESES[mes]}/${ano} — ${Object.keys(decisoes).length} dia(s) revisados`);
    closeModal('modal-he-review');
    // Recalcula resumo do Ponto Manual se aberto
    if(_getPontoManualCards().length) calcResumoManual();
    // Recalcula folha (atualiza payroll-he-total / valor)
    recalculate();
    // Atualiza dashboard SEMPRE (mesmo se não visível) para próxima visita estar fresh
    renderDashboard();
    // ───────────────────────────────────────────────────────────────────
    // Pós-save: verifica pendentes restantes e oferece próxima ação
    // ───────────────────────────────────────────────────────────────────
    const isPontoManualOpen = _getPontoManualCards().length > 0;
    // Mesmo colaborador ainda tem dias pendentes?
    const updatedPayroll = State.payrolls.find(p => p.id === updated.id);
    const sameStillPending = _payrollTemPendente(updatedPayroll);
    if(sameStillPending){
      // Reabre o painel automaticamente para revisar os dias restantes
      toast('✓ Revisão salva — este colaborador ainda tem dias pendentes. Reabrindo painel...', 'info');
      setTimeout(() => openHEReview(), 500);
      return;
    }
    // Próximo colaborador com pendentes (só sugere se não está dentro do fluxo de Ponto Manual)
    if(!isPontoManualOpen){
      const nextPay = _findNextPendentePayroll(mes, ano, empId);
      if(nextPay){
        const empNext  = State.employees.find(e=>e.id===nextPay.employeeId);
        const remaining = _countAllPendentes(mes, ano);
        const empNome  = empNext?.nome || 'próximo colaborador';
        const msg = `✓ Revisão salva!\n\nAinda há ${remaining} colaborador(es) com HE pendente neste mês.\n\nDeseja revisar o próximo agora?\n— ${empNome}`;
        setTimeout(() => {
          if(confirm(msg)){
            setVal('payroll-employee', nextPay.employeeId);
            setVal('payroll-mes',      nextPay.mes);
            setVal('payroll-ano',      nextPay.ano);
            loadPayrollRecord(nextPay.id);
            setTimeout(() => openHEReview(), 400);
          } else {
            toast(`${remaining} colaborador(es) ainda têm HE pendente. Volte ao Dashboard quando quiser revisar.`, 'info');
          }
        }, 300);
        return;
      }
    }
    // Não há mais pendentes
    toast('🎉 Todas as HE pendentes deste mês foram revisadas!', 'success');
  } catch(e){
    console.error(e);
    toast('Erro ao salvar revisão.', 'error');
  } finally {
    if(btn) setBtnLoading(btn, false, '<i class="fa-solid fa-floppy-disk"></i> Salvar revisão');
  }
}

// Atualiza badge visual de "HE pendente" no card de um dia
function _updateHEReviewBadge(card, detec, heReview){
  if(!card) return;
  const existing = card.querySelector('.pm-he-review-badge');
  if(existing) existing.remove();
  if(!detec || !detec.precisaRevisao) return;
  const status = heReview?.status || 'pendente';
  let bg, color, label, icon;
  if(status === 'aprovado'){ bg='#E8F5E9'; color='#1B5E20'; label=`HE aprovada · ${heReview.perc||50}%`; icon='circle-check'; }
  else if(status === 'abonado'){ bg='#ECEFF1'; color='#37474F'; label='HE abonada'; icon='ban'; }
  else                          { bg='#FFF3E0'; color='#E65100'; label=`HE pendente · ${detec.totalMin}min`; icon='triangle-exclamation'; }
  const badge = document.createElement('div');
  badge.className = 'pm-he-review-badge';
  badge.title = (detec.motivos||[]).join(' · ');
  badge.style.cssText = `font-size:10px;font-weight:700;color:${color};background:${bg};padding:2px 8px;border-radius:4px;margin-top:4px;display:inline-block;cursor:pointer`;
  badge.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${label}`;
  badge.onclick = () => openHEReview();
  card.appendChild(badge);
}

async function applyPontoManual(){
  const cards=_getPontoManualCards();
  let diasTrabalhados=0, faltas=0, totalHEmin=0;
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const fam=emp?escalaFamilia(emp.escala||'5x2A'):'5x2';
  const is12x36=fam==='12x36';
  let minContratados=480;
  if(fam==='6x1') minContratados=440;
  else if(fam==='12x36') minContratados=660;
  const existingPayroll=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  cards.forEach(card=>{
    const dia=parseInt(card.dataset.dia);
    const diaSem=parseInt(card.dataset.semana);
    const entrada=card.querySelector('.pm-entrada')?.value;
    const saida=card.querySelector('.pm-saida')?.value;
    const intIni=card.querySelector('.pm-int-ini')?.value;
    const intFim=card.querySelector('.pm-int-fim')?.value;
    const isWeekend=diaSem===0||diaSem===6;
    if(entrada&&saida){
      diasTrabalhados++;
      const realDay={dia,diaSem,entrada,saida,intIni,intFim};
      const existingDay=existingPayroll?.pontoManualDias?.find(d=>d.dia===dia);
      if(existingDay?.heReview) realDay.heReview=existingDay.heReview;
      const expectedDay=emp?_getExpectedDay(emp,mes,ano,dia):null;
      const effLiq=_effectiveMinLiq(realDay,expectedDay,minContratados);
      totalHEmin+=Math.max(0,effLiq-minContratados);
    } else if(!isWeekend&&!is12x36&&!entrada&&!saida) faltas++;
  });
  // Salva horários no Firebase antes de aplicar
  if(empId){
    const dias=_collectPontoManualDias();
    const existing=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
    const record=existing
      ? {...existing, pontoManualDias:dias, updatedAt:new Date().toISOString()}
      : { id:genId(), employeeId:empId, mes, ano, pontoManualDias:dias,
          updatedAt:new Date().toISOString(), createdAt:new Date().toISOString() };
    try{ await DB.save('payrolls', record); } catch(e){ console.error('Erro ao salvar ponto:',e); }
  }
  setVal('payroll-dias',diasTrabalhados);
  setVal('payroll-faltas-injustificadas',faltas);
  setVal('payroll-faltas-justificadas',0);
  if(totalHEmin>0) setVal('payroll-he-total',(totalHEmin/60).toFixed(2));
  recalculate();
  closeModal('modal-ponto-manual');
  toast(`Aplicado: ${diasTrabalhados} dias trabalhados / ${faltas} falta(s)${totalHEmin>0?' / '+minutesToStr(totalHEmin)+' HE':''}.`);
}

// ============================================
// PRÉVIA PARCIAL — calcula em memória, imprime, restaura o formulário
// ============================================
function printPreviewParcial(){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  if(!empId||!emp){ toast('Selecione um colaborador na folha de ponto primeiro.','error'); return; }

  // Campos do formulário que serão temporariamente alterados
  const campos=['payroll-dias','payroll-faltas-injustificadas','payroll-faltas-justificadas',
    'payroll-he-total','payroll-he-valor','payroll-remuneracao','payroll-bonus',
    'payroll-vt-total','payroll-vr-total','payroll-va-liquido','payroll-adiantamento-valor',
    'payroll-noturno','payroll-acumulo','payroll-insalubridade','payroll-desconto-atraso'];
  const backup={};
  campos.forEach(f=>{ backup[f]=val(f); });

  // Calcula dias/faltas/HE do grid atual sem salvar no Firebase
  const cards=_getPontoManualCards();
  let diasTrabalhados=0, faltas=0, totalHEmin=0;
  const fam=escalaFamilia(emp.escala||'5x2A');
  const is12x36=fam==='12x36';
  cards.forEach(card=>{
    const diaSem=parseInt(card.dataset.semana);
    const entrada=card.querySelector('.pm-entrada')?.value;
    const saida=card.querySelector('.pm-saida')?.value;
    const intIni=card.querySelector('.pm-int-ini')?.value;
    const intFim=card.querySelector('.pm-int-fim')?.value;
    const isWeekend=diaSem===0||diaSem===6;
    if(entrada&&saida){
      diasTrabalhados++;
      let mb=timeToMinutes(saida)-timeToMinutes(entrada);
      if(mb<=0) mb+=24*60;
      const mi=_calcIntervaloMin(intIni,intFim,entrada,saida);
      const minLiq=mb-mi;
      let minContr=480;
      if(fam==='6x1') minContr=440;
      else if(fam==='12x36') minContr=660;
      totalHEmin+=Math.max(0,minLiq-minContr);
    } else if(!isWeekend&&!is12x36&&!entrada&&!saida) faltas++;
  });

  // Aplica temporariamente ao formulário e recalcula
  setVal('payroll-dias',diasTrabalhados);
  setVal('payroll-faltas-injustificadas',faltas);
  setVal('payroll-faltas-justificadas',0);
  if(totalHEmin>0) setVal('payroll-he-total',(totalHEmin/60).toFixed(2));
  recalculate();

  // Imprime com flag de prévia (adiciona watermark e faixa laranja)
  printFolhaPonto(true);

  // Restaura formulário original após o print ser gerado
  setTimeout(()=>{
    campos.forEach(f=>{ setVal(f,backup[f]); });
    recalculate();
  }, 600);
}

// ============================================
// IMPRIMIR FOLHA DE PONTO
// ============================================
function printFolhaPonto(isPreview=false){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  if(!empId||!emp){ toast('Selecione um colaborador na folha de ponto primeiro.','error'); return; }

  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  const mesLabel=MESES[mes]||'';

  // Dados financeiros da folha de ponto (form atual ou registro salvo)
  const payrollReg=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);

  const salarioBase=emp.salarioBase||0;
  const diasTrabalhados=numVal('payroll-dias')||0;
  const faltasInj=numVal('payroll-faltas-injustificadas')||0;
  const faltasJust=numVal('payroll-faltas-justificadas')||0;
  const remuneracao=numVal('payroll-remuneracao')||0;
  const vtTotal=numVal('payroll-vt-total')||0;
  const vrTotal=numVal('payroll-vr-total')||0;
  const vaLiquido=numVal('payroll-va-liquido')||0;
  const bonificacao=numVal('payroll-bonus')||0;
  const heTotalHoras=numVal('payroll-he-total')||0;
  const heTotal=heTotalHoras>0?minutesToStr(Math.round(heTotalHoras*60)):'0';
  const heValor=numVal('payroll-he-valor')||0;
  const heCorridoMin=numVal('payroll-he-corrido-min')||0;
  const heCorridoValor=numVal('payroll-he-corrido-valor')||0;
  const heCorridoDetalhe=val('payroll-he-corrido-detalhe')||'';
  const adNoturno=numVal('payroll-noturno')||0;
  const acumulo=numVal('payroll-acumulo')||0;
  const insalubridade=numVal('payroll-insalubridade')||0;
  const adiantamento=numVal('payroll-adiantamento-valor')||0;
  const descontoAtraso=numVal('payroll-desconto-atraso')||0;
  const totalLiquido=remuneracao+heValor+heCorridoValor+adNoturno+acumulo+insalubridade+bonificacao+vtTotal+vrTotal+vaLiquido-adiantamento-descontoAtraso;

  // Posto do colaborador
  const posto=State.postos.find(p=>p.id===emp.posto)||{razaoSocial:'—', endereco:'—'};

  // Dados do ponto manual (do modal aberto ou do registro Firebase)
  const cards=_getPontoManualCards();
  const usandoModal=cards.length>0;
  const diasPonto=usandoModal ? _collectPontoManualDias() : (payrollReg?.pontoManualDias||[]);
  const fam=escalaFamilia(emp.escala||'5x2A');
  const is12x36=fam==='12x36';

  // Monta tabela de dias do mês
  const diasNoMes=new Date(ano,mes,0).getDate();
  const diasSemana=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  let tabelaDias='';
  for(let d=1;d<=diasNoMes;d++){
    const dow=new Date(ano,mes-1,d).getDay();
    const nomeDia=diasSemana[dow];
    const isWknd=dow===0||dow===6;
    const pontodia=diasPonto.find(x=>x.dia===d)||{};
    const entrada=pontodia.entrada||'';
    const saida=pontodia.saida||'';
    const intIni=pontodia.intIni||'';
    const intFim=pontodia.intFim||'';
    let minLiq=0;
    if(entrada&&saida){
      let mb=timeToMinutes(saida)-timeToMinutes(entrada);
      if(mb<=0) mb+=24*60;
      const mi=_calcIntervaloMin(intIni,intFim,entrada,saida);
      minLiq=mb-mi;
    }
    const horasLiq=minLiq>0?minutesToStr(minLiq):'';
    // Sufixo (+1) para saída/intFim cross-midnight em turno noturno
    const saidaDisplay=_shiftCrossesMidnight(entrada,saida)?`${saida} <span style="color:#FB8C00;font-size:9px">(+1)</span>`:saida;
    const intFimDisplay=_intervaloCrossesMidnight(intIni,intFim,entrada,saida)?`${intFim} <span style="color:#FB8C00;font-size:9px">(+1)</span>`:intFim;
    let obsdia='';
    if(!entrada&&!saida){
      if(isWknd||is12x36) obsdia='Folga';
      else obsdia='Falta';
    }
    const rowBg=isWknd?'background:#F8F9FA;color:#999':'';
    tabelaDias+=`<tr style="${rowBg}">
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${String(d).padStart(2,'0')}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${nomeDia}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${entrada}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${saidaDisplay}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intIni}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intFimDisplay}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6;font-weight:${horasLiq?'600':'400'}">${horasLiq}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6;color:#E65100">${obsdia}</td>
    </tr>`;
  }

  const reg=emp.registro?String(emp.registro).padStart(4,'0'):'—';
  const dataAtual=new Date().toLocaleDateString('pt-BR');

  const html=`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${isPreview?'PRÉVIA — ':''}Folha de Ponto — ${emp.nome} — ${mesLabel}/${ano}</title>
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{ font-family:Arial,sans-serif; font-size:11px; color:#212529; padding:16px; }
  h1{ font-size:15px; color:#1a3a6b; }
  h2{ font-size:12px; color:#1a3a6b; margin:10px 0 4px; border-bottom:1px solid #1a3a6b; padding-bottom:2px; }
  .header{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; border-bottom:2px solid #1a3a6b; padding-bottom:8px; }
  .header-left h1{ margin-bottom:2px; }
  .header-left p{ font-size:10px; color:#666; }
  .header-right{ text-align:right; font-size:10px; color:#666; }
  .info-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:10px; }
  .info-item{ background:#F1F5FF; border-radius:3px; padding:4px 7px; }
  .info-label{ font-size:9px; color:#5A7AB5; font-weight:600; text-transform:uppercase; }
  .info-value{ font-size:11px; font-weight:600; color:#1a3a6b; }
  table{ width:100%; border-collapse:collapse; font-size:10px; }
  th{ background:#1a3a6b; color:#fff; padding:4px 6px; text-align:center; border:1px solid #1a3a6b; }
  .fin-table{ margin-top:10px; }
  .fin-table td{ padding:4px 8px; border:1px solid #DEE2E6; }
  .fin-table tr:nth-child(even){ background:#F8F9FA; }
  .fin-label{ font-weight:600; color:#444; width:220px; }
  .fin-value{ text-align:right; width:100px; }
  .fin-total{ background:#1a3a6b!important; color:#fff; font-weight:700; font-size:12px; }
  .assinaturas{ display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin-top:20px; }
  .assinatura-box{ border-top:1px solid #444; padding-top:6px; text-align:center; font-size:10px; color:#555; }
  .resumo-bar{ display:flex; gap:10px; margin:6px 0 10px; }
  .resumo-item{ background:#E8F5E9; border-radius:3px; padding:4px 10px; flex:1; text-align:center; }
  .resumo-item.alerta{ background:#FFF3E0; }
  .resumo-label{ font-size:9px; color:#555; }
  .resumo-valor{ font-size:13px; font-weight:700; color:#1B5E20; }
  .resumo-item.alerta .resumo-valor{ color:#E65100; }
  .preview-banner{ background:#E65100;color:#fff;padding:8px 14px;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;gap:10px;font-size:11px; }
  .preview-banner strong{ font-size:13px; }
  @media print{ body{ padding:8px; } }
</style>
</head>
<body>
${isPreview?`<div class="preview-banner">
  <span style="font-size:18px">⚠️</span>
  <div><strong>PRÉVIA PARCIAL — DOCUMENTO NÃO OFICIAL</strong><br>
  Gerado em ${dataAtual} com base nos registros até o momento. Os valores são proporcionais aos dias já trabalhados e podem mudar até o fechamento do mês.</div>
</div>`:''}
<div class="header">
  <div class="header-left">
    <h1>${_e('nomeEmpresa')}</h1>
    <p>CNPJ: ${_e('cnpj')} &nbsp;|&nbsp; ${_e('descricao')}</p>
    <p style="font-size:12px;font-weight:700;color:${isPreview?'#E65100':'#1a3a6b'};margin-top:4px">${isPreview?'PRÉVIA — ':''}FOLHA DE PONTO — ${mesLabel.toUpperCase()} / ${ano}</p>
  </div>
  <div class="header-right">
    <p>${isPreview?'<strong style="color:#E65100">PRÉVIA PARCIAL</strong><br>':''}</p>
    <p>Emitido em: ${dataAtual}</p>
    <p>Competência: ${mesLabel}/${ano}</p>
    <p>Registro nº ${reg}</p>
  </div>
</div>

<h2>Dados do Colaborador</h2>
<div class="info-grid">
  <div class="info-item"><div class="info-label">Nome</div><div class="info-value">${emp.nome}</div></div>
  <div class="info-item"><div class="info-label">CPF</div><div class="info-value">${emp.cpf||'—'}</div></div>
  <div class="info-item"><div class="info-label">RG</div><div class="info-value">${emp.rg||'—'}</div></div>
  <div class="info-item"><div class="info-label">PIS/PASEP</div><div class="info-value">${emp.pis||'—'}</div></div>
  <div class="info-item"><div class="info-label">Cargo / Função</div><div class="info-value">${emp.cargo||'—'}</div></div>
  <div class="info-item"><div class="info-label">Escala</div><div class="info-value">${emp.escala||'—'}</div></div>
  <div class="info-item"><div class="info-label">Admissão</div><div class="info-value">${emp.admissao?fmtDate(emp.admissao):'—'}</div></div>
  <div class="info-item"><div class="info-label">Posto de Trabalho</div><div class="info-value">${posto.razaoSocial||'—'}</div></div>
  <div class="info-item"><div class="info-label">Salário Base</div><div class="info-value">${fmtMoney(salarioBase)}</div></div>
  <div class="info-item"><div class="info-label">Horário Contratual</div><div class="info-value">${emp.horarioEntrada||'—'} – ${emp.horarioSaida||'—'}${emp.semRefeicao?' <span style="font-size:10px;color:#C62828">(Sem refeição)</span>':((emp.horarioRefIni||emp.horarioRefFim)?` <span style="font-size:10px;color:#888">(Ref. ${emp.horarioRefIni||'—'}–${emp.horarioRefFim||'—'})</span>`:'')}</div></div>
  <div class="info-item"><div class="info-label">Banco de Horas</div><div class="info-value">${emp.bancoHoras||'—'}</div></div>
  <div class="info-item"><div class="info-label">Status</div><div class="info-value">${(emp.status||'ativo').charAt(0).toUpperCase()+(emp.status||'ativo').slice(1)}</div></div>
</div>

<h2>Resumo do Período</h2>
<div class="resumo-bar">
  <div class="resumo-item"><div class="resumo-label">Dias Trabalhados</div><div class="resumo-valor">${diasTrabalhados}</div></div>
  <div class="resumo-item alerta"><div class="resumo-label">Faltas Injust.</div><div class="resumo-valor">${faltasInj}</div></div>
  <div class="resumo-item alerta"><div class="resumo-label">Faltas Just.</div><div class="resumo-valor">${faltasJust}</div></div>
  <div class="resumo-item"><div class="resumo-label">Horas Extras</div><div class="resumo-valor">${heTotal}</div></div>
</div>

<h2>Registro de Ponto Diário</h2>
<table>
  <thead>
    <tr>
      <th>Dia</th><th>Sem.</th><th>Entrada</th><th>Saída</th>
      <th>Int. Início</th><th>Int. Fim</th><th>Horas Líq.</th><th>Obs.</th>
    </tr>
  </thead>
  <tbody>${tabelaDias}</tbody>
</table>

<h2 style="margin-top:12px">Demonstrativo Financeiro</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
  <table class="fin-table">
    <tr><td class="fin-label">Remuneração do Período</td><td class="fin-value">${fmtMoney(remuneracao)}</td></tr>
    <tr><td class="fin-label">Horas Extras (${heTotal})</td><td class="fin-value">${fmtMoney(heValor)}</td></tr>
    ${heCorridoValor>0?`<tr><td class="fin-label">HE Hora Corrida ${heCorridoDetalhe?`<small style="color:#7B1FA2">— ${heCorridoDetalhe}</small>`:''}</td><td class="fin-value">${fmtMoney(heCorridoValor)}</td></tr>`:''}
    ${adNoturno>0?`<tr><td class="fin-label">Adicional Noturno</td><td class="fin-value">${fmtMoney(adNoturno)}</td></tr>`:''}
    ${acumulo>0?`<tr><td class="fin-label">Acúmulo de Função (+20%)</td><td class="fin-value">${fmtMoney(acumulo)}</td></tr>`:''}
    ${insalubridade>0?`<tr><td class="fin-label">Insalubridade</td><td class="fin-value">${fmtMoney(insalubridade)}</td></tr>`:''}
    ${bonificacao>0?`<tr><td class="fin-label">Bonificação</td><td class="fin-value">${fmtMoney(bonificacao)}</td></tr>`:''}
    ${vtTotal>0?`<tr><td class="fin-label">Vale Transporte</td><td class="fin-value">${fmtMoney(vtTotal)}</td></tr>`:''}
    ${vrTotal>0?`<tr><td class="fin-label">Vale Refeição</td><td class="fin-value">${fmtMoney(vrTotal)}</td></tr>`:''}
    ${vaLiquido>0?`<tr><td class="fin-label">Vale Alimentação</td><td class="fin-value">${fmtMoney(vaLiquido)}</td></tr>`:''}
    ${descontoAtraso>0?`<tr><td class="fin-label">Desconto Atraso</td><td class="fin-value" style="color:#c0392b">${fmtMoney(descontoAtraso)}</td></tr>`:''}
    ${adiantamento>0?`<tr><td class="fin-label">Adiantamento (${numVal('payroll-adiantamento-perc')||40}%)</td><td class="fin-value" style="color:#c0392b">${fmtMoney(adiantamento)}</td></tr>`:''}
    <tr class="fin-total"><td class="fin-label" style="color:#fff">TOTAL LÍQUIDO A RECEBER</td><td class="fin-value" style="color:#fff">${fmtMoney(totalLiquido)}</td></tr>
  </table>
  <div>
    <div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:4px;padding:10px;text-align:center">
      <div style="font-size:10px;color:#388E3C;font-weight:600;text-transform:uppercase">Total Líquido</div>
      <div style="font-size:20px;font-weight:700;color:#1B5E20">${fmtMoney(totalLiquido)}</div>
      <div style="font-size:9px;color:#555;margin-top:2px">${mesLabel} / ${ano}</div>
    </div>
  </div>
</div>

<div class="assinaturas">
  <div class="assinatura-box">
    ${_e('nomeEmpresa')}<br>Empresa / Responsável
  </div>
  <div class="assinatura-box">
    ${emp.nome}<br>Colaborador
  </div>
  <div class="assinatura-box">
    ____________________________<br>Conferido por
  </div>
</div>

<script>window.onload=function(){ window.print(); }<\/script>
</body>
</html>`;

  const win=window.open('','_blank','width=900,height=700');
  if(!win){ toast('Permita pop-ups para imprimir a folha.','error'); return; }
  win.document.write(html);
  win.document.close();
}

// ============================================
// EXPORTAR TODAS AS FOLHAS EM PDF (lote)
// ============================================
function _buildFolhaHtmlFromRecord(emp, p){
  const mes      = p.mes;
  const ano      = p.ano;
  const mesLabel = MESES[mes]||'';
  const posto    = State.postos.find(x=>x.id===emp.posto)||{razaoSocial:'—'};
  const reg      = emp.registro?String(emp.registro).padStart(4,'0'):'—';
  const dataAtual= new Date().toLocaleDateString('pt-BR');

  // Valores financeiros do registro salvo
  const diasTrabalhados = p.diasTrabalhados||0;
  const faltasInj       = p.faltasInjustificadas||0;
  const faltasJust      = p.faltasJustificadas||0;
  const remuneracao     = p.remuneracao||0;
  const vtTotal         = p.valeTransporte||0;
  const vrTotal         = p.valeRefeicao||0;
  const vaLiquido       = p.valeAlimentacaoLiquido||0;
  const bonificacao     = p.bonificacao||0;
  const heValor         = p.horasExtrasValor||0;
  const heTotalHoras    = p.horasExtrasTotal||0;
  const hePerc          = p.horasExtrasPerc||50;
  const heTotal         = heTotalHoras>0?minutesToStr(Math.round(heTotalHoras*60)):'0';
  // HE Corrido (salvo em escalas + recálculo na folha)
  const heCorridoMin    = p.heCorridoMin||0;
  const heCorridoValor  = p.heCorridoValor||0;
  const heCorridoDetalhe= p.heCorridoDetalhe||'';
  const adNoturno       = p.adNoturno||0;
  const acumulo         = p.acumuloFuncao||0;
  const insalubridade   = p.insalubridade||0;
  const adiantamento    = p.adiantamentoValor||0;
  const adiantamentoPerc= p.adiantamentoPerc||40;
  const descontoAtraso  = p.descontoAtraso||0;
  // Encargos legais (salvos a partir da v2026-05-08; fallback zero para registros antigos)
  const inssVal         = p.inss||0;
  const irrfVal         = p.irrf||0;
  const fgtsVal         = p.fgts||0;
  const pensaoVal       = p.pensaoAlimenticiaDesc||0;
  const planoSaudeVal   = p.planoSaudeDesc||0;
  const outrosProvVal   = p.outrosProventosTotal||0;
  const outrosDescVal   = p.outrosDescontosTotal||0;
  const totalBrutoVal   = p.totalBruto||0;
  // Líquido final: usa o salvo se disponível, senão calcula o antigo (retrocompatibilidade)
  const totalLiquido    = p.totalLiquidoFinal
    ? p.totalLiquidoFinal
    : remuneracao+heValor+heCorridoValor+adNoturno+acumulo+insalubridade+bonificacao+vtTotal+vrTotal+vaLiquido-adiantamento-descontoAtraso;

  // Tabela de dias do ponto
  const diasPonto    = p.pontoManualDias||[];
  const diasNoMes    = new Date(ano,mes,0).getDate();
  const diasSemana   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const fam          = escalaFamilia(emp.escala||'5x2A');
  const is12x36      = fam==='12x36';
  let tabelaDias='';
  for(let d=1;d<=diasNoMes;d++){
    const dow      = new Date(ano,mes-1,d).getDay();
    const nomeDia  = diasSemana[dow];
    const isWknd   = dow===0||dow===6;
    const pontodia = diasPonto.find(x=>x.dia===d)||{};
    const entrada  = pontodia.entrada||'';
    const saida    = pontodia.saida||'';
    const intIni   = pontodia.intIni||'';
    const intFim   = pontodia.intFim||'';
    let minLiq=0;
    if(entrada&&saida){
      let mb=timeToMinutes(saida)-timeToMinutes(entrada);
      if(mb<=0) mb+=24*60;
      const mi=_calcIntervaloMin(intIni,intFim,entrada,saida);
      minLiq=mb-mi;
    }
    const horasLiq=minLiq>0?minutesToStr(minLiq):'';
    // Sufixo (+1) para saída/intFim cross-midnight em turno noturno
    const saidaDisplay=_shiftCrossesMidnight(entrada,saida)?`${saida} <span style="color:#FB8C00;font-size:9px">(+1)</span>`:saida;
    const intFimDisplay=_intervaloCrossesMidnight(intIni,intFim,entrada,saida)?`${intFim} <span style="color:#FB8C00;font-size:9px">(+1)</span>`:intFim;
    let obsdia='';
    if(!entrada&&!saida){
      if(isWknd||is12x36) obsdia='Folga';
      else obsdia='Falta';
    }
    const rowBg=isWknd?'background:#F8F9FA;color:#999':'';
    tabelaDias+=`<tr style="${rowBg}">
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${String(d).padStart(2,'0')}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${nomeDia}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${entrada}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${saidaDisplay}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intIni}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intFimDisplay}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6;font-weight:${horasLiq?'600':'400'}">${horasLiq}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6;color:#E65100">${obsdia}</td>
    </tr>`;
  }

  return `
<div style="page-break-after:always;padding:16px">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#212529}
  h1{font-size:15px;color:#1a3a6b}
  h2{font-size:12px;color:#1a3a6b;margin:10px 0 4px;border-bottom:1px solid #1a3a6b;padding-bottom:2px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;border-bottom:2px solid #1a3a6b;padding-bottom:8px}
  .header-left p{font-size:10px;color:#666}
  .header-right{text-align:right;font-size:10px;color:#666}
  .info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
  .info-item{background:#F1F5FF;border-radius:3px;padding:4px 7px}
  .info-label{font-size:9px;color:#5A7AB5;font-weight:600;text-transform:uppercase}
  .info-value{font-size:11px;font-weight:600;color:#1a3a6b}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#1a3a6b;color:#fff;padding:4px 6px;text-align:center;border:1px solid #1a3a6b}
  .fin-table{margin-top:10px}
  .fin-table td{padding:4px 8px;border:1px solid #DEE2E6}
  .fin-table tr:nth-child(even){background:#F8F9FA}
  .fin-label{font-weight:600;color:#444;width:220px}
  .fin-value{text-align:right;width:100px}
  .fin-total{background:#1a3a6b!important;color:#fff;font-weight:700;font-size:12px}
  .assinaturas{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:20px}
  .assinatura-box{border-top:1px solid #444;padding-top:6px;text-align:center;font-size:10px;color:#555}
  .resumo-bar{display:flex;gap:10px;margin:6px 0 10px}
  .resumo-item{background:#E8F5E9;border-radius:3px;padding:4px 10px;flex:1;text-align:center}
  .resumo-item.alerta{background:#FFF3E0}
  .resumo-label{font-size:9px;color:#555}
  .resumo-valor{font-size:13px;font-weight:700;color:#1B5E20}
  .resumo-item.alerta .resumo-valor{color:#E65100}
</style>
<div class="header">
  <div class="header-left">
    <h1>${_e('nomeEmpresa')}</h1>
    <p>CNPJ: ${_e('cnpj')} &nbsp;|&nbsp; ${_e('descricao')}</p>
    <p style="font-size:12px;font-weight:700;color:#1a3a6b;margin-top:4px">FOLHA DE PONTO — ${mesLabel.toUpperCase()} / ${ano}</p>
  </div>
  <div class="header-right">
    <p>Emitido em: ${dataAtual}</p>
    <p>Competência: ${mesLabel}/${ano}</p>
    <p>Registro nº ${reg}</p>
    ${p.status==='fechada'?'<p style="color:#1B5E20;font-weight:700">✓ FOLHA FECHADA</p>':''}
  </div>
</div>

<h2>Dados do Colaborador</h2>
<div class="info-grid">
  <div class="info-item"><div class="info-label">Nome</div><div class="info-value">${emp.nome}</div></div>
  <div class="info-item"><div class="info-label">CPF</div><div class="info-value">${emp.cpf||'—'}</div></div>
  <div class="info-item"><div class="info-label">RG</div><div class="info-value">${emp.rg||'—'}</div></div>
  <div class="info-item"><div class="info-label">PIS/PASEP</div><div class="info-value">${emp.pis||'—'}</div></div>
  <div class="info-item"><div class="info-label">Cargo / Função</div><div class="info-value">${emp.cargo||'—'}</div></div>
  <div class="info-item"><div class="info-label">Escala</div><div class="info-value">${emp.escala||'—'}</div></div>
  <div class="info-item"><div class="info-label">Admissão</div><div class="info-value">${emp.admissao?fmtDate(emp.admissao):'—'}</div></div>
  <div class="info-item"><div class="info-label">Posto de Trabalho</div><div class="info-value">${posto.razaoSocial||'—'}</div></div>
  <div class="info-item"><div class="info-label">Salário Base</div><div class="info-value">${fmtMoney(emp.salarioBase||0)}</div></div>
  <div class="info-item"><div class="info-label">Horário Contratual</div><div class="info-value">${emp.horarioEntrada||'—'} – ${emp.horarioSaida||'—'}${emp.semRefeicao?' <span style="font-size:10px;color:#C62828">(Sem refeição)</span>':((emp.horarioRefIni||emp.horarioRefFim)?` <span style="font-size:10px;color:#888">(Ref. ${emp.horarioRefIni||'—'}–${emp.horarioRefFim||'—'})</span>`:'')}</div></div>
  <div class="info-item"><div class="info-label">Banco de Horas</div><div class="info-value">${emp.bancoHoras||'—'}</div></div>
  <div class="info-item"><div class="info-label">Período</div><div class="info-value">${p.periodoDe||'—'} a ${p.periodoAte||'—'}</div></div>
</div>

<h2>Resumo do Período</h2>
<div class="resumo-bar">
  <div class="resumo-item"><div class="resumo-label">Dias Trabalhados</div><div class="resumo-valor">${diasTrabalhados}</div></div>
  <div class="resumo-item alerta"><div class="resumo-label">Faltas Injust.</div><div class="resumo-valor">${faltasInj}</div></div>
  <div class="resumo-item alerta"><div class="resumo-label">Faltas Just.</div><div class="resumo-valor">${faltasJust}</div></div>
  <div class="resumo-item"><div class="resumo-label">Horas Extras</div><div class="resumo-valor">${heTotal}</div></div>
</div>

<h2>Registro de Ponto Diário</h2>
<table>
  <thead>
    <tr>
      <th>Dia</th><th>Sem.</th><th>Entrada</th><th>Saída</th>
      <th>Int. Início</th><th>Int. Fim</th><th>Horas Líq.</th><th>Obs.</th>
    </tr>
  </thead>
  <tbody>${tabelaDias}</tbody>
</table>

<h2 style="margin-top:12px">Demonstrativo Financeiro</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
  <div>
    <div style="font-size:9px;font-weight:700;color:#1a3a6b;text-transform:uppercase;margin-bottom:3px">PROVENTOS</div>
    <table class="fin-table">
      <tr><td class="fin-label">Remuneração do Período</td><td class="fin-value">${fmtMoney(remuneracao)}</td></tr>
      ${heValor>0?`<tr><td class="fin-label">Horas Extras ${heTotal} (${hePerc}%)</td><td class="fin-value">${fmtMoney(heValor)}</td></tr>`:''}
      ${heCorridoValor>0?`<tr><td class="fin-label">HE Hora Corrida ${heCorridoDetalhe?`<small style="color:#7B1FA2">— ${heCorridoDetalhe}</small>`:''}</td><td class="fin-value">${fmtMoney(heCorridoValor)}</td></tr>`:''}
      ${adNoturno>0?`<tr><td class="fin-label">Adicional Noturno</td><td class="fin-value">${fmtMoney(adNoturno)}</td></tr>`:''}
      ${acumulo>0?`<tr><td class="fin-label">Acúmulo de Função (+20%)</td><td class="fin-value">${fmtMoney(acumulo)}</td></tr>`:''}
      ${insalubridade>0?`<tr><td class="fin-label">Insalubridade</td><td class="fin-value">${fmtMoney(insalubridade)}</td></tr>`:''}
      ${bonificacao>0?`<tr><td class="fin-label">Bonificação Boa Permanência</td><td class="fin-value">${fmtMoney(bonificacao)}</td></tr>`:''}
      ${outrosProvVal>0?`<tr><td class="fin-label">Outros Proventos</td><td class="fin-value">${fmtMoney(outrosProvVal)}</td></tr>`:''}
      ${vtTotal>0?`<tr><td class="fin-label">Vale Transporte</td><td class="fin-value">${fmtMoney(vtTotal)}</td></tr>`:''}
      ${vrTotal>0?`<tr><td class="fin-label">Vale Refeição</td><td class="fin-value">${fmtMoney(vrTotal)}</td></tr>`:''}
      ${vaLiquido>0?`<tr><td class="fin-label">Vale Alimentação</td><td class="fin-value">${fmtMoney(vaLiquido)}</td></tr>`:''}
    </table>
    <div style="font-size:9px;font-weight:700;color:#c0392b;text-transform:uppercase;margin:6px 0 3px">DESCONTOS</div>
    <table class="fin-table">
      ${inssVal>0?`<tr><td class="fin-label">INSS</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(inssVal)})</td></tr>`:''}
      ${irrfVal>0?`<tr><td class="fin-label">IRRF</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(irrfVal)})</td></tr>`:''}
      ${pensaoVal>0?`<tr><td class="fin-label">Pensão Alimentícia</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(pensaoVal)})</td></tr>`:''}
      ${planoSaudeVal>0?`<tr><td class="fin-label">Plano de Saúde</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(planoSaudeVal)})</td></tr>`:''}
      ${descontoAtraso>0?`<tr><td class="fin-label">Desconto Atraso</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(descontoAtraso)})</td></tr>`:''}
      ${adiantamento>0?`<tr><td class="fin-label">Adiantamento (${adiantamentoPerc}%)</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(adiantamento)})</td></tr>`:''}
      ${outrosDescVal>0?`<tr><td class="fin-label">Outros Descontos</td><td class="fin-value" style="color:#c0392b">(${fmtMoney(outrosDescVal)})</td></tr>`:''}
    </table>
    ${fgtsVal>0?`<div style="font-size:9px;color:#1565C0;margin-top:4px;padding:3px 6px;background:#E3F2FD;border-radius:2px">FGTS (custo empregador): ${fmtMoney(fgtsVal)}</div>`:''}
    <table class="fin-table" style="margin-top:4px">
      <tr class="fin-total"><td class="fin-label" style="color:#fff">TOTAL LÍQUIDO A RECEBER</td><td class="fin-value" style="color:#fff">${fmtMoney(totalLiquido)}</td></tr>
    </table>
  </div>
  <div>
    <div style="background:#E8F5E9;border:1px solid #A5D6A7;border-radius:4px;padding:10px;text-align:center">
      <div style="font-size:10px;color:#388E3C;font-weight:600;text-transform:uppercase">Total Líquido</div>
      <div style="font-size:20px;font-weight:700;color:#1B5E20">${fmtMoney(totalLiquido)}</div>
      <div style="font-size:9px;color:#555;margin-top:2px">${mesLabel} / ${ano}</div>
    </div>
    ${totalBrutoVal>0?`
    <div style="margin-top:8px;background:#FFF9C4;border:1px solid #F9A825;border-radius:4px;padding:8px;font-size:10px">
      <div style="font-weight:700;color:#E65100;margin-bottom:4px">Resumo Encargos</div>
      <div style="display:flex;justify-content:space-between;padding:2px 0"><span>Total Bruto:</span><span style="font-weight:600">${fmtMoney(totalBrutoVal)}</span></div>
      ${inssVal>0?`<div style="display:flex;justify-content:space-between;padding:2px 0"><span>(-) INSS:</span><span style="color:#c0392b">(${fmtMoney(inssVal)})</span></div>`:''}
      ${irrfVal>0?`<div style="display:flex;justify-content:space-between;padding:2px 0"><span>(-) IRRF:</span><span style="color:#c0392b">(${fmtMoney(irrfVal)})</span></div>`:''}
      ${fgtsVal>0?`<div style="display:flex;justify-content:space-between;padding:2px 0;color:#1565C0"><span>FGTS Empregador:</span><span>${fmtMoney(fgtsVal)}</span></div>`:''}
    </div>`:''}
  </div>
</div>

<div class="assinaturas">
  <div class="assinatura-box">${_e('nomeEmpresa')}<br>Empresa / Responsável</div>
  <div class="assinatura-box">${emp.nome}<br>Colaborador</div>
  <div class="assinatura-box">____________________________<br>Conferido por</div>
</div>
</div>`;
}

function exportarTodasFolhasPDF(){
  const mes=parseInt(val('cont-mes'));
  const ano=parseInt(val('cont-ano'));
  const statusFiltro=val('cont-status-filter')||'ativo';
  const mesLabel=MESES[mes]||'';

  // Payrolls do mês selecionado
  let payrolls=State.payrolls.filter(p=>p.mes==mes&&p.ano==ano);
  if(!payrolls.length){
    toast(`Nenhuma folha lançada em ${mesLabel}/${ano}. Carregue a contabilidade primeiro.`,'warning');
    return;
  }

  // Filtrar por status do colaborador (igual à tabela de contabilidade)
  const emps=State.employees.filter(e=>statusFiltro==='all'||e.status===statusFiltro);
  const empIds=new Set(emps.map(e=>e.id));
  payrolls=payrolls.filter(p=>empIds.has(p.employeeId));

  // Ordenar por nome
  payrolls.sort((a,b)=>{
    const nA=(State.employees.find(e=>e.id===a.employeeId)||{}).nome||'';
    const nB=(State.employees.find(e=>e.id===b.employeeId)||{}).nome||'';
    return nA.localeCompare(nB);
  });

  toast(`Gerando PDF de ${payrolls.length} folhas — aguarde...`,'info');

  // Montar HTML combinado
  let bodyHtml='';
  for(const p of payrolls){
    const emp=State.employees.find(e=>e.id===p.employeeId);
    if(!emp) continue;
    bodyHtml+=_buildFolhaHtmlFromRecord(emp,p);
  }

  const fullHtml=`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Folhas de Ponto — ${mesLabel}/${ano} — ${_e('nomeEmpresa')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#212529}
  @media print{
    @page{size:A4;margin:8mm}
    div[style*="page-break-after"]{page-break-after:always}
  }
</style>
</head>
<body>
${bodyHtml}
<script>window.onload=function(){ window.print(); }<\/script>
</body>
</html>`;

  const win=window.open('','_blank','width=900,height=700');
  if(!win){ toast('Permita pop-ups para exportar o PDF.','error'); return; }
  win.document.write(fullHtml);
  win.document.close();
}

// ============================================
// RELATÓRIO INDIVIDUAL
// ============================================
function initReportIndividualSelect(){
  const sel=document.getElementById('report-individual-emp'); if(!sel) return;
  const currentVal=sel.value;
  sel.innerHTML='<option value="">— Selecione o colaborador —</option>';
  [...State.employees].sort((a,b)=>a.nome.localeCompare(b.nome)).forEach(e=>{
    const opt=document.createElement('option');
    opt.value=e.id; opt.textContent=e.nome+(e.status==='inativo'?' (inativo)':e.status==='afastado'?' (afastado)':'');
    if(e.id===currentVal) opt.selected=true;
    sel.appendChild(opt);
  });
}

function _reportIndividual(){
  const empId=val('report-individual-emp');
  const mes=parseInt(val('report-individual-mes')||0);
  const ano=parseInt(val('report-individual-ano')||0);
  const emp=State.employees.find(e=>e.id===empId);
  if(!emp){ toast('Selecione um colaborador.','error'); return; }
  const periodoLabel=(mes&&ano)?`${MESES[mes]} / ${ano}`:'Todos os períodos';
  _reportHeader(`Relatório Individual — ${emp.nome}`,periodoLabel);
  const reg=emp.registro?String(emp.registro).padStart(4,'0'):'—';
  // Folhas de ponto
  let payrolls=State.payrolls.filter(p=>p.employeeId===empId);
  if(mes&&ano) payrolls=payrolls.filter(p=>p.mes===mes&&p.ano===ano);
  payrolls.sort((a,b)=>b.ano-a.ano||b.mes-a.mes);
  const totalRemun=payrolls.reduce((s,p)=>s+(p.remuneracao||0),0);
  const totalVT=payrolls.reduce((s,p)=>s+(p.valeTransporte||0),0);
  const totalVR=payrolls.reduce((s,p)=>s+(p.valeRefeicao||0),0);
  const totalVA=payrolls.reduce((s,p)=>s+(p.valeAlimentacaoLiquido||0),0);
  document.getElementById('report-summary').innerHTML=`
    <div class="r-stat-card"><div class="r-stat-value">${reg}</div><div class="r-stat-label">Registro</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${statusBadge(emp.status||'ativo')}</div><div class="r-stat-label">Status</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${fmtMoney(emp.salarioBase||0)}</div><div class="r-stat-label">Salário Base</div></div>
    <div class="r-stat-card"><div class="r-stat-value">${payrolls.length}</div><div class="r-stat-label">Lançamentos</div></div>
    <div class="r-stat-card" style="border-color:var(--primary)"><div class="r-stat-value" style="color:var(--primary)">${fmtMoney(totalRemun)}</div><div class="r-stat-label">Total Remuneração</div></div>`;
  // Ficha cadastral
  const thStyle='font-weight:600;color:var(--primary);background:#EEF4FF;border-bottom:1px solid #D0E4FF;width:110px;padding:6px 10px;font-size:12px;white-space:nowrap';
  const tdStyle='border-bottom:1px solid #E8F0FE;padding:6px 10px;font-size:12px';
  const fichaHtml=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;flex-wrap:wrap">
    <div>
      <h4 style="color:var(--primary);margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px"><i class="fa-solid fa-id-card"></i> Dados Pessoais</h4>
      <table class="report-table" style="font-size:12px"><tbody>
        <tr><td style="${thStyle}">Nome</td><td style="${tdStyle}">${emp.nome}</td></tr>
        <tr><td style="${thStyle}">CPF</td><td style="${tdStyle}">${emp.cpf||'—'}</td></tr>
        <tr><td style="${thStyle}">RG</td><td style="${tdStyle}">${emp.rg||'—'}</td></tr>
        <tr><td style="${thStyle}">CTPS</td><td style="${tdStyle}">${emp.ctpsNumero?(emp.ctpsNumero+' / '+(emp.ctpsSerie||'')):'—'}</td></tr>
        <tr><td style="${thStyle}">PIS/NIT</td><td style="${tdStyle}">${emp.pisNit||'—'}</td></tr>
        <tr><td style="${thStyle}">Nascimento</td><td style="${tdStyle}">${formatDateBr(emp.dataNascimento)}</td></tr>
        <tr><td style="${thStyle}">Celular</td><td style="${tdStyle}">${emp.celular||'—'}</td></tr>
        <tr><td style="${thStyle}">E-mail</td><td style="${tdStyle}">${emp.email||'—'}</td></tr>
        <tr><td style="${thStyle}">Endereço</td><td style="${tdStyle};font-size:11px">${emp.endereco?`${emp.endereco}${emp.numero?', '+emp.numero:''} — ${emp.bairro||''}, ${emp.cidade||''} - ${emp.estado||''}`:'—'}</td></tr>
      </tbody></table>
    </div>
    <div>
      <h4 style="color:var(--primary);margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px"><i class="fa-solid fa-briefcase"></i> Contrato & Trabalho</h4>
      <table class="report-table" style="font-size:12px"><tbody>
        <tr><td style="${thStyle}">Escala</td><td style="${tdStyle}">${escalaLabel(emp.escala||'5x2A')}</td></tr>
        <tr><td style="${thStyle}">Setor</td><td style="${tdStyle}">${emp.setor||'—'}</td></tr>
        <tr><td style="${thStyle}">Posto</td><td style="${tdStyle}">${emp.posto||'—'}</td></tr>
        <tr><td style="${thStyle}">Admissão</td><td style="${tdStyle}">${formatDateBr(emp.dataAdmissao)}</td></tr>
        <tr><td style="${thStyle}">Demissão</td><td style="${tdStyle}">${formatDateBr(emp.dataDemissao)||'—'}</td></tr>
        <tr><td style="${thStyle}">Salário Base</td><td style="${tdStyle}">${fmtMoney(emp.salarioBase||0)}</td></tr>
        <tr><td style="${thStyle}">VT Diário</td><td style="${tdStyle}">${fmtMoney(emp.valorDiarioVt||0)}</td></tr>
        <tr><td style="${thStyle}">VR Diário</td><td style="${tdStyle}">${fmtMoney(emp.valorDiarioVr||0)}</td></tr>
        <tr><td style="${thStyle}">VA Mensal</td><td style="${tdStyle}">${fmtMoney(emp.valorMensalVa||0)}</td></tr>
        <tr><td style="${thStyle}">Chave PIX</td><td style="${tdStyle}">${emp.chavePix||'—'}</td></tr>
      </tbody></table>
    </div>
  </div>`;
  // Histórico salarial
  let salHtml='';
  if((emp.historicoSalario||[]).length>0){
    salHtml=`<h4 style="color:var(--primary);margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px"><i class="fa-solid fa-money-bill-wave"></i> Histórico de Salário</h4>
      <table class="report-table" style="font-size:12px;margin-bottom:20px"><thead><tr><th>Data</th><th>Valor</th></tr></thead><tbody>
      ${emp.historicoSalario.map(h=>`<tr><td>${formatDateBr(h.data)}</td><td>${fmtMoney(h.valor)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  // Tabela de lançamentos
  const cols=['Mês/Ano','Dias','Faltas','Remuneração','VT','VR','VA Líq.','Ad.Not.','Bonif.','Adiantamento'];
  const payRows=payrolls.length===0
    ?`<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted)">Nenhum lançamento${mes&&ano?' em '+MESES[mes]+'/'+ano:''}</td></tr>`
    :payrolls.map(p=>{
      const totalFalt='faltasJustificadas' in p?(p.faltasJustificadas||0)+(p.faltasInjustificadas||0):(p.faltas||0);
      return `<tr><td><strong>${MESES[p.mes]}/${p.ano}</strong></td>
        <td>${p.diasTrabalhados}</td><td>${totalFalt}</td>
        <td>${fmtMoney(p.remuneracao)}</td><td>${fmtMoney(p.valeTransporte)}</td>
        <td>${fmtMoney(p.valeRefeicao)}</td><td>${fmtMoney(p.valeAlimentacaoLiquido||0)}</td>
        <td>${fmtMoney(p.adNoturno||0)}</td><td>${fmtMoney(p.bonificacao||0)}</td>
        <td>${p.adiantamentoAtivo?fmtMoney(p.adiantamentoValor||0):'—'}</td></tr>`;
    }).join('');
  const tfoot=payrolls.length>0?`<tr><td><strong>TOTAIS</strong></td><td colspan="2"></td>
    <td>${fmtMoney(totalRemun)}</td><td>${fmtMoney(totalVT)}</td><td>${fmtMoney(totalVR)}</td>
    <td>${fmtMoney(totalVA)}</td><td colspan="3"></td></tr>`:'';
  document.getElementById('report-body-area').innerHTML=fichaHtml+salHtml+
    `<h4 style="color:var(--primary);margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px"><i class="fa-solid fa-file-lines"></i> Lançamentos de Ponto</h4>`+
    _empTable(cols,payRows,tfoot);
}

// ============================================
// POSTOS DE TRABALHO
// ============================================

function maskCnpj(input){
  let v=input.value.replace(/\D/g,'').slice(0,14);
  if(v.length>12) v=v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/,'$1.$2.$3/$4-$5');
  else if(v.length>8) v=v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4}).*/,'$1.$2.$3/$4');
  else if(v.length>5) v=v.replace(/^(\d{2})(\d{3})(\d{0,3}).*/,'$1.$2.$3');
  else if(v.length>2) v=v.replace(/^(\d{2})(\d{0,3}).*/,'$1.$2');
  input.value=v;
}

async function lookupCnpjPosto(){
  const cnpj=(val('posto-cnpj')||'').replace(/\D/g,'');
  if(cnpj.length!==14) return;
  const spinner=document.getElementById('cnpj-lookup-spinner');
  const statusEl=document.getElementById('cnpj-lookup-status');
  // Mostrar spinner
  if(spinner) spinner.style.display='inline';
  if(statusEl){ statusEl.style.display='none'; statusEl.textContent=''; }
  try {
    const res=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if(!res.ok) throw new Error('not found');
    const d=await res.json();
    // Preencher campos
    if(d.razao_social)  setVal('posto-razao',    toTitleCase(d.razao_social));
    if(d.nome_fantasia) setVal('posto-fantasia',  toTitleCase(d.nome_fantasia));
    if(d.email)         setVal('posto-email',     d.email.toLowerCase());
    if(d.ddd_telefone_1){
      const tel=(d.ddd_telefone_1||'').replace(/\D/g,'');
      const fmtTel=tel.length>=10?tel.replace(/^(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3'):tel;
      setVal('posto-telefone', fmtTel);
    }
    if(d.cep){
      const cepFmt=d.cep.replace(/\D/g,'').replace(/^(\d{5})(\d{3})$/,'$1-$2');
      setVal('posto-cep', cepFmt);
    }
    if(d.logradouro)    setVal('posto-endereco',  toTitleCase(d.logradouro));
    if(d.numero)        setVal('posto-numero',    d.numero);
    if(d.complemento)   setVal('posto-complemento', toTitleCase(d.complemento));
    if(d.bairro)        setVal('posto-bairro',    toTitleCase(d.bairro));
    if(d.municipio)     setVal('posto-cidade',    toTitleCase(d.municipio));
    if(d.uf)            setVal('posto-estado',    d.uf);
    // Status da empresa
    const sit=(d.situacao_cadastral||'').toUpperCase();
    const isAtiva=sit==='ATIVA';
    const sitIcon=isAtiva?'circle-check':'circle-exclamation';
    const sitColor=isAtiva?'#1B5E20':'#E65100';
    const sitBg=isAtiva?'#F1F8E9':'#FFF3E0';
    const sitBorder=isAtiva?'#A5D6A7':'#FFCC80';
    if(statusEl){
      statusEl.style.display='block';
      statusEl.style.background=sitBg;
      statusEl.style.border=`1px solid ${sitBorder}`;
      statusEl.style.color=sitColor;
      statusEl.innerHTML=`<i class="fa-solid fa-${sitIcon}"></i> <strong>${toTitleCase(d.razao_social)}</strong> &nbsp;|&nbsp; Situação: <strong>${sit}</strong>${d.data_inicio_atividade?' &nbsp;|&nbsp; Fundação: '+d.data_inicio_atividade.split('-').reverse().join('/'):''}`;
    }
    toast('Dados preenchidos automaticamente pela Receita Federal ✓');
  } catch(e){
    if(statusEl){
      statusEl.style.display='block';
      statusEl.style.background='#FFF3F3';
      statusEl.style.border='1px solid #FFCDD2';
      statusEl.style.color='#B71C1C';
      statusEl.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> CNPJ não encontrado ou inválido. Verifique e tente novamente.';
    }
  } finally {
    if(spinner) spinner.style.display='none';
  }
}

async function lookupCnpjContrato(){
  const cnpj=(val('contrato-cnpj')||'').replace(/\D/g,'');
  if(cnpj.length!==14) return;
  const spinner=document.getElementById('contrato-cnpj-spinner');
  const statusEl=document.getElementById('contrato-cnpj-status');
  if(spinner) spinner.style.display='inline';
  if(statusEl){ statusEl.style.display='none'; statusEl.textContent=''; }
  try {
    const res=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if(!res.ok) throw new Error('not found');
    const d=await res.json();
    if(d.razao_social) setVal('contrato-razao', toTitleCase(d.razao_social));
    if(d.email)        setVal('contrato-email',  d.email.toLowerCase());
    // Montar endereço completo numa linha
    const partes=[
      d.logradouro?toTitleCase(d.logradouro):'',
      d.numero||'',
      d.complemento?toTitleCase(d.complemento):'',
      d.bairro?toTitleCase(d.bairro):'',
      d.municipio?toTitleCase(d.municipio):'',
      d.uf||''
    ].filter(Boolean);
    if(partes.length) setVal('contrato-endereco', partes.join(', '));
    const sit=(d.situacao_cadastral||'').toUpperCase();
    const isAtiva=sit==='ATIVA';
    if(statusEl){
      statusEl.style.display='block';
      statusEl.style.background=isAtiva?'#F1F8E9':'#FFF3E0';
      statusEl.style.border=`1px solid ${isAtiva?'#A5D6A7':'#FFCC80'}`;
      statusEl.style.color=isAtiva?'#1B5E20':'#E65100';
      statusEl.innerHTML=`<i class="fa-solid fa-${isAtiva?'circle-check':'circle-exclamation'}"></i> <strong>${toTitleCase(d.razao_social)}</strong> &nbsp;|&nbsp; Situação: <strong>${sit}</strong>${d.data_inicio_atividade?' &nbsp;|&nbsp; Fundação: '+d.data_inicio_atividade.split('-').reverse().join('/'):''}`;
    }
    toast('Dados do cliente preenchidos pela Receita Federal ✓');
  } catch(e){
    if(statusEl){
      statusEl.style.display='block';
      statusEl.style.background='#FFF3F3';
      statusEl.style.border='1px solid #FFCDD2';
      statusEl.style.color='#B71C1C';
      statusEl.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i> CNPJ não encontrado ou inválido.';
    }
  } finally {
    if(spinner) spinner.style.display='none';
  }
}

function onContratoPostoChange(){
  const postoId=val('contrato-posto');
  if(!postoId) return;
  const p=State.postos.find(x=>x.id===postoId);
  if(!p) return;
  // Preencher dados do cliente a partir do posto cadastrado
  if(p.cnpj)     setVal('contrato-cnpj',     p.cnpj);
  if(p.razaoSocial) setVal('contrato-razao', p.razaoSocial);
  if(p.email)    setVal('contrato-email',    p.email);
  if(p.telefone) setVal('contrato-telefone', p.telefone);
  // Montar endereço a partir dos campos do posto
  const partes=[p.endereco, p.numero, p.complemento, p.bairro, p.cidade, p.estado].filter(Boolean);
  if(partes.length) setVal('contrato-endereco', partes.join(', '));
  // Limpar status do CNPJ anterior
  const statusEl=document.getElementById('contrato-cnpj-status');
  if(statusEl) statusEl.style.display='none';
}

function toTitleCase(str){
  if(!str) return '';
  const minusculas=['de','da','do','das','dos','e','em','a','o','as','os','com','para','por','no','na','nos','nas'];
  return str.toLowerCase().split(' ').map((w,i)=>
    (!i||!minusculas.includes(w))?w.charAt(0).toUpperCase()+w.slice(1):w
  ).join(' ');
}

function maskTelefone(input){
  let v=input.value.replace(/\D/g,'').slice(0,11);
  if(v.length>10) v=v.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');
  else if(v.length>6) v=v.replace(/^(\d{2})(\d{4,5})(\d{0,4}).*/,'($1) $2-$3');
  else if(v.length>2) v=v.replace(/^(\d{2})(\d{0,5}).*/,'($1) $2');
  input.value=v;
}

async function fetchCepPosto(){
  const cep=(val('posto-cep')||'').replace(/\D/g,'');
  if(cep.length!==8) return;
  try {
    const r=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d=await r.json();
    if(!d.erro){
      setVal('posto-endereco',d.logradouro||'');
      setVal('posto-bairro',d.bairro||'');
      setVal('posto-cidade',d.localidade||'');
      setVal('posto-estado',d.uf||'');
    }
  } catch(e){}
}

function renderPostosTable(){
  const q=(val('postos-search')||'').toLowerCase();
  const tbody=document.getElementById('postos-tbody'); if(!tbody) return;
  const lista=State.postos.filter(p=>
    !q ||
    (p.razaoSocial||'').toLowerCase().includes(q) ||
    (p.cnpj||'').includes(q) ||
    (p.cidade||'').toLowerCase().includes(q)
  );
  if(lista.length===0){
    tbody.innerHTML=`<tr><td colspan="6" class="empty-row"><i class="fa-solid fa-building"></i> Nenhum posto cadastrado</td></tr>`;
    return;
  }
  tbody.innerHTML=lista.map(p=>{
    const colaboradores=State.employees.filter(e=>e.posto===p.razaoSocial && (e.status||'ativo')==='ativo').length;
    const nomeExibir=p.nomeFantasia
      ?`<strong>${p.nomeFantasia}</strong><br><span style="font-size:11px;color:var(--text-muted)">${p.razaoSocial}</span>`
      :`<strong>${p.razaoSocial}</strong>`;
    return `<tr>
      <td>${nomeExibir}</td>
      <td style="font-size:12px">${p.cnpj||'—'}</td>
      <td style="font-size:12px">${p.cidade?(p.cidade+(p.estado?' / '+p.estado:'')):'—'}</td>
      <td style="font-size:12px">${p.telefone||'—'}</td>
      <td style="font-size:12px">${p.email?`<a href="mailto:${p.email}" style="color:var(--primary)">${p.email}</a>`:'—'}</td>
      <td><span class="badge-count">${colaboradores}</span></td>
      <td>
        <button class="btn-action btn-edit" onclick="openPostoModal('${p.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-action btn-danger" onclick="confirmDeletePosto('${p.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function populatePostoSelect(){
  const sel=document.getElementById('emp-posto');
  if(!sel) return;
  const current=sel.value;
  sel.innerHTML='<option value="">— Selecione o posto —</option>';
  State.postos.sort((a,b)=>(a.razaoSocial||'').localeCompare(b.razaoSocial||'')).forEach(p=>{
    const opt=document.createElement('option');
    opt.value=p.razaoSocial;
    opt.textContent=p.razaoSocial+(p.cidade?' — '+p.cidade:'');
    sel.appendChild(opt);
  });
  if(current) sel.value=current;
}

function openPostoModal(id=null){
  document.getElementById('modal-posto').classList.remove('hidden');
  const titleEl=document.getElementById('modal-posto-title');
  if(id){
    const p=State.postos.find(x=>x.id===id); if(!p) return;
    titleEl.innerHTML='<i class="fa-solid fa-building"></i> Editar Posto';
    setVal('posto-id',p.id);
    setVal('posto-razao',p.razaoSocial||'');
    setVal('posto-fantasia',p.nomeFantasia||'');
    setVal('posto-cnpj',p.cnpj||'');
    setVal('posto-telefone',p.telefone||'');
    setVal('posto-email',p.email||'');
    setVal('posto-cep',p.cep||'');
    setVal('posto-endereco',p.endereco||'');
    setVal('posto-numero',p.numero||'');
    setVal('posto-complemento',p.complemento||'');
    setVal('posto-bairro',p.bairro||'');
    setVal('posto-cidade',p.cidade||'');
    setVal('posto-estado',p.estado||'');
    const statusEl=document.getElementById('cnpj-lookup-status');
    if(statusEl) statusEl.style.display='none';
  } else {
    titleEl.innerHTML='<i class="fa-solid fa-building"></i> Novo Posto';
    ['posto-id','posto-razao','posto-fantasia','posto-cnpj','posto-telefone','posto-email','posto-cep',
     'posto-endereco','posto-numero','posto-complemento','posto-bairro','posto-cidade','posto-estado']
      .forEach(id=>setVal(id,''));
    const statusEl=document.getElementById('cnpj-lookup-status');
    if(statusEl) statusEl.style.display='none';
  }
}

async function savePosto(){
  const razao=val('posto-razao').trim();
  if(!razao){ toast('Informe a Razão Social.','error'); return; }
  const existingPostoId=val('posto-id');
  const id=existingPostoId||genId();
  const record={
    id, razaoSocial:razao,
    nomeFantasia:val('posto-fantasia').trim(),
    cnpj:val('posto-cnpj').trim(),
    telefone:val('posto-telefone').trim(),
    email:val('posto-email').trim(),
    cep:val('posto-cep').trim(),
    endereco:val('posto-endereco').trim(),
    numero:val('posto-numero').trim(),
    complemento:val('posto-complemento').trim(),
    bairro:val('posto-bairro').trim(),
    cidade:val('posto-cidade').trim(),
    estado:val('posto-estado').trim(),
    updatedAt:new Date().toISOString()
  };
  try {
    await DB.save('postos',record);
    Auth.log(existingPostoId?'POSTO_UPDATED':'POSTO_CREATED', null, `${razao}${record.cidade?' — '+record.cidade:''}`);
    toast(existingPostoId?'Posto atualizado!':'Posto cadastrado!');
    closeModal('modal-posto');
  } catch(e){ toast('Erro ao salvar posto.','error'); }
}

// ---- Histórico de Postos ----

function renderHistoricoPostos(emp){
  const el=document.getElementById('historico-postos-list'); if(!el) return;
  const hist=(emp?.historicoPostos||[]).slice().sort((a,b)=>new Date(b.dataInicio)-new Date(a.dataInicio));
  if(hist.length===0){
    el.innerHTML=`<div class="empty-state small" style="padding:12px">
      <i class="fa-solid fa-building"></i>
      <p style="font-size:13px">Nenhuma transferência registrada</p>
    </div>`;
    return;
  }
  el.innerHTML=`<div class="posto-hist-table">
    <table class="report-table" style="font-size:13px">
      <thead><tr>
        <th style="background:var(--primary)">Posto</th>
        <th style="background:var(--primary)">Entrada</th>
        <th style="background:var(--primary)">Saída</th>
        <th style="background:var(--primary)">Observação</th>
        <th style="background:var(--primary)"></th>
      </tr></thead>
      <tbody>
      ${hist.map((h,i)=>`<tr>
        <td><strong>${h.postoNome}</strong></td>
        <td>${formatDateBr(h.dataInicio)}</td>
        <td>${h.dataFim?formatDateBr(h.dataFim):'<span class="badge-atual">Atual</span>'}</td>
        <td style="color:var(--text-muted);font-size:12px">${h.obs||'—'}</td>
        <td><button class="btn-icon btn-danger-icon" title="Remover"
          onclick="removeHistoricoPosto(${i})"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function openTransferenciaModal(){
  const empId=State.editingEmployeeId;
  const emp=State.employees.find(e=>e.id===empId);
  if(!empId||!emp){ toast('Salve o colaborador antes de registrar transferências.','warning'); return; }

  // Preencher info do posto atual
  const postoAtual=emp.posto||'Nenhum posto definido';
  document.getElementById('transferencia-posto-atual-texto').textContent=`Posto atual: ${postoAtual}`;

  // Preencher select de novo posto (excluindo o atual)
  const sel=document.getElementById('transf-novo-posto');
  sel.innerHTML='<option value="">— Selecione o novo posto —</option>';
  State.postos.sort((a,b)=>(a.razaoSocial||'').localeCompare(b.razaoSocial||'')).forEach(p=>{
    if(p.razaoSocial===postoAtual) return; // não mostra o atual
    const opt=document.createElement('option');
    opt.value=p.razaoSocial;
    opt.textContent=p.razaoSocial+(p.cidade?' — '+p.cidade:'');
    sel.appendChild(opt);
  });

  // Data padrão = hoje
  const hoje=new Date().toISOString().slice(0,10);
  setVal('transf-data-saida',hoje);
  setVal('transf-data-entrada',hoje);
  setVal('transf-obs','');

  document.getElementById('modal-transferencia').classList.remove('hidden');
}

async function saveTransferencia(){
  const empId=State.editingEmployeeId;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;

  const novoPosto=val('transf-novo-posto');
  const dataSaida=val('transf-data-saida');
  const dataEntrada=val('transf-data-entrada');
  const obs=val('transf-obs').trim();

  if(!novoPosto){ toast('Selecione o novo posto.','error'); return; }
  if(!dataSaida){ toast('Informe a data de saída do posto atual.','error'); return; }
  if(!dataEntrada){ toast('Informe a data de entrada no novo posto.','error'); return; }

  const hist=[...(emp.historicoPostos||[])];

  // Fechar o posto atual (marcar dataFim no último sem dataFim)
  const postoAtualNome=emp.posto;
  if(postoAtualNome){
    const aberto=hist.find(h=>!h.dataFim && h.postoNome===postoAtualNome);
    if(aberto) aberto.dataFim=dataSaida;
    else hist.push({ id:genId(), postoNome:postoAtualNome, dataInicio:emp.dataAdmissao||dataEntrada, dataFim:dataSaida, obs:'' });
  }

  // Adicionar novo posto
  hist.push({ id:genId(), postoNome:novoPosto, dataInicio:dataEntrada, dataFim:null, obs });

  // Atualizar colaborador
  const updated={ ...emp, posto:novoPosto, historicoPostos:hist, updatedAt:new Date().toISOString() };
  try {
    await DB.save('employees', updated);
    // Atualizar o select de posto no formulário
    populatePostoSelect();
    const sel=document.getElementById('emp-posto');
    if(sel) sel.value=novoPosto;
    renderHistoricoPostos(updated);
    closeModal('modal-transferencia');
    toast('Transferência registrada com sucesso!');
  } catch(e){ toast('Erro ao registrar transferência.','error'); }
}

async function removeHistoricoPosto(index){
  const empId=State.editingEmployeeId;
  const emp=State.employees.find(e=>e.id===empId); if(!emp) return;
  const hist=[...(emp.historicoPostos||[])].sort((a,b)=>new Date(b.dataInicio)-new Date(a.dataInicio));
  hist.splice(index,1);
  const updated={ ...emp, historicoPostos:hist, updatedAt:new Date().toISOString() };
  await DB.save('employees', updated);
  renderHistoricoPostos(updated);
  toast('Registro removido.','warning');
}

function confirmDeletePosto(id){
  const p=State.postos.find(x=>x.id===id); if(!p) return;
  const emUso=State.employees.some(e=>e.posto===p.razaoSocial);
  if(emUso){
    toast(`Posto em uso por colaboradores ativos — remova o vínculo antes de excluir.`,'error');
    return;
  }
  document.getElementById('confirm-message').textContent=`Excluir o posto "${p.razaoSocial}"?`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    await DB.remove('postos',id);
    Auth.log('POSTO_DELETED', null, p.razaoSocial);
    closeModal('modal-confirm');
    toast('Posto excluído.','warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// ESCALAS — Projeção mensal por colaborador
// ============================================
// Defaults de horários por escala (usado quando emp não tem horarioEntrada/Saida)
const ESCALA_HORARIOS_DEFAULT = {
  '5x2A':  { entrada:'08:00', saida:'18:00' }, // Sex 08-16
  '5x2B':  { entrada:'07:00', saida:'17:00' }, // Sex 07-16
  '6x1A':  { entrada:'07:00', saida:'16:00' }, // Sáb 07-11
  '6x1B':  { entrada:'08:00', saida:'16:20' },
  '6x1C':  { entrada:'08:00', saida:'17:00' }, // Sáb 08-12
  '12x36': { entrada:'07:00', saida:'19:00' }
};

// Retorna horários default para um colaborador num dia da semana específico
function _escalaHorariosDia(emp, diaSem){
  const escala = emp.escala || '5x2A';
  const noturno = !!emp.turnoNoturno;
  const def = ESCALA_HORARIOS_DEFAULT[escala] || ESCALA_HORARIOS_DEFAULT['5x2A'];
  let entrada = emp.horarioEntrada || def.entrada;
  let saida   = emp.horarioSaida   || def.saida;
  // Refeição: respeita flag "semRefeicao" e diferencia noturno/diurno no default
  let intIni, intFim;
  if(emp.semRefeicao){
    intIni = ''; intFim = '';
  } else if(emp.horarioRefIni && emp.horarioRefFim){
    // Cadastro do colaborador tem refeição definida — usa a dele
    intIni = emp.horarioRefIni;
    intFim = emp.horarioRefFim;
  } else {
    // Sem cadastro: default sensato — noturno janta após meia-noite, diurno almoça
    if(noturno){
      intIni = '00:00'; intFim = '01:00';
    } else {
      intIni = '12:00'; intFim = '13:00';
    }
  }
  // Para 12x36 noturno, se não tem horário cadastrado, ajusta default
  if(escala==='12x36' && noturno && !emp.horarioEntrada){
    entrada = '19:00'; saida = '07:00';
  }
  // Variantes com horário diferenciado em sex/sáb (só aplica se usuário NÃO definiu horário próprio)
  if(!emp.horarioEntrada){
    if(diaSem===5 && (escala==='5x2A' || escala==='5x2B')) saida = '16:00';
    if(diaSem===6 && escala==='6x1A') saida = '11:00';
    if(diaSem===6 && escala==='6x1C') saida = '12:00';
  }
  return { entrada, intIni, intFim, saida };
}

// Busca dados do mês anterior (escala salva ou pontoManualDias) para projeção 12x36/6x1B
function _getPrevMonthDias(empId, mes, ano){
  let pMes = mes - 1, pAno = ano;
  if(pMes < 1){ pMes = 12; pAno = ano - 1; }
  // 1) Tenta coleção `escalas` salva
  const savedEsc = (State.escalas||[]).find(e => e.employeeId===empId && e.mes==pMes && e.ano==pAno);
  if(savedEsc?.dias?.length) return savedEsc.dias;
  // 2) Fallback: pontoManualDias da folha de ponto fechada
  const pay = (State.payrolls||[]).find(p => p.employeeId===empId && p.mes==pMes && p.ano==pAno);
  if(pay?.pontoManualDias?.length){
    return pay.pontoManualDias.map(d => ({
      dia:d.dia, diaSem:d.diaSem,
      tipo:(d.entrada && d.saida) ? 'trabalho' : 'folga',
      entrada:d.entrada, intIni:d.intIni, intFim:d.intFim, saida:d.saida
    }));
  }
  return null;
}

// Projeta a escala completa de um colaborador para um mês
function _projectEscala(emp, mes, ano, prevDias){
  const fam = escalaFamilia(emp.escala || '5x2A');
  if(fam==='5x2')   return _projectEscala5x2(emp, mes, ano);
  if(fam==='6x1'){
    if(emp.escala==='6x1B') return _projectEscala6x1B(emp, mes, ano, prevDias);
    return _projectEscala6x1AC(emp, mes, ano);
  }
  if(fam==='12x36') return _projectEscala12x36(emp, mes, ano, prevDias);
  return _projectEscala5x2(emp, mes, ano);
}

function _projectEscala5x2(emp, mes, ano){
  const dias = [];
  const dpm = new Date(ano, mes, 0).getDate();
  for(let d=1; d<=dpm; d++){
    const ds = new Date(ano, mes-1, d).getDay();
    const isWknd = ds===0 || ds===6;
    const tipo = isWknd ? 'folga' : 'trabalho';
    const h = (tipo==='trabalho') ? _escalaHorariosDia(emp, ds) : {entrada:'',intIni:'',intFim:'',saida:''};
    dias.push({ dia:d, diaSem:ds, tipo, ...h });
  }
  return dias;
}

function _projectEscala6x1AC(emp, mes, ano){
  const dias = [];
  const dpm = new Date(ano, mes, 0).getDate();
  for(let d=1; d<=dpm; d++){
    const ds = new Date(ano, mes-1, d).getDay();
    const tipo = (ds===0) ? 'folga' : 'trabalho';
    const h = (tipo==='trabalho') ? _escalaHorariosDia(emp, ds) : {entrada:'',intIni:'',intFim:'',saida:''};
    dias.push({ dia:d, diaSem:ds, tipo, ...h });
  }
  return dias;
}

// 6x1B: folga rotativa (1 dia folga a cada 7). Detecta âncora do mês anterior
function _projectEscala6x1B(emp, mes, ano, prevDias){
  const dias = [];
  const dpm = new Date(ano, mes, 0).getDate();
  let primeiraFolga = null;
  if(prevDias && prevDias.length){
    const sorted = [...prevDias].sort((a,b)=>b.dia-a.dia);
    const lastFolga = sorted.find(d => d.tipo==='folga' || (!d.entrada && !d.saida));
    if(lastFolga){
      const prevDpm = new Date(ano, mes-1, 0).getDate();
      const offsetEnd = prevDpm - lastFolga.dia;
      // Próxima folga: 7 dias após a última, contando do dia 1 do mês atual
      primeiraFolga = (7 - (offsetEnd % 7));
      if(primeiraFolga > dpm) primeiraFolga = null;
    }
  }
  const folgaSet = new Set();
  if(primeiraFolga !== null){
    for(let d=primeiraFolga; d<=dpm; d+=7) folgaSet.add(d);
  }
  for(let d=1; d<=dpm; d++){
    const ds = new Date(ano, mes-1, d).getDay();
    const tipo = folgaSet.has(d) ? 'folga' : 'trabalho';
    const h = (tipo==='trabalho') ? _escalaHorariosDia(emp, ds) : {entrada:'',intIni:'',intFim:'',saida:''};
    const obj = { dia:d, diaSem:ds, tipo, ...h };
    if(primeiraFolga === null) obj.revisao = true; // marcar para revisão manual
    dias.push(obj);
  }
  return dias;
}

// 12x36: alternância 1 dia trabalho / 1 dia folga
function _projectEscala12x36(emp, mes, ano, prevDias){
  const dias = [];
  const dpm = new Date(ano, mes, 0).getDate();
  let lastWork = null;
  if(prevDias && prevDias.length){
    const sorted = [...prevDias].sort((a,b)=>b.dia-a.dia);
    const lw = sorted.find(d => d.tipo==='trabalho' || (d.entrada && d.saida));
    if(lw) lastWork = lw.dia;
  }
  let anchor = null;
  let noPrev = false;
  if(lastWork !== null){
    const prevDpm = new Date(ano, mes-1, 0).getDate();
    const offsetDay1 = (prevDpm - lastWork) + 1; // distância de lastWork até dia 1 do mês atual
    // lastWork = offset 0 (trabalho). Par = trabalho, ímpar = folga.
    anchor = (offsetDay1 % 2 === 0) ? 1 : 2;
  } else {
    anchor = 1;
    noPrev = true;
  }
  for(let d=1; d<=dpm; d++){
    const ds = new Date(ano, mes-1, d).getDay();
    const offset = d - anchor;
    const tipo = (offset % 2 === 0) ? 'trabalho' : 'folga';
    const h = (tipo==='trabalho') ? _escalaHorariosDia(emp, ds) : {entrada:'',intIni:'',intFim:'',saida:''};
    const obj = { dia:d, diaSem:ds, tipo, ...h };
    if(noPrev) obj.revisao = true;
    dias.push(obj);
  }
  return dias;
}

// ============================================
// ESCALAS — Render & UI
// ============================================
function renderEscalas(){
  // Inicializa selects de mês/ano
  const yearSel = document.getElementById('escala-ano');
  if(yearSel && !yearSel.options.length){
    const cur = currentAno();
    let opts = '';
    for(let y=cur-1; y<=cur+2; y++) opts += `<option value="${y}">${y}</option>`;
    yearSel.innerHTML = opts;
    yearSel.value = cur;
    document.getElementById('escala-mes').value = currentMes();
  }
  // Popula filtros postos / setores
  const postoSel = document.getElementById('escala-filter-posto');
  if(postoSel){
    const sel = postoSel.value;
    let opts = '<option value="">Todos</option>';
    (State.postos||[]).forEach(p => { opts += `<option value="${p.id}">${p.razaoSocial||p.nome||'—'}</option>`; });
    postoSel.innerHTML = opts;
    postoSel.value = sel;
  }
  const setorSel = document.getElementById('escala-filter-setor');
  if(setorSel){
    const sel = setorSel.value;
    const setores = [...new Set((State.employees||[]).map(e=>e.setor).filter(Boolean))].sort();
    let opts = '<option value="">Todos</option>';
    setores.forEach(s => { opts += `<option value="${s}">${s}</option>`; });
    setorSel.innerHTML = opts;
    setorSel.value = sel;
  }
  _renderEscalasCards();
}

function onEscalaMesChange(){ _renderEscalasCards(); }
function onEscalaFilterChange(){ _renderEscalasCards(); }

function changeEscalaMes(delta){
  const mesSel = document.getElementById('escala-mes');
  const anoSel = document.getElementById('escala-ano');
  let m = parseInt(mesSel.value) + delta;
  let a = parseInt(anoSel.value);
  if(m < 1){ m = 12; a -= 1; }
  if(m > 12){ m = 1; a += 1; }
  mesSel.value = m;
  if(!Array.from(anoSel.options).some(o=>o.value==a)){
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    anoSel.appendChild(opt);
  }
  anoSel.value = a;
  _renderEscalasCards();
}

function _renderEscalasCards(){
  const mes = parseInt(document.getElementById('escala-mes').value || currentMes());
  const ano = parseInt(document.getElementById('escala-ano').value || currentAno());
  const fNome   = (document.getElementById('escala-filter-nome').value||'').toLowerCase().trim();
  const fPosto  = document.getElementById('escala-filter-posto').value||'';
  const fSetor  = document.getElementById('escala-filter-setor').value||'';
  const fEscala = document.getElementById('escala-filter-escala').value||'';
  const fTurno  = document.getElementById('escala-filter-turno').value||'';

  const ativos = (State.employees||[]).filter(e => (e.status||'ativo')==='ativo');
  const filtered = ativos.filter(e => {
    if(fNome && !(e.nome||'').toLowerCase().includes(fNome)) return false;
    if(fPosto && e.posto !== fPosto) return false;
    if(fSetor && e.setor !== fSetor) return false;
    if(fEscala && e.escala !== fEscala) return false;
    if(fTurno){
      const isNot = !!e.turnoNoturno;
      if(fTurno==='noturno' && !isNot) return false;
      if(fTurno==='diurno'  &&  isNot) return false;
    }
    return true;
  }).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));

  const container = document.getElementById('escalas-container');
  if(!container) return;
  if(!filtered.length){
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter-circle-xmark"></i><p>Nenhum colaborador encontrado com os filtros atuais</p></div>';
    return;
  }
  container.innerHTML = filtered.map(emp => _renderEscalaCard(emp, mes, ano)).join('');
}

function _renderEscalaCard(emp, mes, ano){
  const saved = (State.escalas||[]).find(e => e.employeeId===emp.id && e.mes==mes && e.ano==ano);
  let dias;
  let isProjetada = false;
  if(saved?.dias?.length){
    dias = saved.dias;
  } else {
    const prevDias = _getPrevMonthDias(emp.id, mes, ano);
    dias = _projectEscala(emp, mes, ano, prevDias);
    isProjetada = true;
  }
  const fam = escalaFamilia(emp.escala || '5x2A');
  const posto = (State.postos||[]).find(p=>p.id===emp.posto)?.razaoSocial || '—';
  const setor = emp.setor || '—';
  const noturnoBadge = emp.turnoNoturno
    ? '<span style="background:#E8EAF6;color:#3F51B5;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px"><i class="fa-solid fa-moon"></i> Noturno</span>'
    : '';
  const semRefBadge = emp.semRefeicao
    ? '<span style="background:#FFEBEE;color:#C62828;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px" title="Trabalha sozinho — sem horário de refeição"><i class="fa-solid fa-ban"></i> Sem refeição</span>'
    : '';
  const projBadge = isProjetada
    ? '<span style="background:#FFF3E0;color:#E65100;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px"><i class="fa-solid fa-wand-magic-sparkles"></i> Projetada — não salva</span>'
    : '<span style="background:#E8F5E9;color:#1B5E20;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px"><i class="fa-solid fa-check"></i> Salva</span>';
  const rowsHtml = dias.map(d => _renderEscalaRow(d, fam)).join('');
  return `<div class="card escala-card" data-emp-id="${emp.id}" style="margin-bottom:16px">
    <div class="card-body" style="padding:14px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--primary)">${emp.nome}${noturnoBadge}${semRefBadge}${projBadge}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px"><i class="fa-solid fa-building"></i> ${posto} &middot; <i class="fa-solid fa-sitemap"></i> ${setor} &middot; <strong>${escalaLabel(emp.escala||'5x2A')}</strong></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${emp.semRefeicao?'':`<button class="btn btn-secondary" onclick="openBulkRefeicao('${emp.id}')" title="Atualizar horário de refeição em massa"><i class="fa-solid fa-utensils" style="color:#F59E0B"></i> Refeição em massa</button>`}
          <button class="btn btn-secondary" onclick="resetEscala('${emp.id}')" title="Reprojetar (descarta alterações)"><i class="fa-solid fa-rotate-left"></i> Reprojetar</button>
          <button class="btn btn-primary" onclick="saveEscala('${emp.id}')"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="escala-table" style="width:100%;border-collapse:collapse;font-size:12px;min-width:680px">
          <thead>
            <tr style="background:#F5F7FB">
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border);width:54px">Dia</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border);width:46px">Sem.</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border);width:88px">Status</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border)">Entrada</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border)">Início Refeição</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border)">Retorno Refeição</th>
              <th style="padding:6px 8px;text-align:center;border:1px solid var(--border)">Saída</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function _escalaTipoBadge(tipo, perc){
  if(tipo === 'corrido'){
    const pct = perc ? ` <small style="background:#F3E5F5;padding:0 4px;border-radius:3px">+${perc}%</small>` : '';
    return `<span style="color:#7B1FA2;font-weight:600;font-size:11px"><i class="fa-solid fa-person-running"></i> Corrido${pct}</span>`;
  }
  if(tipo === 'folga')    return '<span style="color:#E65100;font-weight:600;font-size:11px"><i class="fa-solid fa-umbrella-beach"></i> Folga</span>';
  return                          '<span style="color:#1B5E20;font-weight:600;font-size:11px"><i class="fa-solid fa-briefcase"></i> Trabalho</span>';
}

// ============================================
// ESCALAS — Modal de % HE para Corrido
// ============================================
let _pendingCorridoRow = null;
let _previousTipoBeforeCorrido = null;

function _openCorridoPercModal(row, prevTipo){
  _pendingCorridoRow = row;
  _previousTipoBeforeCorrido = prevTipo || 'trabalho';
  setVal('corrido-perc-custom', '');
  document.getElementById('modal-corrido-perc').classList.remove('hidden');
}

function setCorridoPerc(perc){
  const row = _pendingCorridoRow;
  if(!row){ closeModal('modal-corrido-perc'); return; }
  const validPerc = Math.max(0, Math.min(200, parseInt(perc)||50));
  row.dataset.hePerc = validPerc;
  const cell = row.querySelector('.esc-tipo-cell');
  if(cell) cell.innerHTML = _escalaTipoBadge('corrido', validPerc);
  const card = row.closest('.escala-card');
  if(card) card.dataset.dirty = '1';
  closeModal('modal-corrido-perc');
  _pendingCorridoRow = null;
  _previousTipoBeforeCorrido = null;
}

function cancelCorridoPerc(){
  // Reverte o status para o anterior (trabalho ou folga)
  const row = _pendingCorridoRow;
  if(row){
    const prev = _previousTipoBeforeCorrido || 'trabalho';
    row.dataset.tipo = prev;
    delete row.dataset.hePerc;
    const cell = row.querySelector('.esc-tipo-cell');
    if(cell) cell.innerHTML = _escalaTipoBadge(prev);
    // Restaura inputs conforme tipo anterior
    const ent = row.querySelector('.esc-entrada');
    const ini = row.querySelector('.esc-int-ini');
    const fim = row.querySelector('.esc-int-fim');
    const sai = row.querySelector('.esc-saida');
    if(prev === 'trabalho'){
      [ent, ini, fim, sai].forEach(i => { if(i) i.style.opacity='1'; });
      // Recompõe defaults se vazios
      const card = row.closest('.escala-card');
      const empId = card?.dataset.empId;
      const emp = (State.employees||[]).find(e=>e.id===empId);
      if(emp){
        const dia = parseInt(row.dataset.dia);
        const mes = parseInt(document.getElementById('escala-mes').value);
        const ano = parseInt(document.getElementById('escala-ano').value);
        const realDs = new Date(ano, mes-1, dia).getDay();
        const h = _escalaHorariosDia(emp, realDs);
        if(ent && !ent.value) ent.value = h.entrada;
        if(ini && !ini.value) ini.value = h.intIni;
        if(fim && !fim.value) fim.value = h.intFim;
        if(sai && !sai.value) sai.value = h.saida;
      }
    } else {
      // folga
      [ent, ini, fim, sai].forEach(i => { if(i){ i.value=''; i.style.opacity='.55'; } });
    }
  }
  closeModal('modal-corrido-perc');
  _pendingCorridoRow = null;
  _previousTipoBeforeCorrido = null;
}

function _renderEscalaRow(d, fam){
  const sem = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.diaSem];
  // Cores: 12x36 = duas cores suaves alternadas; demais = sáb/dom diferenciados
  let bg = '#fff';
  if(fam==='12x36'){
    bg = (d.tipo==='trabalho' || d.tipo==='corrido') ? '#E3F2FD' : '#FFF8E1';
  } else {
    if(d.diaSem===0)      bg = '#FFEBEE'; // domingo — rosa suave
    else if(d.diaSem===6) bg = '#FFF9C4'; // sábado — amarelo suave
  }
  const revisao = d.revisao ? ' <span title="Revisar manualmente — sem dados anteriores" style="color:#E65100">⚠</span>' : '';
  // Opacidades por tipo:
  //   trabalho → todos visíveis (1)
  //   corrido  → entrada/saída visíveis, refeição esmaecida (.4)
  //   folga    → todos esmaecidos (.55) mas editáveis
  const opEnt = (d.tipo==='folga') ? 'opacity:.55' : '';
  const opSai = (d.tipo==='folga') ? 'opacity:.55' : '';
  const opRef = (d.tipo==='folga') ? 'opacity:.55' : (d.tipo==='corrido' ? 'opacity:.4' : '');
  const tipoTitle = 'Clique para alternar: Trabalho → Corrido (hora corrida, sem refeição) → Folga';
  const hePercAttr = (d.tipo==='corrido' && d.hePercDia) ? `data-he-perc="${d.hePercDia}"` : '';
  return `<tr style="background:${bg}" data-dia="${d.dia}" data-tipo="${d.tipo||'trabalho'}" ${hePercAttr}>
    <td style="padding:4px 6px;text-align:center;border:1px solid var(--border);font-weight:700">${String(d.dia).padStart(2,'0')}${revisao}</td>
    <td style="padding:4px 6px;text-align:center;border:1px solid var(--border);font-size:11px">${sem}</td>
    <td style="padding:4px 6px;text-align:center;border:1px solid var(--border)"><span class="esc-tipo-cell" onclick="toggleEscalaTipo(this)" style="cursor:pointer" title="${tipoTitle}">${_escalaTipoBadge(d.tipo, d.hePercDia)}</span></td>
    <td style="padding:2px;border:1px solid var(--border)"><input type="time" class="esc-entrada" value="${d.entrada||''}" style="width:100%;${opEnt}" onchange="onEscalaCellEdit(this)"></td>
    <td style="padding:2px;border:1px solid var(--border)"><input type="time" class="esc-int-ini" value="${d.intIni||''}" style="width:100%;${opRef}" onchange="onEscalaCellEdit(this)"></td>
    <td style="padding:2px;border:1px solid var(--border)"><input type="time" class="esc-int-fim" value="${d.intFim||''}" style="width:100%;${opRef}" onchange="onEscalaCellEdit(this)"></td>
    <td style="padding:2px;border:1px solid var(--border)"><input type="time" class="esc-saida" value="${d.saida||''}" style="width:100%;${opSai}" onchange="onEscalaCellEdit(this)"></td>
  </tr>`;
}

function onEscalaCellEdit(input){
  const row = input.closest('tr');
  const card = input.closest('.escala-card');
  if(card) card.dataset.dirty = '1';
  if(!row) return;
  const cur = row.dataset.tipo || 'trabalho';
  const isMealField = input.classList.contains('esc-int-ini') || input.classList.contains('esc-int-fim');

  // Helper para resolver defaults do colaborador
  const getDefaults = () => {
    const empId = card?.dataset.empId;
    const emp = (State.employees||[]).find(e=>e.id===empId);
    if(!emp) return null;
    const dia = parseInt(row.dataset.dia);
    const mes = parseInt(document.getElementById('escala-mes').value);
    const ano = parseInt(document.getElementById('escala-ano').value);
    const realDs = new Date(ano, mes-1, dia).getDay();
    return _escalaHorariosDia(emp, realDs);
  };
  const setBadge = (tipo) => {
    const cell = row.querySelector('.esc-tipo-cell');
    if(cell) cell.innerHTML = _escalaTipoBadge(tipo);
  };
  const setOpacity = (tipo) => {
    const ent = row.querySelector('.esc-entrada');
    const ini = row.querySelector('.esc-int-ini');
    const fim = row.querySelector('.esc-int-fim');
    const sai = row.querySelector('.esc-saida');
    if(tipo === 'trabalho'){
      [ent,ini,fim,sai].forEach(i => { if(i) i.style.opacity = '1'; });
    } else if(tipo === 'corrido'){
      if(ent) ent.style.opacity = '1';
      if(sai) sai.style.opacity = '1';
      if(ini) ini.style.opacity = '.4';
      if(fim) fim.style.opacity = '.4';
    } else {
      [ent,ini,fim,sai].forEach(i => { if(i) i.style.opacity = '.55'; });
    }
  };

  // 1) Folga + qualquer input preenchido → Trabalho com defaults completados
  if(cur === 'folga' && input.value){
    row.dataset.tipo = 'trabalho';
    setBadge('trabalho');
    setOpacity('trabalho');
    const h = getDefaults();
    if(h){
      const ent = row.querySelector('.esc-entrada');
      const ini = row.querySelector('.esc-int-ini');
      const fim = row.querySelector('.esc-int-fim');
      const sai = row.querySelector('.esc-saida');
      if(ent && !ent.value) ent.value = h.entrada;
      if(ini && !ini.value) ini.value = h.intIni;
      if(fim && !fim.value) fim.value = h.intFim;
      if(sai && !sai.value) sai.value = h.saida;
    }
    return;
  }
  // 2) Corrido + campo de refeição preenchido → volta para Trabalho normal
  if(cur === 'corrido' && isMealField && input.value){
    row.dataset.tipo = 'trabalho';
    setBadge('trabalho');
    setOpacity('trabalho');
    const ini = row.querySelector('.esc-int-ini');
    const fim = row.querySelector('.esc-int-fim');
    const h = getDefaults();
    if(h){
      if(ini && !ini.value) ini.value = h.intIni;
      if(fim && !fim.value) fim.value = h.intFim;
    }
  }
}

// Ciclo de status: Trabalho → Corrido → Folga → Trabalho ...
function toggleEscalaTipo(span){
  const row = span.closest('tr');
  if(!row) return;
  const card = span.closest('.escala-card');
  const cur = row.dataset.tipo || 'trabalho';
  let novo;
  if(cur === 'trabalho')      novo = 'corrido';
  else if(cur === 'corrido')  novo = 'folga';
  else                        novo = 'trabalho';
  row.dataset.tipo = novo;
  // Limpa hePerc ao sair de corrido
  if(novo !== 'corrido') delete row.dataset.hePerc;
  const perc = parseInt(row.dataset.hePerc) || (novo==='corrido' ? 50 : null);
  span.innerHTML = _escalaTipoBadge(novo, perc);

  const ent = row.querySelector('.esc-entrada');
  const ini = row.querySelector('.esc-int-ini');
  const fim = row.querySelector('.esc-int-fim');
  const sai = row.querySelector('.esc-saida');

  // Defaults do colaborador (para preencher entrada/saída em corrido e tudo em trabalho)
  let h = null;
  if(card){
    const empId = card.dataset.empId;
    const emp = (State.employees||[]).find(e=>e.id===empId);
    if(emp){
      const dia = parseInt(row.dataset.dia);
      const mes = parseInt(document.getElementById('escala-mes').value);
      const ano = parseInt(document.getElementById('escala-ano').value);
      const realDs = new Date(ano, mes-1, dia).getDay();
      h = _escalaHorariosDia(emp, realDs);
    }
  }

  if(novo === 'folga'){
    [ent, ini, fim, sai].forEach(inp => { if(inp){ inp.value=''; inp.style.opacity='.55'; } });
  } else if(novo === 'corrido'){
    // Mantém entrada/saída (preenche se vazio); zera refeição e esmaece
    if(ent){ ent.style.opacity='1'; if(!ent.value && h) ent.value = h.entrada; }
    if(sai){ sai.style.opacity='1'; if(!sai.value && h) sai.value = h.saida; }
    if(ini){ ini.value=''; ini.style.opacity='.4'; }
    if(fim){ fim.value=''; fim.style.opacity='.4'; }
    // Define default 50% e abre modal pra escolher %
    row.dataset.hePerc = '50';
    _openCorridoPercModal(row, cur);
  } else {
    // Trabalho: pré-preenche todos vazios
    [ent, ini, fim, sai].forEach(inp => { if(inp) inp.style.opacity='1'; });
    if(h){
      if(ent && !ent.value) ent.value = h.entrada;
      if(ini && !ini.value) ini.value = h.intIni;
      if(fim && !fim.value) fim.value = h.intFim;
      if(sai && !sai.value) sai.value = h.saida;
    }
  }
  if(card) card.dataset.dirty = '1';
}

function _collectEscalaDias(empId){
  const card = document.querySelector(`.escala-card[data-emp-id="${empId}"]`);
  if(!card) return null;
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const rows = card.querySelectorAll('tbody tr[data-dia]');
  const dias = [];
  rows.forEach(row => {
    const dia = parseInt(row.dataset.dia);
    const ds = new Date(ano, mes-1, dia).getDay();
    const tipo = row.dataset.tipo || 'trabalho';
    const obj = {
      dia, diaSem:ds, tipo,
      entrada: row.querySelector('.esc-entrada').value,
      intIni:  row.querySelector('.esc-int-ini').value,
      intFim:  row.querySelector('.esc-int-fim').value,
      saida:   row.querySelector('.esc-saida').value
    };
    if(tipo === 'corrido'){
      obj.hePercDia = parseInt(row.dataset.hePerc) || 50;
    }
    dias.push(obj);
  });
  return dias;
}

async function saveEscala(empId){
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const dias = _collectEscalaDias(empId);
  if(!dias){ toast('Erro: card não encontrado','error'); return; }
  const existing = (State.escalas||[]).find(e => e.employeeId===empId && e.mes==mes && e.ano==ano);
  const record = {
    id:        existing?.id || genId(),
    employeeId:empId, mes, ano, dias,
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  const card = document.querySelector(`.escala-card[data-emp-id="${empId}"]`);
  const btn = card?.querySelector('.btn-primary');
  if(btn) setBtnLoading(btn, true, '');
  try {
    await DB.save('escalas', record);
    toast('Escala salva!');
    if(card) delete card.dataset.dirty;
  } catch(e){
    console.error(e);
    toast('Erro ao salvar escala','error');
  } finally {
    if(btn) setBtnLoading(btn, false, '<i class="fa-solid fa-floppy-disk"></i> Salvar');
  }
}

function resetEscala(empId){
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const emp = (State.employees||[]).find(e=>e.id===empId);
  if(!emp) return;
  // Substitui card sem usar a versão salva
  const oldEscalas = State.escalas;
  State.escalas = (oldEscalas||[]).filter(e => !(e.employeeId===empId && e.mes==mes && e.ano==ano));
  const card = document.querySelector(`.escala-card[data-emp-id="${empId}"]`);
  if(card) card.outerHTML = _renderEscalaCard(emp, mes, ano);
  State.escalas = oldEscalas;
  toast('Escala reprojetada (não salva)');
}

// ============================================
// ESCALAS — Refeição em massa (cascata)
// ============================================
let _bulkRefeicaoEmpId = null;

function openBulkRefeicao(empId){
  const emp = (State.employees||[]).find(e=>e.id===empId);
  if(!emp){ toast('Colaborador não encontrado','error'); return; }
  if(emp.semRefeicao){ toast('Este colaborador trabalha sozinho — sem horário de refeição.','error'); return; }
  _bulkRefeicaoEmpId = empId;
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const today = new Date();
  const isCurMes = (mes==today.getMonth()+1 && ano==today.getFullYear());
  const startDia = isCurMes ? today.getDate() : 1;
  // Pré-preenche com horários atuais do colaborador
  setVal('bulk-ref-ini', emp.horarioRefIni || '12:00');
  setVal('bulk-ref-fim', emp.horarioRefFim || '13:00');
  setVal('bulk-ref-dia', startDia);
  document.getElementById('bulk-ref-update-cadastro').checked = true;
  document.getElementById('bulk-ref-future-months').checked = true;
  document.getElementById('bulk-refeicao-info').innerHTML =
    `<strong>${emp.nome}</strong> &middot; ${escalaLabel(emp.escala||'5x2A')}${emp.turnoNoturno?' (Noturno)':''}<br>
     <span style="color:var(--text-muted);font-size:12px">Mês visível: ${MESES[mes]}/${ano}</span>`;
  document.getElementById('modal-bulk-refeicao').classList.remove('hidden');
}

async function applyBulkRefeicao(){
  const empId = _bulkRefeicaoEmpId;
  if(!empId){ closeModal('modal-bulk-refeicao'); return; }
  const emp = (State.employees||[]).find(e=>e.id===empId);
  if(!emp){ toast('Colaborador não encontrado','error'); return; }
  const newIni = val('bulk-ref-ini');
  const newFim = val('bulk-ref-fim');
  if(!newIni || !newFim){ toast('Preencha os dois horários.','error'); return; }
  const startDia = parseInt(val('bulk-ref-dia')||'1');
  const updateCadastro = document.getElementById('bulk-ref-update-cadastro').checked;
  const futureMonths = document.getElementById('bulk-ref-future-months').checked;
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const btn = document.querySelector('#modal-bulk-refeicao .btn-primary');
  if(btn) setBtnLoading(btn, true, '');
  try {
    // 1) Atualiza DOM do card atual (apenas dias >= startDia, somente trabalho)
    const card = document.querySelector(`.escala-card[data-emp-id="${empId}"]`);
    let domCount = 0;
    if(card){
      card.querySelectorAll('tbody tr[data-dia]').forEach(row => {
        const d = parseInt(row.dataset.dia);
        if(d < startDia) return;
        if(row.dataset.tipo !== 'trabalho') return;
        const ini = row.querySelector('.esc-int-ini');
        const fim = row.querySelector('.esc-int-fim');
        if(ini){ ini.value = newIni; }
        if(fim){ fim.value = newFim; }
        domCount++;
      });
      card.dataset.dirty = '1';
    }
    // 2) Atualiza cadastro se solicitado
    if(updateCadastro){
      emp.horarioRefIni = newIni;
      emp.horarioRefFim = newFim;
      emp.updatedAt = new Date().toISOString();
      await DB.save('employees', emp);
    }
    // 3) Atualiza meses futuros já salvos (se solicitado)
    let futCount = 0;
    if(futureMonths){
      const futuras = (State.escalas||[]).filter(e => e.employeeId===empId &&
        ((e.ano > ano) || (e.ano==ano && e.mes > mes))
      );
      for(const fut of futuras){
        const novoDias = (fut.dias||[]).map(d => {
          if(d.tipo === 'trabalho'){
            return { ...d, intIni: newIni, intFim: newFim };
          }
          return d;
        });
        const novo = { ...fut, dias: novoDias, updatedAt: new Date().toISOString() };
        await DB.save('escalas', novo);
        futCount++;
      }
    }
    closeModal('modal-bulk-refeicao');
    toast(`Aplicado: ${domCount} dia(s) no mês atual + ${futCount} mês(es) futuro(s). Clique em Salvar no card pra confirmar o mês atual.`);
  } catch(e){
    console.error(e);
    toast('Erro ao aplicar refeição em massa','error');
  } finally {
    if(btn) setBtnLoading(btn, false, '<i class="fa-solid fa-check"></i> Aplicar');
  }
}

// ============================================
// ESCALAS — Exports (Print/Excel/Word)
// ============================================
function exportEscalas(format){
  const mes = parseInt(document.getElementById('escala-mes').value);
  const ano = parseInt(document.getElementById('escala-ano').value);
  const cards = document.querySelectorAll('.escala-card');
  if(!cards.length){ toast('Nenhuma escala visível para exportar','error'); return; }
  let bodyHtml = '';
  cards.forEach(card => {
    const empId = card.dataset.empId;
    const emp = State.employees.find(e=>e.id===empId);
    if(!emp) return;
    const posto = (State.postos||[]).find(p=>p.id===emp.posto)?.razaoSocial || '—';
    const dias = _collectEscalaDias(empId);
    const fam = escalaFamilia(emp.escala||'5x2A');
    bodyHtml += `<h2 style="color:#1a3a6b;font-size:14px;margin:14px 0 4px;page-break-after:avoid">${emp.nome}</h2>
      <p style="font-size:11px;color:#444;margin:0 0 6px"><strong>Posto:</strong> ${posto} &nbsp;|&nbsp; <strong>Setor:</strong> ${emp.setor||'—'} &nbsp;|&nbsp; <strong>Escala:</strong> ${escalaLabel(emp.escala||'5x2A')}${emp.turnoNoturno?' (Noturno)':''}</p>
      <table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:11px;margin-bottom:14px;page-break-inside:auto">
        <thead style="background:#1a3a6b;color:#fff"><tr>
          <th>Dia</th><th>Sem.</th><th>Status</th><th>Entrada</th><th>Início Ref.</th><th>Retorno Ref.</th><th>Saída</th>
        </tr></thead><tbody>`;
    dias.forEach(d => {
      const sem = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.diaSem];
      let bg = '#fff';
      if(fam==='12x36') bg = d.tipo==='trabalho' ? '#E3F2FD' : '#FFF8E1';
      else if(d.diaSem===0) bg = '#FFEBEE';
      else if(d.diaSem===6) bg = '#FFF9C4';
      bodyHtml += `<tr style="background:${bg}">
        <td style="text-align:center"><strong>${String(d.dia).padStart(2,'0')}</strong></td>
        <td style="text-align:center">${sem}</td>
        <td style="text-align:center">${d.tipo==='trabalho'?'Trabalho':'Folga'}</td>
        <td style="text-align:center">${d.entrada||'—'}</td>
        <td style="text-align:center">${d.intIni||'—'}</td>
        <td style="text-align:center">${d.intFim||'—'}</td>
        <td style="text-align:center">${d.saida||'—'}</td>
      </tr>`;
    });
    bodyHtml += `</tbody></table>`;
  });
  const titulo = `Escalas — ${MESES[mes]}/${ano}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titulo}</title>
<style>body{font-family:Arial,sans-serif;padding:14px;color:#212529}h1{color:#1a3a6b;font-size:18px;margin-bottom:6px}h2{page-break-after:avoid}table{font-size:11px}@media print{h1{font-size:14px}h2{font-size:12px}table{page-break-inside:avoid}}</style>
</head><body>
<h1>${_e('nomeEmpresa')} — ${titulo}</h1>
${bodyHtml}
<p style="margin-top:18px;font-size:9px;color:#888;text-align:center">Gerado em ${new Date().toLocaleString('pt-BR')} — ${cards.length} colaborador(es)</p>
</body></html>`;
  if(format==='print'){
    const win = window.open('','_blank','width=900,height=700');
    if(!win){ toast('Permita pop-ups para imprimir','error'); return; }
    win.document.write(html + '<scr'+'ipt>window.onload=function(){window.print();}<\/scr'+'ipt>');
    win.document.close();
  } else if(format==='excel'){
    const blob = new Blob(['﻿' + html], {type:'application/vnd.ms-excel;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Escalas_${MESES[mes]}_${ano}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Excel gerado!');
  } else if(format==='word'){
    const blob = new Blob(['﻿' + html], {type:'application/msword;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Escalas_${MESES[mes]}_${ano}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Word gerado!');
  }
}

// ============================================
// PERFIS CUSTOMIZÁVEIS
// ============================================
const MODULOS_LABELS={
  employees:       'Colaboradores',
  payroll:         'Folha de Ponto',
  escalas:         'Escalas',
  aprovaHE:        'Aprovar Horas Extras',
  reports:         'Relatórios',
  pagamentos:      'Pagamentos',
  decimoterceiro:  '13º Salário',
  ferias:          'Férias',
  contabilidade:   'Contabilidade',
  postos:          'Postos de Trabalho',
  contratos:       'Contratos',
  users:           'Usuários & Acessos',
  log:             'Log de Acessos'
};

// Retorna os módulos permitidos para o usuário
function getUserModules(user){
  if(!user) return {};
  if(user.role==='master')  return {dashboard:true,employees:true,payroll:true,escalas:true,aprovaHE:true,reports:true,pagamentos:true,decimoterceiro:true,ferias:true,contabilidade:true,postos:true,contratos:true,users:true,log:true};
  if(user.role==='operador') return {dashboard:true,employees:false,payroll:true,escalas:true,aprovaHE:false,reports:true,pagamentos:true,decimoterceiro:true,ferias:true,contabilidade:true,postos:false,contratos:false,users:false,log:!!user.showLog};
  if(user.role&&user.role.startsWith('p_')){
    const perfilId=user.role.replace('p_','');
    const perfil=(State.perfis||[]).find(p=>p.id===perfilId);
    if(perfil) return {dashboard:true,...(perfil.modules||{}),log:!!(perfil.modules?.log||user.showLog)};
  }
  return {dashboard:true,payroll:true,escalas:true,reports:true};
}

function openPerfilModal(id=null){
  if(Auth.currentUser?.role!=='master') return;
  document.getElementById('modal-perfil').classList.remove('hidden');
  const titleEl=document.getElementById('modal-perfil-title');
  if(id){
    const p=State.perfis.find(p=>p.id===id); if(!p) return;
    titleEl.innerHTML='<i class="fa-solid fa-shield-halved"></i> Editar Perfil';
    setVal('perfil-id',p.id); setVal('perfil-nome',p.nome);
    Object.keys(MODULOS_LABELS).forEach(mod=>{
      const chk=document.querySelector(`#perfil-modulos input[value="${mod}"]`);
      if(chk) chk.checked=!!((p.modules||{})[mod]);
    });
  } else {
    titleEl.innerHTML='<i class="fa-solid fa-shield-halved"></i> Novo Perfil';
    setVal('perfil-id',''); setVal('perfil-nome','');
    Object.keys(MODULOS_LABELS).forEach(mod=>{
      const chk=document.querySelector(`#perfil-modulos input[value="${mod}"]`);
      if(chk) chk.checked=mod!=='users';
    });
  }
}

async function savePerfil(){
  if(Auth.currentUser?.role!=='master') return;
  const nome=val('perfil-nome').trim();
  if(!nome){ toast('Nome do perfil obrigatório.','error'); return; }
  const modules={dashboard:true};
  Object.keys(MODULOS_LABELS).forEach(mod=>{
    const chk=document.querySelector(`#perfil-modulos input[value="${mod}"]`);
    modules[mod]=chk?chk.checked:false;
  });
  const id=val('perfil-id')||genId();
  const perfil={id,nome,modules,updatedAt:new Date().toISOString()};
  const btn=document.querySelector('#modal-perfil .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    await DB.save('perfis',perfil);
    closeModal('modal-perfil');
    toast(`Perfil "${nome}" salvo!`);
    Auth.log('USER_UPDATED',Auth.currentUser.username,`Perfil salvo: ${nome}`);
  } catch(e){ toast('Erro ao salvar perfil.','error'); }
  finally { setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar Perfil'); }
}

function renderPerfisTable(){
  const tbody=document.getElementById('perfis-tbody'); if(!tbody) return;
  const systemPerfis=[
    {nome:'Master',desc:'Acesso total ao sistema',tipo:'Sistema'},
    {nome:'Operador',desc:'Folha de Ponto + Relatórios',tipo:'Sistema'}
  ];
  let rows=systemPerfis.map(p=>`<tr>
    <td><strong>${p.nome}</strong></td>
    <td style="font-size:12px;color:var(--text-muted)">${p.desc}</td>
    <td><span class="badge badge-muted">Sistema</span></td>
    <td>—</td>
  </tr>`).join('');
  if(State.perfis.length>0){
    rows+=State.perfis.map(p=>{
      const modList=Object.entries(p.modules||{}).filter(([k,v])=>v&&k!=='dashboard').map(([k])=>MODULOS_LABELS[k]||k).join(', ')||'—';
      return `<tr>
        <td><strong>${p.nome}</strong></td>
        <td style="font-size:12px;color:var(--text-muted)">${modList}</td>
        <td><span class="badge badge-gestor">Customizado</span></td>
        <td><div class="actions-cell">
          <button class="btn-icon btn-warning-icon" onclick="openPerfilModal('${p.id}')" title="Editar"><i class="fa-solid fa-pencil"></i></button>
          <button class="btn-icon btn-danger-icon" onclick="confirmDeletePerfil('${p.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  }
  tbody.innerHTML=rows;
}

function confirmDeletePerfil(id){
  const p=State.perfis.find(p=>p.id===id); if(!p) return;
  document.getElementById('confirm-message').textContent=`Excluir o perfil "${p.nome}"? Usuários com este perfil passarão a ser Operadores.`;
  const btn=document.getElementById('confirm-ok-btn');
  btn.innerHTML='<i class="fa-solid fa-trash"></i> Excluir';
  btn.onclick=async()=>{
    await DB.remove('perfis',id);
    closeModal('modal-confirm');
    Auth.log('USER_DELETED',Auth.currentUser.username,`Perfil excluído: ${p.nome}`);
    toast(`Perfil "${p.nome}" excluído.`,'warning');
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ============================================
// LOG EXPANDIDO — TOGGLE POR USUÁRIO
// ============================================
async function toggleShowLog(userId){
  if(Auth.currentUser?.role!=='master') return;
  const u=Auth.users.find(u=>u.id===userId); if(!u) return;
  u.showLog=!u.showLog;
  await DB.save('users',u);
  Auth.log('USER_UPDATED',Auth.currentUser.username,`Log ${u.showLog?'liberado':'bloqueado'} para: ${u.username}`);
  toast(`Log ${u.showLog?'liberado':'bloqueado'} para ${u.username}.`);
}

// ============================================
// MÓDULO DE LICENÇA / LOCAÇÃO
// ============================================
async function checkLicenca(){
  if(!DB.fs) return true;
  try {
    const doc=await DB.fs.collection('config').doc('licenca').get();
    if(!doc.exists) return true; // sem controle de licença = livre
    const lic=doc.data();
    if(!lic.ativa){
      showLicencaLock('Sistema bloqueado pelo administrador. Entre em contato com o suporte.');
      return false;
    }
    if(lic.validade){
      const hoje=new Date().toISOString().split('T')[0];
      if(hoje>lic.validade){
        showLicencaLock(`Licença expirada em ${formatDateBr(lic.validade)}. Renove para continuar usando o sistema.`);
        return false;
      }
      const diasRestantes=Math.floor((new Date(lic.validade)-new Date())/86400000);
      if(diasRestantes<=7){
        setTimeout(()=>toast(`⚠ Licença vence em ${diasRestantes} dia(s)! Renove para não perder o acesso.`,'warning'),3000);
      }
    }
    return true;
  } catch(e){
    console.warn('Licença: erro ao verificar (continuando normalmente):',e);
    return true; // em caso de erro de rede, não bloqueia
  }
}

function showLicencaLock(msg){
  hideLoading();
  const lock=document.getElementById('licenca-lock');
  if(lock){
    const msgEl=document.getElementById('licenca-msg');
    if(msgEl) msgEl.textContent=msg;
    lock.classList.remove('hidden');
  }
}

// ============================================
// INICIALIZAÇÃO
// ============================================
async function init(){
  // Injeta versão nos elementos HTML
  ['login-version','sidebar-version'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.textContent = APP_VERSION;
  });

  showLoading('Verificando configuração...');

  // 1. Verificar se Firebase está configurado
  if(!DB.isConfigured()){ showSetup(); return; }

  showLoading('Conectando ao Firebase...');

  // 2. Inicializar Firebase
  if(!DB.init()){ showSetup(); return; }

  showLoading('Carregando dados...');

  // 2b. Carregar config da empresa (em paralelo — não bloqueia)
  loadEmpresaConfig().catch(()=>{});

  // 3. Carregar dados iniciais em paralelo
  try {
    const [employees, payrolls, users, logs, cctDocs, perfisDocs] = await Promise.all([
      DB.getAll('employees'),
      DB.getAll('payrolls'),
      DB.getAll('users'),
      DB.fs.collection('accessLog').orderBy('timestamp','desc').limit(200).get()
        .then(s=>s.docs.map(d=>d.data())),
      DB.fs.collection('cct').get().then(s=>s.docs.map(d=>d.data())),
      DB.getAll('perfis')
    ]);
    State.employees = employees;
    State.payrolls  = payrolls;
    Auth.users      = users;
    Auth.accessLog  = logs;
    State.cct = cctDocs.find(c=>c.id==='current')||null;
    State.perfis = perfisDocs;
  } catch(e){
    console.error('Erro ao carregar dados:', e);
    const msg = e && e.message ? e.message : String(e);
    document.getElementById('loading-msg').innerHTML =
      '<span style="color:#ef9a9a">⚠ Erro ao conectar ao Firebase</span><br>'
      + '<span style="font-size:13px;opacity:.85">' + msg + '</span><br>'
      + '<span style="font-size:11px;opacity:.65;margin-top:6px;display:block">Verifique firebase-config.js e as regras do Firestore.</span>';
    return;
  }

  // 4. Verificar migração de localStorage
  const hasMigrationData =
    (localStorage.getItem('drg_employees') && JSON.parse(localStorage.getItem('drg_employees')||'[]').length > 0) ||
    (localStorage.getItem('drg_payrolls')  && JSON.parse(localStorage.getItem('drg_payrolls') ||'[]').length > 0);

  if(hasMigrationData && State.employees.length === 0){
    showLoading('Migrando dados locais para o Firebase...');
    const ok = await DB.migrateFromLocalStorage();
    if(ok){
      const [emp,pay,usr] = await Promise.all([DB.getAll('employees'),DB.getAll('payrolls'),DB.getAll('users')]);
      State.employees = emp; State.payrolls = pay; Auth.users = usr;
      toast('Dados migrados do armazenamento local para o Firebase!','success');
    }
  }

  // 5. Garantir usuário padrão
  await Auth.ensureDefaultUser();

  // 6. Iniciar listeners em tempo real
  DB.listen('employees', data => {
    State.employees = data;
    if(State.currentSection==='employees') renderEmployeeTable();
    if(State.currentSection==='dashboard') renderDashboard();
    updateDbInfo();
  });
  DB.listen('payrolls', data => {
    State.payrolls = data;
    if(State.currentSection==='payroll') renderPayrollHistory(val('payroll-employee'));
    if(State.currentSection==='dashboard') renderDashboard();
    updateDbInfo();
  });
  DB.listen('users', data => {
    Auth.users = data;
    if(State.currentSection==='users') renderUsersTable();
  });
  DB.listen('accessLog', data => {
    Auth.accessLog = data.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    if(State.currentSection==='users') renderLogTable();
  }, 'timestamp', 200);
  DB.listen('cct', data => {
    State.cct = data.find(c=>c.id==='current')||null;
    if(State.currentSection==='dashboard') renderDashboard();
  });
  DB.listen('perfis', data => {
    State.perfis = data;
    if(State.currentSection==='users') renderPerfisTable();
  });
  DB.listen('postos', data => {
    State.postos = data;
    if(State.currentSection==='postos') renderPostosTable();
    populatePostoSelect();
  });
  DB.listen('contratos', data => {
    State.contratos = data;
    if(State.currentSection==='contratos') renderContratosTable();
    if(State.currentSection==='dashboard') renderAlerts();
  });
  DB.listen('decimoTerceiro', data => {
    State.decimoTerceiro = data;
    if(State.currentSection==='decimoterceiro') renderDecimoTerceiro();
  });
  DB.listen('ferias', data => {
    State.ferias = data;
    if(State.currentSection==='ferias') renderFeriasModulo();
  });
  DB.listen('escalas', data => {
    State.escalas = data;
    if(State.currentSection==='escalas') renderEscalas();
    if(State.currentSection==='dashboard') renderDashboard();
  });

  // 7. Configurar datas na UI
  document.getElementById('topbar-date').textContent =
    new Date().toLocaleDateString('pt-BR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('payroll-mes').value            = currentMes();
  document.getElementById('payroll-ano').value            = currentAno();
  document.getElementById('report-mes').value             = currentMes();
  document.getElementById('report-ano').value             = currentAno();
  const rIndAno=document.getElementById('report-individual-ano');
  if(rIndAno) rIndAno.value=currentAno();
  const decAno=document.getElementById('dec-ano');
  if(decAno) decAno.value=currentAno();
  const ferModAno=document.getElementById('fer-mod-ano');
  if(ferModAno) ferModAno.value=currentAno();

  // 8. Verificar licença
  const licencaOk = await checkLicenca();
  if(!licencaOk) return;

  // 8b. Verificar sessão existente
  hideLoading();
  const sessionUser = Auth.loadSession();
  if(sessionUser){
    Auth.currentUser = sessionUser;
    document.getElementById('login-screen').classList.add('hidden');
    applyUserSession(sessionUser);
  }

  // 8c. Restaurar auto-backup automaticamente (sem clique do usuário)
  AutoBackup.tryRestore();

  // 9. Listeners de férias (cálculo automático de dias)
  document.getElementById('ferias-inicio')?.addEventListener('change', calcFeriasDias);
  document.getElementById('ferias-fim')?.addEventListener('change', calcFeriasDias);

  // 10. Tecla Escape fecha modais
  document.addEventListener('keydown', e => {
    if(e.key==='Escape'){
      ['modal-employee','modal-pdf','modal-confirm','modal-user','modal-change-pass','modal-cct',
       'modal-ponto-manual','modal-relatorio-individual','modal-perfil']
        .forEach(id => document.getElementById(id)?.classList.add('hidden'));
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
