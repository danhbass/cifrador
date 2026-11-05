/* Gerenciador de versões do Cifrador.
   A versão em meta[name=app-version] representa os arquivos efetivamente carregados.
   O version.json é consultado sem cache; a troca do SW só começa após ação explícita. */
(() => {
 'use strict';
 const meta=document.querySelector('meta[name="app-version"]');
 const installed=meta?.content||'1.0.0';
 const VERSION_URL=new URL('version.json',document.baseURI);
 const SW_URL=new URL('sw.js',document.baseURI);
 const SW_SCOPE=new URL('./',document.baseURI).pathname;
 const DISMISS_KEY='cifrador-update-dismissed';
 const $=(s,r=document)=>r.querySelector(s);
 let release=null, registration=null, promptShown=false;
 const semver=v=>String(v||'0').split('.').map(n=>parseInt(n,10)||0);
 const newer=(a,b)=>{const x=semver(a),y=semver(b);for(let i=0;i<3;i++){if((x[i]||0)>(y[i]||0))return true;if((x[i]||0)<(y[i]||0))return false;}return false;};
 async function latest(){const u=new URL(VERSION_URL);u.searchParams.set('_',Date.now());const r=await fetch(u,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error('Não foi possível consultar a versão publicada.');const d=await r.json();if(!d.version)throw Error('version.json sem número de versão.');return d;}
 function ensureUI(){if($('#cifradorUpdateUI'))return;const host=document.createElement('div');host.id='cifradorUpdateUI';host.innerHTML=`
 <style>
 #cfUpdateToast{position:fixed;z-index:9998;left:50%;bottom:18px;transform:translateX(-50%);width:min(560px,calc(100vw - 24px));background:#171c28;color:#f7f7fb;border:1px solid #424b63;border-radius:16px;padding:16px;box-shadow:0 12px 40px #0007;font:14px system-ui}
 #cfUpdateToast p{margin:5px 0 12px;color:#c3cada;line-height:1.45}#cfUpdateToast .cfBtns{display:flex;gap:8px;flex-wrap:wrap}
 #cfUpdateToast button{border:1px solid #56617b;border-radius:10px;padding:10px 13px;background:#252d40;color:#fff;font-weight:650;cursor:pointer}
 #cfUpdateToast .primary{background:#5145cd;border-color:#5145cd}
 #cfUpdateModal{position:fixed;inset:0;z-index:9999;background:#0009;display:grid;place-items:center;padding:18px;font:15px system-ui}
 #cfUpdateModal[hidden],#cfUpdateToast[hidden]{display:none}
 #cfUpdateModal .panel{width:min(520px,100%);max-height:85vh;overflow:auto;background:#171c28;color:#f7f7fb;border:1px solid #424b63;border-radius:18px;padding:22px}
 #cfUpdateModal li{margin:9px 0;color:#c3cada}#cfUpdateModal button{border:1px solid #56617b;border-radius:10px;padding:11px 14px;background:#252d40;color:white;font-weight:650;cursor:pointer;margin:8px 6px 0 0}#cfUpdateModal .primary{background:#5145cd}
 #cfUpdateProgress{height:5px;background:#343c50;border-radius:5px;overflow:hidden;margin-top:12px}#cfUpdateProgress>i{display:block;height:100%;width:0;background:#8b80ff;transition:width .2s}
 </style>
 <aside id="cfUpdateToast" hidden role="status"><b>Nova versão disponível!</b><p>Uma atualização do Cifrador está disponível. Você pode continuar utilizando a versão atual e atualizar quando desejar.</p><div class="cfBtns"><button id="cfWhatsNew">Ver novidades</button><button id="cfLater">Atualizar depois</button><button class="primary" id="cfNow">Atualizar agora</button></div></aside>
 <div id="cfUpdateModal" hidden role="dialog" aria-modal="true" aria-labelledby="cfUpdateTitle"><div class="panel"><h2 id="cfUpdateTitle">Nova versão</h2><p id="cfUpdateLead"></p><ul id="cfUpdateChanges"></ul><div id="cfUpdateProgress" hidden><i></i></div><p id="cfUpdateStatus" aria-live="polite"></p><button class="primary" id="cfModalNow">Atualizar agora</button><button id="cfModalLater">Mais tarde</button></div></div>`;
 document.body.appendChild(host);
 $('#cfWhatsNew').onclick=showNews;$('#cfLater').onclick=dismiss;$('#cfNow').onclick=updateNow;
 $('#cfModalNow').onclick=updateNow;$('#cfModalLater').onclick=()=>$('#cfUpdateModal').hidden=true;
 }
 function notify(){if(promptShown)return;const last=Number(localStorage.getItem(DISMISS_KEY)||0);if(Date.now()-last<12*60*60*1000)return;promptShown=true;$('#cfUpdateToast').hidden=false;}
 function dismiss(){localStorage.setItem(DISMISS_KEY,String(Date.now()));$('#cfUpdateToast').hidden=true;}
 function showNews(){if(!release)return;$('#cfUpdateTitle').textContent='Nova versão '+release.version;$('#cfUpdateLead').textContent=release.title||'Confira o que mudou:';$('#cfUpdateChanges').innerHTML=(release.changes||[]).map(x=>{const li=document.createElement('li');li.textContent=x;return li.outerHTML;}).join('');$('#cfUpdateToast').hidden=true;$('#cfUpdateModal').hidden=false;}
 function progress(msg,pct){$('#cfUpdateProgress').hidden=false;$('#cfUpdateProgress i').style.width=(pct||0)+'%';$('#cfUpdateStatus').textContent=msg;}
 async function updateNow(){
   if(!release)return;$('#cfUpdateToast').hidden=true;$('#cfUpdateModal').hidden=false;$('#cfUpdateTitle').textContent='Preparando atualização '+release.version;$('#cfUpdateLead').textContent='Aguarde enquanto verificamos e preparamos os arquivos.';$('#cfUpdateChanges').innerHTML='';$('#cfModalNow').disabled=true;$('#cfModalLater').disabled=true;
   try{
     if(!navigator.onLine)throw Error('Você está sem conexão. A versão atual continuará funcionando.');
     progress('Verificando os arquivos publicados…',10);
     const check=await fetch(new URL('app/index.html?check='+Date.now(),document.baseURI),{cache:'no-store'});
     if(!check.ok)throw Error('Os arquivos da nova versão ainda não estão disponíveis no servidor.');
     progress('Preparando o Service Worker…',30);
     const sw=new URL(SW_URL);sw.searchParams.set('v',release.version);
     registration=await navigator.serviceWorker.register(sw.href,{scope:SW_SCOPE,updateViaCache:'none'});
     await registration.update();
     const waitForWorker=async()=>{
       if(registration.waiting)return registration.waiting;
       return await new Promise((resolve,reject)=>{
         let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('Tempo esgotado aguardando a instalação.'));}},60000);
         const inspect=()=>{const w=registration.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&registration.waiting&&!done){done=true;clearTimeout(timer);resolve(registration.waiting);}if(w.state==='redundant'&&!done){done=true;clearTimeout(timer);reject(Error('O navegador não conseguiu instalar os arquivos novos.'));}});};
         registration.addEventListener('updatefound',inspect);inspect();
         if(registration.waiting&&!done){done=true;clearTimeout(timer);resolve(registration.waiting);}
       });
     };
     let worker=await waitForWorker();
     progress('Arquivos preparados. Aguardando ativação autorizada…',75);
     const onController=()=>{progress('Atualização ativada. Reabrindo a aplicação…',100);sessionStorage.setItem('cifrador-update-complete',release.version);location.reload();};
     navigator.serviceWorker.addEventListener('controllerchange',onController,{once:true});
     worker.postMessage({type:'ACTIVATE_AFTER_USER_CONFIRMATION'});
     setTimeout(()=>{if(navigator.serviceWorker.controller&&registration.active?.state==='activated'){sessionStorage.setItem('cifrador-update-complete',release.version);location.reload();}},1200);
   }catch(err){$('#cfUpdateStatus').textContent=err.message||'Não foi possível atualizar. Tente novamente mais tarde.';$('#cfModalNow').disabled=false;$('#cfModalLater').disabled=false;$('#cfUpdateProgress').hidden=true;}
 }
 async function init(){
   ensureUI();
   const done=sessionStorage.getItem('cifrador-update-complete');if(done){sessionStorage.removeItem('cifrador-update-complete');const n=document.createElement('div');n.textContent='Atualização concluída! Você está utilizando a versão '+done+'.';n.style.cssText='position:fixed;z-index:9999;bottom:18px;left:50%;transform:translateX(-50%);background:#171c28;color:white;padding:13px 17px;border:1px solid #53607a;border-radius:12px;box-shadow:0 8px 28px #0008;font:14px system-ui';document.body.appendChild(n);setTimeout(()=>n.remove(),5000);}
   const badge=document.createElement('small');badge.textContent='Versão '+installed;badge.style.cssText='display:block;text-align:center;opacity:.55;padding:8px;font:11px system-ui';document.body.appendChild(badge);
   if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol)){try{registration=await navigator.serviceWorker.register(new URL(SW_URL+'?v='+encodeURIComponent(installed)),{scope:SW_SCOPE,updateViaCache:'none'});}catch(e){console.warn('Service Worker:',e);}}
   const check=async()=>{if(!navigator.onLine)return;try{const v=await latest();if(newer(v.version,installed)){release=v;notify();}}catch(e){console.info('Verificação de versão indisponível:',e.message);}};
   await check();window.addEventListener('online',check);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});setInterval(check,30*60*1000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();