/* ============================================
   D.R. Global Multi Services — Sistema de Gestão
   app.js  (v4 — Firebase Firestore)
   ============================================ */

'use strict';

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
const State = {
  employees: [],
  payrolls:  [],
  perfis:    [],
  postos:    [],
  contratos: [],
  cct: null,
  currentSection: 'dashboard',
  editingEmployeeId: null,
  currentPdfFile: null,
  currentPdfText: '',
  employeeFilter: 'all'
};

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
function showSection(name){
  if(!Auth.currentUser) return;
  const mods=getUserModules(Auth.currentUser);
  if(name==='users'     && !mods.users && !mods.log) return;
  if(name==='employees' && !mods.employees) return;
  if(name==='payroll'   && !mods.payroll)   return;
  if(name==='reports'   && !mods.reports)   return;
  if(name==='postos'    && !mods.postos)    return;
  if(name==='contratos' && !mods.contratos) return;
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));
  const section=document.getElementById('section-'+name);
  const navBtn=document.getElementById('nav-'+name);
  if(section) section.classList.add('active');
  if(navBtn)  navBtn.classList.add('active');
  const titles={dashboard:'Dashboard',employees:'Colaboradores',payroll:'Folha de Ponto',
                reports:'Relatórios',users:'Usuários & Acessos',postos:'Postos de Trabalho',contratos:'Contratos'};
  document.getElementById('topbar-title').textContent=titles[name]||name;
  State.currentSection=name;
  if(name==='employees') renderEmployeeTable();
  if(name==='payroll')   initPayrollSection();
  if(name==='dashboard') renderDashboard();
  if(name==='reports')   initReportIndividualSelect();
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
  const contratosLi=document.getElementById('nav-contratos-li');
  if(contratosLi) contratosLi.classList.toggle('hidden', !mods.contratos);
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
  const totalEsp=payThisMonth.reduce((s,p)=>s+(p.remuneracao||0),0);
  const ativos=State.employees.filter(e=>(e.status||'ativo')==='ativo').length;
  const inativos=State.employees.filter(e=>(e.status||'ativo')==='inativo').length;
  const afastados=State.employees.filter(e=>(e.status||'ativo')==='afastado').length;
  const totalPostos=(State.postos||[]).length;
  const stats=document.getElementById('dashboard-stats'); if(!stats) return;
  const cctInfo=State.cct?`<div class="stat-card" style="border-color:#7B1FA2;border-left-width:4px"><div class="stat-icon" style="background:#F3E5F5;color:#7B1FA2"><i class="fa-solid fa-file-contract"></i></div><div><div class="stat-value" style="font-size:14px">CCT vigente</div><div class="stat-label">desde ${formatDateBr(State.cct.vigencia)}</div></div></div>`:'';
  stats.innerHTML=`
    <div class="stat-card blue"><div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
      <div><div class="stat-value">${ativos}</div><div class="stat-label">Colaboradores ativos</div></div></div>
    <div class="stat-card teal"><div class="stat-icon"><i class="fa-solid fa-user-clock"></i></div>
      <div><div class="stat-value">${afastados}</div><div class="stat-label">Afastados INSS</div></div></div>
    <div class="stat-card" style="border-color:#9E9E9E;border-left-width:4px"><div class="stat-icon" style="background:#F5F5F5;color:#757575"><i class="fa-solid fa-user-slash"></i></div>
      <div><div class="stat-value">${inativos}</div><div class="stat-label">Colaboradores inativos</div></div></div>
    <div class="stat-card" style="border-color:#1565C0;border-left-width:4px;cursor:pointer" onclick="showSection('postos')" title="Ver postos de trabalho">
      <div class="stat-icon" style="background:#E3F2FD;color:#1565C0"><i class="fa-solid fa-building"></i></div>
      <div><div class="stat-value" style="color:#1565C0">${totalPostos}</div><div class="stat-label">Postos de trabalho</div></div></div>
    <div class="stat-card green"><div class="stat-icon"><i class="fa-solid fa-file-circle-check"></i></div>
      <div><div class="stat-value">${payThisMonth.length}</div><div class="stat-label">Folhas lançadas em ${MESES[mes]}</div></div></div>
    <div class="stat-card amber"><div class="stat-icon"><i class="fa-solid fa-money-bill-wave"></i></div>
      <div><div class="stat-value">${fmtMoney(totalEsp)}</div><div class="stat-label">Total remuneração ${MESES[mes]}</div></div></div>
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
  document.querySelectorAll('.status-filter-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderEmployeeTable();
}

function statusBadge(status){
  const s = status||'ativo';
  if(s==='ativo')    return '<span class="badge badge-status-ativo">Ativo</span>';
  if(s==='inativo')  return '<span class="badge badge-status-inativo">Inativo</span>';
  if(s==='afastado') return '<span class="badge badge-status-afastado">Afastado INSS</span>';
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
  tbody.innerHTML=list.map((e)=>{
    const celularLimpo=(e.celular||'').replace(/\D/g,'');
    const whatsBtn=celularLimpo?`<button class="btn-icon btn-whatsapp-icon" onclick="openWhatsApp('${celularLimpo}','${e.nome.split(' ')[0]}')" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>`:'';
    return `<tr>
      <td><span class="badge badge-muted">${e.registro?String(e.registro).padStart(4,'0'):'—'}</span></td>
      <td><div style="display:flex;align-items:center;gap:8px">
        ${e.fotoUrl?`<img src="${e.fotoUrl}" class="emp-table-photo" alt="">`:`<div class="emp-table-initials">${initials(e.nome)}</div>`}
        <span class="td-name">${e.nome}</span>
      </div></td>
      <td>${statusBadge(e.status)}</td>
      <td><span class="td-escala">${escalaLabel(e.escala||'5x2A')}</span></td>
      <td><span style="font-size:12px;color:var(--text-muted)">${e.posto||'—'}</span></td>
      <td>${e.dataAdmissao?formatDateBr(e.dataAdmissao):'—'}</td>
      <td><span class="td-mono">${e.cpf||'—'}</span></td>
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

