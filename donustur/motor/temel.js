/* Belge Dönüştür: ortak yardımcılar ve belge modeli.

   Bütün biçimler (Word, UDF, PDF, resim) önce tek bir ortak modele okunur,
   sonra istenen biçime o modelden yazılır. Uzunluk birimi her yerde puntodur.

   belge   = { sayfa: {en, boy, ust, alt, sol, sag, ustbilgi, altbilgi}, sekme,
               ustbilgi, altbilgi, ilkFarkli, ilkUstbilgi, ilkAltbilgi, bloklar }
   blok    = paragraf | tablo | { tur: 'kirma' }
   paragraf= { tur: 'p', hiza: 'sol'|'orta'|'sag'|'iki', sol, sag, ilk, once, sonra,
               aralik, sabit: {deger, enAz}, sekmeler: [{yer, tip}], sayfaOnce,
               cizgiUst, cizgiAlt, parcalar }
   parça   = { m: metin, k, i, a, u, ust, alt, boyut, yt, renk, zemin }
           | { resim: {veri, tip, pxEn, pxBoy}, en, boy }
           | { alan: 'sayfa'|'toplam', ...biçim }
   tablo   = { tur: 'tablo', sutunlar, kenarlik, hiza, satirlar: [{ hucreler:
               [{ bloklar, yatay, devam, zemin }] }] }

   Metin parçalarında sekme "\t", satır içi satır sonu "\n" olarak durur. */

