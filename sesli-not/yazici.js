/* Sesli Not: yazıya dökme işçisi.
   Konuşmayı cihazın içinde metne çevirir; ses hiçbir yere gönderilmez.
   Yazıya dökme kitaplığı ve model dosyaları ilk kullanımda bir kez indirilir
   ve tarayıcının deposunda saklanır, sonraki kullanımlarda internet gerekmez.

   Ana sayfadan gelen iletiler:
     { tip: 'hazirla', model }             modeli indirir ve belleğe alır
     { tip: 'yaz', id, model, pcm }        pcm: 16 kHz tek kanal Int16 (ArrayBuffer)
     { tip: 'bosalt' }                     modeli bellekten atar
   Ana sayfaya giden iletiler:
     { tip: 'indirme', model, oran }       model indirme ilerlemesi (0-1)
     { tip: 'hazir', model }
     { tip: 'basladi', id, parca }         kaydın kaç parçada işleneceği
     { tip: 'ilerleme', id, oran, metin }  yazıya dökme ilerlemesi ve o ana kadarki metin
     { tip: 'bitti', id, metin }
     { tip: 'hata', id, asama, mesaj }     asama: 'model' ya da 'yazim' */

/* Yazıya dökme kitaplığı (Transformers.js, Apache 2.0 lisanslı) uygulamayla birlikte gelmez;
   ilk kullanımda jsDelivr adlı açık dağıtım ağından indirilir ve cihazda saklanır. İndirilen
   dosyanın özeti aşağıdaki değerle karşılaştırılır; tutmazsa dosya çalıştırılmaz. Böylece
   uygulama yalnızca denenmiş olan sürümle çalışır. Sürüm değişirse özet de değişmelidir;
   vendor klasöründeki ONNX Runtime dosyaları da kitaplığın o sürümüyle gelenler olmalıdır. */
const KITAPLIK_ADRES = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const KITAPLIK_OZET = '8b5a3171f8876bab2b1820a7d65eb87628e3d30bb5ea85b9dd398e76eb34decb'; // SHA-256
const KITAPLIK_DEPO = 'sesli-not-kitaplik';

const VENDOR = new URL('./vendor/', import.meta.url).href;

let kitaplik = null, kitaplikSoz = null;

async function ozetAl(tampon) {
  const o = new Uint8Array(await crypto.subtle.digest('SHA-256', tampon));
  let s = '';
  for (let i = 0; i < o.length; i++) s += o[i].toString(16).padStart(2, '0');
  return s;
}

async function kitaplikGetir() {
  let depo = null;
  try { depo = await caches.open(KITAPLIK_DEPO); } catch (e) { /* depo yoksa her seferinde indirilir */ }
  if (depo) {
    const y = await depo.match(KITAPLIK_ADRES);
    if (y) {
      const t = await y.arrayBuffer();
      if (await ozetAl(t) === KITAPLIK_OZET) return t;
      await depo.delete(KITAPLIK_ADRES);
    }
  }
  const y = await fetch(KITAPLIK_ADRES, { mode: 'cors', credentials: 'omit' });
  if (!y.ok) throw new Error('Yazıya dökme kitaplığı indirilemedi (' + y.status + ')');
  const t = await y.arrayBuffer();
  if (await ozetAl(t) !== KITAPLIK_OZET) throw new Error('Yazıya dökme kitaplığı doğrulanamadı');
  if (depo) {
    try {
      await depo.put(KITAPLIK_ADRES, new Response(t.slice(0), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } }));
      // Eski sürümden kalan kopya varsa silinir.
      for (const k of await depo.keys()) if (k.url !== KITAPLIK_ADRES) await depo.delete(k);
    } catch (e) { /* saklanamazsa bir sonraki açılışta yeniden indirilir */ }
  }
  return t;
}

async function kitaplikYukle() {
  if (kitaplik) return kitaplik;
  if (!kitaplikSoz) {
    kitaplikSoz = (async () => {
      const tampon = await kitaplikGetir();
      // Özeti doğrulanan baytların kendisi çalıştırılır.
      const adres = URL.createObjectURL(new Blob([tampon], { type: 'text/javascript' }));
      let m;
      try {
        m = await import(adres);
      } catch (e) {
        // Bu yolu desteklemeyen bir tarayıcıda dosya, az önce doğrulanan adresten doğrudan alınır.
        m = await import(KITAPLIK_ADRES);
      } finally {
        URL.revokeObjectURL(adres);
      }
      m.env.allowLocalModels = false;
      m.env.useBrowserCache = true;
      m.env.backends.onnx.wasm.wasmPaths = {
        mjs: VENDOR + 'ort-wasm-simd-threaded.mjs',
        wasm: VENDOR + 'ort-wasm-simd-threaded.wasm',
      };
      m.env.backends.onnx.wasm.numThreads = 1;
      kitaplik = m;
      return m;
    })();
    kitaplikSoz.then(() => {}, () => { kitaplikSoz = null; }); // başarısızsa yeniden denenebilsin
  }
  return kitaplikSoz;
}

