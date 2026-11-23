const CACHE_PREFIX='growth-command-shell:'+self.registration.scope+'v';
const CACHE=CACHE_PREFIX+'5';
const SHELL=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./oyo-logo.png','./icon-192.png','./icon-512.png','./ocr/tesseract.min.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==location.origin)return;
  event.respondWith(fetch(request).catch(async()=>await caches.match(request)||Response.error()));
});