function getNextRegistro(){
  if(State.employees.length===0) return 1;
  const max=State.employees.reduce((m,e)=>Math.max(m,parseInt(e.registro)||0),0);
  return max+1;
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
    setVal('emp-registro', emp.registro ? String(emp.registro).padStart(4,'0') : '—');
    setVal('emp-id',emp.id); setVal('emp-nome',emp.nome); setVal('emp-rg',emp.rg||'');
    setVal('emp-cpf',emp.cpf); setVal('emp-titulo',emp.tituloEleitor||''); setVal('emp-pis',emp.pisNit||'');
    setVal('emp-ctps-numero',emp.ctpsNumero||''); setVal('emp-ctps-serie',emp.ctpsSerie||'');
    setVal('emp-nascimento',emp.dataNascimento||'');
    setVal('emp-email',emp.email||''); setVal('emp-celular',emp.celular||''); setVal('emp-cep',emp.cep||'');
    setVal('emp-endereco',emp.endereco||''); setVal('emp-numero',emp.numero||''); setVal('emp-complemento',emp.complemento||'');
    setVal('emp-bairro',emp.bairro||''); setVal('emp-cidade',emp.cidade||''); setVal('emp-estado',emp.estado||'SP');
    setVal('emp-tipo-transporte',emp.tipoTransporte||'vt');
    setVal('emp-vt-dia',emp.valorDiarioVt||''); setVal('emp-vr-dia',emp.valorDiarioVr||'');
    setVal('emp-va-mensal',emp.valorMensalVa||''); setVal('emp-pix',emp.chavePix||'');
    onTipoTransporteChange();
    // Contrato & Trabalho
    setVal('emp-data-admissao',emp.dataAdmissao||''); setVal('emp-data-demissao',emp.dataDemissao||'');
    setVal('emp-status',emp.status||'ativo'); setVal('emp-escala',emp.escala||'5x2A');
    setVal('emp-horario-entrada',emp.horarioEntrada||''); setVal('emp-horario-saida',emp.horarioSaida||'');
    setVal('emp-salario-base',emp.salarioBase||'');
    setVal('emp-posto',emp.posto||'');
    setVal('emp-setor',emp.setor||'');
    setVal('emp-exame-vencimento',emp.exameVencimento||'');
    const chk=document.getElementById('emp-turno-noturno'); if(chk) chk.checked=!!(emp.turnoNoturno);
    onEscalaChange();
    // Histórico de salário
    renderHistoricoSalario(emp.historicoSalario||[]);
    // Histórico de postos
    renderHistoricoPostos(emp);
    // Foto
    loadEmployeePhoto(emp.id, emp.fotoUrl||null);
    // Férias
    renderFeriasList(emp.ferias||[]);
    // Documentos
    loadDocumentList(emp.id);
  } else {
    const nextNum = getNextRegistro();
    titleEl.innerHTML='<i class="fa-solid fa-user-plus"></i> Novo Colaborador';
    setVal('emp-registro', String(nextNum).padStart(4,'0'));
    ['emp-id','emp-nome','emp-rg','emp-cpf','emp-titulo','emp-pis','emp-ctps-numero','emp-ctps-serie',
     'emp-nascimento','emp-email','emp-celular','emp-cep','emp-endereco','emp-numero','emp-complemento',
     'emp-bairro','emp-cidade','emp-vt-dia','emp-vr-dia','emp-va-mensal','emp-pix','emp-tipo-transporte',
     'emp-data-admissao','emp-data-demissao','emp-horario-entrada','emp-horario-saida',
     'emp-salario-base','emp-posto','emp-setor','emp-exame-vencimento'].forEach(fid=>setVal(fid,''));
    // Resetar foto, férias e histórico de postos
    loadEmployeePhoto(null, null);
    renderFeriasList([]);
    renderHistoricoSalario([]);
    renderHistoricoPostos(null);
    setVal('emp-estado','SP'); setVal('emp-status','ativo'); setVal('emp-escala','5x2A');
    const chk=document.getElementById('emp-turno-noturno'); if(chk) chk.checked=false;
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
    valorDiarioVt:numVal('emp-vt-dia'), valorDiarioVr:numVal('emp-vr-dia'),
    valorMensalVa:numVal('emp-va-mensal'),
    chavePix:val('emp-pix'),
    // Contrato & Trabalho
    dataAdmissao:val('emp-data-admissao'),
    dataDemissao:demissao,
    status,
    escala:val('emp-escala')||'5x2A',
    horarioEntrada:val('emp-horario-entrada'),
    horarioSaida:val('emp-horario-saida'),
    turnoNoturno:chk?chk.checked:false,
    salarioBase:numVal('emp-salario-base'),
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
    await DB.save('employees',data);
    Auth.log(State.editingEmployeeId?'EMPLOYEE_UPDATED':'EMPLOYEE_CREATED', null, `${data.nome} (CPF: ${data.cpf||'—'}, Posto: ${data.posto||'—'})`);
    closeModal('modal-employee');
    toast(State.editingEmployeeId?'Colaborador atualizado!':'Colaborador cadastrado!');
  } catch(e){ toast('Erro ao salvar. Verifique a conexão.','error'); console.error(e); }
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
  const mes=document.getElementById('payroll-mes');
  mes.value=mes.value||currentMes();
  document.getElementById('payroll-ano').value=document.getElementById('payroll-ano').value||currentAno();
  if(currentId) onPayrollEmployeeChange();
}

