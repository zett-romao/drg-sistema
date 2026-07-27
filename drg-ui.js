/* drg-ui.js — padrao DR Systems: botao de acao NUNCA e mudo.
 *
 * Regra nº 1 do ~/.claude/CLAUDE.md.
 * Ciclo: pressionou -> travou -> respondeu -> saiu -> destravou.
 *
 * Botao parado depois do clique faz a pessoa clicar de novo, e clique repetido
 * vira registro duplicado no banco (caso real: "Criar conta" do DRG-Guard,
 * gerando varios pedidos de acesso para a mesma pessoa).
 *
 * Resolve o app inteiro de uma vez, sem mexer em cada tela: um vigia global
 * observa o clique e as chamadas de rede que ele dispara.
 *
 *   1. Clique em qualquer <button> arma o vigia.
 *   2. Se o clique for para a rede, o botao trava e avisa.
 *   3. Enquanto a requisicao estiver no ar, clique repetido e ENGOLIDO
 *      (nao chega no onclick) — e essa a barreira contra o duplicado.
 *   4. Quando a rede responde, o botao volta ao normal sozinho.
 *   5. Botao que nao usa rede (abrir modal, trocar aba) se desarma em 250ms.
 *
 * Instalacao (antes do script do app):
 *   <link rel="stylesheet" href="drg-ui.css">
 *   <script src="drg-ui.js"></script>
 *
 * Ajustes opcionais, declarados ANTES deste arquivo:
 *   window.DRG_UI = { trocarTexto: false }   // React/Next: nao mexer no texto
 *
 * Para tirar um botao do ciclo: data-noguard="1".
 */