(function (K) {
  'use strict';
  const BD = K.BD = K.BD || {};

  BD.A4 = { en: 595.28, boy: 841.89 };
  BD.YT = 'Times New Roman';

  BD.yeniSayfa = () => ({ en: BD.A4.en, boy: BD.A4.boy, ust: 70.87, alt: 70.87, sol: 70.87, sag: 70.87, ustbilgi: 35.4, altbilgi: 35.4 });
  BD.yeniBelge = () => ({ sayfa: BD.yeniSayfa(), sekme: 36, ustbilgi: null, altbilgi: null, bloklar: [] });
  BD.paragraf = (parcalar, ek) => Object.assign({ tur: 'p', hiza: 'sol', sol: 0, sag: 0, ilk: 0, once: 0, sonra: 0, aralik: 1, parcalar: parcalar || [] }, ek || {});

  BD.Hata = class extends Error {
    constructor(mesaj) { super(mesaj); this.name = 'BelgeHatasi'; this.kullaniciya = true; }
  };

  /* ---------- Kitaplıklar: ilk gerektiğinde yüklenir ---------- */

  const yuklenen = {};
  BD.kok = '';
  BD.betik = yol => yuklenen[yol] || (yuklenen[yol] = new Promise((coz, red) => {
    const s = document.createElement('script');
    s.src = BD.kok + yol;
    s.onload = () => coz();
    s.onerror = () => { delete yuklenen[yol]; s.remove(); red(new BD.Hata('Gerekli kitaplık yüklenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.')); };
    document.head.appendChild(s);
  }));
  BD.zip = () => BD.betik('vendor/fflate.js').then(() => K.fflate);
  BD.pdfLib = () => Promise.all([BD.betik('vendor/pdf-lib.min.js'), BD.betik('vendor/fontkit.umd.min.js')]).then(() => K.PDFLib);
  let pdfjsSoz = null;
  BD.pdfjs = () => pdfjsSoz || (pdfjsSoz = import(new URL(BD.kok + 'vendor/pdf.min.mjs', document.baseURI).href).then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL(BD.kok + 'vendor/pdf.worker.min.mjs', document.baseURI).href;
    return m;
  }).catch(e => { pdfjsSoz = null; throw new BD.Hata('PDF okuyucu yüklenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.'); }));

  /* ---------- XML ---------- */

  BD.xmlKacis = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // XML 1.0'ın kabul etmediği denetim karakterlerini ayıklar.
  BD.xmlTemiz = s => String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
  BD.xmlOku = metin => {
    let d = new DOMParser().parseFromString(metin, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) {
      d = new DOMParser().parseFromString(BD.xmlTemiz(metin), 'application/xml');
      if (d.getElementsByTagName('parsererror').length) throw new BD.Hata('Dosyanın içeriği okunamadı; dosya bozuk olabilir.');
    }
    return d;
  };
  // Doğrudan çocuklar; ad verilirse yalnızca o yerel addakiler.
  BD.cocuklar = (el, ad) => {
    const c = [];
    if (!el) return c;
    for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (!ad || n.localName === ad) c.push(n);
    return c;
  };
  BD.cocuk = (el, ad) => {
    if (!el) return null;
    for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (n.localName === ad) return n;
    return null;
  };
  // Ad alanı önekinden bağımsız nitelik okuma (w:val → val).
  BD.nit = (el, ad) => {
    if (!el) return null;
    const a = el.attributes;
    for (let i = 0; i < a.length; i++) if (a[i].localName === ad) return a[i].value;
    return null;
  };

  /* ---------- Bayt ve metin ---------- */

  BD.utf8 = s => new TextEncoder().encode(s);
  BD.utf8Coz = b => new TextDecoder('utf-8').decode(b);
  BD.b64 = bayt => {
    let s = '';
    for (let i = 0; i < bayt.length; i += 0x8000) s += String.fromCharCode.apply(null, bayt.subarray(i, i + 0x8000));
    return btoa(s);
  };
  BD.b64Coz = metin => {
    const s = atob(String(metin).replace(/\s+/g, ''));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };
  BD.oku = dosya => dosya.arrayBuffer().then(b => new Uint8Array(b));

  /* ---------- Dosya türü ---------- */

  const bas = (b, ...kod) => kod.every((k, i) => b[i] === k);
  BD.resimTipi = b => {
    if (!b || b.length < 12) return null;
    if (bas(b, 0xFF, 0xD8, 0xFF)) return 'jpeg';
    if (bas(b, 0x89, 0x50, 0x4E, 0x47)) return 'png';
    if (bas(b, 0x47, 0x49, 0x46, 0x38)) return 'gif';
    if (bas(b, 0x42, 0x4D)) return 'bmp';
    if (bas(b, 0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heic';
    if (bas(b, 0x49, 0x49, 0x2A, 0x00) || bas(b, 0x4D, 0x4D, 0x00, 0x2A)) return 'tiff';
    return null;
  };

  // 'docx' | 'udf' | 'pdf' | 'resim' | 'doc' | null
  BD.turBul = async (bayt, ad) => {
    const uz = (String(ad || '').match(/\.([a-z0-9]+)$/i) || [])[1];
    const uzanti = uz ? uz.toLowerCase() : '';
    for (let i = 0; i < Math.min(bayt.length - 4, 1024); i++) {
      if (bayt[i] === 0x25 && bayt[i + 1] === 0x50 && bayt[i + 2] === 0x44 && bayt[i + 3] === 0x46) return 'pdf';
    }
    if (bas(bayt, 0x50, 0x4B)) {
      const fflate = await BD.zip();
      let adlar = [];
      try { fflate.unzipSync(bayt, { filter: f => { adlar.push(f.name); return false; } }); } catch (e) { adlar = []; }
      if (adlar.some(a => a === 'word/document.xml')) return 'docx';
      if (adlar.some(a => /^content\.xml$/i.test(a)) && !adlar.includes('mimetype')) return 'udf';
      if (uzanti === 'udf') return 'udf';
      if (uzanti === 'docx') return 'docx';
      return null;
    }
    if (bas(bayt, 0xD0, 0xCF, 0x11, 0xE0)) return 'doc';
    const r = BD.resimTipi(bayt);
    if (r && r !== 'tiff') return 'resim';
    if (/^(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(uzanti)) return 'resim';
    return null;
  };

  BD.TUR_ADI = { docx: 'Word', udf: 'UDF', pdf: 'PDF', resim: 'Resim' };
  BD.UZANTI = { pdf: '.pdf', docx: '.docx', udf: '.udf', jpg: '.jpg', png: '.png' };
  BD.MIME = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    udf: 'application/octet-stream',
    jpg: 'image/jpeg', png: 'image/png', zip: 'application/zip',
  };
  BD.adDegistir = (ad, uzanti) => (String(ad || 'belge').replace(/\.[a-z0-9]{1,5}$/i, '') || 'belge') + uzanti;

  /* ---------- Resimler ---------- */

  // Tarayıcının çözebildiği her resmi tuvale çizer. Telefon fotoğraflarındaki
  // yön bilgisi bu sırada uygulanır; PDF kitaplığı bunu kendisi yapmaz.
  BD.resimCoz = async bayt => {
    const tip = BD.resimTipi(bayt);
    const blob = new Blob([bayt], { type: tip ? 'image/' + tip : 'application/octet-stream' });
    let kaynak = null;
    if (K.createImageBitmap) {
      try { kaynak = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
      catch (e) { try { kaynak = await createImageBitmap(blob); } catch (e2) { kaynak = null; } }
    }
    if (!kaynak) {
      const url = URL.createObjectURL(blob);
      try {
        kaynak = await new Promise((coz, red) => {
          const r = new Image();
          r.onload = () => coz(r);
          r.onerror = () => red(new BD.Hata('Resim açılamadı; biçimi bu cihazda desteklenmiyor olabilir.'));
          r.src = url;
        });
      } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
    }
    const en = kaynak.width || kaynak.naturalWidth, boy = kaynak.height || kaynak.naturalHeight;
    if (!en || !boy) throw new BD.Hata('Resim açılamadı.');
    return { kaynak, en, boy };
  };

  const tuvalBayt = (tuval, mime, kalite) => new Promise((coz, red) => {
    tuval.toBlob(b => { if (!b) red(new BD.Hata('Resim hazırlanamadı.')); else b.arrayBuffer().then(a => coz(new Uint8Array(a))); }, mime, kalite);
  });
  BD.tuvalBayt = tuvalBayt;

  // Resmi en uzun kenarı "sinir" pikseli geçmeyecek biçimde JPEG ya da PNG'ye çevirir.
  BD.resimHazirla = async (bayt, secenek) => {
    const s = Object.assign({ sinir: 2400, tip: 'jpeg', kalite: 0.88 }, secenek || {});
    const { kaynak, en, boy } = await BD.resimCoz(bayt);
    const oran = Math.min(1, s.sinir / Math.max(en, boy));
    const tEn = Math.max(1, Math.round(en * oran)), tBoy = Math.max(1, Math.round(boy * oran));
    const tuval = document.createElement('canvas');
    tuval.width = tEn; tuval.height = tBoy;
    const c = tuval.getContext('2d');
    if (s.tip === 'jpeg') { c.fillStyle = '#fff'; c.fillRect(0, 0, tEn, tBoy); }
    c.drawImage(kaynak, 0, 0, tEn, tBoy);
    if (kaynak.close) kaynak.close();
    const veri = await tuvalBayt(tuval, s.tip === 'png' ? 'image/png' : 'image/jpeg', s.kalite);
    tuval.width = tuval.height = 0;
    return { veri, tip: s.tip === 'png' ? 'png' : 'jpeg', pxEn: tEn, pxBoy: tBoy };
  };

  // Model içindeki bir resmi PDF'e ve Word'e konabilecek hale (JPEG ya da PNG) getirir.
  BD.resimUygun = async r => {
    const tip = BD.resimTipi(r.veri);
    if ((tip === 'jpeg' || tip === 'png') && r.pxEn && r.pxBoy) return Object.assign(r, { tip });
    const h = await BD.resimHazirla(r.veri, { sinir: 3000, tip: tip === 'jpeg' ? 'jpeg' : 'png' });
    if (tip === 'jpeg' || tip === 'png') return Object.assign(r, { tip, pxEn: h.pxEn, pxBoy: h.pxBoy });
    return Object.assign(r, h);
  };

  /* ---------- Model yardımcıları ---------- */

  // Bütün bloklarda (tablo hücreleri dahil) dolaşır.
  BD.gez = (bloklar, is) => {
    for (const b of bloklar || []) {
      if (b.tur === 'p') is(b);
      else if (b.tur === 'tablo') for (const s of b.satirlar) for (const h of s.hucreler) BD.gez(h.bloklar, is);
    }
  };
  BD.tumBloklar = belge => [belge.ustbilgi, belge.altbilgi, belge.ilkUstbilgi, belge.ilkAltbilgi, belge.bloklar].filter(Boolean);

  // Modeldeki bütün resimleri kullanıma hazırlar; açılamayanları çıkarır.
  BD.resimleriHazirla = async belge => {
    const isler = [];
    for (const grup of BD.tumBloklar(belge)) BD.gez(grup, p => { for (const x of p.parcalar) if (x.resim) isler.push([p, x]); });
    for (const [p, x] of isler) {
      try { await BD.resimUygun(x.resim); }
      catch (e) { p.parcalar.splice(p.parcalar.indexOf(x), 1); }
    }
  };

  BD.duzMetin = belge => {
    const s = [];
    BD.gez(belge.bloklar, p => s.push(p.parcalar.map(x => x.m || '').join('')));
    return s.join('\n');
  };

  BD.renkOnalti = sayi => '#' + ((sayi >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
})(typeof self !== 'undefined' ? self : this);