function onPayrollEmployeeChange(){
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const infoEl=document.getElementById('payroll-emp-info');
  if(emp){
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
    if(infoEl) infoEl.classList.add('hidden');
    const noturnoCard=document.getElementById('noturno-card');
    if(noturnoCard) noturnoCard.classList.add('hidden');
  }
  recalculate(); renderPayrollHistory(empId);
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
  if(wrap) wrap.style.display=tipo==='nao'?'none':'';
  // Atualiza label do campo de valor
  const lbl=wrap?wrap.querySelector('label'):null;
  if(lbl) lbl.innerHTML=tipo==='am'
    ? '<i class="fa-solid fa-motorcycle" style="color:#4fc3f7"></i> Valor Diário AM (R$)'
    : '<i class="fa-solid fa-bus" style="color:#4fc3f7"></i> Valor Diário VT (R$)';
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

  // --- VT e VR ---
  setVal('payroll-vt-total',(numVal('payroll-vt-dia')*dias).toFixed(2));
  setVal('payroll-vr-total',(numVal('payroll-vr-dia')*dias).toFixed(2));

  // --- Bonificação: bloqueada se qualquer falta ---
  const bonusCard=document.getElementById('bonus-card');
  const bonusInput=document.getElementById('payroll-bonus');
  const bonusAlert=document.getElementById('bonus-alert');
  if(totalFaltas>0){
    bonusCard.classList.add('locked'); bonusInput.disabled=true;
    setVal('payroll-bonus',''); bonusAlert.classList.remove('hidden');
  } else {
    bonusCard.classList.remove('locked'); bonusInput.disabled=false; bonusAlert.classList.add('hidden');
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

  // --- Adiantamento quinzenal ---
  const ativoAdiant=val('payroll-adiantamento-ativo')==='sim';
  const percAdiant=parseInt(val('payroll-adiantamento-perc')||'40');
  if(ativoAdiant && remuneracao>0){
    setVal('payroll-adiantamento-valor',((remuneracao*(percAdiant/100))).toFixed(2));
  } else {
    setVal('payroll-adiantamento-valor','0.00');
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
  setVal('payroll-dias',p.diasTrabalhados);
  // Suporte a registros antigos (campo faltas único) e novos (divididos)
  setVal('payroll-faltas-justificadas',p.faltasJustificadas||0);
  setVal('payroll-faltas-injustificadas',p.faltasInjustificadas||(p.faltas||0));
  setVal('payroll-remuneracao',p.remuneracao); setVal('payroll-vt-dia',p.vtDia||'');
  setVal('payroll-vt-total',p.valeTransporte); setVal('payroll-vr-dia',p.vrDia||'');
  setVal('payroll-vr-total',p.valeRefeicao); setVal('payroll-va-total',p.valeAlimentacaoTotal||'');
  setVal('payroll-va-liquido',p.valeAlimentacaoLiquido||''); setVal('payroll-bonus',p.bonificacao||'');
  setVal('payroll-noturno',p.adNoturno||'');
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
  const dias=numVal('payroll-dias');
  const faltasJust=numVal('payroll-faltas-justificadas');
  const faltasInjust=numVal('payroll-faltas-injustificadas');
  const totalFaltas=faltasJust+faltasInjust;
  const vtDia=numVal('payroll-vt-dia'), vrDia=numVal('payroll-vr-dia');
  const existing=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
  const record={
    id:existing?existing.id:genId(), employeeId:empId,
    mes:parseInt(mes), ano:parseInt(ano),
    diasTrabalhados:dias,
    faltas:totalFaltas,
    faltasJustificadas:faltasJust,
    faltasInjustificadas:faltasInjust,
    remuneracao:numVal('payroll-remuneracao'),
    vtDia, valeTransporte:vtDia*dias,
    vrDia, valeRefeicao:vrDia*dias,
    valeAlimentacaoTotal:numVal('payroll-va-total'),
    valeAlimentacaoLiquido:numVal('payroll-va-liquido'),
    bonificacao:totalFaltas===0?numVal('payroll-bonus'):0,
    adNoturno:numVal('payroll-noturno'),
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
    pdfName:State.currentPdfFile?State.currentPdfFile.name:(existing?existing.pdfName:''),
    updatedAt:new Date().toISOString(),
    createdAt:existing?existing.createdAt:new Date().toISOString()
  };
  const btn=document.querySelector('#section-payroll .btn-primary');
  setBtnLoading(btn,true,'');
  try {
    await DB.save('payrolls',record);
    const empNome=(State.employees.find(e=>e.id===empId)||{}).nome||'—';
    Auth.log(existing?'PAYROLL_UPDATED':'PAYROLL_CREATED', null, `${empNome} — ${MESES[parseInt(mes)]}/${ano}`);
    toast(existing?'Lançamento atualizado!':'Lançamento salvo!');
    clearPdf(null,true);
  } catch(e){ toast('Erro ao salvar.','error'); }
  finally { setBtnLoading(btn,false,'<i class="fa-solid fa-floppy-disk"></i> Salvar Lançamento'); }
}

function clearPayrollForm(){
  ['payroll-dias','payroll-faltas','payroll-faltas-justificadas','payroll-faltas-injustificadas',
   'payroll-remuneracao','payroll-vt-dia','payroll-vt-total',
   'payroll-vr-dia','payroll-vr-total','payroll-va-total','payroll-va-liquido',
   'payroll-bonus','payroll-noturno','payroll-adiantamento-valor',
   'payroll-atraso-min','payroll-desconto-atraso',
   'payroll-entrada','payroll-saida','payroll-intervalo-inicio','payroll-intervalo-fim',
   'payroll-horas-liquidas','payroll-horas-extras-dia','payroll-he-total','payroll-he-valor']
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
const GEMINI_API_KEY = 'AIzaSyAgXsJAKaHkXTbibx-qAoFkm1XAqQlLqts';
const GEMINI_MODEL   = 'gemini-2.5-flash';

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
  '5x2A': 'Escala 5x2 — Variante A: trabalha SEGUNDA A SEXTA (08h-18h / Sex 08h-16h). Sábados e domingos NÃO são dias de trabalho. Falta = dia útil de Seg a Sex sem registro de entrada nem saída.',
  '5x2B': 'Escala 5x2 — Variante B: trabalha SEGUNDA A SEXTA (07h-17h / Sex 07h-16h). Sábados e domingos NÃO são dias de trabalho. Falta = dia útil de Seg a Sex sem registro de entrada nem saída.',
  '6x1A': 'Escala 6x1 — Variante A: trabalha SEGUNDA A SÁBADO (07h-16h / Sáb 07h-11h), folga DOMINGO. Falta = qualquer dia entre Seg e Sáb sem registro de entrada nem saída.',
  '6x1B': 'Escala 6x1 — Variante B: trabalha TODOS OS DIAS (08h-16h20). Falta = qualquer dia sem registro de entrada nem saída (com 1 folga semanal que aparece marcada como "FOLGA" ou similar).',
  '12x36': 'Escala 12x36: o colaborador trabalha em DIAS ALTERNADOS (12h trabalho / 36h folga). DIAS SEM REGISTRO PODEM SER FOLGAS PROGRAMADAS — NÃO são faltas automaticamente. Considere FALTA = 0 a menos que a folha explicite uma falta na coluna OBS (ex: "FALTA", "FALTOU", "AUSENTE"). Se houver atestado, conta como justificada e não entra em "faltas".'
};

// Chama a API do Gemini com visão
async function callGemini(base64Data, mimeType, escala){
  const escalaRule=ESCALA_RULES[escala]||ESCALA_RULES['5x2A'];
  const prompt=`Você é um sistema de leitura de folha de ponto brasileira. Analise a imagem desta folha de ponto e extraia os dados com precisão.

A folha tem as colunas: DIA | ENTRADA | INÍCIO INTERVALO | RETORNO INTERVALO | SAÍDA | RUBRICA DO EMPREGADO | HORA EXTRA | OBS

ESCALA DO COLABORADOR: ${escalaRule}

Extraia e retorne SOMENTE um JSON válido com este formato exato:
{
  "nome": "nome completo do colaborador ou null se não encontrado",
  "cargo": "cargo ou função ou null",
  "ctps": "número da CTPS ou null",
  "diasTrabalhados": número inteiro de dias com registro de ENTRADA e SAÍDA preenchidos,
  "faltas": número inteiro de dias contados como FALTA conforme as regras da escala acima,
  "horasExtras": número decimal total de horas extras (some a coluna HORA EXTRA),
  "observacoes": "texto das observações relevantes ou null"
}

Regras gerais:
- Dia trabalhado = linha com horário de ENTRADA e SAÍDA preenchidos
- Faltas DEVEM seguir a regra específica da ESCALA acima — leia com atenção
- Se a coluna OBS contiver "FÉRIAS", "ATESTADO", "AFASTAMENTO" ou similar, NÃO conta como falta
- Se a coluna HORA EXTRA estiver em branco, considere 0
- Retorne APENAS o JSON, sem markdown, sem explicação, sem texto adicional`;

  const resp=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contents:[{parts:[
          {text:prompt},
          {inline_data:{mime_type:mimeType, data:base64Data}}
        ]}],
        generationConfig:{
          temperature:0.1,
          maxOutputTokens:4096,
          responseMimeType:'application/json'
        }
      })
    }
  );
  if(!resp.ok){
    const err=await resp.json();
    throw new Error(err.error?.message||'Erro na API Gemini');
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
  else if(type==='afastados')  _reportAfastados();
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
  } else {
    infoEl.style.display='none';
    ['cct-vigencia','cct-salario-base','cct-vt-diario','cct-vr-diario','cct-va-mensal','cct-bonificacao','cct-plr'].forEach(id=>setVal(id,''));
    setVal('cct-adicional-noturno',20);
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

async function uploadDocument(){
  const empId=val('emp-id');
  if(!empId){ toast('Salve o colaborador antes de enviar documentos.','warning'); return; }
  DB.initStorage();
  if(!DB.storage){ toast('Firebase Storage não disponível.','error'); return; }
  const fileInput=document.getElementById('doc-file');
  const file=fileInput?fileInput.files[0]:null;
  if(!file){ toast('Selecione um arquivo.','error'); return; }
  const tipo=val('doc-tipo')||'Outros';
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
function openPontoManual(){
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
    cards+=`<div style="border:1px solid ${borderCard};border-radius:8px;padding:8px 12px;background:${bgCard};display:flex;align-items:center;gap:10px" data-dia="${d}" data-semana="${diaSem}">
      <div style="min-width:42px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:var(--primary);line-height:1">${diaFormatado}</div>
        <div style="font-size:10px;color:${isWeekend?'#FB8C00':'var(--text-muted)'};font-weight:600;text-transform:uppercase">${diasLabel}</div>
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4px 6px">
        <div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Entrada</div>
          <input type="time" class="pm-entrada pm-input" style="${opStyle}" onchange="calcResumoManual()">
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">Saída</div>
          <input type="time" class="pm-saida pm-input" style="${opStyle}" onchange="calcResumoManual()">
        </div>
        <div>
          <div style="font-size:10px;color:#F59E0B;margin-bottom:2px">🍽 Int. Início</div>
          <input type="time" class="pm-int-ini pm-input" style="${opStyle}" onchange="calcResumoManual()">
        </div>
        <div>
          <div style="font-size:10px;color:#F59E0B;margin-bottom:2px">🍽 Int. Fim</div>
          <input type="time" class="pm-int-fim pm-input" style="${opStyle}" onchange="calcResumoManual()">
        </div>
      </div>
    </div>`;
  }
  grid.innerHTML=cards;
  // Carregar dados salvos do Firebase (se existirem)
  const payrollSalvo=State.payrolls.find(p=>p.employeeId===empId&&p.mes==mes&&p.ano==ano);
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
      // Exibe ícones de localização do app de ponto
      ['entrada','saida','intIni','intFim'].forEach(k=>{
        const geo=d[k+'_geo'];
        if(!geo) return;
        const sel=k==='entrada'?'.pm-entrada':k==='saida'?'.pm-saida':k==='intIni'?'.pm-int-ini':'.pm-int-fim';
        const inp=card.querySelector(sel);
        if(!inp) return;
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

function _collectPontoManualDias(){
  const dias=[];
  _getPontoManualCards().forEach(card=>{
    dias.push({
      dia:     parseInt(card.dataset.dia),
      diaSem:  parseInt(card.dataset.semana),
      entrada: card.querySelector('.pm-entrada')?.value||'',
      saida:   card.querySelector('.pm-saida')?.value||'',
      intIni:  card.querySelector('.pm-int-ini')?.value||'',
      intFim:  card.querySelector('.pm-int-fim')?.value||''
    });
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
  let diasTrabalhados=0, faltas=0, totalHEmin=0;
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  cards.forEach(card=>{
    const diaSem=parseInt(card.dataset.semana);
    const entrada=card.querySelector('.pm-entrada')?.value;
    const saida=card.querySelector('.pm-saida')?.value;
    const intIni=card.querySelector('.pm-int-ini')?.value;
    const intFim=card.querySelector('.pm-int-fim')?.value;
    const isWeekend=diaSem===0||diaSem===6;
    if(entrada&&saida){
      diasTrabalhados++;
      let minBrutos=timeToMinutes(saida)-timeToMinutes(entrada);
      if(minBrutos<=0) minBrutos+=24*60;
      const minIntervalo=(intIni&&intFim)?Math.max(0,timeToMinutes(intFim)-timeToMinutes(intIni)):0;
      const minLiquidos=minBrutos-minIntervalo;
      let minContratados=480; // 8h padrão
      if(emp){
        const fam=escalaFamilia(emp.escala||'5x2A');
        if(fam==='6x1') minContratados=440;
        else if(fam==='12x36') minContratados=660;
      }
      totalHEmin+=Math.max(0,minLiquidos-minContratados);
    } else if(!isWeekend&&!entrada&&!saida) faltas++;
  });
  const diasEl=document.getElementById('ponto-resumo-dias');
  const faltasEl=document.getElementById('ponto-resumo-faltas');
  const heEl=document.getElementById('ponto-resumo-he');
  if(diasEl)   diasEl.textContent=diasTrabalhados;
  if(faltasEl) faltasEl.textContent=faltas;
  if(heEl)     heEl.textContent=totalHEmin>0?minutesToStr(totalHEmin):'0h';
}

async function applyPontoManual(){
  const cards=_getPontoManualCards();
  let diasTrabalhados=0, faltas=0, totalHEmin=0;
  const empId=val('payroll-employee');
  const emp=State.employees.find(e=>e.id===empId);
  const mes=parseInt(val('payroll-mes')||currentMes());
  const ano=parseInt(val('payroll-ano')||currentAno());
  cards.forEach(card=>{
    const diaSem=parseInt(card.dataset.semana);
    const entrada=card.querySelector('.pm-entrada')?.value;
    const saida=card.querySelector('.pm-saida')?.value;
    const intIni=card.querySelector('.pm-int-ini')?.value;
    const intFim=card.querySelector('.pm-int-fim')?.value;
    const isWeekend=diaSem===0||diaSem===6;
    if(entrada&&saida){
      diasTrabalhados++;
      let minBrutos=timeToMinutes(saida)-timeToMinutes(entrada);
      if(minBrutos<=0) minBrutos+=24*60;
      const minIntervalo=(intIni&&intFim)?Math.max(0,timeToMinutes(intFim)-timeToMinutes(intIni)):0;
      const minLiquidos=minBrutos-minIntervalo;
      let minContratados=480;
      if(emp){
        const fam=escalaFamilia(emp.escala||'5x2A');
        if(fam==='6x1') minContratados=440;
        else if(fam==='12x36') minContratados=660;
      }
      totalHEmin+=Math.max(0,minLiquidos-minContratados);
    } else if(!isWeekend&&!entrada&&!saida) faltas++;
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
// IMPRIMIR FOLHA DE PONTO
// ============================================
function printFolhaPonto(){
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
  const adNoturno=numVal('payroll-noturno')||0;
  const adiantamento=numVal('payroll-adiantamento-valor')||0;
  const descontoAtraso=numVal('payroll-desconto-atraso')||0;
  const totalLiquido=remuneracao+heValor+adNoturno+bonificacao+vtTotal+vrTotal+vaLiquido-adiantamento-descontoAtraso;

  // Posto do colaborador
  const posto=State.postos.find(p=>p.id===emp.posto)||{razaoSocial:'—', endereco:'—'};

  // Dados do ponto manual (do modal aberto ou do registro Firebase)
  const cards=_getPontoManualCards();
  const usandoModal=cards.length>0;
  const diasPonto=usandoModal ? _collectPontoManualDias() : (payrollReg?.pontoManualDias||[]);

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
      const mi=(intIni&&intFim)?Math.max(0,timeToMinutes(intFim)-timeToMinutes(intIni)):0;
      minLiq=mb-mi;
    }
    const horasLiq=minLiq>0?minutesToStr(minLiq):'';
    let obsdia='';
    if(!entrada&&!saida&&!isWknd) obsdia='Falta';
    else if(!entrada&&!saida&&isWknd) obsdia='Folga';
    const rowBg=isWknd?'background:#F8F9FA;color:#999':'';
    tabelaDias+=`<tr style="${rowBg}">
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${String(d).padStart(2,'0')}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${nomeDia}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${entrada}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${saida}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intIni}</td>
      <td style="text-align:center;padding:3px 6px;border:1px solid #DEE2E6">${intFim}</td>
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
<title>Folha de Ponto — ${emp.nome} — ${mesLabel}/${ano}</title>
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
  @media print{ body{ padding:8px; } }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <h1>D.R. Global Multi Services</h1>
    <p>CNPJ: 47.619.085/0001-98 &nbsp;|&nbsp; Gestão de Portaria e Segurança</p>
    <p style="font-size:12px;font-weight:700;color:#1a3a6b;margin-top:4px">FOLHA DE PONTO — ${mesLabel.toUpperCase()} / ${ano}</p>
  </div>
  <div class="header-right">
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
  <div class="info-item"><div class="info-label">Horário Contratual</div><div class="info-value">${emp.horarioEntrada||'—'} – ${emp.horarioSaida||'—'}</div></div>
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
    ${adNoturno>0?`<tr><td class="fin-label">Adicional Noturno</td><td class="fin-value">${fmtMoney(adNoturno)}</td></tr>`:''}
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
    D.R. Global Multi Services<br>Empresa / Responsável
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
// PERFIS CUSTOMIZÁVEIS
// ============================================
const MODULOS_LABELS={
  employees:'Colaboradores',
  payroll:  'Folha de Ponto',
  reports:  'Relatórios',
  postos:   'Postos de Trabalho',
  contratos:'Contratos',
  users:    'Usuários & Acessos',
  log:      'Log de Acessos'
};

// Retorna os módulos permitidos para o usuário
function getUserModules(user){
  if(!user) return {};
  if(user.role==='master')  return {dashboard:true,employees:true,payroll:true,reports:true,postos:true,contratos:true,users:true,log:true};
  if(user.role==='operador') return {dashboard:true,employees:false,payroll:true,reports:true,postos:false,contratos:false,users:false,log:!!user.showLog};
  if(user.role&&user.role.startsWith('p_')){
    const perfilId=user.role.replace('p_','');
    const perfil=(State.perfis||[]).find(p=>p.id===perfilId);
    if(perfil) return {dashboard:true,...(perfil.modules||{}),log:!!(perfil.modules?.log||user.showLog)};
  }
  return {dashboard:true,payroll:true,reports:true};
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
  showLoading('Verificando configuração...');

  // 1. Verificar se Firebase está configurado
  if(!DB.isConfigured()){ showSetup(); return; }

  showLoading('Conectando ao Firebase...');

  // 2. Inicializar Firebase
  if(!DB.init()){ showSetup(); return; }

  showLoading('Carregando dados...');

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

  // 7. Configurar datas na UI
  document.getElementById('topbar-date').textContent =
    new Date().toLocaleDateString('pt-BR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('payroll-mes').value            = currentMes();
  document.getElementById('payroll-ano').value            = currentAno();
  document.getElementById('report-mes').value             = currentMes();
  document.getElementById('report-ano').value             = currentAno();
  const rIndAno=document.getElementById('report-individual-ano');
  if(rIndAno) rIndAno.value=currentAno();

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
