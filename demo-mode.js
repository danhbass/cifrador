/* Modo demonstração: usa a mesma interface, mas somente armazenamento temporário. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('demo') !== '1') return;

  window.CIFRADOR_DEMO = true;
  document.documentElement.classList.add('cifrador-demo');

  // Cada entrada/recarregamento começa do zero. Nenhum dado da Demo vai ao localStorage.
  const prefix = 'cifrador-demo:';
  const store = {
    getItem(k) { return sessionStorage.getItem(prefix + k); },
    setItem(k, v) { sessionStorage.setItem(prefix + k, String(v)); },
    removeItem(k) { sessionStorage.removeItem(prefix + k); },
    clear() {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) sessionStorage.removeItem(k);
      }
    },
    key(i) {
      const keys = [];
      for (let n = 0; n < sessionStorage.length; n++) {
        const k = sessionStorage.key(n);
        if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length));
      }
      return keys[i] ?? null;
    },
    get length() {
      let n = 0;
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) n++;
      }
      return n;
    }
  };

  // Apaga qualquer sessão de demonstração anterior, inclusive ao pressionar F5.
  store.clear();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  window.CIFRADORStorage = store;

  // Itens que não fazem parte da experiência de demonstração.
  const hideDemoControls = () => {
    const style = document.createElement('style');
    style.id = 'cifrador-demo-restrictions';
    style.textContent = `
      .cifrador-demo #btnAdd,
      .cifrador-demo #btnAddTop,
      .cifrador-demo #btnData,
      .cifrador-demo #dDataSec,
      .cifrador-demo #dHelp,
      .cifrador-demo #dImportSongs,
      .cifrador-demo #dMenuAddSong { display:none !important; }
    `;
    document.head.appendChild(style);
  };
  hideDemoControls();

  // Barra exclusiva da demonstração: não existe na aplicação definitiva.
  const addDemoTopbar = () => {
    if (document.getElementById('cifrador-demo-topbar')) return;
    const style = document.createElement('style');
    style.id = 'cifrador-demo-topbar-style';
    style.textContent = `
      #cifrador-demo-topbar{position:sticky;top:0;z-index:70;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px max(14px,env(safe-area-inset-right)) 10px max(14px,env(safe-area-inset-left));background:#111827;color:#f8fafc;border-bottom:1px solid #374151;box-shadow:0 3px 12px #0002}
      #cifrador-demo-topbar a,#cifrador-demo-topbar button{min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 13px;border:1px solid #64748b;border-radius:10px;color:#f8fafc;background:#1f2937;font:600 14px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;text-decoration:none;cursor:pointer}
      #cifrador-demo-topbar button{background:#4338ca;border-color:#6366f1}
      #cifrador-demo-topbar a:focus-visible,#cifrador-demo-topbar button:focus-visible{outline:3px solid #a5b4fc;outline-offset:2px}
      #cifrador-demo-install-dialog{position:fixed;inset:0;z-index:100;display:none;place-items:center;padding:18px;background:#0009;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
      #cifrador-demo-install-dialog.open{display:grid}
      #cifrador-demo-install-dialog .demo-install-card{width:min(460px,100%);max-height:85vh;overflow:auto;padding:22px;border-radius:18px;background:#fff;color:#111827;box-shadow:0 20px 60px #0005}
      #cifrador-demo-install-dialog h2{margin:0 0 12px;font-size:20px}
      #cifrador-demo-install-dialog p,#cifrador-demo-install-dialog li{margin:8px 0}
      #cifrador-demo-install-dialog button{min-height:42px;padding:8px 14px;border:0;border-radius:10px;background:#4338ca;color:#fff;font-weight:700;cursor:pointer}
      @media(max-width:520px){#cifrador-demo-topbar{align-items:stretch}#cifrador-demo-topbar a,#cifrador-demo-topbar button{flex:1 1 100%;font-size:13px}}
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'cifrador-demo-topbar';
    bar.setAttribute('aria-label', 'Atalhos da demonstração');
    const home = document.createElement('a');
    home.href = new URL('../', location.href).href;
    home.textContent = '← Voltar para tela de apresentação';
    const install = document.createElement('button');
    install.type = 'button';
    install.id = 'cifrador-demo-install-button';
    install.textContent = '↓ Instalar Cifrador no celular';
    bar.append(home, install);
    document.body.prepend(bar);

    const dialog = document.createElement('div');
    dialog.id = 'cifrador-demo-install-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cifrador-demo-install-title');
    dialog.innerHTML = '<div class="demo-install-card"><h2 id="cifrador-demo-install-title">Instalar o Cifrador</h2><div id="cifrador-demo-install-instructions"></div><p style="text-align:right;margin-top:18px"><button type="button" id="cifrador-demo-install-close">Entendi</button></p></div>';
    document.body.appendChild(dialog);
    const instructions = dialog.querySelector('#cifrador-demo-install-instructions');
    const closeDialog = () => dialog.classList.remove('open');
    dialog.querySelector('#cifrador-demo-install-close').addEventListener('click', closeDialog);
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); });

    let installPrompt = null;
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      installPrompt = event;
    });
    install.addEventListener('click', async () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      if (standalone) {
        instructions.textContent = 'O Cifrador já está instalado neste dispositivo.';
      } else if (installPrompt) {
        const promptEvent = installPrompt;
        installPrompt = null;
        await promptEvent.prompt();
        await promptEvent.userChoice;
        return;
      } else if (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        instructions.innerHTML = '<p>Para instalar no iPhone ou iPad:</p><ol><li>Abra esta página no Safari.</li><li>Toque em <b>Compartilhar</b>.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Confirme em <b>Adicionar</b>.</li></ol>';
      } else {
        instructions.innerHTML = '<p>Para instalar o Cifrador:</p><ol><li>Abra o menu do navegador (⋮ ou ⋯).</li><li>Procure <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</li><li>Confirme a instalação, se a opção estiver disponível.</li></ol><p>Se a opção não aparecer, verifique se está usando um navegador compatível e se a página foi aberta por HTTPS.</p>';
      }
      dialog.classList.add('open');
      dialog.querySelector('#cifrador-demo-install-close').focus();
    });
  };
  addDemoTopbar();

  // Proteção adicional: mesmo acionados por código, os atalhos bloqueados não abrem telas.
  const blocked = '#btnAdd, #btnAddTop, #btnData, #dDataSec, #dHelp, #dImportSongs, #dMenuAddSong';
  document.addEventListener('click', event => {
    if (event.target.closest && event.target.closest(blocked)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.prepareCifradorDemo = async () => {
    const response = await fetch('demo-data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Não foi possível carregar os dados de demonstração.');
    const data = await response.json();
    const tags = [...new Set(data.songs.flatMap(s => s.tags || []))];
    const tagIds = Object.fromEntries(tags.map((name, i) => [name, 'demo-tag-' + i]));
    const mine = data.songs.map(s => ({
      id: 'demo-' + s.id, title: s.name, content: s.lyrics, chordLines: []
    }));
    const st = {};
    data.songs.forEach(s => { st['demo-' + s.id] = (s.tags || []).map(t => tagIds[t]); });
    const user = {
      v: 2,
      lists: [{
        id: 'demo-repertorio',
        name: 'Repertório de demonstração',
        sort: 'custom',
        order: data.initialRepertoire.map(id => 'demo-' + id),
        items: data.initialRepertoire.map(id => 'demo-' + id)
      }],
      mine, hidden: [], edits: {}, tr: {},
      tags: tags.map(name => ({ id: tagIds[name], name })),
      st, rs: {}, lk: {}
    };
    store.setItem('cantos_user_v2', JSON.stringify(user));
    store.setItem('cifrador-demo-initialized', '1');
  };

  // Ao sair e voltar pelo histórico (bfcache), reinicia a demonstração.
  window.addEventListener('pagehide', () => store.clear());
  window.addEventListener('pageshow', event => {
    if (event.persisted) location.reload();
  });
})();
