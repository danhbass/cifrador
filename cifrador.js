
/* ============ Utilidades ============ */
const localStorage = window.CIFRADORStorage || window.localStorage;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const st = { cur: null, tr: 0, size: 18, chords: true, twoColumns: false, scrollTimer: null, scrollSpeed: 1, list: 'all', q: '', edit: null, wake: null, inv: false, img: null, chordLines: [], nav: [], navName: '' };
let toastT, importCancelled = false, importUi = null;
function impStart(files) { // painel com a quantidade de arquivos e o andamento de cada um (sem termos técnicos)
  hideImportProgress();
  const n = files.length; importUi = document.createElement('div'); importUi.id = 'importProgress'; importUi.setAttribute('role', 'status'); importUi.setAttribute('aria-live', 'polite');
  importUi.innerHTML = '<div class="ip-head"><b>' + (n === 1 ? 'Importando 1 arquivo' : 'Importando ' + n + ' arquivos') + '</b><span data-ip-count></span></div><div class="ip-all"><i data-ip-all></i></div>' +
    '<ul class="ip-list">' + files.map(f => '<li class="ip-row" data-st="wait"><span class="ip-ic" aria-hidden="true"></span><span class="ip-name">' + esc(f.name) + '</span><span class="ip-st">Aguardando</span><div class="ip-bar"><i></i></div></li>').join('') + '</ul>' +
    '<button type="button" class="ip-cancel" data-import-cancel>Cancelar importação</button>';
  document.body.appendChild(importUi);
  importUi.querySelector('[data-import-cancel]').onclick = () => { importCancelled = true; abortOcrForImport(); hideImportProgress(); toast('Importação cancelada. Os arquivos já processados foram mantidos.'); };
  impSet(0, 'wait');
}
function impSet(i, state, pct) { // state: wait | run | done | error; pct: 0–100 (sem pct = andamento sem porcentagem)
  if (!importUi) return; const rows = importUi.querySelectorAll('.ip-row'), r = rows[i]; if (!r) return;
  r.dataset.st = state; r.classList.toggle('ip-ind', state === 'run' && pct == null);
  const t = r.querySelector('.ip-st'), bar = r.querySelector('.ip-bar i');
  if (state === 'run') { t.textContent = pct == null ? 'Lendo…' : Math.round(pct) + '%'; bar.style.width = pct == null ? '' : Math.max(3, Math.min(100, pct)) + '%'; r.scrollIntoView({ block: 'nearest' }); }
  else { t.textContent = state === 'done' ? 'Pronto' : state === 'error' ? 'Não foi possível ler' : 'Aguardando'; bar.style.width = state === 'done' ? '100%' : '0'; }
  const fin = [...rows].filter(x => x.dataset.st === 'done' || x.dataset.st === 'error').length;
  importUi.querySelector('[data-ip-count]').textContent = fin + ' de ' + rows.length + (rows.length === 1 ? '' : ' prontos');
  importUi.querySelector('[data-ip-all]').style.width = Math.round(fin / rows.length * 100) + '%';
}
function hideImportProgress() { if (importUi) importUi.remove(); importUi = null; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 4000);
}
function showImportErrors(msg) { const box = $('#importError'); if (!box) { toast(msg); return; } $('#importErrorText').textContent = msg; box.classList.remove('hidden'); }
$('#importErrorClose')?.addEventListener('click', () => $('#importError').classList.add('hidden'));
$('#importErrorOk')?.addEventListener('click', () => $('#importError').classList.add('hidden'));
function ask(msg, yes = 'OK', no = 'Cancelar', inp) { // com "inp" vira um campo de texto e devolve o texto (ou null)
  return new Promise(res => {
    const i = $('#dlgIn'), withInput = inp !== undefined;
    $('#dlgMsg').textContent = msg; $('#dlgYes').textContent = yes; $('#dlgNo').textContent = no;
    i.classList.toggle('hidden', !withInput); i.value = inp || '';
    $('#dlg').classList.remove('hidden');
    const done = v => { $('#dlg').classList.add('hidden'); $('#dlgYes').onclick = $('#dlgNo').onclick = i.onkeydown = null; res(v); };
    $('#dlgYes').onclick = () => done(withInput ? i.value.trim() : true);
    $('#dlgNo').onclick = () => done(withInput ? null : false);
    i.onkeydown = e => { if (e.key === 'Enter') $('#dlgYes').click(); };
    if (withInput) setTimeout(() => i.focus(), 50);
  });
}
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ============ Dados: catálogo (fixo, do site) + dados da pessoa (neste aparelho) ============
   Catálogo  = catalogo.json: { next, songs:[{id,title,content}] }. IDs nunca mudam nem são reaproveitados.
   Pessoa    = localStorage "cantos_user_v2":
     lists  [{id,name,sort,items:[ids]}]  -> listas guardam só IDs (a ordem do array é a "ordem de inclusão")
     mine   [{id,title,content,img}]       -> cifras criadas/importadas pela pessoa (id "u-...")
     hidden [ids]                          -> cifras do catálogo que a pessoa excluiu
     edits  {id:{title,content,b}}         -> correções da pessoa em cifras do catálogo (b = hash do original)
     tr     {id:semitons}                  -> tom salvo por cifra                                            */
const UKEY = 'cantos_user_v2', OLD_DB = 'cantos_db_v1', OLD_LISTS = 'cantos_lists_v1', TKEY = 'cantos_theme';
let CAT = [], catById = new Map(), catNext = 1, catOk = false;
let U, songs = [], byId = new Map(), persistAsked = false, migInfo = null;
const emptyUser = () => ({ v: 2, lists: [], mine: [], hidden: [], edits: {}, tr: {}, tags: [], st: {}, rs: {}, lk: {} });
/* ============ Links para ouvir (Spotify, YouTube…) ============
   Logotipos: Simple Icons (CC0). As marcas pertencem aos respectivos proprietários. */
const LINKMAX = 3, LINKLEN = 500;
const PLAT = {"spotify":{"n":"Spotify","c":"#1ED760","d":"M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"},"youtube":{"n":"YouTube","c":"#FF0000","d":"M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"},"youtubemusic":{"n":"YouTube Music","c":"#FF0000","d":"M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L15.816 12l-6.132 3.54z"},"deezer":{"n":"Deezer","c":"#A238FF","d":"M.693 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807C.312 4.41 0 5.666 0 7.217s.312 2.808.693 2.808ZM21.038 1.56c-.364 0-.684.805-.91 2.096C19.765 1.446 19.184 0 18.526 0c-.78 0-1.464 2.036-1.784 5-.312-2.158-.788-3.536-1.325-3.536-.745 0-1.386 2.704-1.62 6.472-.442-1.932-1.083-3.145-1.793-3.145s-1.35 1.213-1.793 3.145c-.242-3.76-.874-6.463-1.628-6.463-.537 0-1.013 1.378-1.325 3.535C6.938 2.036 6.262 0 5.474 0c-.658 0-1.247 1.447-1.602 3.665-.217-1.291-.546-2.105-.91-2.105-.675 0-1.221 2.807-1.221 6.272 0 3.466.546 6.273 1.221 6.273.277 0 .537-.476.736-1.273.32 2.928.996 4.938 1.776 4.938.606 0 1.143-1.204 1.507-3.11.251 3.622.875 6.195 1.602 6.195.46 0 .875-1.023 1.187-2.677C10.142 21.6 11 24 12.004 24c1.005 0 1.863-2.4 2.235-5.822.312 1.654.727 2.677 1.186 2.677.728 0 1.352-2.573 1.603-6.195.364 1.906.9 3.11 1.507 3.11.78 0 1.455-2.01 1.775-4.938.208.797.46 1.273.737 1.273.675 0 1.22-2.807 1.22-6.273-.008-3.457-.553-6.272-1.23-6.272ZM23.307 10.024c.381 0 .693-1.256.693-2.807 0-1.55-.312-2.807-.693-2.807-.381 0-.693 1.256-.693 2.807s.312 2.808.693 2.808Z"},"applemusic":{"n":"Apple Music","c":"#FA243C","d":"M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"},"soundcloud":{"n":"SoundCloud","c":"#FF5500","d":"M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"},"tidal":{"n":"Tidal","c":"#000000","d":"M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l4.004-4.004L12.012 12l-4.004 4.004 4.004 4.004 4.004-4.004L12.012 12l4.004-4.004-4.004-4.004zM16.042 7.996l3.979-3.979L24 7.996l-3.979 3.979z"}};
const PLAT_HOSTS = [
  ['youtubemusic', h => h === 'music.youtube.com'],
  ['youtube', h => h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com')],
  ['spotify', h => h === 'spotify.com' || h.endsWith('.spotify.com') || h === 'spotify.link'],
  ['deezer', h => h === 'deezer.com' || h.endsWith('.deezer.com') || h === 'deezer.page.link' || h === 'dzr.page.link'],
  ['applemusic', h => h === 'music.apple.com' || h === 'itunes.apple.com'],
  ['soundcloud', h => h === 'soundcloud.com' || h.endsWith('.soundcloud.com')],
  ['tidal', h => h === 'tidal.com' || h.endsWith('.tidal.com')]
];
function normLink(raw) { // devolve o link https limpo, '' se vazio, ou null se for inválido
  let s = String(raw == null ? '' : raw).trim(); if (!s) return '';
  if (s.length > LINKLEN) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, ''); // colou "open.spotify.com/…" sem o https
  let u; try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  return u.href.length <= LINKLEN ? u.href : null;
}
function platOf(url) {
  let h = ''; try { h = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) {}
  const k = (PLAT_HOSTS.find(([, f]) => f(h)) || [])[0];
  return k ? { k, ...PLAT[k] } : { k: 'link', n: h || 'Link', c: '#475569', d: '' };
}
const LINK_GLYPH = '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M13.5 10.5a3 3 0 0 0-4.2 0L7 12.8a3 3 0 0 0 4.2 4.2l.8-.8"/></g>';
const platIcon = (p, size = 24) => '<svg class="pi" data-k="' + p.k + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (p.d ? '<path fill="' + p.c + '" d="' + p.d + '"/>' : '<g style="color:' + p.c + '">' + LINK_GLYPH + '</g>') + '</svg>';
const linkLabel = p => p.k === 'link' ? 'Abrir link (' + p.n + ')' : 'Ouvir no ' + p.n;
const linksOf = id => (U.lk && Array.isArray(U.lk[id]) ? U.lk[id] : []);
const linkAnchors = (id, size) => linksOf(id).map(u => { const p = platOf(u), t = linkLabel(p); return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + platIcon(p, size) + '</a>'; }).join('');
const cleanLinks = a => [...new Set((Array.isArray(a) ? a : []).map(x => (typeof x === 'string' ? normLink(x) : null)).filter(Boolean))].slice(0, LINKMAX);
function setLinks(id, a) { const l = cleanLinks(a); if (l.length) U.lk[id] = l; else delete U.lk[id]; }

const SAFE_ID = /^[A-Za-z0-9_.-]{1,64}$/, BAD_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const okId = x => typeof x === 'string' && SAFE_ID.test(x) && !BAD_KEY.has(x);
const LIM = { imp: 8000, songs: 20000, content: 300000, title: 200, lists: 300, items: 8000, tags: 200, img: 2000000 };
function cleanUser(r) { // valida TUDO o que vem do armazenamento ou de um arquivo importado (tipos, tamanhos, identificadores, chaves perigosas)
  const u = emptyUser(), rep = { dropped: 0 }; cleanUser.rep = rep;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return u;
  const arr = a => (Array.isArray(a) ? a : []), ent = o => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o) : []);
  const bad = () => { rep.dropped++; return false; }, str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
  const ids = a => arr(a).slice(0, LIM.items).filter(x => okId(x) || bad());
  const marks = (a, n) => [...new Set(arr(a).filter(x => Number.isInteger(x) && x >= -n && x < n))].slice(0, 5000); // negativo = linha marcada como letra
  const nl = s => s.split('\n').length, seenL = new Set(), seenM = new Set(), tagIds = new Set();
  for (const l of arr(r.lists).slice(0, LIM.lists)) {
    if (!l || typeof l !== 'object' || !okId(l.id) || typeof l.name !== 'string' || seenL.has(l.id)) { bad(); continue; } seenL.add(l.id);
    u.lists.push({ id: l.id, name: l.name.slice(0, 40), sort: ['added', 'custom'].includes(l.sort) ? l.sort : 'name', order: ids(l.order), items: [...new Set(ids(l.items))], recv: !!l.recv });
  }
  for (const m of arr(r.mine).slice(0, LIM.songs)) {
    if (!m || typeof m !== 'object' || !okId(m.id) || typeof m.title !== 'string' || seenM.has(m.id)) { bad(); continue; } seenM.add(m.id);
    const content = str(m.content, LIM.content), img = typeof m.img === 'string' && m.img.length <= LIM.img && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(m.img) ? m.img : undefined;
    u.mine.push({ id: m.id, title: str(m.title, LIM.title), content, img, chordLines: marks(m.chordLines, nl(content)) });
  }
  u.hidden = [...new Set(ids(r.hidden))];
  for (const [k, v] of ent(r.rs).slice(0, LIM.songs)) {
    if (!okId(k) || !v || typeof v !== 'object' || typeof v.title !== 'string' || typeof v.content !== 'string') { bad(); continue; }
    const content = str(v.content, LIM.content);
    u.rs[k] = { title: str(v.title, LIM.title), content, chordLines: marks(v.chordLines, nl(content)), rtags: arr(v.rtags).filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 20)) };
  }
  for (const t of arr(r.tags).slice(0, LIM.tags)) {
    if (!t || typeof t !== 'object' || !okId(t.id) || typeof t.name !== 'string' || !t.name.trim() || tagIds.has(t.id)) { bad(); continue; } tagIds.add(t.id); u.tags.push({ id: t.id, name: t.name.slice(0, 20) });
  }
  for (const [k, v] of ent(r.st).slice(0, LIM.songs)) { if (!okId(k) || !Array.isArray(v)) { bad(); continue; } const a = [...new Set(v.filter(x => typeof x === 'string' && tagIds.has(x)))].slice(0, 50); if (a.length) u.st[k] = a; }
  for (const [k, e] of ent(r.edits).slice(0, LIM.songs)) {
    if (!okId(k) || !e || typeof e !== 'object') { bad(); continue; }
    const content = typeof e.content === 'string' ? e.content.slice(0, LIM.content) : undefined;
    u.edits[k] = { title: typeof e.title === 'string' ? e.title.slice(0, LIM.title) : undefined, content, chordLines: Array.isArray(e.chordLines) ? marks(e.chordLines, content == null ? 20000 : nl(content)) : undefined, b: String(e.b || '').slice(0, 64) };
  }
  for (const [k, v] of ent(r.tr)) if (okId(k) && Number.isInteger(v) && v && v >= -24 && v <= 24) u.tr[k] = v;
  for (const [k, v] of ent(r.lk).slice(0, LIM.songs)) { if (!okId(k) || !Array.isArray(v)) { bad(); continue; } const a = cleanLinks(v); if (a.length) u.lk[k] = a; }
  return u;
}
function save() {
  try {
    localStorage.setItem(UKEY, JSON.stringify(U));
    if (!persistAsked) { persistAsked = true; try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {} }
    return true;
  } catch (e) { toast('Não foi possível salvar: armazenamento cheio ou bloqueado.'); return false; }
}
function rebuild() { // junta catálogo (menos as excluídas, com as edições) e as cifras da pessoa
  const hid = new Set(U.hidden); songs = [];
  for (const c of CAT) {
    if (hid.has(c.id)) continue;
    const e = U.edits[c.id];
    songs.push({ id: c.id, cat: true, title: (e && e.title) || c.title, content: e && e.content != null ? e.content : c.content, chordLines: e && Array.isArray(e.chordLines) ? e.chordLines : [], edited: !!e, stale: !!e && e.b !== hash(c.content) });
  }
  for (const m of U.mine) songs.push({ id: m.id, cat: false, title: m.title, content: m.content, img: m.img, chordLines: Array.isArray(m.chordLines) ? m.chordLines : [] });
  for (const s of songs) { s.nt = norm(s.title); s.nc = norm(s.content.split('\n').filter(l => !isChordLine(l)).join('\n')); s.ng = norm(tagsOf(s.id).map(t => t.name).join(' ')); }
  byId = new Map(songs.map(s => [s.id, s]));
  for (const [id, r] of Object.entries(U.rs)) byId.set(id, { id, cat: false, ro: true, title: r.title, content: r.content, chordLines: r.chordLines, rtags: r.rtags, nt: norm(r.title), nc: norm(r.content), ng: norm(r.rtags.join(' ')) });
}
function refresh() { rebuild(); if (st.cur) st.cur = byId.get(st.cur.id) || null; }
const tagById = id => U.tags.find(t => t.id === id);
const tagsOf = id => (byId.get(id) && byId.get(id).ro) ? (byId.get(id).rtags || []).map(n => ({ id: n, name: n })) : (U.st[id] || []).map(tagById).filter(Boolean);
const tagChips = id => { const t = tagsOf(id); return t.slice(0, 2).map(x => '<span class="tg"' + (tagById(x.id) ? ' data-tg="' + esc(x.id) + '"' : '') + '>' + esc(x.name) + '</span>').join('') + (t.length > 2 ? '<span class="tg">+' + (t.length - 2) + '</span>' : ''); };
const listById = id => U.lists.find(l => l.id === id);
const inLists = id => U.lists.some(l => l.items.includes(id));
function addToList(sid, lid) { const l = listById(lid); if (l && !l.items.includes(sid)) l.items.push(sid); }
function removeFromList(sid, lid) { const l = listById(lid); if (l) l.items = l.items.filter(x => x !== sid); }

