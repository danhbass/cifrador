/* Modo demonstração: mesma aplicação, armazenamento separado por aba. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') !== '1') return;
  window.CIFRADOR_DEMO = true;
  const prefix = 'cifrador-demo:';
  const store = {
    getItem(k) { return sessionStorage.getItem(prefix + k); },
    setItem(k,v) { sessionStorage.setItem(prefix + k, String(v)); },
    removeItem(k) { sessionStorage.removeItem(prefix + k); },
    clear() { for (let i=sessionStorage.length-1;i>=0;i--) { const k=sessionStorage.key(i); if (k && k.startsWith(prefix)) sessionStorage.removeItem(k); } },
    key(i) { const keys=[]; for(let n=0;n<sessionStorage.length;n++){const k=sessionStorage.key(n);if(k&&k.startsWith(prefix))keys.push(k.slice(prefix.length));} return keys[i] ?? null; },
    get length() { let n=0; for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);if(k&&k.startsWith(prefix))n++;} return n; }
  };
  window.CIFRADORStorage = store;
  window.prepareCifradorDemo = async () => {
    if (store.getItem('cantos_user_v2')) return;
    const response = await fetch('demo-data.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('Não foi possível carregar os dados de demonstração.');
    const data = await response.json();
    const tags = [...new Set(data.songs.flatMap(s => s.tags || []))];
    const tagIds = Object.fromEntries(tags.map((name,i)=>[name,'demo-tag-'+i]));
    const mine = data.songs.map(s => ({id:'demo-'+s.id,title:s.name,content:s.lyrics,chordLines:[]}));
    const ids = data.songs.map(s=>'demo-'+s.id);
    const st = {};
    data.songs.forEach(s => { st['demo-'+s.id]=(s.tags||[]).map(t=>tagIds[t]); });
    const user = {
      v:2,
      lists:[{id:'demo-repertorio',name:'Repertório de demonstração',sort:'custom',order:data.initialRepertoire.map(id=>'demo-'+id),items:data.initialRepertoire.map(id=>'demo-'+id)}],
      mine, hidden:[], edits:{}, tr:{},
      tags:tags.map(name=>({id:tagIds[name],name})), st, rs:{}, lk:{}
    };
    store.setItem('cantos_user_v2', JSON.stringify(user));
    store.setItem('cifrador-demo-initialized','1');
  };
//  const addBanner = () => {
//  if (document.getElementById('demoModeBanner')) return;
//    const style=document.createElement('style');
//    style.textContent='#demoModeBanner{position:sticky;top:0;z-index:10000;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:8px 12px;background:#302b59;color:#f5f2ff;border-bottom:1px solid #7167c9;font:600 13px system-ui}#demoModeBanner a{color:#fff;text-decoration:underline}';
//    document.head.appendChild(style);
//    const bar=document.createElement('div');bar.id='demoModeBanner';bar.innerHTML='<span>Você está experimentando o Cifrador · Modo demonstração</span><a href="../">Voltar à apresentação</a>';
//    document.body.prepend(bar);
//  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',addBanner,{once:true}); else addBanner();
})();
