let installPrompt=null;
const $=s=>document.querySelector(s);
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const isStandalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;});
function showInstructions(){const box=$("#installInstructions");if(isStandalone){box.innerHTML="<p>O Cifrador já está instalado neste dispositivo.</p><a class='btn primary' href='app/'>Abrir aplicação</a>";}
else if(isIOS){box.innerHTML="<ol><li>Abra este endereço no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b>.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Confirme em <b>Adicionar</b>.</li></ol>";}
else if(installPrompt){box.innerHTML="<p>Seu navegador permite instalar o Cifrador como aplicativo.</p><p>Use o botão Instalar para abrir a confirmação nativa.</p>";}
else{box.innerHTML="<p>No Chrome/Edge, abra o menu do navegador e procure <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>. A opção pode variar conforme navegador e dispositivo.</p>";}
$("#installModal").classList.remove("hidden");}
async function install(){if(isStandalone){$("#installStatus").textContent="Aplicativo já instalado!";location.href="app/";return;}
if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
showInstructions();}
$("#installBtn").onclick=install;$("#installBtn2").onclick=showInstructions;$("#closeInstall").onclick=()=>$("#installModal").classList.add("hidden");
if(isStandalone){$("#installStatus").textContent="O Cifrador já está instalado neste dispositivo.";}
if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){navigator.serviceWorker.register("sw.js?v=1.0.1",{scope:"./"}).catch(()=>{});}