function loadUser() {
  let raw = null, txt = null; try { txt = localStorage.getItem(UKEY); raw = JSON.parse(txt || 'null'); } catch (e) { raw = null; }
  const quarentena = msg => { try { localStorage.setItem('cantos_quarentena', txt); } catch (e) {} setTimeout(() => toast(msg), 1500); }; // nunca descarta dados em silêncio
  if (txt && !raw) quarentena('Os dados salvos estavam ilegíveis. Uma cópia foi guardada antes de recomeçar.');
  if (raw && raw.v === 2) { U = cleanUser(raw); if (cleanUser.rep.dropped) quarentena(cleanUser.rep.dropped + ' item(ns) inválido(s) foram ignorados. A cópia original foi guardada.'); }
  else { U = emptyUser(); if (catOk) { try { if (migrateV1()) save(); } catch (e) { console.error(e); } } }
  if (catOk && reconcile()) save();
}
// Versão antiga (cantos_db_v1): cada cifra casa com o catálogo pelo título/conteúdo; o resto vira "minha". Nada se perde.
function migrateV1() {
  let old = [], ol = [];
  try { old = JSON.parse(localStorage.getItem(OLD_DB) || '[]'); ol = JSON.parse(localStorage.getItem(OLD_LISTS) || '[]'); } catch (e) {}
  if (!Array.isArray(old) || !old.length || !CAT.length) return false;
  const exact = new Map(CAT.map(c => [norm(c.title) + '\u0000' + c.content, c.id]));
  const byT = new Map(); for (const c of CAT) { const k = norm(c.title); byT.set(k, byT.has(k) ? null : c.id); }
  const used = new Set(), map = new Map(); let kept = 0, edited = 0;
  for (const s of old) {
    if (!s || typeof s.title !== 'string') continue;
    const content = typeof s.content === 'string' ? s.content : '';
    let id = exact.get(norm(s.title) + '\u0000' + content);
    if (id && used.has(id)) id = null;
    if (!id) { const t = byT.get(norm(s.title)); if (t && !used.has(t) && content.trim()) { id = t; U.edits[id] = { content, b: hash(catById.get(id).content) }; edited++; } }
    if (!id) { id = 'u-' + uid(); U.mine.push({ id, title: s.title, content, img: typeof s.img === 'string' && s.img.startsWith('data:image/') ? s.img : undefined }); kept++; }
    else used.add(id);
    map.set(s.id, id);
    if (Number.isInteger(s.tr) && s.tr) U.tr[id] = s.tr;
  }
  U.hidden = CAT.filter(c => !used.has(c.id)).map(c => c.id);
  const meta = new Map((Array.isArray(ol) ? ol : []).filter(l => l && /^[\w-]{1,40}$/.test(l.id) && typeof l.name === 'string').map(l => [l.id, l]));
  const per = new Map();
  old.forEach((s, i) => {
    if (!s || !map.has(s.id)) return;
    const ls = new Set(Array.isArray(s.ls) ? s.ls : []); if (s.fav) ls.add('fav');
    for (const lid of ls) {
      if (typeof lid !== 'string') continue;
      if (!per.has(lid)) per.set(lid, []);
      per.get(lid).push({ id: map.get(s.id), t: (s.lt && s.lt[lid]) || 0, i });
    }
  });
  for (const [lid, m] of meta) if (!listById(lid)) U.lists.push({ id: lid, name: m.name.slice(0, 40), sort: 'name', items: [] });
  for (const [lid, m] of meta) { const L = listById(lid); if (lid !== 'fav') L.name = m.name.slice(0, 40); L.sort = m.sort === 'added' ? 'added' : 'name'; }
  for (const [lid, arr] of per) { const L = listById(lid); if (L) L.items = [...new Set(arr.sort((a, b) => a.t - b.t || a.i - b.i).map(x => x.id))]; }
  migInfo = { kept, edited };
  return true;
}
// Arruma o que mudou no catálogo: cifra da pessoa que passou a existir no catálogo, edições já publicadas, IDs removidos.
function reconcile() {
  let ch = false; const key = (t, c) => norm(t) + '\u0000' + c;
  const exact = new Map(CAT.map(c => [key(c.title, c.content), c.id]));
  U.mine = U.mine.filter(m => {
    const cid = !m.img && exact.get(key(m.title, m.content)); if (!cid) return true;
    U.lists.forEach(l => { if (l.items.includes(m.id)) { l.items = [...new Set(l.items.map(x => (x === m.id ? cid : x)))]; } });
    if (U.tr[m.id] && !U.tr[cid]) U.tr[cid] = U.tr[m.id]; delete U.tr[m.id]; if (U.lk[m.id] && !U.lk[cid]) U.lk[cid] = U.lk[m.id]; delete U.lk[m.id]; ch = true; return false;
  });
  for (const [id, e] of Object.entries(U.edits)) {
    const c = catById.get(id);
    if (!c || ((e.title == null || e.title === c.title) && (e.content == null || e.content === c.content))) { delete U.edits[id]; ch = true; }
  }
  const h2 = U.hidden.filter(id => catById.has(id)); if (h2.length !== U.hidden.length) { U.hidden = h2; ch = true; }
  return ch;
}
async function loadCatalog() {
  try {
    const r = await fetch('catalogo.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json(); CAT = Array.isArray(d.songs) ? d.songs.filter(c => c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.content === 'string') : [];
    catById = new Map(CAT.map(c => [c.id, c]));
    catNext = Number.isInteger(d.next) ? d.next : 1 + Math.max(0, ...CAT.map(c => parseInt(c.id.slice(1), 10) || 0));
    catOk = true;
  } catch (e) { catOk = false; }
}

/* ============ Acordes e transposição ============ */
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const NOTE_IDX = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,'E#':5,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};
const CHORD_RE_RAW = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|alt|m|M|°|º|ø|\+|-|\d{1,2}(?:\/\d{1,2})*|[#b]\d{1,2}|\([^()\s]*\))*(?:\/[A-G][#b]?)?$/;
const CHORD_RE = { test: s => typeof s === 'string' && s.length <= 16 && CHORD_RE_RAW.test(s) }; // limite de tamanho evita travamento (backtracking exponencial) com textos maliciosos
const IGN = /^(N\.?C\.?|\|{1,2}|\|:|:\||\/|-|–|—|%|\.{2,}|:|\(?x?\d+x?\)?|\(|\))$/i;

function chordTok(t) {
  if (CHORD_RE.test(t)) return { pre: '', core: t, post: '' };
  const m = t.match(/^([(|{\[]*)(.+?)([)|}\]]*)$/);
  if (m && CHORD_RE.test(m[2])) return { pre: m[1] || '', core: m[2], post: m[3] || '' };
  return null;
}
const LBL = /^(intr[oe]?r?o?|introdu[cç][aã]o|inter|interl[uú]dio|iter|solo|ponte|refr[aã]o|verso|final|fine|termina|ataque|riff|frase|break|coda|base|outro|bis)\.?$/i;
const IGN_X = /^(::|\|+|\d+ª?|vez(es)?|pausa|bis|\.{2,3})$/i;
function isChordLine(line) {
  const masked = line.replace(/\[([^\]\n]*)\]/g, (m, c) => CHORD_RE.test(c) ? m : ' ')
    .replace(/\([^()\n]*\)/g, m => { const i = m.slice(1, -1).trim().split(/\s+/); return i.every(x => chordTok(x) || IGN.test(x) || IGN_X.test(x)) ? ' ' + i.join(' ') + ' ' : ' '; });
  let t = masked.replace(/[:;{}\]\\]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return false;
  if (LBL.test(t[0])) { let k = 1; while (k < t.length && !chordTok(t[k])) k++; t = t.slice(k); }
  let n = 0;
  for (const x of t) { if (chordTok(x)) n++; else if (!(IGN.test(x) || IGN_X.test(x) || LBL.test(x))) return false; }
  return n > 0;
}
function tChord(c, n, flat) {
  const m = c.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  const N = flat ? FLAT : SHARP;
  const sh = r => N[(NOTE_IDX[r] + (n % 12) + 12) % 12];
  return sh(m[1]) + m[2] + (m[3] ? '/' + sh(m[3]) : '');
}
function transposeLine(line, n, flat) {
  return line.replace(/(\S+)(\s*)/g, (m, t, sp) => {
    const k = chordTok(t);
    if (!k) return m;
    const nc = tChord(k.core, n, flat);
    const d = nc.length - k.core.length;
    return k.pre + nc + k.post + (sp ? ' '.repeat(Math.max(1, sp.length - d)) : '');
  });
}
function findKey(text, chordLines = []) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) { const l = lines[i];
    if (isChordLine(l) || chordLines.includes(i)) for (const t of l.trim().split(/\s+/)) { const k = chordTok(t); if (k) return k.core; }
  }
  const re = /\[([^\]\n]+)\]/g; let m;
  while ((m = re.exec(text))) if (CHORD_RE.test(m[1])) return m[1];
  return null;
}
function useFlat(key, n) {
  if (!key) return false;
  const m = key.match(/^([A-G][#b]?)(m(?!aj)|min)?/);
  const i = (NOTE_IDX[m[1]] + (n % 12) + 12) % 12;
  return (m[2] ? [2,7,0,5,10,3] : [5,10,3,8,1,6]).includes(i);
}
function fitCols() {
  const el = $('#song'), cs = getComputedStyle(el), pr = document.createElement('span');
  pr.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; pr.textContent = 'M'.repeat(40);
  el.appendChild(pr); const cw = pr.getBoundingClientRect().width / 40; pr.remove();
  let w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (st.twoColumns) w = (w - 32) / 2;
  return cw > 0 && w > 0 ? Math.max(12, Math.floor(w / cw) - 1) : 60;
}
function parseFmt(line) { // tira os marcadores e devolve o texto limpo + estilo de cada caractere
  if (!/\*\*|__|==/.test(line)) return { t: line, f: null };
  const M = ['**', '__', '=='], cnt = m => line.split(m).length - 1, on = {}, st = {};
  M.forEach(m => { on[m] = cnt(m) > 0 && cnt(m) % 2 === 0; st[m] = 0; });
  let t = '', f = [];
  for (let i = 0; i < line.length;) { const m = M.find(x => on[x] && line.startsWith(x, i)); if (m) { st[m] ^= 1; i += 2; continue; } t += line[i]; f.push((st['**'] ? 1 : 0) | (st['__'] ? 2 : 0) | (st['=='] ? 4 : 0)); i++; }
  return { t, f };
}
function fmtHtml(t, f, a = 0, b = t.length) {
  if (!f) return esc(t.slice(a, b)); let out = '', i = a;
  while (i < b) { let j = i; const s = f[i]; while (j < b && f[j] === s) j++; let x = esc(t.slice(i, j)); if (s & 1) x = '<b>' + x + '</b>'; if (s & 2) x = '<i>' + x + '</i>'; if (s & 4) x = '<mark class="hl">' + x + '</mark>'; out += x; i = j; }
  return out;
}
function wrapText(s, W) { // devolve [{t, o}] (o = posição no texto original, para manter a formatação)
  const o = []; let off = 0; s = s.replace(/\s+$/, '');
  while (s.length > W) { let sp = s.lastIndexOf(' ', W); if (sp <= 0) sp = W; o.push({ t: s.slice(0, sp).replace(/\s+$/, ''), o: off }); const rest = s.slice(sp), lead = rest.length - rest.replace(/^\s+/, '').length; off += sp + lead; s = rest.slice(lead); }
  o.push({ t: s, o: off }); return o;
}
function wrapPair(ch, ly, W) { // quebra a letra e leva cada acorde junto do trecho onde ele está
  ch = ch.replace(/\s+$/, ''); ly = ly.replace(/\s+$/, '');
  const tk = []; ch.replace(/\S+/g, (m, i) => { tk.push({ i, m }); return m; });
  const total = Math.max(ch.length, ly.length), out = []; let start = 0;
  const seg = (a, b) => { let c = ''; for (const t of tk) if (t.i >= a && t.i < b) c = c.padEnd(t.i - a, ' ') + t.m; return [c, ly.slice(a, b).replace(/\s+$/, ''), a]; };
  while (total - start > W) {
    let cut = start + W;
    if (ly.length > cut) { const sp = ly.lastIndexOf(' ', cut); if (sp > start) cut = sp + 1; }
    for (let g = 0; g < 6; g++) { // não deixa um acorde partido ao meio
      const t = tk.find(t => t.i > start && t.i < cut && t.i + t.m.length > cut); if (!t) break;
      const sp = ly.lastIndexOf(' ', t.i - 1); cut = sp >= start ? sp + 1 : t.i;
    }
    if (cut <= start) cut = start + W;
    out.push(seg(start, cut)); start = cut;
  }
  out.push(seg(start, total)); return out;
}
function transposeText(text, n, chordLines = [], Wopt) {
  const lines = text.replace(/\r/g, '').split('\n');
  const key = findKey(text, chordLines), flat = useFlat(key, n), W = Wopt || fitCols();
  const isC = i => !chordLines.includes(-i - 1) && (chordLines.includes(i) || isChordLine(lines[i]));
  const cH = s => '<span class="chord">' + esc(s) + '</span>', out = [];
  const inl = l => l.split(/(\[[^\]\n]+\])/).map(p => { const m = p.match(/^\[([^\]]+)\]$/);
    if (m && CHORD_RE.test(m[1])) return st.chords ? '<span class="chord">[' + esc(n ? tChord(m[1], n, flat) : m[1]) + ']</span>' : '';
    return esc(p); }).join('');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isC(i)) {
      const ch = n ? transposeLine(l, n, flat) : l, nx = lines[i + 1];
      if (nx !== undefined && nx.trim() && !isC(i + 1) && !nx.includes('[')) {
        const pf = parseFmt(nx);
        for (const [c, y, a] of wrapPair(ch, pf.t, W)) { if (st.chords && c.trim()) out.push(cH(c)); out.push(fmtHtml(pf.t, pf.f, a, a + y.length)); }
        i++;
      } else if (st.chords) wrapText(ch, W).forEach(s => out.push(cH(s.t)));
    } else if (l.includes('[')) out.push(inl(parseFmt(l).t));
    else { const pf = parseFmt(l); wrapText(pf.t, W).forEach(s => out.push(fmtHtml(pf.t, pf.f, s.o, s.o + s.t.length))); }
  }
  return { html: out.join('\n'), key: key ? (n ? tChord(key, n, flat) : key) : null };
}


