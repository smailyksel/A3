/* Belge Dönüştür: çevrimdışı çalışma.
   Uygulama dosyaları ilk açılışta cihaza alınır; dönüştürme kitaplıkları ve
   belge yazı tipleri de bunların içindedir, böylece internet yokken de
   dönüştürme yapılabilir. İnternet varken dosyaların güncel hali indirilir,
   yokken cihazdaki kopya kullanılır. Seçilen belgeler burada saklanmaz.
   Dosyalarda değişiklik yapıldığında SURUM artırılmalıdır. */

const SURUM = 'donustur-v1';

const DOSYALAR = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'motor/temel.js',
  'motor/udf.js',
  'motor/docx-oku.js',
  'motor/docx-yaz.js',
  'motor/pdf-yaz.js',
  'motor/pdf-oku.js',
  'motor/islem.js',
  'vendor/fflate.js',
  'vendor/pdf-lib.min.js',
  'vendor/fontkit.umd.min.js',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'yazitipi/serif-normal.ttf',
  'yazitipi/serif-kalin.ttf',
  'yazitipi/serif-italik.ttf',
  'yazitipi/serif-kalinitalik.ttf',
  'yazitipi/sans-normal.ttf',
  'yazitipi/sans-kalin.ttf',
  'yazitipi/sans-italik.ttf',
  'yazitipi/sans-kalinitalik.ttf',
  'yazitipi/yalin-normal.ttf',
  'yazitipi/yalin-kalin.ttf',
  'yazitipi/yalin-italik.ttf',
  'yazitipi/yalin-kalinitalik.ttf',
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
      .then(adlar => Promise.all(adlar.filter(a => a.startsWith('donustur-') && a !== SURUM).map(a => caches.delete(a))))
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
  // Kitaplıklar, yazı tipleri ve simgeler sürümle birlikte değişir; cihazdaki kopya yeterlidir.
  if (/\.(woff2|ttf|png)$/.test(url.pathname) || url.pathname.includes('/vendor/')) { e.respondWith(kopyaOnce(istek)); return; }
  e.respondWith(agOnce(istek));
});