// Sürümler sabitlenmiştir; kaynak depoda sonradan yapılacak bir değişiklik uygulamayı etkilemez.
// Sürüm, kitaplığın "revision" seçeneğiyle değil indirme adresinin kalıbıyla verilir: kitaplık
// bazı denetimlerinde o seçeneği dikkate almayıp ağa çıkıyor, bu da internetsiz kullanımı bozuyor.
const MODELLER = {
  dogru: { ad: 'onnx-community/whisper-small', surum: '36050c46d777d46dc4b5f43f6d90574fc38f8732', boyut: 252e6 },
  hizli: { ad: 'onnx-community/whisper-base', surum: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c', boyut: 80e6 },
};

const HIZ = 16000;
const CERCEVE = 320; // 20 ms

let hat = null, hatModel = '', yuklenen = null;

async function hazirla(kod) {
  const m = MODELLER[kod];
  if (!m) throw new Error('Bilinmeyen model: ' + kod);
  if (hat && hatModel === kod) return hat;
  if (yuklenen && yuklenen.kod === kod) return yuklenen.soz;
  if (yuklenen) { try { await yuklenen.soz; } catch (e) { /* önceki yükleme bitsin */ } }
  if (hat) { try { await hat.dispose(); } catch (e) { /* önemli değil */ } hat = null; hatModel = ''; }

  const inen = new Map();
  let sonIleti = 0;
  const ilerle = b => {
    if (!b || b.status !== 'progress' || !b.file) return;
    inen.set(b.file, b.loaded || 0);
    const simdi = Date.now();
    if (simdi - sonIleti < 120) return;
    sonIleti = simdi;
    let t = 0;
    for (const v of inen.values()) t += v;
    postMessage({ tip: 'indirme', model: kod, oran: Math.min(0.99, t / m.boyut) });
  };
  // Geçici bir ağ ya da sunucu arızasında indirme iki kez daha denenir; inen dosyalar
  // saklandığı için yeniden deneme kaldığı yerden sürer.
  const yukle = async () => {
    const BEKLEME = [3000, 8000];
    for (let deneme = 0; ; deneme++) {
      try {
        const { pipeline, env } = await kitaplikYukle();
        env.remotePathTemplate = '{model}/resolve/' + m.surum + '/';
        return await pipeline('automatic-speech-recognition', m.ad, { dtype: 'q8', device: 'wasm', progress_callback: ilerle });
      } catch (e) {
        const cevrimdisi = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (deneme >= BEKLEME.length || cevrimdisi) throw e;
        await new Promise(coz => setTimeout(coz, BEKLEME[deneme]));
      }
    }
  };
  const soz = yukle().then(p => {
    hat = p; hatModel = kod; yuklenen = null;
    postMessage({ tip: 'hazir', model: kod });
    return p;
  }, e => { yuklenen = null; throw e; });
  yuklenen = { kod, soz };
  return soz;
}

/* Kaydı en çok 28 saniyelik parçalara ayırır. Model 30 saniyelik pencerelerle
   çalıştığından uzun kayıt bölünmek zorundadır; kelime ortasından kesmemek için
   kesme yeri, konuşmadaki en sessiz ana denk getirilir. Baştaki ve sondaki
   sessizlik atılır; hiç konuşma yoksa boş liste döner. */
function bolumle(x) {
  const n = Math.floor(x.length / CERCEVE);
  if (n < 15) return [];
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let t = 0;
    const o = i * CERCEVE;
    for (let j = 0; j < CERCEVE; j++) { const v = x[o + j] / 32768; t += v * v; }
    e[i] = Math.sqrt(t / CERCEVE);
  }
  const sirali = Float32Array.from(e).sort();
  const taban = sirali[Math.floor(n * 0.1)];
  const tepe = sirali[Math.min(n - 1, Math.floor(n * 0.97))];
  // Eşik kaydın kendi düzeyine göre belirlenir; kısık sesle yapılan kayıt da konuşma sayılır.
  if (tepe < 0.0012) return [];
  const esik = Math.max(0.0008, Math.min(taban * 3 + tepe * 0.02, tepe * 0.3));

  let ilk = -1, son = -1, sesli = 0;
  for (let i = 0; i < n; i++) {
    if (e[i] > esik) { if (ilk < 0) ilk = i; son = i; sesli++; }
  }
  if (sesli < 10) return [];
  const bas = Math.max(0, ilk - 15);
  const bitis = Math.min(n, son + 25);

  const EN_UZUN = 1400, ARAMA_BAS = 750, YUMUSAT = 7; // 28 sn, 15 sn, +-140 ms
  const parcalar = [];
  let s = bas;
  while (bitis - s > EN_UZUN) {
    let enIyi = s + EN_UZUN, enAz = Infinity;
    for (let i = s + ARAMA_BAS; i <= s + EN_UZUN; i++) {
      let t = 0;
      for (let k = -YUMUSAT; k <= YUMUSAT; k++) t += e[Math.min(n - 1, Math.max(0, i + k))];
      if (t < enAz) { enAz = t; enIyi = i; }
    }
    parcalar.push([s, enIyi]);
    s = enIyi;
  }
  // Sonda bir saniyeden kısa bir artık kalırsa önceki parçaya eklenir.
  if (bitis - s < 50 && parcalar.length) parcalar[parcalar.length - 1][1] = bitis;
  else parcalar.push([s, bitis]);
  return parcalar.map(([a, b]) => [a * CERCEVE, Math.min(x.length, b * CERCEVE)]);
}