/* ============ Lista ============ */
function getVisible() { // cifras na ordem exibida (também usada por Anterior/Próxima)
  if (st.list !== 'all' && !listById(st.list)) st.list = 'all';
  const q = norm(st.q.trim()), L = listById(st.list);
  const base = L ? L.items.map(id => byId.get(id)).filter(Boolean) : songs.slice();
  const arr = base.filter(s => (!st.tag || (U.st[s.id] || []).includes(st.tag)) && (q[0] === '#' ? s.ng.includes(q.slice(1).trim()) : (!q || s.nt.includes(q) || s.nc.includes(q) || s.ng.includes(q))));
  if (L) { const o = Array.isArray(L.order) && L.order.length ? L.order : L.items; return arr.sort((a, b) => { const x = o.indexOf(a.id), y = o.indexOf(b.id); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y); }); }
  return arr.sort((a, b) => a.title.localeCompare(b.title, 'pt'));
}
const repActs = l => (l.recv ? [['save', '⬇', 'Salvar no meu catálogo']] : [['add', '＋', 'Adicionar músicas']]).concat([['ren', '✎', 'Renomear'], ['share', '🔗', 'Enviar'], ['del', '🗑', 'Excluir']]);
function repHeadHtml(l, n) { // mesmas opções do ⋯ da lista de repertórios no menu lateral
  return '<div class="dRep repHead" data-head="' + esc(l.id) + '"><button type="button" class="btn repBack" data-hback aria-label="Voltar para a página inicial" title="Voltar para a página inicial">← Início</button><span class="repTitle">' + (l.recv ? '📥 ' : '📁 ') + esc(l.name) + ' <small>(' + n + ')</small></span>' +
    '<button type="button" class="dMore" data-hmore aria-label="Opções do repertório" title="Opções do repertório" aria-expanded="false">⋯</button><div class="dActs">' +
    repActs(l).map(([a, ic, t]) => '<button class="dIco" data-ra="' + a + '" data-id="' + esc(l.id) + '" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + ic + '</button>').join('') + '</div></div>';
}
function repAction(btn) { // usado pelo menu lateral e pelo cabeçalho da lista
  st.list = btn.dataset.id; renderList(); closeIfPhone();
  $({ add: '#lstAddSongs', ren: '#lstRen', share: '#lstShare', del: '#lstDel', save: '#lstSave' }[btn.dataset.ra]).click();
}
function renderList() {
  const arr = getVisible(), q = norm(st.q.trim());
  const Lc = listById(st.list), inc = !!Lc;
  $('#count').textContent = arr.length + ' de ' + songs.length + ' músicas';
  const cnt = l => l.items.filter(id => byId.has(id)).length;
  $('#chips').innerHTML = Lc ? repHeadHtml(Lc, cnt(Lc)) : ''; // o nome é só um título: sem clique. As ações ficam no menu ⋯
  $('#listActions').classList.toggle('hidden', st.list === 'all');
  $('#lstDel').classList.toggle('hidden', st.list === 'all');
  $('#list').innerHTML = arr.length ? arr.map((s, n) => {
    let sn = '';
    if (q && !s.nt.includes(q)) {
      const l = s.content.split('\n').find(l => norm(l).includes(q) && !isChordLine(l));
      if (l) sn = '<div class="text-sm opacity-70 truncate font-normal">' + esc(l.trim()) + '</div>';
    }
    const lk = linkAnchors(s.id, 22);
    const tag = tagChips(s.id) + (!s.cat ? '<span class="text-xs opacity-60 ml-2 font-normal">minha</span>' : (s.edited ? '<span class="text-xs opacity-60 ml-2 font-normal">✎ editada</span>' : ''));
    return '<li class="flex items-stretch gap-2 rowli">' +
      (inc ? '<button type="button" class="btn drag shrink-0" aria-label="Arrastar cifra" title="Arrastar para ordenar">☰</button>' : '') +
      '<button data-open="' + esc(s.id) + '" class="btn flex-1 !justify-start text-left py-3 min-h-[56px]"><div class="min-w-0 w-full"><div class="truncate">' + (inc ? '<span class="opacity-60 mr-2">' + (n + 1) + '.</span>' : '') + esc(s.title) + tag + '</div>' + sn + '</div></button>' + (lk ? '<span class="rowlinks">' + lk + '</span>' : '') +
      '<button data-more class="btn rowmore" aria-label="Mais ações" title="Mais ações">⋯</button><div class="rowacts"><button data-fav="' + esc(s.id) + '" class="btn" aria-label="Listas">' + (inLists(s.id) ? '★' : '☆') + '</button>' +
      '<button data-tagbtn="' + esc(s.id) + '" class="btn" aria-label="Tags" title="Tags">🏷</button>' + '<button data-copy-row="' + esc(s.id) + '" class="btn" aria-label="Copiar cifra" title="Copiar cifra">📋</button>' + '<button data-pdf-row="' + esc(s.id) + '" class="btn" aria-label="Exportar PDF" title="Exportar PDF">📄</button>' + '<button data-edit="' + esc(s.id) + '" class="btn" aria-label="Editar">✎</button>' +
      '<button data-del="' + esc(s.id) + '" class="btn" aria-label="Excluir">🗑</button></div></li>';
  }).join('') : (catOk || songs.length ? (songs.length ? '<li class="text-center opacity-60 py-12">Nenhuma música aqui.</li>' : '<li class="text-center py-12"><button type="button" data-empty-import class="opacity-70 hover:opacity-100 underline underline-offset-4 cursor-pointer">Clique aqui para incluir sua primeira cifra.</button></li>') : '<li class="text-center opacity-60 py-12">Não consegui carregar o catálogo. Verifique a internet e recarregue a página. Você ainda pode usar Importar e + Adicionar.</li>');  renderDrawer();
}
async function deleteSong(s) {
  if (s.ro) { if (!await ask('Remover "' + s.title + '" deste repertório recebido?', 'Remover')) return false; U.lists.forEach(l => removeFromList(s.id, l.id)); delete U.rs[s.id]; delete U.tr[s.id]; delete U.lk[s.id]; save(); refresh(); toast('Música removida.'); return true; }
  const msg = s.cat ? 'Excluir "' + s.title + '"?\n\nA cifra some só para você e pode ser restaurada em “Meus dados”.' : 'Excluir "' + s.title + '"?\n\nEsta cifra é sua e será apagada de vez.';
  if (!await ask(msg, 'Excluir')) return false;
  if (s.cat) { if (!U.hidden.includes(s.id)) U.hidden.push(s.id); } // as listas continuam com o ID: se restaurar, a cifra volta às listas
  else { U.mine = U.mine.filter(m => m.id !== s.id); U.lists.forEach(l => removeFromList(s.id, l.id)); delete U.tr[s.id]; delete U.lk[s.id]; }
  save(); refresh(); toast('Música excluída.'); return true;
}
$('#list').addEventListener('click', async e => {
  if (e.target.closest('[data-empty-import]')) { $('#btnAdd').click(); return; }
  const more = e.target.closest('[data-more]');
  if (more) { const li = more.closest('li'), was = li.classList.contains('open'); document.querySelectorAll('#list li.open').forEach(x => x.classList.remove('open')); if (!was) li.classList.add('open'); return; }
  const tgb = e.target.closest('[data-tagbtn]');
  if (tgb) { const id = tgb.dataset.tagbtn, sg = byId.get(id); document.querySelectorAll('#list li.open').forEach(x => x.classList.remove('open')); if (!sg || sg.ro) return toast('Tags só em cifras do seu catálogo.'); openTags({ get: () => U.st[id] || [], set: a => { if (a.length) U.st[id] = a; else delete U.st[id]; save(); } }); return; }
  if (e.target.closest('.rowacts')) document.querySelectorAll('#list li.open').forEach(x => x.classList.remove('open'));
  const tgc = e.target.closest('[data-tg]'); if (tgc) { st.tag = tgc.dataset.tg; renderList(); return; }
  const o = e.target.closest('[data-open]'), f = e.target.closest('[data-fav]'), d = e.target.closest('[data-del]');
  const ed = e.target.closest('[data-edit]'), cp = e.target.closest('[data-copy-row]'), pdf = e.target.closest('[data-pdf-row]');
  if (cp) { const s=byId.get(cp.dataset.copyRow); if(s) { const txt=toneText(s); try { await navigator.clipboard.writeText(txt); toast('Cifra copiada.'); } catch (_) { const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Cifra copiada.'); } } }
  else if (pdf) { const s=byId.get(pdf.dataset.pdfRow); if(s) download(norm(s.title).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'.pdf',buildPdf([songBlocks(s,84)]),'application/pdf'); }
  else if (ed) openModal(byId.get(ed.dataset.edit));
  else if (o) openSong(o.dataset.open);
  else if (f) openPicker(f.dataset.fav);
  else if (d) { const s = byId.get(d.dataset.del); if (s && await deleteSong(s)) renderList(); }
});
$('#search').addEventListener('input', e => { st.q = e.target.value; renderList(); });
$('#chips').onclick = e => {
  if (e.target.closest('[data-hback]')) { goHome(); return; }
  const m = e.target.closest('[data-hmore]'); if (m) { const row = m.closest('.dRep'); row.classList.toggle('menu-open'); m.setAttribute('aria-expanded', row.classList.contains('menu-open')); return; }
  const a = e.target.closest('[data-ra]'); if (a) repAction(a);
};

$('#lstRen').onclick = async () => {
  const l = listById(st.list); if (!l) return;
  const n = await ask('Novo nome da lista:', 'Salvar', 'Cancelar', l.name);
  if (n) { l.name = n.slice(0, 40); save(); renderList(); }
};
$('#lstDel').onclick = async () => {
  const l = listById(st.list); if (!l || l.id === 'fav') return;
  if (!await ask('Excluir a lista "' + l.name + '"?\n\nAs músicas continuam no livro, só saem desta lista.', 'Excluir')) return;
  if (l.recv) l.items.forEach(id => { delete U.rs[id]; delete U.tr[id]; delete U.lk[id]; });
  U.lists = U.lists.filter(x => x.id !== l.id); save(); refresh(); st.list = 'all'; renderList(); toast('Repertório excluído.');
};

/* ============ Visualizador ============ */
function openSong(id, keepNav) {
  const s = byId.get(id); if (!s) return;
  if (!keepNav) { // a sequência Anterior/Próxima é a lista exibida (lista escolhida, busca e ordem)
    st.nav = getVisible().map(x => x.id);
    const L = listById(st.list); st.navName = L ? L.name : 'Todas';
  }
  st.cur = s; st.tr = U.tr[s.id] || 0;
  $('#viewer').classList.remove('hidden'); $('#viewer').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  setViewerHeaderHidden(false);
  renderSong();
  rememberOpen();
}
let scRaf=null,scPos=0,scLast=0;
function stopAutoScroll() { if (scRaf) cancelAnimationFrame(scRaf); scRaf = null; st.scrollTimer = null; $('#scrollPlay').textContent = '▶'; $('#scrollPlay').classList.add('btn-p'); $('#scrollControls').classList.add('hidden'); }
function startAutoScroll() {
  stopAutoScroll(); const v = $('#viewer'); scPos = v.scrollTop; scLast = 0; st.scrollTimer = true;
  $('#scrollPlay').textContent = '⏸'; $('#scrollPlay').classList.remove('btn-p'); $('#scrollControls').classList.remove('hidden');
  const tick = ts => {
    if (!st.scrollTimer) return;
    if (scLast) { scPos += st.scrollSpeed * 20 * Math.min(ts - scLast, 100) / 1000; v.scrollTop = scPos; if (Math.abs(v.scrollTop - scPos) > 3) scPos = v.scrollTop; }
    scLast = ts;
    if (v.scrollTop + v.clientHeight >= v.scrollHeight - 2) return stopAutoScroll();
    scRaf = requestAnimationFrame(tick);
  };
  scRaf = requestAnimationFrame(tick);
}
$('#scrollPlay').onclick = () => st.scrollTimer ? stopAutoScroll() : startAutoScroll();
$('#scrollSlower').onclick = () => { st.scrollSpeed = Math.max(0.25, Math.round((st.scrollSpeed - 0.25) * 100) / 100); $('#scrollSpeed').textContent = st.scrollSpeed + 'x'; if (st.scrollTimer) startAutoScroll(); };
$('#scrollFaster').onclick = () => { st.scrollSpeed = Math.min(5, Math.round((st.scrollSpeed + 0.25) * 100) / 100); $('#scrollSpeed').textContent = st.scrollSpeed + 'x'; if (st.scrollTimer) startAutoScroll(); };
function closeSong() {
  leaveFs();
  $('#colorPop').classList.add('hidden');
  stopAutoScroll();
  $('#viewer').classList.add('hidden'); document.body.style.overflow = '';
  if (st.wake) { st.wake.release().catch(() => {}); st.wake = null; $('#vWake').classList.remove('btn-on'); }
  st.cur = null; rememberOpen(); renderList();
}
function renderSong() {
  const s = st.cur; if (!s) return;
  const out = transposeText(s.content, st.tr, s.chordLines || []);
  $('#vTitle').textContent = s.title;
  { const h = linkAnchors(s.id, 30), fab = $('#listenFab'); fab.innerHTML = h; fab.classList.toggle('hidden', !h); }
  $('#vFav').textContent = inLists(s.id) ? '★' : '☆';
  const hasTxt = !!s.content.trim();
  ['#song', '#ctlTr', '#vChords'].forEach(i => $(i).classList.toggle('hidden', !hasTxt));
  $('#song').innerHTML = out.html;
  $('#song').style.fontSize = st.size + 'px';
  $('#song').classList.toggle('two-columns', st.twoColumns);
  $('#vColumns').textContent = st.twoColumns ? '2 col.' : '1 col.';
  $('#vColumns').classList.toggle('btn-on', st.twoColumns);
  $('#vColumns').setAttribute('aria-pressed', String(st.twoColumns));
  $('#keyLbl').textContent = out.key || '—';
  const im = $('#songImg');
  im.classList.toggle('hidden', !s.img); if (s.img) im.src = s.img;
  $('#vChords').classList.toggle('btn-on', st.chords); $('#vChords').textContent = st.chords ? 'Cifra' : 'Letra';
  $('#vTag').textContent = '🏷'; $('#vTag').dataset.l = 'Tags' + ((U.st[s.id] || []).length ? ' (' + U.st[s.id].length + ')' : '');
  $('#vNote').classList.toggle('hidden', !s.edited);
  $('#vNoteTxt').textContent = s.stale ? '✎ Sua versão editada (o catálogo foi atualizado depois).' : '✎ Sua versão editada.';
  const i = st.nav.indexOf(s.id);
  $('#navInfo').textContent = (st.navName || 'Todas') + (i >= 0 ? ' · ' + (i + 1) + '/' + st.nav.length : '');
  $('#navPrev').disabled = i <= 0; $('#navNext').disabled = i < 0 || i >= st.nav.length - 1;
}
function go(d) {
  if (!st.cur) return;
  const i = st.nav.indexOf(st.cur.id); if (i < 0) return;
  let j = i + d; while (st.nav[j] && !byId.has(st.nav[j])) j += d; // pula cifras excluídas
  if (st.nav[j]) openSong(st.nav[j], true);
}
$('#navPrev').onclick = () => go(-1);
$('#navNext').onclick = () => go(1);
function setTr(d) {
  st.tr = d === 0 ? 0 : ((st.tr + d) % 12 + 12) % 12;
  if (st.tr > 6) st.tr -= 12;
  if (st.tr) U.tr[st.cur.id] = st.tr; else delete U.tr[st.cur.id];
  save(); renderSong();
}
$('#vBack').onclick = closeSong;
$('#trUp').onclick = () => setTr(1);
$('#trDown').onclick = () => setTr(-1);
$('#trReset').onclick = () => setTr(0);
$('#fUp').onclick = () => { st.size = Math.min(48, st.size + 2); renderSong(); };
$('#fDown').onclick = () => { st.size = Math.max(10, st.size - 2); renderSong(); };
$('#vChords').onclick = () => { st.chords = !st.chords; renderSong(); };
$('#vColumns').onclick = () => { st.twoColumns = !st.twoColumns; renderSong(); };
$('#vFav').onclick = () => openPicker(st.cur.id);
$('#vDel').onclick = async () => { if (st.cur && await deleteSong(st.cur)) closeSong(); };
$('#vEdit').onclick = () => openModal(st.cur);
$('#vRestore').onclick = async () => {
  if (!st.cur || !st.cur.edited || !await ask('Voltar ao texto original do catálogo?\n\nA sua edição será descartada.', 'Restaurar')) return;
  delete U.edits[st.cur.id]; save(); refresh(); renderSong(); toast('Original restaurado.');
};
$('#vWake').onclick = async () => {
  try {
    if (st.wake) { await st.wake.release(); st.wake = null; $('#vWake').classList.remove('btn-on'); toast('Tela volta ao normal.'); }
    else { st.wake = await navigator.wakeLock.request('screen'); $('#vWake').classList.add('btn-on'); toast('Tela sempre ligada.'); }
  } catch (e) { toast('Este navegador não permite manter a tela ligada.'); }
};
function setViewerHeaderHidden(hidden) {
  $('#viewer').classList.toggle('header-hidden', hidden);
  $('#vToggleHeader').textContent = hidden ? '🙈' : '👁️';
}
$('#vToggleHeader').onclick = () => setViewerHeaderHidden(!$('#viewer').classList.contains('header-hidden'));
/* ============ Tela cheia: só a cifra, a navegação e o botão de sair ============ */
let immersive = false, fsTipShown = false; // "immersive" = modo sem a barra do app, para navegadores que não têm tela cheia (ex.: iPhone)
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const fsCan = () => { const e = document.documentElement; return !!(e.requestFullscreen || e.webkitRequestFullscreen) && document.fullscreenEnabled !== false; };
const isFs = () => !!fsEl() || immersive;
function exitFs() { try { if (!fsEl()) return; const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
function leaveFs() { immersive = false; exitFs(); syncFs(); }
async function toggleFullscreen() {
  if (isFs()) { leaveFs(); return; }
  if (fsCan()) { try { const e = document.documentElement, r = (e.requestFullscreen || e.webkitRequestFullscreen).call(e); if (r && r.then) await r; } catch (_) { immersive = true; } }
  else {
    immersive = true;
    const instalado = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!instalado && !fsTipShown) { fsTipShown = true; toast('Mostrando só a cifra. Para esconder também a barra do navegador, instale o Cifrador na tela inicial.'); }
  }
  syncFs();
}
function syncFs() { const on = isFs(), b = $('#vFull'); document.documentElement.classList.toggle('is-fs', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = on ? 'Sair da tela cheia' : 'Tela cheia'; b.setAttribute('aria-label', b.title); }
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, syncFs));
$('#vFull').onclick = toggleFullscreen;
$('#navFsExit').onclick = leaveFs;

/* ============ Modal: adicionar / editar ============ */
function renderEditorHighlight() {
  const pre = $('#mHighlight'), ta = $('#mText'); if (!pre || !ta) return;
  const lines = ta.value.replace(/\r/g, '').split('\n');
  pre.innerHTML = lines.map((line, i) => {
    const isChord = !st.chordLines.includes(-i - 1) && (st.chordLines.includes(i) || isChordLine(line));
    if (!line) return '<span> </span>';
    if (isChord) return '<span class="editor-chord-line">' + esc(line) + '</span>';
    return line.split(/(\[[^\]\n]+\])/g).map(part => {
      const m = part.match(/^\[([^\]]+)\]$/);
      return m && CHORD_RE.test(m[1]) ? '<span class="editor-chord-line">' + esc(part) + '</span>' : esc(part);
    }).join('');
  }).join('\n') + '\n';
  pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
}
const shiftMarks = (oldT, newT) => { // as marcações de linha acompanham inserções e remoções de linhas
  const a = oldT.split('\n'), b = newT.split('\n'); let p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const d = b.length - a.length; if (!d) return;
  st.chordLines = st.chordLines.map(m => { const neg = m < 0, i = neg ? -m - 1 : m; let n = i;
    if (i >= a.length - s) n = i + d; else if (d < 0 && i >= b.length - s) return null; return neg ? -n - 1 : n; }).filter(x => x !== null);
};
$('#mText').addEventListener('focus', e => { e.target.dataset.prev = e.target.value; });
$('#mText').addEventListener('input', e => { const t = e.target; if (t.dataset.prev !== undefined) shiftMarks(t.dataset.prev, t.value); t.dataset.prev = t.value; renderEditorHighlight(); });
$('#mText').addEventListener('scroll', () => { const pre = $('#mHighlight'); pre.scrollTop = $('#mText').scrollTop; pre.scrollLeft = $('#mText').scrollLeft; });

let modalBaseline = '';
function modalState() { return JSON.stringify({ title: $('#mTitle').value, text: $('#mText').value, marks: st.chordLines, tags: st.edTags || [], links: st.edLinks || [] }); }
function updLinkChip(row) {
  const t = row.querySelector('[data-lin]').value.trim(), c = row.querySelector('[data-chip]'), n = t ? normLink(t) : '';
  if (!t) { c.className = 'mlchip'; c.textContent = 'Link'; }
  else if (n === null) { c.className = 'mlchip bad'; c.textContent = 'Link inválido'; }
  else { const p = platOf(n); c.className = 'mlchip'; c.innerHTML = platIcon(p, 18) + esc(p.n); }
}
function renderEdLinks() {
  const n = st.edLinks.length;
  $('#mLinks').innerHTML = st.edLinks.map((u, i) => '<div class="mlrow" data-i="' + i + '"><div class="mlhead"><span class="mlchip" data-chip></span><button type="button" class="btn mlx" data-ldel="' + i + '" aria-label="Remover link" title="Remover link">×</button></div><input type="url" class="fld" data-lin inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Cole aqui o link da música" aria-label="Endereço do link ' + (i + 1) + '" value="' + esc(u) + '"></div>').join('');
  $('#mLinks').querySelectorAll('.mlrow').forEach(updLinkChip);
  $('#mLinkAdd').classList.toggle('hidden', n >= LINKMAX); $('#mLinksCount').textContent = n ? n + ' de ' + LINKMAX : '';
}
const syncEdLinks = () => { st.edLinks = [...$('#mLinks').querySelectorAll('[data-lin]')].map(i => i.value); }; // a tela é a fonte da verdade
$('#mLinkAdd').onclick = () => { syncEdLinks(); if (st.edLinks.length >= LINKMAX) return; st.edLinks.push(''); renderEdLinks(); const l = $('#mLinks').querySelectorAll('[data-lin]'); l[l.length - 1].focus(); };
$('#mLinks').addEventListener('input', e => { const r = e.target.closest('.mlrow'); if (!r || !e.target.isConnected || !e.target.matches('[data-lin]')) return; syncEdLinks(); updLinkChip(r); });
$('#mLinks').addEventListener('change', e => { const r = e.target.closest('.mlrow'); if (!r || !e.target.isConnected || !e.target.matches('[data-lin]')) return; const n = normLink(e.target.value); if (n) { e.target.value = n; syncEdLinks(); updLinkChip(r); } }); // mostra o endereço completo com https
$('#mLinks').addEventListener('click', e => { const d = e.target.closest('[data-ldel]'); if (!d) return; syncEdLinks(); st.edLinks.splice(Number(d.dataset.ldel), 1); renderEdLinks(); });
function openModal(song) {
  if (song && song.ro) return toast('Música recebida: use “Salvar no meu catálogo” para poder editar.');
  st.edit = song ? song.id : null; st.edTags = song ? [...(U.st[song.id] || [])] : []; st.edLinks = song ? [...linksOf(song.id)] : []; renderEdLinks();
  $('#mHead').textContent = song ? (song.cat ? 'Editar cifra (só para você)' : 'Editar cifra') : 'Nova cifra';
  $('#mTitle').value = song ? song.title : '';
  $('#mText').value = song ? song.content : '';
  st.chordLines = song && Array.isArray(song.chordLines) ? [...song.chordLines] : [];
  $('#mChordInfo').textContent = 'Selecione uma linha (ou um trecho) e use “É cifra” ou “É letra”. As linhas reconhecidas como acordes ficam destacadas.';
  $('#mText').rows = song ? 16 : 10;
  $('#mNote').classList.toggle('hidden', !(song && st.tr));
  $('#mText').dataset.prev = $('#mText').value;
  $('#modal').classList.remove('hidden');
  renderEditorHighlight(); modalBaseline = modalState();
}
async function closeModal(force = false) {
  if (!force && !$('#modal').classList.contains('hidden') && modalState() !== modalBaseline) {
    const choice = await ask('Existem alterações que ainda não foram salvas. Deseja descartá-las?', 'Descartar alterações', 'Continuar editando');
    if (!choice) return false;
  }
  $('#modal').classList.add('hidden'); st.edit = null; st.chordLines = []; st.edLinks = []; modalBaseline = ''; return true;
}
// A adição manual também está disponível no modal acionado pelo botão principal.
$('#mCancel').onclick = () => closeModal();
$('#mX').onclick = () => closeModal();
$('#btnCreateRep').onclick = async () => { const name = await ask('Nome do novo repertório:', 'Criar', 'Cancelar', 'Meu repertório'); if (!name) return; const clean = name.slice(0,40); if (U.lists.some(l => l.name.toLowerCase() === clean.toLowerCase())) return toast('Já existe um repertório com esse nome.'); const l = { id: uid(), name: clean, sort: 'custom', order: [], items: [] }; U.lists.push(l); save(); st.list = l.id; renderList(); toast('Repertório criado. Adicione cifras pelo botão ☆ em cada música.'); };
$('#mChooseFile').onclick = async () => { if (await closeModal()) $('#file').click(); };
$('#mMarkChord').onclick = () => {
  const ta = $('#mText'), text = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
  const first = text.slice(0, start).split('\n').length - 1;
  const last = text.slice(0, end).split('\n').length - 1;
  const lines = text.replace(/\r/g, '').split('\n');
  const chosen = []; for (let i = first; i <= last; i++) chosen.push(i);
  st.chordLines = st.chordLines.filter(x => !chosen.includes(-x - 1)); for (const i of chosen) if (!st.chordLines.includes(i)) st.chordLines.push(i);
  st.chordLines.sort((a,b)=>a-b); renderEditorHighlight();
  $('#mChordInfo').textContent = st.chordLines.length + ' linha(s) marcada(s) manualmente.';
  toast('Linhas marcadas como cifra.');
};
$('#mMarkLyric').onclick = () => {
  const ta = $('#mText'), t = ta.value, a = t.slice(0, ta.selectionStart).split('\n').length - 1, b = t.slice(0, ta.selectionEnd).split('\n').length - 1, ch = [];
  for (let i = a; i <= b; i++) ch.push(i);
  st.chordLines = st.chordLines.filter(x => !ch.includes(x) && !ch.includes(-x - 1)); ch.forEach(i => st.chordLines.push(-i - 1));
  st.chordLines.sort((x, y) => x - y); renderEditorHighlight(); toast('Linhas marcadas como letra.');
};
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#mSave').onclick = () => {
  const title = $('#mTitle').value.trim() || 'Sem título', content = $('#mText').value.replace(/\r/g, '');
  if (!content.trim()) return toast('Digite ou cole o texto da cifra antes de salvar.');
  const links = []; // confere os links antes de gravar qualquer coisa
  for (const inp of $('#mLinks').querySelectorAll('[data-lin]')) { const t = inp.value.trim(); if (!t) continue; const n = normLink(t); if (n === null) { inp.focus(); return toast('Confira o link: use um endereço que comece com https.'); } if (!links.includes(n)) links.push(n); }
  const edit = st.edit && byId.get(st.edit), bak = JSON.stringify(U);
  if (edit && st.edTone) { delete U.tr[edit.id]; st.tr = 0; }
  if (edit) { if (st.edTags.length) U.st[edit.id] = [...st.edTags]; else delete U.st[edit.id]; setLinks(edit.id, links); }
  if (edit && edit.cat) { // correção pessoal de uma cifra do catálogo: guarda só a diferença
    const c = catById.get(edit.id);
    if (title === c.title && content === c.content && !st.chordLines.length) delete U.edits[edit.id];
    else U.edits[edit.id] = { title: title !== c.title ? title : undefined, content: content !== c.content ? content : undefined, chordLines: st.chordLines.length ? [...st.chordLines] : undefined, b: hash(c.content) };
  } else if (edit) { Object.assign(U.mine.find(x => x.id === edit.id), { title, content, chordLines: [...st.chordLines] }); }
  else { const id = 'u-' + uid(); if (st.edTags.length) U.st[id] = [...st.edTags]; U.mine.push({ id, title, content, chordLines: [...st.chordLines] }); setLinks(id, links); if (st.list !== 'all') addToList(id, st.list); }
  if (!save()) { U = cleanUser(JSON.parse(bak)); return; }
  closeModal(true); refresh(); renderList(); if (st.cur) renderSong(); toast('Música salva.');
};

/* ============ Escolher lista ============ */
let pickSong = null;
function openPicker(id) {
  pickSong = byId.get(id); if (!pickSong) return;
  $('#pickTitle').textContent = pickSong.title; $('#pickNew').value = '';
  renderPicker(); $('#pick').classList.remove('hidden');
}
function renderPicker() {
  $('#pickList').innerHTML = U.lists.map(l => {
    const on = l.items.includes(pickSong.id);
    return '<button data-pl="' + esc(l.id) + '" class="btn w-full !justify-between' + (on ? ' btn-on' : '') + '"><span class="truncate">' + (l.id === 'fav' ? '★ ' : '') + esc(l.name) + '</span><span>' + (on ? '✓' : '+') + '</span></button>';
  }).join('');
}
function closePicker() { $('#pick').classList.add('hidden'); pickSong = null; renderList(); if (st.cur) renderSong(); }
$('#pickList').onclick = e => {
  const b = e.target.closest('[data-pl]'); if (!b || !pickSong) return;
  if (listById(b.dataset.pl).items.includes(pickSong.id)) removeFromList(pickSong.id, b.dataset.pl); else addToList(pickSong.id, b.dataset.pl);
  save(); renderPicker();
};
function pickCreate() {
  const name = $('#pickNew').value.trim().slice(0, 40);
  if (!name) return toast('Digite o nome da nova lista.');
  let l = U.lists.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!l) { l = { id: uid(), name, sort: 'name', items: [] }; U.lists.push(l); }
  addToList(pickSong.id, l.id); save();
  $('#pickNew').value = ''; renderPicker(); toast('Adicionada a "' + l.name + '".');
}
$('#pickAdd').onclick = pickCreate;
$('#pickNew').onkeydown = e => { if (e.key === 'Enter') pickCreate(); };
$('#pickDone').onclick = closePicker;
$('#pick').addEventListener('click', e => { if (e.target.id === 'pick') closePicker(); });


