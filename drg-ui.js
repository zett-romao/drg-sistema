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
  var TETO_TRAVA = cfg.tetoTrava || 15000;          // ms: teto absoluto de trava (nunca travar pra sempre)

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
    // Se o proprio app JA trocou o texto depois do clique (tem ciclo proprio,
    // tipo setBtnLoading), quem manda no texto e ele: nao disputamos. Aqui
    // ficamos so com a barreira contra o clique repetido.
    var appJaCuida = btn.innerHTML !== alvo.htmlOriginal;
    if (podeTrocarTexto(btn) && !appJaCuida) {
      // 🔒 O HTML restaurado e o capturado NO CLIQUE (armar), nunca o de agora.
      // App que ja tem o proprio ciclo de botao (ex.: setBtnLoading do Kronos)
      // troca o innerHTML por "Salvando..." ANTES da rede disparar. Se a foto
      // fosse tirada aqui, ela pegaria justamente esse "Salvando..." e o
      // destravar devolveria ele — o botao ficava "Salvando..." PARA SEMPRE,
      // mesmo sem clique nenhum, porque o proprio app ja tinha restaurado o
      // texto certo antes. Foi o que aconteceu no Kronos (27/07/2026).
      alvo.larguraOriginal = btn.style.minWidth;
      alvo.textoTrocado = true;
      btn.style.minWidth = btn.offsetWidth + 'px';   // nao deixa o botao "pular"
      btn.textContent = '⏳ Aguarde...';
      btn.dataset.drgTexto = '1';                    // o CSS esconde o girador
    }
    // 🔒 TETO: botao NUNCA fica travado para sempre. O Firestore mantem canais
    // XHR de escuta (Listen) abertos por minutos — se um clique cair junto com
    // a abertura de um canal desses, o `loadend` so chega quando a escuta
    // termina, e ate la o botao ficaria mudo e travado. Passou do teto, solta.
    clearTimeout(alvo.teto);
    alvo.teto = setTimeout(function () { destravar(alvo); }, TETO_TRAVA);
  }

  function destravar(alvo) {
    var btn = alvo.btn;
    clearTimeout(alvo.teto);
    if (alvo.travado) {
      // Só devolve o HTML se fomos NÓS que trocamos. Em botao de icone o texto
      // nunca foi tocado — restaurar ali desfaria uma mudanca legitima do app.
      if (alvo.textoTrocado && alvo.htmlOriginal != null) btn.innerHTML = alvo.htmlOriginal;
      btn.style.minWidth = alvo.larguraOriginal || '';
      btn.classList.remove('drg-ocupado');
      delete btn.dataset.drgTexto;
    }
    alvo.travado = false;
    delete btn.dataset.drgBusy;
    if (armado === alvo) armado = null;
  }

  function armar(btn) {
    if (armado) destravar(armado);
    // Foto do botao no instante do clique — ANTES de qualquer handler do app
    // mexer no innerHTML (o listener de clique roda em fase de CAPTURA).
    var alvo = { btn: btn, pendentes: 0, travado: false, htmlOriginal: btn.innerHTML };
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

  // ---- 4. Pergunta de sim/nao — NUNCA o confirm() do navegador --------
  /* O confirm()/alert() nativo pode ser DESLIGADO pelo proprio navegador. Depois
   * de alguns dialogos seguidos, o Chrome/Edge mostra a caixinha "Impedir que
   * esta pagina crie caixas de dialogo adicionais"; marcada uma vez, confirm()
   * passa a devolver `false` NA HORA, sem perguntar nada. O codigo le isso como
   * "o usuario cancelou" e nao faz nada — clique mudo, o unico caminho do app
   * que escapa da regra nº 1, porque o silencio acontece ANTES da acao.
   *
   * Caso real (DRG-Hidro, 28/07/2026): o botao "A caixa esta cheia agora" nao
   * fazia NADA no navegador do dono, com backend, rota e conta intactos — o
   * clique morria no confirm(). Um modal do proprio app nao tem esse botao de
   * mudo: se o navegador engolir alguma coisa, quem some e a tela inteira.
   *
   * Portado do DRG-Hidro (v0.31.0). Aqui ele entra pelas acoes NOVAS; as
   * chamadas antigas de confirm() do app seguem como estavam.
   *
   *   if (!await drgConfirmar('Excluir isto?', { ok: 'Excluir', perigo: true })) return;
   */
  function drgConfirmar(texto, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'drg-conf-ov';
      var linhas = String(texto).split('\n').map(function (l) {
        var d = document.createElement('p');
        d.className = 'drg-conf-p';
        d.textContent = l;
        return d.outerHTML;
      }).join('');
      ov.innerHTML =
        '<div class="drg-conf" role="dialog" aria-modal="true">' +
          '<button type="button" class="drg-conf-x" data-noguard="1" data-r="0" aria-label="Fechar">✕</button>' +
          '<h3 class="drg-conf-h"></h3>' +
          '<div class="drg-conf-txt">' + linhas + '</div>' +
          '<div class="drg-conf-btns">' +
            '<button type="button" class="drg-conf-nao" data-noguard="1" data-r="0"></button>' +
            '<button type="button" class="drg-conf-sim' + (opts.perigo ? ' drg-conf-perigo' : '') + '" data-noguard="1" data-r="1"></button>' +
          '</div>' +
        '</div>';
      // Titulo e rotulos por textContent: titulo de registro traz nome digitado.
      ov.querySelector('.drg-conf-h').textContent = opts.titulo || 'Confirmar';
      ov.querySelector('.drg-conf-nao').textContent = opts.cancelar || 'Cancelar';
      ov.querySelector('.drg-conf-sim').textContent = opts.ok || 'Confirmar';

      var fechado = false;
      function fim(valor) {
        if (fechado) return;
        fechado = true;
        document.removeEventListener('keydown', tecla, true);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        resolve(valor);
      }
      function tecla(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); fim(false); }
        else if (ev.key === 'Enter') { ev.preventDefault(); fim(true); }
      }
      ov.addEventListener('click', function (ev) {
        if (ev.target === ov) return fim(false);              // clique fora
        var b = ev.target.closest && ev.target.closest('[data-r]');
        if (b) fim(b.dataset.r === '1');
      });
      document.addEventListener('keydown', tecla, true);
      document.body.appendChild(ov);
      var sim = ov.querySelector('.drg-conf-sim');
      if (sim) sim.focus();
    });
  }

  global.drgSubmit = drgSubmit;
  global.drgMsg = drgMsg;
  global.drgMsgLimpa = drgMsgLimpa;
  global.drgConfirmar = drgConfirmar;
})(window);
