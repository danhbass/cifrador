/* Cifrador PWA — cache isolado por versão e ativação sob consentimento.
   O parâmetro ?v= é definido pelo version.json somente após o usuário autorizar. */
const VERSION = new URL(self.location.href).searchParams.get('v') || '1.0.2';
const CACHE = 'cifrador-static-' + VERSION;
const CORE = [
  './', './index.html', './app/', './app/index.html', './demo/', './demo/index.html',
  './cifrador.js', './demo-mode.js', './demo-data.json', './update.js', './landing.js', './tailwind.css', './catalogo.json',
  './manifest.json', './version.json', './version-history.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './logo.png',
  './pdf_min.js', './pdf_worker_min.js',
  './ocr/por.js', './ocr/tesseract.min.js', './ocr/tesseract-core-lstm.wasm.js',
  './ocr/tesseract-core-simd-lstm.wasm.js', './ocr/worker.min.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll falha a instalação se algum recurso essencial não estiver disponível.
    await cache.addAll(CORE);
    // Não chamar skipWaiting aqui: o worker permanece em waiting até confirmação.
  })());
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'ACTIVATE_AFTER_USER_CONFIRMATION') {
    self.skipWaiting();
  }
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('cifrador-static-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of clients) client.postMessage({type:'CIFRADOR_UPDATED',version:VERSION});
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Version metadata must never be served from a stale cache.
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/version-history.json')) {
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(request,{cache:'no-cache'});
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const path=url.pathname;
        if (path.includes('/demo')) return (await caches.match('./demo/index.html')) || Response.error();
        if (path.includes('/app')) return (await caches.match('./app/index.html')) || Response.error();
        return (await caches.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