/* Normaliza títulos extraídos de PDF/TXT; corrigido: antes era chamada sem definição. */
function cleanTitle(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—:;|]+|[\s\-–—:;|]+$/g, '').trim();
}

/* ============ Importação (PDF / TXT / JSON / HTML antigo) — vira "minhas cifras" ============ */
const SEC = 'pr[eé]-?\\s*refr[aã]o|refr[aã]o|ponte|intro(?:du[cç][aã]o)?|interl[uú]dio|final|solo|coro|verso|estrofe|bis|outro|riff';
const SECTION_RE = new RegExp('^(?:' + SEC + '|(?:(?:primeira|segunda|terceira|quarta|quinta|[uú]ltima|\\d+[ªa]?)\\s+)?parte)(?:\\s*\\d+)?\\s*:?$', 'iu');
const SECTION_COLON_RE = new RegExp('^(?:' + SEC + ')(?:\\s*\\d+)?\\s*:', 'iu');
function clearlyNotTitle(t) {
  t = t.trim();
  const c = cleanTitle(t);
  return !t || /^\d{1,4}$/.test(t) || /^[\[(]/.test(t) || SECTION_RE.test(c) || SECTION_COLON_RE.test(c) || isChordLine(t);
}
function plausibleTitle(t) {
  t = t.trim();
  if (clearlyNotTitle(t) || t.length < 2 || t.length > 70) return false;
  if ((t.match(/\p{L}/gu) || []).length < 2) return false;
  if (/[,;:]$/.test(t)) return false;
  return !/^\p{Ll}/u.test(cleanTitle(t));
}
function splitTitle(block, fallback) {
  const lines = block.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) return null;
  const f = lines[0].trim();
  if (plausibleTitle(f)) return { title: cleanTitle(f), content: lines.slice(1).join('\n').replace(/^\n+/, '').trimEnd() };
  return { title: fallback, content: lines.join('\n').trimEnd() };
}
function seedFromHtml(t) {
  const el = new DOMParser().parseFromString(t, 'text/html').querySelector('#seed');
  const raw = el && el.textContent.trim();
  if (!raw || raw === '[]') throw new Error('Este HTML não tem cifras embutidas.');
  return raw;
}
function parseTxt(txt, name) {
  const base = name.replace(/\.[^.]+$/, '');
  const parts = txt.split(/^\s*(?:-{3,}|={3,}|_{3,}|#{3,})\s*$/m).filter(p => p.trim());
  return parts.map((p, i) => splitTitle(p, parts.length > 1 ? base + ' ' + (i + 1) : base)).filter(s => s && s.content.trim());
}

function itemsToText(items) {
  const it = items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) || 10 }));
  if (!it.length) return '';
  const wide = it.filter(i => i.s.length >= 3);
  const cw = wide.length ? wide.reduce((a, i) => a + i.w / i.s.length, 0) / wide.length : 5;
  const x0 = Math.min(...it.map(i => i.x));
  it.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const i of it) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(i.y - cur.y) <= Math.max(2, i.h * 0.4)) { cur.items.push(i); cur.h = Math.max(cur.h, i.h); }
    else lines.push({ y: i.y, h: i.h, items: [i] });
  }
  let out = '', prevY = null;
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let s = '', prevEnd = null;
    for (const i of l.items) {
      if (prevEnd !== null && i.x - prevEnd <= cw * 0.25) s += i.s;
      else {
        const col = Math.round((i.x - x0) / cw);
        if (col > s.length) s += ' '.repeat(col - s.length); else if (s && !/\s$/.test(s)) s += ' ';
        s += i.s;
      }
      prevEnd = i.x + i.w;
    }
    if (prevY !== null && prevY - l.y > l.h * 2.2) out += '\n';
    out += s.replace(/\s+$/, '') + '\n';
    prevY = l.y;
  }
  return out;
}
async function pdfToSongs(file, onProg = () => {}) {
  await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let pages = [], ocrIdx = [];
  const O = pdfjsLib.OPS, imgOps = [O.paintImageXObject, O.paintInlineImageXObject, O.paintJpegXObject, O.paintImageMaskXObject];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pg = await pdf.getPage(p), tc = await pg.getTextContent(), t = itemsToText(tc.items);
    pages.push(t); onProg(Math.round(p / pdf.numPages * 30));
    if (t.replace(/\s/g, '').length < 400 && (await pg.getOperatorList()).fnArray.some(f => imgOps.includes(f))) ocrIdx.push(p); // página quase só imagem (ex.: título em texto + cifra em foto)
  }
  const ocrN = Math.min(ocrIdx.length, 80);
  for (let k = 0; k < ocrN; k++) { // lê só as páginas que são imagem; as de texto continuam sendo lidas direto
    onProg(30 + Math.round(k / ocrN * 65));
    const pg = await pdf.getPage(ocrIdx[k]), vp = pg.getViewport({ scale: 3.5 }), cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    pages[ocrIdx[k] - 1] = await ocrRead(cv);
  }
  onProg(96);
  if (pages.join('').replace(/\s/g, '').length < 30) throw new Error('Este PDF não tem texto nem imagens legíveis.');
  const base = file.name.replace(/\.[^.]+$/, '');
  // 1) tira cabeçalhos/rodapés que se repetem nas páginas (ex.: "Ministério… www… 12"), sumário e números soltos
  const sig = s => s.toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim().split(' ').sort().join(' ');
  const pl = pages.map(t => t.split('\n').map(x => x.replace(/\s+$/, '')));
  const edgeIdx = ls => { const ne = ls.map((l, k) => [l, k]).filter(x => x[0].trim()); return new Set([...ne.slice(0, 4), ...ne.slice(-3)].map(x => x[1])); };
  const cnt = new Map();
  if (pl.length >= 6) pl.forEach(ls => { const E = edgeIdx(ls); new Set([...E].map(k => ls[k]).filter(l => !isChordLine(l) && /\p{L}{3}/u.test(l)).map(sig)).forEach(k => cnt.set(k, (cnt.get(k) || 0) + 1)); });
  const minRep = Math.max(3, Math.floor(pl.length * 0.03)), tocRe = /\.{4,}\s*\d+\s*$|…{2,}/;
  const L = [];
  pl.forEach(ls => {
    const E = edgeIdx(ls); let first = true, any = false;
    const rm = new Set([...E].filter(k => !isChordLine(ls[k]) && sig(ls[k]) && (cnt.get(sig(ls[k])) || 0) >= minRep));
    const ne = ls.map((l, k) => k).filter(k => ls[k].trim()); // linha entre dois cabeçalhos também é cabeçalho (ex.: nome do CD)
    for (let t = 1; t < ne.length - 1; t++) if (rm.has(ne[t - 1]) && rm.has(ne[t + 1]) && ls[ne[t]].trim().length < 60 && !isChordLine(ls[ne[t]])) rm.add(ne[t]);
    ls.forEach((l, k) => {
      if (/^\s*\d{1,4}\s*$/.test(l) || tocRe.test(l) || rm.has(k)) return;
      if (!l.trim() && (!any || !L.length)) return;
      L.push({ t: l, ps: first && !!l.trim() }); if (l.trim()) { first = false; any = true; }
    });
    if (any) L.push({ t: '', ps: false });
  });
  // 2) acha os títulos linha a linha (inclusive vários por página)
  const nextNE = (i, n) => { const o = []; for (let j = i + 1; j < L.length && o.length < n; j++) if (L[j].t.trim()) o.push(L[j].t); return o; };
  const isTitleLine = i => {
    const mu = L[i].t.match(/^\s*m[uú]sica\s*:\s*(\S.{1,69})$/i); if (mu) return cleanTitle(mu[1].trim());
    const t = L[i].t.trim().replace(/\s{2,}/g, ' '); if (!t || !plausibleTitle(t) || isChordLine(L[i].t)) return false;
    const catT = L[i].t.trim().replace(/\s{2,}/g, ' '), isCat = /^[A-ZÀ-Ú][A-ZÀ-Ú ]{2,}\s*[–—-]\s*\S/.test(catT) && catT.split(/\s+/).length <= 11 && !/[,;]$/.test(catT);
    if (isCat) { const [c0 = '', c1 = ''] = nextNE(i, 2); if (isChordLine(c0) || CHORDISH(c0) || (c0.trim().length < 80 && (isChordLine(c1) || CHORDISH(c1)))) return cleanTitle(catT); }
    const body0 = t.replace(/^\d{1,3}\s*[.\-–)]\s*/, ''), numUp = /^\d{1,3}\s*[.\-–)]\s*\p{L}/u.test(t) && body0 === body0.toUpperCase();
    if (!(L[i].ps || i === 0 || !L[i - 1].t.trim() || numUp)) return false;
    const body = t.replace(/^\d{1,3}\s*[.\-–)]\s*/, ''), words = body.split(/\s+/).length;
    const numbered = /^\d{1,3}\s*[.\-–)]\s*\p{L}/u.test(t), upper = body === body.toUpperCase() && (body.match(/\p{Lu}/gu) || []).length >= 2;
    const [n0 = '', n1 = ''] = nextNE(i, 2);
    const chordSoon = isChordLine(n0) || CHORDISH(n0) || (n0.trim().length < 80 && !isChordLine(n0) && (isChordLine(n1) || CHORDISH(n1)) && (/^\s*[\[(]/.test(n0) || numbered || upper || L[i].ps));
    if (words > 9) return false;
    if (numbered) return chordSoon || upper;
    if (upper) return chordSoon || L[i].ps;
    return L[i].ps && chordSoon;
  };
  const res = []; let cur = null;
  for (let i = 0; i < L.length; i++) {
    const tt = isTitleLine(i);
    if (tt) { cur = { title: (typeof tt === 'string' ? tt : cleanTitle(L[i].t.trim())).replace(/\s{2,}/g, ' ').replace(/\s*[-–]\s*Músicas Católicas$/i, ''), content: '' }; res.push(cur); continue; }
    if (!cur) { if (!L[i].t.trim()) continue; cur = { title: base, content: '' }; res.push(cur); }
    if (L[i].ps && cur.content) cur.content += '\n';
    cur.content += L[i].t + '\n';
  }
  res.forEach(s => { s.content = s.content.replace(/^\n+/, '').trimEnd(); });
  // descarta capa/índice: sem cifra e quase sem texto
  for (let k = res.length - 1; k >= 0; k--) { const s = res[k], ls = s.content.split('\n').filter(x => x.trim()); if ((!ls.some(isChordLine) && ls.length < 4) || /^(índice|sumário|livro de cantos|capa|repert[óo]rio)\b/i.test(s.title)) res.splice(k, 1); }
  return res.filter(s => s.content.trim());
}

/* ===== (importação, continuação) ===== */
/* ============ Importação (PDF / TXT / JSON / HTML antigo) — vira "minhas cifras" ============ */
function parseSongsJson(d) { // formatos antigos: array de músicas ou {songs}
  let arr = Array.isArray(d) ? d : (d.songs || d.musicas || d.cantos || (d.title || d.titulo ? [d] : []));
  arr = (Array.isArray(arr) ? arr : []).filter(s => s && typeof s === 'object'); if (arr.length > LIM.imp) { toast('O arquivo tem ' + arr.length + ' cifras; só as primeiras ' + LIM.imp + ' foram importadas.'); arr = arr.slice(0, LIM.imp); }
  return arr.map(s => ({
    title: String(s.title || s.titulo || s.nome || s.name || '').trim(),
    content: String(s.content || s.cifra || s.letra || s.texto || s.lyrics || s.text || ''),
    img: typeof s.img === 'string' && s.img.length <= LIM.img && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s.img) ? s.img : undefined
  })).map(s => ({ ...s, title: s.title.slice(0, LIM.title), content: s.content.slice(0, LIM.content) })).filter(s => s.title && (s.content.trim() || s.img));
}
function addMineOne(s) { // devolve o id (já existente ou novo) de uma cifra idêntica
  const k = norm(s.title) + '\u0000' + s.content;
  const ex = U.mine.find(m => norm(m.title) + '\u0000' + m.content === k && m.img === s.img);
  if (ex) return { id: ex.id, isNew: false };
  if (!s.img) { const c = CAT.find(c => norm(c.title) + '\u0000' + c.content === k); if (c) { U.hidden = U.hidden.filter(h => h !== c.id); return { id: c.id, isNew: false }; } }
  const id = 'u-' + uid(); U.mine.push({ id, title: s.title, content: s.content, img: s.img }); return { id, isNew: true };
}
async function unzipEntry(buf, name) {
  const v = new DataView(buf), u = new Uint8Array(buf); let e = u.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('arquivo inválido');
  let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const m = v.getUint16(p + 10, true), cs = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    if (dec.decode(u.subarray(p + 46, p + 46 + nl)) === name) { const s = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), d = u.subarray(s, s + cs);
      return dec.decode(m === 0 ? d : await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
    p += 46 + nl + xl + cl;
  }
  throw new Error('conteúdo não encontrado no arquivo');
}
function xmlParas(xml, isP, spec) { // texto por parágrafo, mantendo espaços
  const d = new DOMParser().parseFromString(xml, 'application/xml'), out = [];
  const walk = n => { let s = ''; for (const c of n.childNodes) { if (c.nodeType === 3) s += c.nodeValue; else if (spec(c)) s += spec(c)(c); else s += walk(c); } return s; };
  const visit = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (isP(c)) out.push(walk(c)); else visit(c); } };
  visit(d.documentElement); return out.join('\n');
}
function cleanChordGaps(t) { // tira a linha em branco entre uma cifra e a letra dela
  const L = t.split('\n'), o = [];
  for (let k = 0; k < L.length; k++) { o.push(L[k]); if (isChordLine(L[k]) && L[k + 1] !== undefined && !L[k + 1].trim()) { let q = k + 1; while (L[q] !== undefined && !L[q].trim()) q++; if (L[q] !== undefined && !isChordLine(L[q]) && !/^\s*(intro|inter|solo|final)/i.test(L[k])) k = q - 1; } }
  return o.join('\n');
}
async function docToText(f, ext) {
  const buf = await f.arrayBuffer();
  if (ext === 'odt') return cleanChordGaps(xmlParas(await unzipEntry(buf, 'content.xml'), c => c.localName === 'p' || c.localName === 'h',
    c => c.localName === 's' ? (n => ' '.repeat(+n.getAttribute('text:c') || 1)) : c.localName === 'tab' ? (() => '    ') : c.localName === 'line-break' ? (() => '\n') : null));
  return cleanChordGaps(xmlParas(await unzipEntry(buf, 'word/document.xml'), c => c.localName === 'p',
    c => c.localName === 't' ? (n => n.textContent) : c.localName === 'tab' ? (() => '    ') : c.localName === 'br' ? (() => '\n') : null));
}
async function importFiles(files, customMode = false) {
  let total = 0, dup = 0; const erros = [], imgs = [], imgIdx = []; importCancelled = false; impStart(files);
  let fileIndex = 0;
  for (const f of files) {
    if (importCancelled) break;
    fileIndex++; const fi = fileIndex - 1; impSet(fi, 'run');
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase(); let list;
      if (f.type.startsWith('image/') || ['png','jpg','jpeg','webp','bmp'].includes(ext)) { imgs.push(f); imgIdx.push(fi); impSet(fi, 'wait'); continue; }
      else if (ext === 'pdf' || f.type === 'application/pdf') list = await pdfToSongs(f, p => impSet(fi, 'run', p));
      else if (ext === 'json') {
        if (f.size > 30 * 1024 * 1024) throw new Error('arquivo grande demais (máximo 30 MB)');
        const d = JSON.parse(await f.text()); if (d === null || typeof d !== 'object') throw new Error('formato de arquivo não reconhecido');
        if (d && d.k === 'lista') { await importSharedList(d); continue; }
        if (d && d.v === 2 && Array.isArray(d.lists)) { await restoreBackup(d); continue; }
        if (d && Array.isArray(d.songs) && (d.v === 3 || 'next' in d)) { await importCatalog(d); continue; }
        list = parseSongsJson(d);
      }
      else if (ext === 'html' || ext === 'htm') list = parseSongsJson(JSON.parse(seedFromHtml(await f.text())));
      else if (ext === 'odt' || ext === 'docx') list = parseTxt(await docToText(f, ext), f.name);
      else list = parseTxt(await f.text(), f.name);
      if (importCancelled) break;
      if (!list.length) throw new Error('Nenhuma música encontrada.');
      if (customMode) {
        const combined = list.map((song, i) => (song.title || ('Música ' + (i + 1))) + '\n' + (song.content || song.text || '')).join('\n\n\n');
        openModal(null); $('#mTitle').value = list[0].title || f.name.replace(/\.[^.]+$/, '').slice(0, 100); $('#mText').value = combined; $('#mText').dataset.prev = combined; renderEditorHighlight();
        hideImportProgress(); toast('Revise e edite o conteúdo. Quando estiver pronto, toque em “Dividir” para separar as cifras.');
        return;
      }
      for (const s of list) { if (addMineOne(s).isNew) total++; else dup++; }
    } catch (e) { erros.push(f.name + ': ' + (e.message || 'erro desconhecido')); impSet(fi, 'error'); }
    finally { if (importUi && importUi.querySelectorAll('.ip-row')[fi]?.dataset.st === 'run') impSet(fi, 'done'); }
  }
  if (imgs.length) { // fotos/prints: lê o texto e abre no editor para você revisar antes de salvar
    try {
      const parts = []; for (let i = 0; i < imgs.length; i++) { if (importCancelled) break; impSet(imgIdx[i], 'run'); parts.push(await ocrRead(imgs[i])); impSet(imgIdx[i], 'done'); }
      if (importCancelled) { hideImportProgress(); toast('Importação cancelada.'); return; }
      const text = parts.join('\n\n').trim(); if (!text) throw new Error('não encontrei texto na imagem');
      if (total) save(); refresh(); renderList();
      openModal(null); $('#mTitle').value = imgs[0].name.replace(/\.[^.]+$/, '').slice(0, 100); $('#mText').value = text; $('#mText').dataset.prev = text; renderEditorHighlight();
      hideImportProgress(); toast('Texto lido da imagem. Confira os acordes e toque em Salvar.'); return;
    } catch (e) { erros.push('Imagem: ' + (e.message || 'não foi possível ler a imagem')); imgIdx.forEach(k => impSet(k, 'error')); }
  }
  hideImportProgress();
  if (importCancelled) { if (total) save(); refresh(); renderList(); toast('Importação cancelada. Os arquivos já processados foram mantidos.'); return; }
  if (total) save(); refresh(); renderList();
  if (erros.length) { showImportErrors('Não foi possível concluir a importação:\n\n' + erros.join('\n') + '\n\nVocê pode corrigir o arquivo e tentar novamente.'); if (!total && !dup) openModal(null); }
  else if (total || dup) toast(total + ' música(s) importada(s)' + (dup ? '; ' + dup + ' já existiam.' : '.'));
}
$('#btnAdd').onclick = () => openModal(null);
$('#btnAddTop').onclick = () => openModal(null);
$('#file').onchange = async e => {
  const fl = [...e.target.files]; e.target.value = ''; if (!fl.length) return;
  let needsChoice = true;
  if (fl.length === 1 && /\.json$/i.test(fl[0].name)) {
    try { const d = JSON.parse(await fl[0].text()); if (d && (d.k === 'lista' || (d.v === 2 && Array.isArray(d.lists)))) needsChoice = false; } catch (_) {}
  }
  let customMode = false;
  if (needsChoice) {
    const custom = await ask('Como deseja importar este arquivo?\n\nImportação automática: o Cifrador identifica as músicas quando possível.\nRevisar e dividir manualmente: você confere os títulos e indica onde cada cifra começa.', 'Importação automática', 'Revisar e dividir manualmente');
    if (custom === false) customMode = true; else if (custom !== true) return;
  }
  await importFiles(fl, customMode);
};
let pdfLoading = null;
function loadPdfJs() { // aceita os dois nomes de arquivo (pdf_min.js ou pdf.min.js), tudo do próprio site
  if (window.pdfjsLib) return Promise.resolve();
  const opts = [['pdf_min.js', 'pdf_worker_min.js'], ['pdf.min.js', 'pdf.worker.min.js']];
  const tryOne = i => new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = opts[i][0];
    s.onload = () => { if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = opts[i][1]; ok(); } else { s.remove(); no(); } };
    s.onerror = () => { s.remove(); no(); };
    document.head.appendChild(s);
  }).catch(() => i + 1 < opts.length ? tryOne(i + 1) : Promise.reject(new Error('Leitor de PDF não encontrado no site: envie pdf_min.js e pdf_worker_min.js.')));
  return pdfLoading || (pdfLoading = tryOne(0).catch(e => { pdfLoading = null; throw e; }));
}

