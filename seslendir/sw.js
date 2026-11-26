/* Seslendir: çevrimdışı açılış.
   Uygulama dosyaları ilk açılışta cihaza alınır. İnternet varken dosyaların
   güncel hali indirilir, yokken cihazdaki kopya kullanılır. Okunacak metin
   burada değil, tarayıcı deposunda durur.
   Dosyalarda değişiklik yapıldığında SURUM artırılmalıdır. */

const SURUM = 'seslendir-v3';

const DOSYALAR = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'fonts/hanken-grotesk-latin-400-normal.woff2',
  'fonts/hanken-grotesk-latin-500-normal.woff2',
  'fonts/hanken-grotesk-latin-600-normal.woff2',
  'fonts/hanken-grotesk-latin-ext-400-normal.woff2',
  'fonts/hanken-grotesk-latin-ext-500-normal.woff2',
  'fonts/hanken-grotesk-latin-ext-600-normal.woff2',
  'fonts/marcellus-latin-400-normal.woff2',
  'fonts/marcellus-latin-ext-400-normal.woff2',
];

const KAPSAM = new URL('./', self.location).pathname;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(adlar => Promise.all(adlar.filter(a => a.startsWith('seslendir-') && a !== SURUM).map(a => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

function sakla(istek, yanit) {
  if (yanit && yanit.ok && yanit.type === 'basic') {
    const kopya = yanit.clone();
    caches.open(SURUM).then(c => c.put(istek, kopya)).catch(() => {});
  }
  return yanit;
}

// Önce ağ; üç saniyede yanıt gelmezse ya da ağ yoksa cihazdaki kopya.
function agOnce(istek, yedek) {
  const kopya = () => caches.match(istek, { ignoreSearch: true }).then(y => y || (yedek ? caches.match(yedek) : undefined));
  return new Promise(coz => {
    let bitti = false;
    const sure = setTimeout(() => {
      kopya().then(y => { if (y && !bitti) { bitti = true; coz(y); } });
    }, 3000);
    fetch(istek).then(y => {
      clearTimeout(sure);
      sakla(istek, y);
      if (!bitti) { bitti = true; coz(y); }
    }).catch(() => {
      clearTimeout(sure);
      kopya().then(y => { if (!bitti) { bitti = true; coz(y || Response.error()); } });
    });
  });
}

function kopyaOnce(istek) {
  return caches.match(istek).then(y => y || fetch(istek).then(yanit => sakla(istek, yanit)));
}

self.addEventListener('fetch', e => {
  const istek = e.request;
  if (istek.method !== 'GET') return;
  const url = new URL(istek.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(KAPSAM)) return;
  if (istek.mode === 'navigate') { e.respondWith(agOnce(istek, './')); return; }
  if (/\.(woff2|png)$/.test(url.pathname)) { e.respondWith(kopyaOnce(istek)); return; }
  e.respondWith(agOnce(istek));
});