// Modelin sessiz ya da gürültülü yerlerde uydurduğu bilinen kalıplar.
const UYDURMA = /^(altyaz[ıi]\s*m\.?\s*k\.?|izlediğiniz için teşekkür(ler| ederim| ederiz)|bir sonraki videoda görüşmek üzere|abone olmayı unutmayın)[.!\s]*$/i;

function temizle(t) {
  let m = (t || '')
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .replace(/\((?:müzik|alkış|gülüşmeler|sessizlik)[^)]{0,20}\)/gi, ' ')
    .replace(/altyaz[ıi]\s*m\.\s*k\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (UYDURMA.test(m)) m = '';
  return m;
}

async function yaz(id, kod, tampon) {
  const p = await hazirla(kod);
  const x = new Int16Array(tampon);
  const parcalar = bolumle(x);
  postMessage({ tip: 'basladi', id, parca: parcalar.length });
  const metinler = [];
  for (let i = 0; i < parcalar.length; i++) {
    const [a, b] = parcalar[i];
    const f = new Float32Array(b - a);
    for (let j = 0; j < f.length; j++) f[j] = x[a + j] / 32768;
    const sonuc = await p(f, { language: 'turkish', task: 'transcribe' });
    const m = temizle(Array.isArray(sonuc) ? sonuc[0] && sonuc[0].text : sonuc && sonuc.text);
    if (m) metinler.push(m);
    postMessage({ tip: 'ilerleme', id, oran: (i + 1) / parcalar.length, metin: metinler.join(' ') });
  }
  return metinler.join(' ');
}

// İşler sırayla yürür; aynı anda iki kayıt işlenmez.
let sira = Promise.resolve();

self.onmessage = olay => {
  const d = olay.data || {};
  if (d.tip === 'hazirla') {
    sira = sira.then(() => hazirla(d.model)).then(() => {}, e => {
      postMessage({ tip: 'hata', id: null, asama: 'model', mesaj: String(e && e.message || e) });
    });
  } else if (d.tip === 'yaz') {
    sira = sira.then(async () => {
      let asama = 'model';
      try {
        await hazirla(d.model);
        asama = 'yazim';
        const metin = await yaz(d.id, d.model, d.pcm);
        postMessage({ tip: 'bitti', id: d.id, metin });
      } catch (e) {
        postMessage({ tip: 'hata', id: d.id, asama, mesaj: String(e && e.message || e) });
      }
    });
  } else if (d.tip === 'bosalt') {
    sira = sira.then(async () => {
      if (hat) { try { await hat.dispose(); } catch (e) { /* önemli değil */ } }
      hat = null; hatModel = '';
    });
  }
};

postMessage({ tip: 'acildi' });