/* ============ Enviar lista (link ou arquivo) ============ */
const toB64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function pipe(u8, T) { return new Uint8Array(await new Response(new Response(u8).body.pipeThrough(new T('deflate-raw'))).arrayBuffer()); }
async function pack(obj) { // 'z' = comprimido, 'j' = texto puro (navegadores sem compressão)
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') { try { return 'z' + toB64(await pipe(raw, CompressionStream)); } catch (e) {} }
  return 'j' + toB64(raw);
}
async function unpack(s) {
  const u = fromB64(s.slice(1));
  return JSON.parse(new TextDecoder().decode(s[0] === 'z' ? await pipe(u, DecompressionStream) : u));
}
function listPayload(L) { // leva texto, marcações, tom e tags exatamente como você vê
  const arr = []; let skipped = 0;
  for (const id of L.items) {
    const s = byId.get(id); if (!s) continue; if (!s.content.trim()) { skipped++; continue; }
    const g = s.ro ? (s.rtags || []) : tagsOf(id).map(t => t.name);
    arr.push({ t: s.title, x: s.content, c: s.chordLines && s.chordLines.length ? s.chordLines : undefined, r: U.tr[id] || undefined, g: g.length ? g : undefined, k: linksOf(id).length ? linksOf(id) : undefined });
  }
  return { obj: { k: 'lista', v: 2, n: L.name, s: L.sort, songs: arr }, skipped };
}
let shareObj = null;
async function openShare() {
  const L = listById(st.list); if (!L) return;
  const { obj, skipped } = listPayload(L); shareObj = obj;
  const link = location.href.split('#')[0] + '#l=' + await pack(obj), big = link.length > 8000;
  $('#shareLink').value = big ? '' : link;
  $('#shareInfo').textContent = obj.songs.length + ' música(s) em “' + L.name + '”, com texto, tom e tags como você vê.' + (skipped ? ' ' + skipped + ' em imagem ficam de fora.' : '') + (big ? ' O link ficaria grande demais: use “Baixar arquivo”.' : ' Quem abrir o link escolhe se quer receber.');
  ['#shCopy', '#shareLink'].forEach(i => $(i).classList.toggle('hidden', big));
  $('#share').classList.remove('hidden');
}
/* PDF de verdade, sem bibliotecas: Courier (mantém o alinhamento), cifras em azul e negrito, no tom visível */
const CP = { '–': 0x96, '—': 0x97, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '…': 0x85, '•': 0x95 };
const pdfStr = s => [...s].map(c => { const k = c.charCodeAt(0), ch = String.fromCharCode(k < 256 ? k : (CP[c] || 63)); return ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch; }).join('');
function songBlocks(s, W) {
  const n = U.tr[s.id] || 0, sv = st.chords; st.chords = true;
  const o = transposeText(s.content, n, s.chordLines || [], W); st.chords = sv;
  const un = x => x.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const bl = [{ t: 'title', s: s.title }]; if (o.key) bl.push({ t: 'sub', s: 'Tom: ' + o.key + (n ? ' (transposto)' : '') }); bl.push({ t: 'gap' });
  for (const l of o.html.split('\n')) { const m = l.match(/^<span class="chord">([^<]*)<\/span>$/); bl.push(m ? { t: 'chord', s: un(m[1]) } : { t: 'text', s: un(l) }); }
  return bl;
}
function buildPdf(songsBl) {
  const M = 42, PH = 842, st2 = { title: ['F2', 14, 18, '0 g'], sub: ['F1', 9, 12, '0.4 g'], gap: ['F1', 10, 6, '0 g'], chord: ['F2', 10, 12, '0 0.35 0.7 rg'], text: ['F1', 10, 12, '0 g'] };
  const pages = []; let cur = [], y = PH - M;
  for (const bl of songsBl) {
    if (cur.length) { pages.push(cur); cur = []; } y = PH - M;
    for (const b of bl) { const [f, sz, lh, col] = st2[b.t]; if (y - lh < M) { pages.push(cur); cur = []; y = PH - M; } y -= lh; if (b.t !== 'gap' && b.s) cur.push(col + ' BT /' + f + ' ' + sz + ' Tf ' + M + ' ' + y.toFixed(1) + ' Td (' + pdfStr(b.s) + ') Tj ET'); }
  }
  if (cur.length) pages.push(cur);
  let out = '%PDF-1.4\n'; const offs = [];
  const add = s => { offs.push(out.length); out += offs.length + ' 0 obj\n' + s + '\nendobj\n'; };
  add('<</Type/Catalog/Pages 2 0 R>>'); add('<</Type/Pages/Kids[' + pages.map((_, i) => (5 + 2 * i) + ' 0 R').join(' ') + ']/Count ' + pages.length + '>>');
  add('<</Type/Font/Subtype/Type1/BaseFont/Courier/Encoding/WinAnsiEncoding>>'); add('<</Type/Font/Subtype/Type1/BaseFont/Courier-Bold/Encoding/WinAnsiEncoding>>');
  pages.forEach((p, i) => { const s = p.join('\n'); add('<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ' + (6 + 2 * i) + ' 0 R>>'); add('<</Length ' + s.length + '>>\nstream\n' + s + '\nendstream'); });
  const xr = out.length;
  out += 'xref\n0 ' + (offs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<</Size ' + (offs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xr + '\n%%EOF';
  return new Uint8Array([...out].map(c => c.charCodeAt(0)));
}
$('#shPdf').onclick = () => {
  const L = listById(st.list); if (!L) return;
  const bls = L.items.map(id => byId.get(id)).filter(s => s && s.content.trim()).map(s => songBlocks(s, 84));
  if (!bls.length) return toast('Este repertório ainda não tem cifras.');
  download('repertorio-' + norm(L.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf', buildPdf(bls), 'application/pdf');
};
$('#lstShare').onclick = openShare;
$('#shClose').onclick = () => $('#share').classList.add('hidden');
$('#share').addEventListener('click', e => { if (e.target.id === 'share') $('#share').classList.add('hidden'); });
$('#shCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#shareLink').value); toast('Link copiado.'); }
  catch (e) { $('#shareLink').select(); toast('Selecionei o link: use Ctrl+C (ou copiar).'); }
};
$('#shFile').onclick = () => download('lista-' + norm(shareObj.n).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json', JSON.stringify(shareObj));
async function importV2(o) {
  const sg = (Array.isArray(o.songs) ? o.songs : []).filter(x => x && typeof x.t === 'string' && typeof x.x === 'string' && x.x.trim()).slice(0, 600);
  if (!sg.length) throw new Error('vazio');
  const base = String(o.n || 'Repertório recebido').slice(0, 40), ex = U.lists.find(l => l.recv && l.name === base);
  if (!await ask((ex ? 'Atualizar o repertório recebido “' : 'Receber o repertório “') + base + '” com ' + sg.length + ' música(s)?\n\nO seu catálogo não é alterado: o repertório fica numa área separada.', ex ? 'Atualizar' : 'Receber')) return false;
  let L = ex;
  if (L) { L.items.forEach(id => { delete U.rs[id]; delete U.tr[id]; delete U.lk[id]; }); L.items = []; }
  else { let name = base, k = 2; while (U.lists.some(l => l.name.toLowerCase() === name.toLowerCase())) name = base.slice(0, 34) + ' (' + k++ + ')'; L = { id: uid(), name, sort: o.s === 'added' ? 'added' : 'name', items: [], recv: true }; U.lists.push(L); }
  for (const x of sg) {
    const id = 'r-' + uid();
    U.rs[id] = { title: x.t.slice(0, 200), content: x.x, chordLines: Array.isArray(x.c) ? x.c.filter(Number.isInteger) : [], rtags: Array.isArray(x.g) ? x.g.filter(s => typeof s === 'string').map(s => s.slice(0, 20)).slice(0, 10) : [] };
    if (Number.isInteger(x.r) && x.r) U.tr[id] = x.r; setLinks(id, x.k); L.items.push(id);
  }
  save(); refresh(); st.list = L.id; renderList(); toast('Repertório “' + L.name + '” recebido: ' + sg.length + ' música(s).'); return true;
}
function saveRecvToMine(L) {
  let n = 0;
  for (const id of L.items) {
    const s = byId.get(id); if (!s || !s.ro) continue;
    const r = addMineOne({ title: s.title, content: s.content }); n++;
    if (r.isNew) { const m = U.mine.find(x => x.id === r.id); if (m) m.chordLines = [...s.chordLines]; }
    if (U.tr[id] && !U.tr[r.id]) U.tr[r.id] = U.tr[id];
    if (linksOf(id).length && !linksOf(r.id).length) setLinks(r.id, linksOf(id));
    const ids = new Set(U.st[r.id] || []);
    for (const nm of s.rtags) { let t = U.tags.find(x => x.name.toLowerCase() === nm.toLowerCase()); if (!t) { t = { id: uid(), name: nm }; U.tags.push(t); } ids.add(t.id); }
    if (ids.size) U.st[r.id] = [...ids];
  }
  save(); refresh(); renderList(); toast(n + ' música(s) salva(s) no seu catálogo.');
}
$('#lstSave').onclick = () => { const L = listById(st.list); if (L && L.recv) saveRecvToMine(L); };
async function importSharedList(o) {
  if (o && o.v === 2) return importV2(o);
  if (!o || o.k !== 'lista' || !Array.isArray(o.i) || o.i.length > 3000) throw new Error('Lista inválida');
  if (!catOk) { toast('O catálogo não carregou. Abra de novo com internet para importar a lista.'); return false; }
  const base = String(o.n || 'Lista importada').slice(0, 40);
  if (!await ask('Importar a lista “' + base + '” com ' + o.i.length + ' cifra(s)?\n\nEla entra como uma lista nova; o que você já tem não é alterado.', 'Importar')) return false;
  let name = base, k = 2; while (U.lists.some(l => l.name.toLowerCase() === name.toLowerCase())) name = base.slice(0, 35) + ' (' + k++ + ')';
  const L = { id: uid(), name, sort: o.s === 'added' ? 'added' : 'name', items: [] };
  const um = (Array.isArray(o.u) ? o.u : []).map(x => ({ title: String((x && x.t) || '').slice(0, 200), content: String((x && x.x) || '') }));
  let miss = 0, novas = 0;
  for (const it of o.i) {
    let id = null;
    if (typeof it === 'string') { if (catById.has(it)) { id = it; U.hidden = U.hidden.filter(h => h !== it); } else miss++; }
    else if (Number.isInteger(it) && um[it] && um[it].title && um[it].content.trim()) { const r = addMineOne(um[it]); id = r.id; if (r.isNew) novas++; }
    if (id && !L.items.includes(id)) L.items.push(id);
  }
  U.lists.push(L); save(); refresh(); st.list = L.id; renderList();
  toast('Lista “' + L.name + '” importada: ' + L.items.length + ' cifra(s)' + (novas ? ', ' + novas + ' nova(s) em “minhas”' : '') + (miss ? '; ' + miss + ' não existem neste site' : '') + '.');
  return true;
}
/* ============ Lembrar a cifra aberta (recarregar a página não volta para o início) ============ */
const OPENKEY = 'cifrador-aberta';
function rememberOpen() { // grava na URL (#c=...) qual cifra está aberta; sem criar passos no histórico do navegador
  try {
    const base = location.pathname + location.search;
    if (!st.cur) { if (location.hash.startsWith('#c=')) history.replaceState(null, '', base); sessionStorage.removeItem(OPENKEY); return; }
    const p = new URLSearchParams(); p.set('c', st.cur.id); if (st.list && st.list !== 'all') p.set('l', st.list); if (st.tag) p.set('t', st.tag);
    history.replaceState(null, '', base + '#' + p.toString());
  } catch (_) {}
}
function restoreOpen(h) { // reabre a cifra gravada na URL, na mesma lista e no mesmo ponto da rolagem
  const p = new URLSearchParams(h.slice(1)), id = p.get('c');
  if (!id || !byId.has(id)) { history.replaceState(null, '', location.pathname + location.search); return; }
  if (st.cur && st.cur.id === id) return;
  const L = p.get('l'), T = p.get('t');
  if (L && listById(L)) st.list = L;
  if (T && U.tags.some(t => t.id === T)) st.tag = T;
  let y = 0; try { const o = JSON.parse(sessionStorage.getItem(OPENKEY) || 'null'); if (o && o.id === id && Number.isFinite(o.y)) y = o.y; } catch (_) {}
  renderList(); openSong(id);
  if (!st.nav.includes(id)) { st.list = 'all'; st.tag = null; renderList(); openSong(id); } // a cifra não está mais nessa lista
  if (y > 0) requestAnimationFrame(() => { $('#viewer').scrollTop = y; });
}
let openSaveT = null;
$('#viewer').addEventListener('scroll', () => { clearTimeout(openSaveT); openSaveT = setTimeout(() => { try { if (st.cur) sessionStorage.setItem(OPENKEY, JSON.stringify({ id: st.cur.id, y: Math.round($('#viewer').scrollTop) })); } catch (_) {} }, 250); }, { passive: true });
async function checkHash() {
  const h = location.hash;
  if (h.startsWith('#c=')) { restoreOpen(h); return; }
  if (!h.startsWith('#l=')) return;
  const p = h.slice(3); history.replaceState(null, '', location.pathname + location.search);
  try { await importSharedList(await unpack(p)); } catch (e) { toast('Link inválido ou incompleto.'); }
}
window.addEventListener('hashchange', checkHash);

/* ============ Meus dados (backup, restaurar, proteger, apagar) ============ */
async function openData() {
  const nh = U.hidden.filter(id => catById.has(id)).length;
  let pst = ''; try { pst = navigator.storage && navigator.storage.persisted ? ((await navigator.storage.persisted()) ? ' · armazenamento protegido ✓' : ' · armazenamento não protegido') : ''; } catch (e) {}
  $('#dataInfo').textContent = (U.lists.length) + ' lista(s) · ' + U.mine.length + ' cifra(s) suas · ' + Object.keys(U.edits).length + ' editada(s) · ' + U.hidden.length + ' excluída(s)' + pst;
  $('#data').classList.remove('hidden');
}
$('#btnData').onclick = openData;
$('#dImportSongs').onclick = () => { $('#data').classList.add('hidden'); $('#btnAdd').click(); };
const dateStr = () => new Date().toISOString().slice(0, 10);
$('#dCatBackup').onclick = () => {
  const ok = new Set(), arr = []; let img = 0;
  for (const s of songs) { if (!s.content.trim()) { img++; continue; } ok.add(s.id); const g = tagsOf(s.id).map(t => t.name);
    arr.push({ id: s.id, title: s.title, content: s.content, chordLines: s.chordLines && s.chordLines.length ? s.chordLines : undefined, tr: U.tr[s.id] || undefined, tags: g.length ? g : undefined, lk: linksOf(s.id).length ? linksOf(s.id) : undefined }); }
  const lists = U.lists.filter(l => !l.recv).map(l => ({ name: l.name, sort: l.sort, items: l.items.filter(id => ok.has(id)) }));
  download('catalogo-' + dateStr() + '.json', JSON.stringify({ app: 'cifrador', v: 3, exportedAt: new Date().toISOString(), next: catNext, songs: arr, lists, lib: JSON.parse(JSON.stringify(U)) }));
  toast('Backup com ' + arr.length + ' cifra(s) e ' + lists.length + ' repertório(s)' + (img ? ' (' + img + ' em imagem ficaram de fora)' : '') + '.');
};
$('#dCatUp').onclick = () => { $('#data').classList.add('hidden'); $('#file').click(); };
$('#dCatDel').onclick = async () => {
  const n = songs.length; if (!n) return toast('Não há cifras para excluir.');
  if (!await ask('Excluir TODAS as ' + n + ' cifras?\n\nSão removidas todas as cifras (do catálogo, suas e recebidas), com o tom salvo e as tags aplicadas a elas. Seus repertórios continuam, mas vazios, e as tags criadas continuam disponíveis.\n\nUm backup será baixado antes, por segurança.', 'Continuar', 'Cancelar')) return;
  if (!await ask('Última confirmação: esta ação não pode ser desfeita. Excluir tudo agora?', 'Excluir tudo', 'Cancelar')) return;
  try { $('#dCatBackup').onclick(); } catch (_) {}
  U.mine = []; U.edits = {}; U.hidden = CAT.map(c => c.id); U.tr = {}; U.st = {}; U.lk = {}; U.rs = {};
  U.lists = U.lists.filter(l => !l.recv); U.lists.forEach(l => { l.items = []; l.order = []; });
  if (!save()) return;
  st.list = 'all'; st.tag = null; refresh(); renderList(); $('#data').classList.add('hidden'); toast(n + ' cifra(s) excluída(s). O backup foi baixado.');
};
async function importCatalog(d) {
  const sg = (Array.isArray(d.songs) ? d.songs : []).slice(0, LIM.imp).filter(x => x && typeof x === 'object' && typeof x.title === 'string' && typeof x.content === 'string' && x.content.trim()).map(x => ({ ...x, title: x.title.slice(0, LIM.title), content: x.content.slice(0, LIM.content) })), lists = (Array.isArray(d.lists) ? d.lists : []).slice(0, LIM.lists).filter(l => l && typeof l === 'object');
  if (!sg.length) return toast('Este arquivo não tem cifras.');
  if (!await ask('Catálogo com ' + sg.length + ' cifra(s)' + (lists.length ? ' e ' + lists.length + ' repertório(s)' : '') + '.\n\nMesclar com o seu catálogo atual? Cifras iguais não duplicam e nada seu é apagado.', 'Mesclar', 'Outras opções')) {
    if (!await ask('Substituir TODO o seu catálogo por este arquivo?' + (d.lib ? '\n\nA biblioteca volta exatamente como estava no backup (cifras, edições, exclusões, tons, tags e repertórios).' : '') + '\n\nSuas cifras, edições e exclusões atuais serão trocadas. Faça um backup antes.', 'Substituir', 'Cancelar')) return;
    if (d.lib && typeof d.lib === 'object') { U = cleanUser(d.lib); const dr = cleanUser.rep.dropped; if (catOk) reconcile(); if (!save()) return; st.list = 'all'; st.tag = null; refresh(); renderList(); return toast('Biblioteca restaurada.' + (dr ? ' ' + dr + ' item(ns) inválido(s) foram ignorados.' : '')); }
    U.mine = []; U.edits = {}; U.hidden = CAT.map(c => c.id); U.tr = {}; U.st = {}; U.lk = {}; U.lists = U.lists.filter(l => l.recv);
  }
  const map = new Map(); let n = 0;
  for (const x of sg) {
    const r = addMineOne({ title: x.title, content: x.content }); if (r.isNew) n++; if (x.id) map.set(x.id, r.id);
    const m = U.mine.find(q => q.id === r.id); if (m && Array.isArray(x.chordLines)) m.chordLines = x.chordLines.filter(Number.isInteger);
    if (Number.isInteger(x.tr) && x.tr) U.tr[r.id] = x.tr;
    if (!linksOf(r.id).length) setLinks(r.id, x.lk);
    const ids = new Set(U.st[r.id] || []);
    for (const nm of Array.isArray(x.tags) ? x.tags : []) { if (typeof nm !== 'string') continue; let t = U.tags.find(q => q.name.toLowerCase() === nm.toLowerCase()); if (!t) { t = { id: uid(), name: nm.slice(0, 20) }; U.tags.push(t); } ids.add(t.id); }
    if (ids.size) U.st[r.id] = [...ids];
  }
  for (const l of lists) { if (!l || typeof l.name !== 'string' || !Array.isArray(l.items)) continue;
    let L = U.lists.find(q => !q.recv && q.name.toLowerCase() === l.name.toLowerCase()); if (!L) { L = { id: uid(), name: l.name.slice(0, 40), sort: ['added', 'custom'].includes(l.sort) ? l.sort : 'name', items: [] }; U.lists.push(L); }
    for (const id of l.items) { const nid = map.get(id); if (nid && !L.items.includes(nid)) L.items.push(nid); } }
  if (!save()) return; refresh(); renderList(); toast(n + ' cifra(s) nova(s) no seu catálogo; ' + (sg.length - n) + ' já existiam.');
}
$('#dClose').onclick = () => $('#data').classList.add('hidden');
$('#data').addEventListener('click', e => { if (e.target.id === 'data') $('#data').classList.add('hidden'); });
async function restoreBackup(d) {
  if (!await ask('Restaurar este backup?\n\nIsto substitui as suas listas, cifras suas, edições e exclusões atuais.', 'Restaurar')) return;
  U = cleanUser(d); if (catOk) reconcile(); save(); refresh(); st.list = 'all'; renderList(); toast('Backup restaurado.');
}


/* ============ Cores da letra e das cifras ============ */
const COLOR_KEY = 'cifrador-colors-v1';
function applyColors(lyrics, chords) {
  const safe = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;
  lyrics = safe(lyrics, '#111827'); chords = safe(chords, '#0878c9');
  document.documentElement.style.setProperty('--lyrics-color', lyrics);
  document.documentElement.style.setProperty('--chord-color', chords);
  $('#lyricsColor').value = lyrics; $('#chordColor').value = chords;
}
try { const c = JSON.parse(localStorage.getItem(COLOR_KEY) || '{}'); applyColors(c.lyrics, c.chords); } catch (_) { applyColors('#111827', '#0878c9'); }
function saveColors() {
  const colors = { lyrics: $('#lyricsColor').value, chords: $('#chordColor').value };
  applyColors(colors.lyrics, colors.chords);
  try { localStorage.setItem(COLOR_KEY, JSON.stringify(colors)); } catch (_) {}
  if ($('#modal') && !$('#modal').classList.contains('hidden')) renderEditorHighlight();
}
$('#lyricsColor').addEventListener('input', saveColors);
$('#chordColor').addEventListener('input', saveColors);

/* ============ Tema ============ */
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('#btnTheme').textContent = dark ? '☀️' : '🌙';
  $('#vTheme').textContent = dark ? '☀️' : '🌙';
  let savedColors = false; try { savedColors = !!localStorage.getItem(COLOR_KEY); } catch (_) {}
  if (!savedColors) applyColors(dark ? '#f1f5f9' : '#111827', dark ? '#fbbf24' : '#0878c9');
}
function toggleTheme() { const dark = !document.documentElement.classList.contains('dark'); applyTheme(dark); try { localStorage.setItem(TKEY, dark ? 'dark' : 'light'); } catch (e) {} }
$('#btnTheme').onclick = toggleTheme;
$('#vTheme').onclick = toggleTheme;