(function (global) {
  'use strict';

  var cfg = global.DRG_UI || {};
  // Em React/Vue o texto do botao pertence ao framework: trocar por
  // "Aguarde..." briga com a proxima renderizacao. Nesses casos o aviso fica
  // por conta do girador do CSS (classe .drg-ocupado).
  var trocarTexto = cfg.trocarTexto !== false;
  var JANELA_SEM_REDE = cfg.janelaSemRede || 250;  // ms para decidir que o clique nao chama a rede
  var FOLGA = cfg.folga || 80;                      // ms de espera por uma chamada encadeada

  var armado = null;

  function podeTrocarTexto(btn) {
    if (!trocarTexto) return false;
    var t = (btn.textContent || '').trim();
    return t.length > 2;              // botao de icone nao vira texto
  }

  function travar(alvo) {
    var btn = alvo.btn;
    if (alvo.travado) return;
    alvo.travado = true;
    btn.dataset.drgBusy = '1';
    btn.classList.add('drg-ocupado');
    if (podeTrocarTexto(btn)) {
      alvo.htmlOriginal = btn.innerHTML;
      alvo.larguraOriginal = btn.style.minWidth;
      btn.style.minWidth = btn.offsetWidth + 'px';   // nao deixa o botao "pular"
      btn.textContent = '⏳ Aguarde...';
      btn.dataset.drgTexto = '1';                    // o CSS esconde o girador
    }
  }

  function destravar(alvo) {
    var btn = alvo.btn;
    if (alvo.travado) {
      if (alvo.htmlOriginal != null) btn.innerHTML = alvo.htmlOriginal;
      btn.style.minWidth = alvo.larguraOriginal || '';
      btn.classList.remove('drg-ocupado');
      delete btn.dataset.drgTexto;
    }
    delete btn.dataset.drgBusy;
    if (armado === alvo) armado = null;
  }

  function armar(btn) {
    if (armado) destravar(armado);
    var alvo = { btn: btn, pendentes: 0, travado: false, htmlOriginal: null };
    armado = alvo;
    alvo.timer = setTimeout(function () {
      if (alvo.pendentes === 0) destravar(alvo);
    }, JANELA_SEM_REDE);
    return alvo;
  }

  function vincular(alvo, promessa) {
    if (!promessa || typeof promessa.then !== 'function') return;
    clearTimeout(alvo.timer);
    alvo.pendentes++;
    travar(alvo);
    var fim = function () {
      alvo.pendentes--;
      if (alvo.pendentes > 0) return;
      // A mesma acao costuma encadear outra chamada (salvar e recarregar):
      // so destrava no fim de tudo.
      clearTimeout(alvo.timer);
      alvo.timer = setTimeout(function () {
        if (alvo.pendentes === 0) destravar(alvo);
      }, FOLGA);
    };
    promessa.then(fim, fim);
  }

  // ---- 1. O clique ----------------------------------------------------
  // Fase de captura: roda ANTES do onclick, entao consegue engolir o clique
  // repetido enquanto a requisicao anterior esta no ar.
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('button, .button, [role="button"]');
    if (!btn || btn.dataset.noguard === '1') return;
    if (btn.dataset.drgBusy === '1') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    if (btn.disabled) return;
    armar(btn);
  }, true);

  // Enter dentro do formulario nao gera clique: arma pelo submit.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || !form.querySelector) return;
    var btn = form.querySelector('button[type="submit"], button:not([type])');
    if (!btn || btn.dataset.noguard === '1') return;
    if (btn.dataset.drgBusy === '1') { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    if (armado && armado.btn === btn) return;
    armar(btn);
  }, true);

  // ---- 2. A rede ------------------------------------------------------
  if (global.fetch) {
    var fetchOriginal = global.fetch;
    global.fetch = function () {
      var p = fetchOriginal.apply(this, arguments);
      if (armado) vincular(armado, p);
      return p;
    };
  }
  // Quem usa axios/jQuery ainda cai no XMLHttpRequest.
  if (global.XMLHttpRequest) {
    var enviarOriginal = global.XMLHttpRequest.prototype.send;
    global.XMLHttpRequest.prototype.send = function () {
      var alvo = armado;
      if (alvo) {
        var xhr = this;
        var p = new Promise(function (resolve) {
          xhr.addEventListener('loadend', function () { resolve(); }, { once: true });
        });
        vincular(alvo, p);
      }
      return enviarOriginal.apply(this, arguments);
    };
  }

  // ---- 3. Mensagem de resposta ---------------------------------------
  function drgMsg(el, tipo, texto) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.className = 'form-msg drg-msg--' + tipo;
    el.textContent = (tipo === 'ok' ? '✓ ' : '⚠ ') + texto;
    el.hidden = false;
  }
  function drgMsgLimpa(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    el.className = 'form-msg';
    el.textContent = '';
  }

  /* Ciclo completo para uso explicito, quando a tela precisa fazer algo depois
   * do sucesso (fechar, voltar ao login, navegar):
   *   drgSubmit(btn, async () => { ...; return 'deu certo'; },
   *             { msg: 'cadMsg', depois: voltarAoLogin, espera: 2500 })
   */
  async function drgSubmit(btn, acao, opts) {
    opts = opts || {};
    if (btn && btn.dataset.drgBusy === '1' && !opts.jaArmado) return;
    var alvo = (armado && armado.btn === btn) ? armado : (btn ? armar(btn) : null);
    if (alvo) { clearTimeout(alvo.timer); alvo.pendentes++; travar(alvo); }
    if (opts.msg) drgMsgLimpa(opts.msg);
    try {
      var retorno = await acao();
      if (opts.msg) drgMsg(opts.msg, 'ok', retorno || opts.sucesso || 'Pronto!');
      if (opts.depois) setTimeout(opts.depois, opts.espera == null ? 1800 : opts.espera);
      return retorno;
    } catch (e) {
      if (opts.msg) drgMsg(opts.msg, 'erro', (e && e.message) || 'Nao foi possivel concluir.');
      throw e;
    } finally {
      if (alvo) { alvo.pendentes--; if (alvo.pendentes <= 0) destravar(alvo); }
    }
  }

  global.drgSubmit = drgSubmit;
  global.drgMsg = drgMsg;
  global.drgMsgLimpa = drgMsgLimpa;
})(window);
