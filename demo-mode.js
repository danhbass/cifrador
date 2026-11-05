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