function goBack() { // fecha o que estiver aberto; devolve false se não havia nada
  if (!$('#dlg').classList.contains('hidden')) { $('#dlgNo').click(); return true; }
  for (const [id, fn] of [['#pick', closePicker], ['#modal', closeModal], ['#share', () => $('#share').classList.add('hidden')], ['#data', () => $('#data').classList.add('hidden')]])
    if (!$(id).classList.contains('hidden')) { fn(); return true; }
  if (st.cur) { closeSong(); return true; }
  return false;
}
document.addEventListener('keydown', e => {
  if (keyCapture) { keyCapture(e); return; }
  if (e.key === 'Escape') { if (isFs()) { leaveFs(); return; } if (!$('#cpyDlg').classList.contains('hidden')) { $('#cpyDlg').querySelector('[data-dismiss]')?.click(); return; } if (goBack()) return; for (const id of ['#keys','#help','#tagm','#addm','#splitm']) { const el=$(id); if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return; } } document.querySelectorAll('.hpop').forEach(x=>x.classList.add('hidden')); $('#colorPop').classList.add('hidden'); return; }
  if (!st.cur || e.ctrlKey || e.metaKey || e.altKey) return;
  const ae = document.activeElement;
  if (anyModalOpen() || (ae && (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable))) return;
  const act = KEY_ACTIONS.map(a => a[0]).find(a => KEYS[a].includes(normKey(e.key))); if (!act) return;
  e.preventDefault(); if (ae && ae.tagName === 'BUTTON') ae.blur(); // o botão focado não pode "clicar" junto com a tecla
  if (e.repeat && (act === 'songPrev' || act === 'songNext')) return;
  runKeyAction(act);
});

/* ============ Página, teclas e pedal de página ============ */
const KEYSKEY = 'cifrador-teclas-v1';
const CHEV = { l: 'M15 5l-7 7 7 7', r: 'M9 5l7 7-7 7', u: 'M5 15l7-7 7 7', d: 'M5 9l7 7 7-7' }; // mesmo desenho de seta em todo o app
const chev = (k, s = 18) => '<svg class="ch" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + CHEV[k] + '"/></svg>';
const KEY_ACTIONS = [['songPrev', 'l', 'Cifra anterior'], ['pagePrev', 'u', 'Página anterior'], ['pageNext', 'd', 'Próxima página'], ['songNext', 'r', 'Próxima cifra']];
const KEYS_DEFAULT = () => ({ songPrev: ['ArrowLeft'], pagePrev: ['ArrowUp', 'PageUp'], pageNext: ['ArrowDown', 'PageDown'], songNext: ['ArrowRight'], autoNext: false });
const KEYS_RESERVED = ['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process', 'ContextMenu'];
let KEYS = KEYS_DEFAULT(), keyCapture = null, keyWaiting = null;
try {
  const k = JSON.parse(localStorage.getItem(KEYSKEY) || 'null');
  if (k && typeof k === 'object') { for (const [a] of KEY_ACTIONS) if (Array.isArray(k[a])) KEYS[a] = k[a].filter(x => typeof x === 'string' && x.length > 0 && x.length <= 24).slice(0, 6); KEYS.autoNext = k.autoNext === true; }
} catch (_) {}
const saveKeys = () => { try { localStorage.setItem(KEYSKEY, JSON.stringify(KEYS)); } catch (_) {} };
const normKey = k => k.length === 1 ? k.toLowerCase() : k;
const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Espaço', PageUp: 'Page Up', PageDown: 'Page Down', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End' };
const keyLabel = k => KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
const anyModalOpen = () => ['#modal', '#pick', '#dlg', '#share', '#data', '#help', '#keys', '#tagm', '#addm', '#splitm', '#cpyDlg', '#importError'].some(s => { const el = $(s); return el && !el.classList.contains('hidden'); });

function pageScroll(dir) { // rola uma "tela" por vez, como se o dedo tivesse arrastado
  if (!st.cur) return;
  const v = $('#viewer'), top = Math.max(0, $('#viewerHeader').getBoundingClientRect().bottom), bottom = $('#navBar').getBoundingClientRect().top;
  const area = Math.max(120, bottom - top), step = Math.round(area * 0.9);
  const endEl = st.img || !$('#songImg').classList.contains('hidden') ? $('#songImg') : $('#song');
  const toEnd = endEl.getBoundingClientRect().bottom - bottom; // quanto falta para o fim da cifra aparecer
  if (dir > 0 && toEnd <= 8) { // já está no fim
    const i = st.nav.indexOf(st.cur.id);
    if (KEYS.autoNext && i >= 0 && i < st.nav.length - 1) go(1); else toast('Fim da cifra');
    return;
  }
  if (dir < 0 && v.scrollTop <= 4) return;
  const delta = dir > 0 ? Math.min(step, toEnd) : -Math.min(step, v.scrollTop);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || st.scrollTimer; // com a rolagem automática ligada, move direto
  v.scrollTo({ top: v.scrollTop + delta, behavior: calm ? 'auto' : 'smooth' });
}
function runKeyAction(a) { if (a === 'songPrev') go(-1); else if (a === 'songNext') go(1); else if (a === 'pagePrev') pageScroll(-1); else if (a === 'pageNext') pageScroll(1); }
$('#pgPrev').onclick = () => pageScroll(-1);
$('#pgNext').onclick = () => pageScroll(1);

function renderKeys() {
  const row = ([a, ic, t]) => '<div class="keyrow"><div class="keyname">' + chev(ic) + ' ' + esc(t) + '</div><div class="keychips">' +
    KEYS[a].map((k, i) => '<span class="kchip">' + esc(keyLabel(k)) + '<button type="button" data-kdel="' + a + '" data-kidx="' + i + '" aria-label="Remover a tecla ' + esc(keyLabel(k)) + '" title="Remover">×</button></span>').join('') +
    '<button type="button" class="btn keyadd' + (keyWaiting === a ? ' btn-p' : '') + '" data-kadd="' + a + '">' + (keyWaiting === a ? 'Aperte a tecla…' : '＋ Tecla') + '</button></div></div>';
  $('#keysBody').innerHTML = (keyWaiting ? '<p class="keywait" role="status">Aperte agora a tecla (ou o botão do pedal). Esc cancela.</p>' : '') +
    '<p class="intro">Escolha quais teclas, ou botões de um pedal de página, fazem cada ação na tela da cifra. Cada ação pode ter várias teclas.</p>' +
    KEY_ACTIONS.map(row).join('') +
    '<label class="keyopt"><input type="checkbox" id="keyAuto"' + (KEYS.autoNext ? ' checked' : '') + '><span>No fim da cifra, a tecla de <b>Próxima página</b> abre a <b>próxima cifra</b><br><small style="opacity:.75">Ideal para pedal de um botão só.</small></span></label>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="keysReset">Restaurar padrão</button></div>' +
    '<p class="tip">As teclas valem na tela da cifra e ficam guardadas neste aparelho. Esc sempre volta e não pode ser trocada.</p>';
}
function startKeyCapture(a) {
  keyWaiting = a; renderKeys();
  keyCapture = e => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { endCapture(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return; // espera a tecla "de verdade"
    if (KEYS_RESERVED.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) { toast('Essa tecla não pode ser usada. Tente outra.'); return; }
    const k = normKey(e.key); let moved = null;
    for (const [x, , nome] of KEY_ACTIONS) if (KEYS[x].includes(k) && x !== a) { KEYS[x] = KEYS[x].filter(y => y !== k); moved = nome; }
    if (!KEYS[a].includes(k)) { if (KEYS[a].length >= 6) { toast('Máximo de 6 teclas por ação.'); endCapture(); return; } KEYS[a].push(k); }
    saveKeys(); endCapture(); toast('Tecla ' + keyLabel(k) + ' gravada' + (moved ? ' (tirei de “' + moved + '”)' : '') + '.');
  };
}
function endCapture() { keyCapture = null; keyWaiting = null; if (!$('#keys').classList.contains('hidden')) renderKeys(); }
function openKeys() { $('#keys').classList.remove('hidden'); renderKeys(); $('#keysBody').scrollTop = 0; $('#keysClose').focus({ preventScroll: true }); }
function closeKeys() { keyCapture = null; keyWaiting = null; $('#keys').classList.add('hidden'); }
$('#dKeys').onclick = () => { closeIfPhone(); openKeys(); };
$('#keysClose').onclick = closeKeys;
$('#keys').addEventListener('click', e => { if (e.target === $('#keys')) closeKeys(); });
$('#keysBody').addEventListener('click', e => {
  const add = e.target.closest('[data-kadd]'), del = e.target.closest('[data-kdel]');
  if (add) { if (keyWaiting === add.dataset.kadd) endCapture(); else startKeyCapture(add.dataset.kadd); }
  else if (del) { const a = del.dataset.kdel; KEYS[a].splice(Number(del.dataset.kidx), 1); saveKeys(); renderKeys(); }
  else if (e.target.closest('#keysReset')) { KEYS = KEYS_DEFAULT(); saveKeys(); keyCapture = null; keyWaiting = null; renderKeys(); toast('Teclas restauradas.'); }
});
$('#keysBody').addEventListener('change', e => { if (e.target.id === 'keyAuto') { KEYS.autoNext = e.target.checked; saveKeys(); } });

window.addEventListener('resize', () => { if (st.cur && !$('#viewer').classList.contains('hidden')) renderSong(); });
/* ============ Tom visível, copiar, PDF da cifra, adicionar várias, dividir ============ */
function toneText(s) { // texto da cifra já no tom em que você a vê
  const n = U.tr[s.id] || 0; if (!n) return s.content;
  const cl = s.chordLines || [], lines = s.content.split('\n'), flat = useFlat(findKey(s.content, cl), n);
  return lines.map((l, i) => (!cl.includes(-i - 1) && (cl.includes(i) || isChordLine(l))) ? transposeLine(l, n, flat) : l).join('\n');
}
function copyChoice(title) { return new Promise(res => { $('#cpyTitle').textContent = '“' + title + '”'; $('#cpyDlg').classList.remove('hidden'); const done = v => { $('#cpyDlg').classList.add('hidden'); $('#cpyDlg').removeEventListener('click', outside); document.removeEventListener('keydown', escKey); res(v); }; const outside=e=>{if(e.target===$('#cpyDlg'))done(null)}; const escKey=e=>{if(e.key==='Escape')done(null)}; $('#cpyDlg').addEventListener('click',outside); document.addEventListener('keydown',escKey); $('#cpyText').onclick = () => done('copy'); $('#cpyDup').onclick = () => done('dup'); }); }
const _openModal = openModal;
openModal = function (song) {
  _openModal(song); st.edTone = false; $('#mChooseFile').parentElement.classList.toggle('hidden', !!(song && !song.ro)); // ao editar não precisa escolher arquivo
  if (song && !song.ro && U.tr[song.id]) { $('#mText').value = toneText(song); $('#mText').dataset.prev = $('#mText').value; st.edTone = true; renderEditorHighlight(); }
  $('#mNote').textContent = 'Você está editando no tom que estava vendo. Ao salvar, este passa a ser o tom da cifra.'; $('#mNote').classList.toggle('hidden', !st.edTone);
};
$('#vPdf').onclick = () => { const s = st.cur; if (!s) return; download(norm(s.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf', buildPdf([songBlocks(s, 84)]), 'application/pdf'); };
$('#vCopy').onclick = async () => {
  const s = st.cur; if (!s) return;
  const choice = await copyChoice(s.title); if (choice === 'copy') {
    const txt = songBlocks(s, 80).filter(b => st.chords || b.t !== 'chord').map(b => b.s || '').join('\n').replace(/\n{3,}/g, '\n\n');
    try { await navigator.clipboard.writeText(txt); } catch (_) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast('Cifra copiada.');
  } else if (choice === 'dup') {
    const r = addMineOne({ title: s.title + ' (cópia)', content: toneText(s) }), m = U.mine.find(q => q.id === r.id);
    if (m && s.chordLines) m.chordLines = [...s.chordLines]; if (U.st[s.id]) U.st[r.id] = [...U.st[s.id]]; if (linksOf(s.id).length) setLinks(r.id, linksOf(s.id));
    save(); refresh(); renderList(); toast('Cópia criada no seu catálogo.');
  }
};
let addSel = new Set(), addL = null;
function renderAdd() {
  const q = norm($('#addQ').value.trim()), inL = new Set(addL.items);
  const arr = songs.filter(s => !inL.has(s.id) && (!q || (q[0] === '#' ? s.ng.includes(q.slice(1).trim()) : s.nt.includes(q) || s.nc.includes(q) || s.ng.includes(q)))).sort((a, b) => a.title.localeCompare(b.title, 'pt')).slice(0, 80);
  $('#addList').innerHTML = arr.length ? arr.map(s => '<button data-a="' + esc(s.id) + '" class="btn w-full !justify-between' + (addSel.has(s.id) ? ' btn-on' : '') + '"><span class="truncate text-left">' + esc(s.title) + '</span><span>' + (addSel.has(s.id) ? '✓' : '+') + '</span></button>').join('') : '<p class="text-sm opacity-70">Nada encontrado.</p>';
  $('#addOk').textContent = 'Adicionar' + (addSel.size ? ' (' + addSel.size + ')' : '');
}
$('#lstAddSongs').onclick = () => { const L = listById(st.list); if (!L || L.recv) return; addL = L; addSel = new Set(); $('#addQ').value = ''; renderAdd(); $('#addm').classList.remove('hidden'); };
$('#addQ').addEventListener('input', renderAdd);
$('#addList').onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; const id = b.dataset.a; addSel.has(id) ? addSel.delete(id) : addSel.add(id); const sc = $('#addList').scrollTop; renderAdd(); $('#addList').scrollTop = sc; };
$('#addCancel').onclick = () => $('#addm').classList.add('hidden');
$('#addOk').onclick = () => { if (!addSel.size) return toast('Selecione ao menos uma cifra.'); addSel.forEach(id => { if (!addL.items.includes(id)) addL.items.push(id); }); save(); $('#addm').classList.add('hidden'); renderList(); toast(addSel.size + ' cifra(s) adicionada(s) ao repertório.'); };
function fmtWrap(mark) { // envolve (ou desfaz) a formatação no trecho selecionado; linhas de acordes ficam intactas
  const ta = $('#mText'), a = ta.selectionStart, b = ta.selectionEnd; if (a === b) return toast('Selecione o trecho do texto que quer formatar.');
  const out = ta.value.slice(a, b).split('\n').map(l => {
    if (!l.trim() || isChordLine(l)) return l;
    const m = l.match(/^(\s*)([\s\S]*?)(\s*)$/), c = m[2], on = c.length > 2 * mark.length && c.startsWith(mark) && c.endsWith(mark);
    return m[1] + (on ? c.slice(mark.length, -mark.length) : mark + c + mark) + m[3];
  }).join('\n');
  ta.setRangeText(out, a, b, 'select'); ta.dispatchEvent(new Event('input')); ta.focus();
}
[['#mBold', '**'], ['#mItal', '__'], ['#mHigh', '==']].forEach(([id, mk]) => { $(id).addEventListener('pointerdown', e => e.preventDefault()); $(id).onclick = () => fmtWrap(mk); });
$('#mClr').addEventListener('pointerdown', e => e.preventDefault());
$('#mClr').onclick = () => { const ta = $('#mText'), a = ta.selectionStart, b = ta.selectionEnd; if (a === b) return toast('Selecione o trecho que quer limpar.'); ta.setRangeText(ta.value.slice(a, b).replace(/\*\*|__|==/g, ''), a, b, 'select'); ta.dispatchEvent(new Event('input')); ta.focus(); };
let spLines = [], spOrig = [], spMark = new Set(), spKind = new Map();
const looksTitle = (L, i) => {
  const t = L[i].trim(); if (!t || isChordLine(L[i]) || t.length > 70 || /[,:;]$/.test(t) || (i > 0 && L[i - 1].trim())) return false;
  const b = t.replace(/^\d{1,3}\s*[.\-–)]\s*/, ''); if (!(b === b.toUpperCase() || /^\d{1,3}\s*[.\-–)]/.test(t) || /^m[uú]sica\s*:/i.test(t))) return false;
  for (let k = i + 1, c = 0; k < L.length && c < 3; k++) if (L[k].trim()) { if (isChordLine(L[k])) return true; c++; } return false;
};
const spIdx = uid => spOrig.indexOf(uid); // posição atual da linha: o número de identificação (uid) nunca muda ao excluir
const spInfo = () => { $('#splitInfo').textContent = spMark.size + ' título(s) selecionado(s). Clique no botão de tipo para alternar entre 📝 Letra, 🎸 Cifra e 🏷️ Título; × exclui a linha.'; };
const spNome = uid => spMark.has(uid) ? 'Título' : (spKind.get(uid) || 'letter') === 'chord' ? 'Cifra' : 'Letra';
const spIcon = uid => spMark.has(uid) ? '🏷️' : (spKind.get(uid) || 'letter') === 'chord' ? '🎸' : '📝';
function spSetRow(row, uid) { // atualiza só o visual de UMA linha (o resto da lista não é tocado)
  const title = spMark.has(uid), chord = !title && (spKind.get(uid) || 'letter') === 'chord', i = spIdx(uid);
  row.style.background = title ? '#4338ca' : ''; row.style.color = title ? '#fff' : ''; row.style.fontWeight = title ? '700' : '';
  const tx = row.querySelector('[data-edit-line]'), tb = row.querySelector('[data-type-line]');
  if (tx) { tx.textContent = (title ? '✂ ' : '') + (spLines[i] || ' '); tx.style.color = chord ? 'var(--chord-color)' : ''; tx.style.fontWeight = title || chord ? '700' : ''; }
  if (tb) { tb.textContent = spIcon(uid); tb.title = 'Tipo atual: ' + spNome(uid) + ' — clique para alternar'; tb.setAttribute('aria-label', 'Tipo da linha: ' + spNome(uid).toLowerCase()); }
}
function renderSplit() {
  const cur = ($('#mTitle').value.trim() || 'Sem título');
  const iconBtn = uid => '<button type="button" data-type-line="' + uid + '" class="shrink-0 rounded-lg px-2 py-1 border border-current hover:bg-black/10" aria-label="Tipo da linha: ' + spNome(uid).toLowerCase() + '" title="Tipo atual: ' + spNome(uid) + ' — clique para alternar">' + spIcon(uid) + '</button>';
  $('#splitList').innerHTML = '<div class="px-2 py-2 font-bold border-b border-slate-200 dark:border-slate-800" style="background:#e0e7ff;color:#1e1b4b">📄 Cifra atual: ' + esc(cur) + ' <span style="font-weight:400">(selecione a linha inteira que inicia uma nova música)</span></div>' + spLines.map((l, i) => {
    const uid = spOrig[i], title = spMark.has(uid);
    return '<div data-s="' + uid + '" class="flex items-start gap-2 px-2 py-1 border-b border-slate-200 dark:border-slate-800 cursor-pointer" style="' + (title ? 'background:#4338ca;color:#fff;font-weight:700' : '') + '"><span contenteditable="true" spellcheck="false" data-edit-line="' + uid + '" class="flex-1 min-w-0 whitespace-pre-wrap break-words outline-none focus:ring-1 focus:ring-indigo-400 rounded" aria-label="Editar texto da linha"' + (!title && spKind.get(uid) === 'chord' ? ' style="color:var(--chord-color);font-weight:700"' : '') + '>' + (title ? '✂ ' : '') + esc(l || ' ') + '</span>' + iconBtn(uid) + '<button type="button" data-delete-line="' + uid + '" class="shrink-0 rounded-lg px-2 py-1 border border-current opacity-80 hover:opacity-100" aria-label="Excluir linha" title="Excluir esta linha">×</button></div>';
  }).join('');
  spInfo();
}
$('#mMulti').onclick = () => {
  spLines = $('#mText').value.split('\n'); spOrig = spLines.map((_, i) => i); spMark = new Set(); spKind = new Map();
  spLines.forEach((line, i) => { spKind.set(i, isChordLine(line) ? 'chord' : 'letter'); if (looksTitle(spLines, i)) spMark.add(i); });
  const first = spLines.findIndex(l => l.trim()); if ($('#mTitle').value.trim() && first >= 0) spMark.delete(first);
  renderSplit(); $('#splitm').classList.remove('hidden');
};
$('#splitList').addEventListener('input', e => {
  const editor = e.target.closest('[data-edit-line]'), row = e.target.closest('[data-s]'); if (!editor || !row) return;
  const uid = Number(row.dataset.s), i = spIdx(uid); if (i < 0) return;
  let t = editor.textContent.replace(/\u00a0/g, ' '); if (spMark.has(uid) && t.startsWith('✂ ')) t = t.slice(2);
  spLines[i] = t;
});
$('#splitList').addEventListener('keydown', e => {
  const editor = e.target.closest('[data-edit-line]'); if (!editor) return;
  if (e.key === 'Enter') { e.preventDefault(); editor.blur(); }
});
$('#splitList').onclick = e => {
  if (e.target.closest('[data-edit-line]')) { e.stopPropagation(); return; }
  const row = e.target.closest('[data-s]'); if (!row) return;
  const uid = Number(row.dataset.s);
  if (e.target.closest('[data-delete-line]')) { // exclui: só remove esta linha; as demais não são reprocessadas
    e.stopPropagation();
    const i = spIdx(uid); if (i < 0) return;
    spLines.splice(i, 1); spOrig.splice(i, 1); spMark.delete(uid); spKind.delete(uid);
    row.remove(); spInfo(); return;
  }
  if (e.target.closest('[data-type-line]')) { // alterna Letra → Cifra → Título
    e.stopPropagation();
    const cur = spMark.has(uid) ? 'title' : (spKind.get(uid) || 'letter');
    if (cur === 'letter') { spKind.set(uid, 'chord'); spMark.delete(uid); }
    else if (cur === 'chord') { spKind.set(uid, 'letter'); spMark.add(uid); }
    else { spMark.delete(uid); spKind.set(uid, 'letter'); }
    spSetRow(row, uid); spInfo();
  }
};
$('#splitCancel').onclick = () => $('#splitm').classList.add('hidden');
$('#splitOk').onclick = () => {
  const m = [...spMark].map(spIdx).filter(i => i >= 0).sort((a, b) => a - b); if (!m.length) return toast('Marque ao menos uma linha de título.');
  const cl = st.chordLines, segs = [];
  if (m[0] > 0 && spLines.slice(0, m[0]).some(l => l.trim())) segs.push({ t: null, a: 0, b: m[0] });
  m.forEach((s, k) => segs.push({ t: s, a: s + 1, b: k + 1 < m.length ? m[k + 1] : spLines.length }));
  const part = sg => { let a = sg.a, b = sg.b; while (a < b && !spLines[a].trim()) a++; while (b > a && !spLines[b - 1].trim()) b--;
    return { content: spLines.slice(a, b).join('\n'), marks: spLines.slice(a, b).map((line, offset) => { const i = a + offset, kind = spKind.get(spOrig[i]) || 'letter'; return kind === 'chord' ? offset : -(offset + 1); }) }; };
  const titleOf = s => cleanTitle(spLines[s].trim().replace(/^\d{1,3}\s*[.\-–)]\s*/, '').replace(/^m[uú]sica\s*:\s*/i, '').replace(/\.+$/, '')).slice(0, 120);
  const p0 = part(segs[0]); if (segs[0].t !== null) $('#mTitle').value = titleOf(segs[0].t);
  $('#mText').value = p0.content; $('#mText').dataset.prev = p0.content; st.chordLines = p0.marks;
  let n = 0;
  for (const sg of segs.slice(1)) { const p = part(sg); if (!p.content.trim()) continue;
    const r = addMineOne({ title: titleOf(sg.t), content: p.content }); n++; const mm = U.mine.find(q => q.id === r.id); if (mm) mm.chordLines = p.marks; if (st.edTags.length) U.st[r.id] = [...st.edTags]; }
  save(); refresh(); renderList(); renderEditorHighlight(); $('#splitm').classList.add('hidden');
  toast((n ? n + ' cifra(s) nova(s) criada(s). ' : '') + 'A primeira está no editor: revise e toque em Salvar.');
};
/* ============ OCR: lê texto de imagens, 100% no aparelho (pasta ocr/) ============ */
let ocrWorker = null, ocrLoading = null;
// Interrompe imediatamente o reconhecimento em andamento quando o usuário cancela a importação.
function abortOcrForImport() {
  const w = ocrWorker;
  ocrWorker = null;
  ocrLoading = null;
  if (w && typeof w.terminate === 'function') { try { Promise.resolve(w.terminate()).catch(() => {}); } catch (_) {} }
}
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { console.warn('Arquivo não encontrado no site: ' + src); no(new Error('A leitura de imagens não está disponível agora. Tente novamente mais tarde.')); }; document.head.appendChild(s); });
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  if (!ocrLoading) ocrLoading = (async () => {
    await loadScript('ocr/tesseract.min.js'); await loadScript('ocr/por.js');
    const bin = Uint8Array.from(atob(self.OCR_POR), c => c.charCodeAt(0)); self.OCR_POR = null;
    const url = URL.createObjectURL(new Blob([bin])), abs = p => new URL(p, location.href).href;
    const w = await Tesseract.createWorker('por', 1, { workerPath: abs('ocr/worker.min.js'), corePath: abs('ocr'), langPath: url + '#', cacheMethod: 'none' });
    await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
    return w;
  })();
  try { ocrWorker = await ocrLoading; } catch (e) { ocrLoading = null; throw e; }
  return ocrWorker;
}
function ocrToText(data) { // reconstrói o alinhamento (acorde sobre a letra) pela posição de cada palavra
  const junk = t => { const s = t.replace(/\s/g, ''); const alnum = (s.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length; return s.length > 0 && (alnum < 1 || (s.length >= 3 && alnum / s.length < 0.4)); };
  const lines = (data.lines || []).filter(l => l.text.trim() && l.words.length && !junk(l.text)), cws = [];
  lines.forEach(l => l.words.forEach(w => { const t = w.text.trim(); if (t.length >= 4 && w.confidence > 60) cws.push((w.bbox.x1 - w.bbox.x0) / t.length); }));
  if (!lines.length) return '';
  cws.sort((a, b) => a - b); const cw = Math.max(3, cws.length ? cws[cws.length >> 1] : 8), minX = Math.min(...lines.map(l => l.bbox.x0));
  const hs = lines.map(l => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b), lh = hs[hs.length >> 1] || 20; let out = [], prev = null;
  for (const l of lines) {
    if (prev && l.bbox.y0 - prev.bbox.y1 > lh * 0.9) out.push('');
    let s = ''; for (const [wi, w] of l.words.entries()) { let t = w.text.trim(); if (wi === 0 && /^[A-G](?=[A-Z][a-zà-ú]{2,})/.test(t) && l.words.length > 2) t = t.slice(1); const col = Math.min(300, Math.max(0, Math.round((w.bbox.x0 - minX) / cw) || 0)); s = s.length >= col ? s + (s ? ' ' : '') + t : s + ' '.repeat(col - s.length) + t; }
    out.push(s); prev = l;
  }
  return out.join('\n');
}
const OCRCFG = { prep: 'stretch', S: 4, pad: 8 };
const OCRFIX = t => t.replace(/^\[o?$/, 'C').replace(/^([A-G])\1$/i, '$1').replace(/^([A-G])[Il|](?=\/|\d|$|\))/, '$1b').replace(/\?/g, '').replace(/^([A-G][#b]?)rn/, '$1m').replace(/[‘’´`]/g, '');
function fixTok(t) { // conserta confusões comuns do OCR num acorde: "#" lido como i/t/k/l/1, dois acordes colados (curto e sem recursão)
  if (t.length > 10 || chordTok(t)) return t;
  const x = t.replace(/^([A-G])[itkljI1|!]{1,3}(?=m|7|\/|\d|$)/, '$1#').replace(/\/([A-G])[itkljI1|!]{1,3}$/, '/$1#');
  if (chordTok(x)) return x;
  for (let i = 1; i < x.length; i++) { const p = x.slice(0, i), q = x.slice(i); if (chordTok(p) && chordTok(q)) return p + ' ' + q; }
  return t;
}
const lev = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
const CHORDISH = l => { const t = l.trim().split(/\s+/).filter(Boolean); // linha que PARECE de acordes, mesmo com erros de leitura
  return t.length > 0 && t.length <= 12 && (t.length > 1 || !!chordTok(t[0])) && t.every(x => x.length <= 8 && (!/[^\x00-\x7F]/.test(x) || x.length <= 5) && !/[a-z]{5,}/.test(x.replace(/sus|maj|dim|add/g, ''))) && t.filter(x => /^[A-G\[\(|!]/.test(x)).length >= Math.ceil(t.length * 0.6); };
function rebuildLine(l, fn) { let out = '', m; const re = /\S+/g; while ((m = re.exec(l))) { const t = fn(m[0]); out = out.length < m.index ? out.padEnd(m.index, ' ') + t : (out ? out + ' ' : '') + t; } return out; }
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOfChord = t => { const m = String(t).match(/^([A-G])([#b]?)/); return m ? (NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : null; };
function sharpRepair(lines) { // se (quase) todos os acordes cabem num tom, acorde fora do tom que vira acorde do tom ao ganhar "#" é um "#" perdido pelo OCR
  const toks = []; lines.forEach(l => { if (CHORDISH(l)) l.trim().split(/\s+/).forEach(t => { if (chordTok(t)) toks.push(t); }); });
  if (toks.length < 6) return lines;
  const MAJ = [0, 5, 7], MIN = [2, 4, 9], SCALE = [0, 2, 4, 5, 7, 9, 11], minor = t => /^[A-G][#b]?m(?!aj)/.test(t), main = t => t.split('/')[0];
  const ok = (t, k) => { const r = pcOfChord(main(t)); if (r == null) return false; const d = (r - k + 12) % 12; return minor(main(t)) ? MIN.includes(d) : MAJ.includes(d); };
  let best = -1, bs = 0; for (let k = 0; k < 12; k++) { const s = toks.filter(t => ok(t, k)).length; if (s > bs) { bs = s; best = k; } }
  if (best < 0 || bs / toks.length < 0.7) return lines;
  const sharp = t => t.replace(/^([A-G])(?![#b])/, '$1#'), bassSharp = t => t.replace(/\/([A-G])(?![#b])/, '/$1#');
  return lines.map(l => !CHORDISH(l) ? l : rebuildLine(l, t => {
    if (!chordTok(t)) return t; let x = t;
    if (!ok(x, best) && ok(sharp(x), best)) x = sharp(x);
    const b = x.match(/\/([A-G][#b]?)/); if (b && !SCALE.includes((pcOfChord(b[1]) - best + 12) % 12) && SCALE.includes((pcOfChord(b[1] + '#') - best + 12) % 12)) x = bassSharp(x);
    return x; }));
}
function fixOcrChords(text) { // corrige acordes mal lidos; só mexe em linhas que acabam sendo de acordes (letras ficam intactas)
  const L = text.split('\n').map(l => { if (isChordLine(l)) return l; const f = rebuildLine(l, t => fixTok(OCRFIX(t))); return isChordLine(f) ? f : l; });
  const valid = l => { const t = l.trim().split(/\s+/).filter(Boolean); return t.length ? t.filter(x => chordTok(x)).length / t.length : 0; };
  const cand = L.map(l => CHORDISH(l) && valid(l) >= 0.5), freq = {};
  L.forEach((l, i) => { if (cand[i]) l.trim().split(/\s+/).forEach(t => { if (chordTok(t)) freq[t] = (freq[t] || 0) + 1; }); });
  const vocab = Object.keys(freq).sort((a, b) => freq[b] - freq[a]); if (!vocab.length) return sharpRepair(L).join('\n');
  const M = L.map((l, i) => !cand[i] ? l : rebuildLine(l, t => { // acorde isolado ainda errado: usa o mais parecido entre os acordes que a própria página usa
    if (!chordTok(t) && /[A-Ga-g]/.test(t)) { let best = null, bd = 9; for (const v of vocab) { const d = lev(t, v); if (d < bd) { bd = d; best = v; } } if (best && bd <= 2 && bd < t.length) return best; } return t; }));
  return sharpRepair(M).join('\n');
}
function mergePasses(fw, ws) { // fw = 1ª leitura (geral), ws = 2ª (só acordes): onde as duas leram o mesmo lugar e ambas são acordes válidos, vale a de maior confiança; palavras que só a 1ª achou são mantidas
  const cx = v => (v.bbox.x0 + v.bbox.x1) / 2, valid = v => !!chordTok(fixTok(OCRFIX(v.text))), used = new Set(), out = [];
  for (const v of ws) {
    const f = fw.find(q => !used.has(q) && Math.abs(cx(q) - cx(v)) < Math.max(12, q.bbox.x1 - q.bbox.x0));
    if (f) { used.add(f); out.push(valid(v) && valid(f) && f.confidence > v.confidence + 5 ? f : v); } else out.push(v);
  }
  for (const f of fw) if (!used.has(f) && f.text.trim() && valid(f) && !out.some(v => Math.abs(cx(v) - cx(f)) < Math.max(12, f.bbox.x1 - f.bbox.x0))) out.push(f);
  return out.sort((a, b) => a.bbox.x0 - b.bbox.x0);
}
function prepCanvas(cv, mode) { // contraste: cinza + alongamento do histograma (fundo vira branco, letras ficam pretas)
  if (mode === 'none') return cv;
  const g = cv.getContext('2d'), im = g.getImageData(0, 0, cv.width, cv.height), d = im.data, n = cv.width * cv.height, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const y = (d[i * 4] * 77 + d[i * 4 + 1] * 151 + d[i * 4 + 2] * 28) >> 8; d[i * 4] = y; hist[y]++; }
  let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += hist[lo]; if (acc >= n * 0.01) break; } acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc >= n * 0.01) break; }
  if (hi - lo < 30) return cv; const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) { let y = Math.max(0, Math.min(255, (d[i * 4] - lo) * k)); if (mode === 'bin') y = y > 150 ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = y; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return cv;
}
async function ocrRead(src) { // src: arquivo de imagem ou canvas
  if (importCancelled) throw new Error('Importação cancelada.');
  let cv = src;
  if (!(src instanceof HTMLCanvasElement)) { const bmp = await createImageBitmap(src), k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height)); cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); }
  prepCanvas(cv, OCRCFG.prep);
  const w = await getOcr();
  if (importCancelled) throw new Error('Importação cancelada.');
  const r = await w.recognize(cv, {}, { blocks: true }), S = OCRCFG.S, pad = OCRCFG.pad;
  // 2ª leitura só das linhas que parecem de acordes, com alfabeto restrito; só é aceita se o resultado realmente forem acordes
  await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGabdijmsu#/0123456789+°()- ', tessedit_pageseg_mode: '7' });
  try {
    for (const l of r.data.lines) {
      if (!l.words.length || !CHORDISH(l.text)) continue;
      const x0 = Math.max(0, l.bbox.x0 - pad), y0 = Math.max(0, l.bbox.y0 - pad), cw = Math.min(cv.width - x0, l.bbox.x1 - l.bbox.x0 + 2 * pad), ch = Math.min(cv.height - y0, l.bbox.y1 - l.bbox.y0 + 2 * pad);
      const c2 = document.createElement('canvas'); c2.width = cw * S; c2.height = ch * S; const g = c2.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c2.width, c2.height); g.imageSmoothingQuality = 'high'; g.drawImage(cv, x0, y0, cw, ch, 0, 0, c2.width, c2.height);
      if (importCancelled) throw new Error('Importação cancelada.');
      const rr = await w.recognize(c2, {}, { blocks: true }), ws = [];
      rr.data.lines.forEach(q => q.words.forEach(v => { if (v.text.trim()) ws.push({ text: v.text, confidence: v.confidence, bbox: { x0: x0 + v.bbox.x0 / S, x1: x0 + v.bbox.x1 / S, y0: y0 + v.bbox.y0 / S, y1: y0 + v.bbox.y1 / S } }); }));
      const mw = mergePasses(l.words, ws), fixed = mw.map(v => fixTok(OCRFIX(v.text))).join(' ');
      if (mw.length && isChordLine(fixed)) { l.words = mw; l.text = mw.map(v => v.text).join(' '); }
    }
  } finally { await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' }); }
  return fixOcrChords(ocrToText(r.data));
}
/* ============ Menu lateral, janelinhas e voltar ao topo ============ */
const wide = () => matchMedia('(min-width: 1024px)').matches;
function setMenu(open, persist = true) {
  if (wide()) { document.body.classList.toggle('dock-open', open); $('#drawer').classList.remove('open'); $('#drawerBg').classList.add('hidden'); }
  else { document.body.classList.remove('dock-open'); $('#drawer').classList.toggle('open', open); $('#drawerBg').classList.toggle('hidden', !open); }
  $('#btnMenu').setAttribute('aria-expanded', String(open)); $('#drawer').setAttribute('aria-hidden', String(!open));
  if (persist && wide()) { try { localStorage.setItem('cifrador-menu', open ? '1' : '0'); } catch (_) {} }
}
const menuOpen = () => wide() ? document.body.classList.contains('dock-open') : $('#drawer').classList.contains('open');
function initMenu() { let p = null; try { p = localStorage.getItem('cifrador-menu'); } catch (_) {} setMenu(wide() ? p !== '0' : false, false); }
let wasWide = wide(); addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); initMenu(); } });
$('#btnMenu').onclick = () => setMenu(!menuOpen()); $('#drawerBg').onclick = $('#drawerClose').onclick = () => setMenu(false);
document.addEventListener('click', e => { if (menuOpen() && !e.target.closest('#drawer, #btnMenu, #help, #keys')) setMenu(false); });
const closeIfPhone = () => { if (!wide()) setMenu(false); };
function goHome() { st.list = 'all'; st.tag = null; st.q = ''; $('#search').value = ''; renderList(); scrollTo({ top: 0 }); closeIfPhone(); }
$('#dHome').onclick = goHome;
$('#dTags').onclick = () => { closeIfPhone(); $('#btnTags').click(); };
$('#dMenuAddSong').onclick = () => { closeIfPhone(); $('#dImportSongs').click(); };
function openHelp() { const m = $('#help'); m.classList.remove('hidden'); $('#helpBody').scrollTop = 0; $('#helpClose').focus({ preventScroll: true }); }
function closeHelp() { $('#help').classList.add('hidden'); }
$('#dHelp').onclick = () => { closeIfPhone(); openHelp(); };
$('#helpClose').onclick = closeHelp;
$('#help').addEventListener('click', e => { if (e.target === $('#help')) closeHelp(); });
$('#dMenuBackup').onclick = () => { closeIfPhone(); $('#dCatBackup').click(); };
$('#dMenuUpload').onclick = () => { closeIfPhone(); $('#dCatUp').click(); };
$('#dMenuDeleteAll').onclick = () => { closeIfPhone(); $('#dCatDel').click(); };
$('#dNewRep').onclick = e => { e.preventDefault(); e.stopPropagation(); closeIfPhone(); $('#btnCreateRep').click(); };
function renderDrawer() {
  const cnt = l => l.items.filter(id => byId.has(id)).length, SL = { name: 'Nome', added: 'Inclusão', custom: 'Customizada' };
  const row = (id, name, n, l) => '<div class="dRep" data-rep-row="' + esc(id) + '">' + (l ? '<button type="button" class="dIco repDrag" aria-label="Arrastar repertório" title="Arrastar para ordenar">☰</button>' : '') + '<button class="dName' + (st.list === id ? ' on' : '') + '" data-pick="' + esc(id) + '"><span class="truncate">' + (l && l.recv ? '📥 ' : '📁 ') + esc(name) + '</span><small>' + n + '</small></button>' +
    (l ? '<button type="button" class="dMore" data-rmore="' + esc(l.id) + '" aria-label="Opções do repertório" title="Opções do repertório">⋯</button><div class="dActs">' + [l.recv ? ['save', '⬇', 'Salvar no meu catálogo'] : ['add', '＋', 'Adicionar músicas'], ['ren', '✎', 'Renomear'], ['share', '🔗', 'Enviar'], ['del', '🗑', 'Excluir']]
      .map(([a, ic, t]) => '<button class="dIco" data-ra="' + a + '" data-id="' + esc(l.id) + '" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + ic + '</button>').join('') + '</div>' : '') + '</div>';
  $('#dReps').innerHTML = U.lists.map(l => row(l.id, l.name, cnt(l), l)).join('');
}

// Padroniza o fechamento das janelas com um X no canto superior direito.
(function installModalCloseIcons() {
  const modalIds = ['cpyDlg','dlg','pick','share','data','tagm','addm','splitm']; // o editor (modal) tem cabeçalho próprio
  for (const id of modalIds) {
    const outer = document.getElementById(id); if (!outer) continue;
    const panel = outer.children[0]; if (!panel) continue;
    const close = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fechar');
    if (!close) continue;
    panel.style.position = 'relative'; panel.style.paddingTop = '0';
    close.classList.add('hidden');
    const bar = document.createElement('div'); // barra fixa no topo do painel: o ✕ continua visível mesmo com o conteúdo rolado
    bar.style.cssText = 'position:sticky;top:0;z-index:5;display:flex;justify-content:flex-end;align-items:center;min-height:2.8rem;padding:0 12px;background-color:inherit;margin:0';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'btn';
    x.textContent = '✕'; x.setAttribute('aria-label', 'Fechar janela'); x.title = 'Fechar';
    x.style.cssText = 'min-width:44px;min-height:40px;font-weight:800;font-size:18px';
    x.addEventListener('click', () => close.click()); bar.appendChild(x); panel.insertBefore(bar, panel.firstChild);
  }
})();

$('#dReps').onclick = e => {
  const more = e.target.closest('[data-rmore]'); if (more) { const row = more.closest('.dRep'), was = row.classList.contains('menu-open'); document.querySelectorAll('#dReps .dRep.menu-open').forEach(x => x.classList.remove('menu-open')); if (!was) row.classList.add('menu-open'); return; }
  const p = e.target.closest('[data-pick]'), a = e.target.closest('[data-ra]');
  if (p) { st.list = p.dataset.pick; renderList(); scrollTo({ top: 0 }); closeIfPhone(); }
  else if (a) repAction(a);
};
function hoverPop(btnSel, popSel) { // mouse: abre ao passar; toque: abre/fecha ao tocar
  const b = $(btnSel), p = $(popSel); let t;
  const show = () => { clearTimeout(t); document.querySelectorAll('.hpop').forEach(x => { if (x !== p) x.classList.add('hidden'); }); $('#colorPop').classList.add('hidden'); p.classList.remove('hidden');
    const r = b.getBoundingClientRect(), pw = p.offsetWidth; p.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px'; p.style.top = (r.bottom + 6) + 'px'; };
  const hide = () => { t = setTimeout(() => p.classList.add('hidden'), 180); };
  if (matchMedia('(hover: hover)').matches) [b, p].forEach(el => { el.addEventListener('mouseenter', show); el.addEventListener('mouseleave', hide); });
  b.addEventListener('click', () => { if (!matchMedia('(hover: hover)').matches) (p.classList.contains('hidden') ? show() : p.classList.add('hidden')); });
}
hoverPop('#trBtn', '#popTone'); hoverPop('#fBtn', '#popFont'); hoverPop('#vOpts', '#popOpts');
$('#popOpts').addEventListener('click', e => { if (e.target.closest('button')) $('#popOpts').classList.add('hidden'); });
document.addEventListener('click', e => {
  if (!e.target.closest('.hpop, #trBtn, #fBtn, #vOpts')) document.querySelectorAll('.hpop').forEach(x => x.classList.add('hidden'));
  if (!e.target.closest('#list li')) document.querySelectorAll('#list li.open').forEach(x => x.classList.remove('open'));
  if (!e.target.closest('#chips')) document.querySelectorAll('#chips .dRep.menu-open').forEach(x => { x.classList.remove('menu-open'); x.querySelector('[data-hmore]')?.setAttribute('aria-expanded', 'false'); });
});
const _renderSong = renderSong; renderSong = function () { _renderSong.apply(this, arguments); $('#fontLbl').textContent = st.size; };
addEventListener('scroll', () => $('#toTop').classList.toggle('hidden', !$('#viewer').classList.contains('hidden') || scrollY < 500), { passive: true });
$('#toTop').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
$('#viewer').addEventListener('scroll', () => $('#vTop').classList.toggle('hidden', $('#viewer').scrollTop < 600), { passive: true });
$('#vTop').onclick = () => $('#viewer').scrollTo({ top: 0, behavior: 'smooth' });
initMenu();
/* ============ Tags ============ */
let tagCtx = null;
function openTags(ctx) { tagCtx = ctx || null; $('#tagHead').textContent = tagCtx ? 'Tags desta música' : 'Tags (toque para filtrar)'; renderTags(); $('#tagm').classList.remove('hidden'); }
function renderTags() {
  const on = tagCtx ? tagCtx.get() : [];
  $('#tagList').innerHTML = U.tags.length ? U.tags.map(t => '<div class="flex gap-2"><button data-tt="' + esc(t.id) + '" class="btn flex-1 !justify-between' + (on.includes(t.id) ? ' btn-on' : '') + '"><span class="truncate">' + esc(t.name) + '</span><span class="text-xs">' + (tagCtx ? (on.includes(t.id) ? '✓' : '+') : 'filtrar') + '</span></button><button data-te="' + esc(t.id) + '" class="btn" aria-label="Renomear tag">✎</button><button data-td="' + esc(t.id) + '" class="btn" aria-label="Excluir tag">🗑</button></div>').join('') : '<p class="text-sm opacity-70">Nenhuma tag ainda. Crie uma abaixo.</p>';
}
function closeTags() { $('#tagm').classList.add('hidden'); tagCtx = null; refresh(); renderList(); if (st.cur) renderSong(); }
function tagCreate() {
  const name = $('#tagNew').value.trim().slice(0, 20); if (!name) return toast('Digite o nome da tag.');
  let t = U.tags.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!t) { t = { id: uid(), name }; U.tags.push(t); save(); }
  if (tagCtx && !tagCtx.get().includes(t.id)) tagCtx.set([...tagCtx.get(), t.id]);
  $('#tagNew').value = ''; renderTags();
}
$('#tagAdd').onclick = tagCreate; $('#tagNew').onkeydown = e => { if (e.key === 'Enter') tagCreate(); };
$('#tagDone').onclick = closeTags; $('#tagm').addEventListener('click', e => { if (e.target.id === 'tagm') closeTags(); });
$('#tagList').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tt) {
    if (tagCtx) { const a = tagCtx.get(), id = b.dataset.tt; tagCtx.set(a.includes(id) ? a.filter(x => x !== id) : [...a, id]); renderTags(); }
    else { st.tag = b.dataset.tt; closeTags(); }
  } else if (b.dataset.te) {
    const t = tagById(b.dataset.te), n = await ask('Novo nome da tag:', 'Salvar', 'Cancelar', t.name);
    if (n && !U.tags.some(x => x.id !== t.id && x.name.toLowerCase() === n.toLowerCase())) { t.name = n.slice(0, 20); save(); renderTags(); } else if (n) toast('Já existe uma tag com esse nome.');
  } else if (b.dataset.td) {
    const t = tagById(b.dataset.td);
    if (!await ask('Excluir a tag "' + t.name + '"?\n\nEla sai de todas as músicas; as músicas continuam no catálogo.', 'Excluir')) return;
    U.tags = U.tags.filter(x => x.id !== t.id);
    for (const k of Object.keys(U.st)) { U.st[k] = U.st[k].filter(x => x !== t.id); if (!U.st[k].length) delete U.st[k]; }
    if (st.tag === t.id) st.tag = null; save(); renderTags();
  }
};
$('#btnTags').onclick = () => openTags(null);
$('#mTags').onclick = () => openTags({ get: () => st.edTags, set: a => { st.edTags = a; } });
$('#vTag').onclick = () => { const id = st.cur.id; openTags({ get: () => U.st[id] || [], set: a => { if (a.length) U.st[id] = a; else delete U.st[id]; save(); } }); };
let dragLi = null, dragRep = null;
$('#list').addEventListener('pointerdown', e => { const b = e.target.closest('.drag'); if (!b) return; dragLi = b.closest('li'); dragLi.classList.add('dragging'); b.setPointerCapture(e.pointerId); e.preventDefault(); });
$('#list').addEventListener('pointermove', e => {
  if (!dragLi) return;
  if (e.clientY < 90) scrollBy(0, -14); else if (e.clientY > innerHeight - 90) scrollBy(0, 14);
  for (const li of $('#list').children) { if (li === dragLi || !li.classList.contains('rowli')) continue; const r = li.getBoundingClientRect();
    if (e.clientY > r.top && e.clientY < r.bottom) { li.parentNode.insertBefore(dragLi, e.clientY < r.top + r.height / 2 ? li : li.nextSibling); break; } }
});
const endSongDrag = () => { if (!dragLi) return; dragLi.classList.remove('dragging'); dragLi = null; const L = listById(st.list);
  if (L) { const visibleIds = [...$('#list').querySelectorAll('[data-open]')].map(b => b.dataset.open); const rest = L.items.filter(id => !visibleIds.includes(id)); L.items = [...visibleIds, ...rest]; L.order = [...L.items]; L.sort = 'custom'; save(); renderList(); } };
$('#list').addEventListener('pointerup', endSongDrag); $('#list').addEventListener('pointercancel', endSongDrag);
$('#dReps').addEventListener('pointerdown', e => { const b = e.target.closest('.repDrag'); if (!b) return; dragRep = b.closest('.dRep'); dragRep.classList.add('dragging'); b.setPointerCapture(e.pointerId); e.preventDefault(); });
$('#dReps').addEventListener('pointermove', e => { if (!dragRep) return; for (const row of $('#dReps').children) { if (row === dragRep) continue; const r = row.getBoundingClientRect(); if (e.clientY > r.top && e.clientY < r.bottom) { row.parentNode.insertBefore(dragRep, e.clientY < r.top + r.height / 2 ? row : row.nextSibling); break; } } });
const endRepDrag = () => { if (!dragRep) return; dragRep.classList.remove('dragging'); dragRep = null; const ids = [...$('#dReps').querySelectorAll('[data-rep-row]')].map(x => x.dataset.repRow); const map = new Map(U.lists.map(l => [l.id,l])); U.lists = ids.map(id => map.get(id)).filter(Boolean); save(); renderList(); };
$('#dReps').addEventListener('pointerup', endRepDrag); $('#dReps').addEventListener('pointercancel', endRepDrag);

/* ============ Visualizador: cores, pinça e preferências ============ */
const UIKEY = 'cifrador-ui-v1';
try { const p = JSON.parse(localStorage.getItem(UIKEY) || '{}'); if (p.size >= 10 && p.size <= 48) st.size = p.size; st.twoColumns = !!p.twoColumns; if (p.chords === false) st.chords = false; } catch (_) {}
const saveUi = () => { try { localStorage.setItem(UIKEY, JSON.stringify({ size: st.size, twoColumns: st.twoColumns, chords: st.chords })); } catch (_) {} };
['#fUp', '#fDown', '#vChords', '#vColumns'].forEach(s => $(s).addEventListener('click', saveUi));
const cp = $('#colorPop'); let cpT;
const cpShow = () => { clearTimeout(cpT); const r = $('#vColors').getBoundingClientRect(); cp.style.top = (r.bottom + 4) + 'px'; cp.style.right = Math.max(8, innerWidth - r.right) + 'px'; cp.classList.remove('hidden'); };
const cpHide = () => { cpT = setTimeout(() => cp.classList.add('hidden'), 150); };
['#vColors', '#colorPop'].forEach(s => { $(s).addEventListener('mouseenter', cpShow); $(s).addEventListener('mouseleave', cpHide); });
$('#vColors').onclick = () => { if (!matchMedia('(hover: hover)').matches) cpShow(); }; // com mouse só o hover abre; no toque, um toque abre
document.addEventListener('click', e => { if (!e.target.closest('#colorPop, #vColors')) cp.classList.add('hidden'); });
let pz = null; const pd = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
$('#viewer').addEventListener('touchstart', e => { if (e.touches.length === 2) pz = { d: pd(e), s: st.size }; }, { passive: true });
$('#viewer').addEventListener('touchmove', e => {
  if (!pz || e.touches.length !== 2) return; e.preventDefault();
  const ns = Math.round(Math.max(10, Math.min(48, pz.s * pd(e) / pz.d))); if (ns !== st.size) { st.size = ns; renderSong(); }
}, { passive: false });
$('#viewer').addEventListener('touchend', e => { if (e.touches.length < 2 && pz) { pz = null; saveUi(); } });
(async function init() {
  if (window.prepareCifradorDemo) { try { await window.prepareCifradorDemo(); } catch (e) { console.error(e); } }
  let t = null; try { t = localStorage.getItem(TKEY); } catch (e) {}
  applyTheme(t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  await loadCatalog();
  loadUser(); if (window.CIFRADOR_DEMO) st.list = 'demo-repertorio'; rebuild(); renderList();
  if (!catOk) toast('Não consegui carregar o catálogo. Mostrando só as suas cifras.');
  else if (migInfo) toast('Seus dados foram atualizados' + (migInfo.kept ? ': ' + migInfo.kept + ' cifra(s) suas ficaram em “minhas”' : '') + (migInfo.edited ? ', ' + migInfo.edited + ' edição(ões) preservada(s)' : '') + '.');
  checkHash();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();


// Fechar janelas pelo fundo (mouse/toque), com o mesmo comportamento do botão Fechar.
['#modal','#cpyDlg','#pick','#share','#data','#tagm','#addm','#splitm'].forEach(sel=>{const el=$(sel); if(el) el.addEventListener('click',e=>{if(e.target!==el)return; if(sel==='#modal') closeModal(); else if(sel==='#cpyDlg') { /* copyChoice handles its own promise */ } else el.classList.add('hidden');});});
