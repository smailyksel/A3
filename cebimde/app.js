/* Cebimde: notlar, hazır bilgiler, önemli tarihler, tıbbi kayıtlar ve dekontlar.
   Bütün kayıtlar yalnızca bu cihazda tutulur; hiçbir sunucuya veri gönderilmez.
   Yazılı kayıtlar tarayıcı deposunda (localStorage), eklenen fotoğraf ve PDF'ler
   cihazın veritabanında (IndexedDB) durur. Cihazlar arası aktarım yedek dosyasıyla
   yapılır. Birleştirme, her kaydın değişme zamanına (g) ve silinenlerin izine bakar. */
(() => {
  'use strict';

  const VERI_ANAHTAR = 'cebimde.veri.v1';
  const CIHAZ_ANAHTAR = 'cebimde.cihaz.v1';
  const SURUM = '1.2';
  const YAKIN_GUN = 14;                  // bu kadar gün ve azı kalan tarihler öne çıkarılır
  const ROZET_GUN = 7;                   // bu kadar gün ve azı kalanlar ilk ekranda ve sekmede haber verilir
  const DOSYA_SINIRI = 20 * 1024 * 1024; // tek dosya için üst sınır
  const DOSYA_ADEDI = 12;                // bir kayda eklenebilecek dosya sayısı
  const RESIM_KENAR = 2200;              // büyük fotoğraflar uzun kenarı bu kadar piksel olacak biçimde küçültülür
  const PDF_SAYFA = 40;                  // bir PDF'in en çok bu kadar sayfası gösterilir

  const TURLER = { banka: 'Banka', adres: 'Adres', fatura: 'Fatura', mesaj: 'Mesaj', diger: 'Diğer' };
  const TUR_IPUCU = {
    banka: 'TR00 0000 0000 0000 0000 0000 00',
    adres: 'Mahalle, cadde, numara, ilçe / il',
    fatura: 'Ad soyad ya da unvan, vergi dairesi, vergi numarası',
    mesaj: 'Sık gönderdiğiniz mesajı yazın',
    diger: 'Kopyalamak istediğiniz bilgiyi yazın',
  };
  const TIBBI_TURLER = { tahlil: 'Tahlil', rapor: 'Rapor', recete: 'Reçete', goruntu: 'Görüntü', diger: 'Diğer' };
  const KART_ORNEK = [
    { tur: 'banka', baslik: 'IBAN' },
    { tur: 'adres', baslik: 'Büro adresi' },
    { tur: 'fatura', baslik: 'Fatura bilgileri' },
    { tur: 'mesaj', baslik: 'Randevu teyidi' },
  ];
  const TARIH_ORNEK = [
    { ad: 'Doğum günü', yillik: true },
    { ad: 'Kasko yenileme', yillik: true },
    { ad: 'Araç muayenesi', yillik: false },
    { ad: 'Pasaport bitişi', yillik: false },
  ];
  const GORUNUMLER = { notlar: 'Notlar', bilgiler: 'Hazır Bilgiler', tarihler: 'Önemli Tarihler', tibbi: 'Tıbbi Kayıtlar', dekont: 'Dekontlar', ayarlar: 'Ayarlar' };
  const EKLE_YAZI = { notlar: 'Yeni not', bilgiler: 'Yeni bilgi', tarihler: 'Yeni tarih', tibbi: 'Yeni kayıt', dekont: 'Yeni dekont' };
  const GUN_UZUN = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

  /* ---------- Yardımcılar ---------- */

  const $ = (s, k) => (k || document).querySelector(s);
  const $$ = (s, k) => Array.from((k || document).querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const ikon = (ad, sinif) => `<svg class="ikon${sinif ? ' ' + sinif : ''}" aria-hidden="true"><use href="#i-${ad}"/></svg>`;
  const simdi = () => Date.now();
  const kimlik = () => simdi().toString(36) + Math.random().toString(36).slice(2, 8);
  const temizKimlik = x => String(x).replace(/[^\w-]/g, '').slice(0, 40);
  const iki = n => String(n).padStart(2, '0');
  const kucuk = s => String(s).toLocaleLowerCase('tr');
  const sahip = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

  const tarihYaz = d => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
  const tarihOku = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const tarihMi = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && tarihYaz(tarihOku(x)) === x;
  const bugun = () => tarihYaz(new Date());
  const gunEkle = (s, n) => { const d = tarihOku(s); d.setDate(d.getDate() + n); return tarihYaz(d); };
  const haftaGunu = s => (tarihOku(s).getDay() + 6) % 7; // 0: Pazartesi
  const gunFarki = (a, b) => Math.round((tarihOku(a) - tarihOku(b)) / 864e5);
  const ayFarki = (a, b) => {
    const x = tarihOku(a), y = tarihOku(b);
    return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) - (y.getDate() < x.getDate() ? 1 : 0);
  };

  const bicimGunAy = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' });
  const bicimTam = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const bicimAyYil = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
  const bicimKisa = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
  const bicimSaat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const bicimTutar = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // "30 Kasım Pazartesi"; başka yıldaysa yıl da yazılır.
  function tarihMetni(s) {
    const d = tarihOku(s);
    const govde = d.getFullYear() === new Date().getFullYear() ? bicimGunAy.format(d) : bicimTam.format(d);
    return `${govde} ${GUN_UZUN[haftaGunu(s)]}`;
  }
  function yakinTarih(zaman) {
    const s = tarihYaz(new Date(zaman)), f = gunFarki(s, bugun());
    if (f === 0) return 'Bugün';
    if (f === -1) return 'Dün';
    const d = tarihOku(s);
    return d.getFullYear() === new Date().getFullYear() ? bicimKisa.format(d) : bicimTam.format(d);
  }

  const tutarYaz = n => bicimTutar.format(n) + ' TL';
  // "1.250,50", "1250.50", "1250" gibi yazımları sayıya çevirir; anlaşılmazsa null döner.
  function tutarOku(s) {
    let m = String(s || '').replace(/\s|TL|₺/gi, '');
    if (!m) return null;
    if (m.includes(',')) m = m.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(m)) m = m.replace(/\./g, '');
    const n = Number(m);
    return /^\d+(\.\d+)?$/.test(m) && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  function boyutMetni(n) {
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB';
  }
  const dosyaTuru = tip => (/^image\//.test(tip) ? 'resim' : tip === 'application/pdf' ? 'pdf' : 'diger');

  /* ---------- Depo ---------- */

  let depoCalisiyor = true;
  function depoOku(anahtar) {
    try { return localStorage.getItem(anahtar); } catch (e) { depoCalisiyor = false; return null; }
  }
  function depoYaz(anahtar, deger) {
    try { localStorage.setItem(anahtar, deger); return true; } catch (e) { depoCalisiyor = false; return false; }
  }
  function jsonOku(anahtar) {
    try { return JSON.parse(depoOku(anahtar) || 'null'); } catch (e) { return null; }
  }

  // Eklenen fotoğraf ve PDF'lerin içeriği burada, kimliğiyle saklanır.
  const dosyaDeposu = (() => {
    let acilis = null;
    const ac = () => acilis || (acilis = new Promise((coz, red) => {
      const i = indexedDB.open('cebimde', 1);
      i.onupgradeneeded = () => { i.result.createObjectStore('dosyalar'); };
      i.onsuccess = () => coz(i.result);
      i.onerror = () => { acilis = null; red(i.error); };
    }));
    const islem = (mod, f) => ac().then(vt => new Promise((coz, red) => {
      const t = vt.transaction('dosyalar', mod);
      const istek = f(t.objectStore('dosyalar'));
      t.oncomplete = () => coz(istek.result);
      t.onerror = t.onabort = () => red(t.error);
    }));
    return {
      yaz: (id, kayit) => islem('readwrite', s => s.put(kayit, id)),
      oku: id => islem('readonly', s => s.get(id)),
      sil: id => islem('readwrite', s => s.delete(id)),
      anahtarlar: () => islem('readonly', s => s.getAllKeys()),
    };
  })();

  const bosVeri = () => ({ surum: 1, notlar: [], kartlar: [], tarihler: [], belgeler: [], silinen: {}, sonYedek: 0 });

  // Depodan ya da yedek dosyasından gelen veriyi beklenen biçime sokar.
  function duzelt(h) {
    const v = bosVeri();
    if (!h || typeof h !== 'object') return v;
    const dizi = x => (Array.isArray(x) ? x : []);
    const metin = (x, enFazla) => (typeof x === 'string' ? x : '').slice(0, enFazla);
    const zaman = x => { const n = Number(x); return Number.isFinite(n) ? Math.min(1e15, Math.max(0, n)) : 0; };

    v.notlar = dizi(h.notlar).filter(x => x && x.id != null && (String(x.baslik || '').trim() || String(x.metin || '').trim())).map(x => ({
      id: temizKimlik(x.id),
      baslik: metin(x.baslik, 120),
      metin: metin(x.metin, 20000),
      sabit: x.sabit === true,
      olusturma: zaman(x.olusturma),
      g: zaman(x.g),
    })).filter(x => x.id);

    v.kartlar = dizi(h.kartlar).filter(x => x && x.id != null && typeof x.icerik === 'string' && x.icerik.trim()).map(x => ({
      id: temizKimlik(x.id),
      tur: sahip(TURLER, x.tur) ? x.tur : 'diger',
      baslik: metin(x.baslik, 60).trim(),
      icerik: metin(x.icerik, 2000).trim(),
      sabit: x.sabit === true,
      olusturma: zaman(x.olusturma),
      g: zaman(x.g),
    })).filter(x => x.id);

    v.tarihler = dizi(h.tarihler).filter(x => x && x.id != null && typeof x.ad === 'string' && x.ad.trim() && tarihMi(x.tarih)).map(x => ({
      id: temizKimlik(x.id),
      ad: metin(x.ad, 80).trim(),
      tarih: x.tarih,
      yillik: x.yillik === true,
      not: metin(x.not, 300).trim(),
      olusturma: zaman(x.olusturma),
      g: zaman(x.g),
    })).filter(x => x.id);

    v.belgeler = dizi(h.belgeler).filter(x => x && x.id != null && (x.bolum === 'tibbi' || x.bolum === 'dekont') && typeof x.baslik === 'string' && x.baslik.trim() && tarihMi(x.tarih)).map(x => {
      const tutar = x.tutar === null || x.tutar === undefined || x.tutar === '' ? NaN : Number(x.tutar);
      return {
        id: temizKimlik(x.id),
        bolum: x.bolum,
        baslik: metin(x.baslik, 120).trim(),
        tur: x.bolum === 'tibbi' ? (sahip(TIBBI_TURLER, x.tur) ? x.tur : 'diger') : '',
        tarih: x.tarih,
        tutar: x.bolum === 'dekont' && Number.isFinite(tutar) ? Math.min(1e12, Math.max(0, tutar)) : null,
        not: metin(x.not, 500).trim(),
        dosyalar: dizi(x.dosyalar).filter(d => d && d.id != null && temizKimlik(d.id)).slice(0, DOSYA_ADEDI).map(d => ({
          id: temizKimlik(d.id),
          ad: metin(d.ad, 120).trim() || 'dosya',
          tip: /^[\w.+-]+\/[\w.+-]+$/.test(d.tip) ? d.tip : 'application/octet-stream',
          boyut: zaman(d.boyut),
        })),
        olusturma: zaman(x.olusturma),
        g: zaman(x.g),
      };
    }).filter(x => x.id);

    if (h.silinen && typeof h.silinen === 'object') {
      const sinir = simdi() - 400 * 864e5; // çok eski silme izleri tutulmaz
      for (const k of Object.keys(h.silinen)) {
        const n = Number(h.silinen[k]);
        if (Number.isFinite(n) && n > sinir && temizKimlik(k) === k) v.silinen[k] = n;
      }
    }
    v.sonYedek = zaman(h.sonYedek);
    return v;
  }

  // İki cihazın kayıtlarını birleştirir: aynı kayıtta sonradan değişen kalır, silinenler geri gelmez.
  function birlestir(yerel, gelen) {
    const silinen = Object.assign({}, yerel.silinen);
    for (const k of Object.keys(gelen.silinen)) silinen[k] = Math.max(silinen[k] || 0, gelen.silinen[k]);
    const sec = (a, b) => {
      const m = new Map();
      for (const x of a) m.set(x.id, x);
      for (const y of b) { const x = m.get(y.id); m.set(y.id, !x || y.g > x.g ? y : x); }
      return [...m.values()].filter(x => !(silinen[x.id] && silinen[x.id] >= x.g));
    };
    return duzelt({
      surum: 1,
      notlar: sec(yerel.notlar, gelen.notlar),
      kartlar: sec(yerel.kartlar, gelen.kartlar),
      tarihler: sec(yerel.tarihler, gelen.tarihler),
      belgeler: sec(yerel.belgeler, gelen.belgeler),
      silinen,
      sonYedek: yerel.sonYedek,
    });
  }

  let veri = duzelt(jsonOku(VERI_ANAHTAR));
  let cihaz = Object.assign({ kurNotKapali: false }, jsonOku(CIHAZ_ANAHTAR) || {});
  let kalicilikIstendi = false;

  function kaydet() {
    if (!depoYaz(VERI_ANAHTAR, JSON.stringify(veri))) {
      bildir('Kayıt bu cihaza yazılamadı. Tarayıcının gizli modunda olmadığınızdan emin olun.');
      return;
    }
    if (!kalicilikIstendi && navigator.storage && navigator.storage.persist) {
      kalicilikIstendi = true;
      navigator.storage.persist().catch(() => {});
    }
  }
  const silindi = id => { veri.silinen[id] = simdi(); };
  const dosyaKimlikleri = v => { const s = new Set(); for (const b of v.belgeler) for (const d of b.dosyalar) s.add(d.id); return s; };

  // Hiçbir kayda bağlı olmayan dosyalar açılışta temizlenir. Silme anında temizlenmez ki "Geri al" çalışsın.
  async function artiklariTemizle() {
    if (pencere.open) { setTimeout(artiklariTemizle, 60000); return; } // dosya eklenirken araya girilmez
    try {
      const bagli = dosyaKimlikleri(veri);
      for (const id of await dosyaDeposu.anahtarlar()) if (!bagli.has(id)) await dosyaDeposu.sil(id);
    } catch (e) { /* depo açılamadıysa temizlenecek bir şey de yoktur */ }
  }

  /* ---------- Durum ---------- */

  let gorunum = 'notlar';
  const ui = { tur: 'tum', tibbiTur: 'tum', ara: { notlar: '', bilgiler: '', tibbi: '', dekont: '' } };
  let sonGun = bugun();
  let kurIstegi = null;

  const kurulu = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const appleCihaz = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const dokunmatik = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  /* ---------- Tarih hesabı ---------- */

  // Kaydın sıradaki gerçekleşme günü. Her yıl tekrarlayanlarda geçmiş tarih bir sonraki yıla taşınır.
  function sonraki(t) {
    const bg = bugun();
    if (!t.yillik || t.tarih >= bg) return t.tarih;
    const p = t.tarih.split('-').map(Number);
    const yilda = y => `${y}-${iki(p[1])}-${iki(Math.min(p[2], new Date(y, p[1], 0).getDate()))}`;
    const y = Number(bg.slice(0, 4)), bu = yilda(y);
    return bu >= bg ? bu : yilda(y + 1);
  }
  const kalan = t => gunFarki(sonraki(t), bugun());

  // Büyük yazılacak sayı ve birimi.
  function sayim(gun, hedef) {
    if (gun < 0) return [String(-gun), 'gün önce'];
    if (gun === 0) return ['Bugün', ''];
    if (gun < 365) return [String(gun), 'gün'];
    const ay = ayFarki(bugun(), hedef);
    return ay < 24 ? [String(ay), 'ay'] : [String(Math.floor(ay / 12)), 'yıl'];
  }
  const sayimMetni = t => { const s = sayim(kalan(t), sonraki(t)); return s[1] ? `${s[0]} ${s[1]}` : s[0]; };
  const yaklasanlar = () => veri.tarihler
    .map(t => ({ t, k: kalan(t) }))
    .filter(x => x.k >= 0 && x.k <= ROZET_GUN)
    .sort((a, b) => a.k - b.k);

  /* ---------- Takvim dosyası ---------- */

  // Tek etkinlikli takvim dosyası üretir: tam gün, bir hafta ve bir gün önce saat 09.00'da hatırlatma.
  function takvimMetni(t) {
    const gun = sonraki(t);
    const kac = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const damga = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const satirlar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cebimde//TR', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${t.id}-${gun}@cebimde`,
      `DTSTAMP:${damga}`,
      `DTSTART;VALUE=DATE:${gun.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${gunEkle(gun, 1).replace(/-/g, '')}`,
      `SUMMARY:${kac(t.ad)}`,
    ];
    if (t.not) satirlar.push(`DESCRIPTION:${kac(t.not)}`);
    if (t.yillik) satirlar.push('RRULE:FREQ=YEARLY');
    satirlar.push(
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${kac(t.ad)}`, 'TRIGGER:-P6DT15H', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${kac(t.ad)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    );
    // Uzun satırlar takvim biçiminin gerektirdiği gibi bölünür.
    const bol = s => { const p = []; let k = [...s]; while (k.length > 60) { p.push(k.slice(0, 60).join('')); k = k.slice(60); } p.push(k.join('')); return p.join('\r\n '); };
    return satirlar.map(bol).join('\r\n') + '\r\n';
  }

  function sadeAd(ad, vars) {
    const harf = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
    return kucuk(ad).replace(/[çğıöşü]/g, c => harf[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || vars;
  }

  function indir(icerik, ad, tip) {
    const url = URL.createObjectURL(icerik instanceof Blob ? icerik : new Blob([icerik], { type: tip }));
    const a = document.createElement('a');
    a.href = url; a.download = ad;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Dosyayı paylaşım ekranına verir; desteklenmiyorsa false döner.
  async function dosyaPaylas(blob, ad, tip) {
    let dosya = null;
    try { dosya = new File([blob], ad, { type: tip }); } catch (e) { return false; }
    if (!navigator.canShare || !navigator.canShare({ files: [dosya] })) return false;
    try { await navigator.share({ files: [dosya] }); } catch (e) { if (!e || e.name !== 'AbortError') return false; }
    return true;
  }

  /* ---------- Kopyalama ---------- */

  async function panoyaYaz(metin) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(metin); return true; }
    } catch (e) { /* eski yönteme düşülür */ }
    try {
      const a = document.createElement('textarea');
      a.value = metin; a.setAttribute('readonly', '');
      a.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(a); a.select(); a.setSelectionRange(0, metin.length);
      const oldu = document.execCommand('copy');
      a.remove();
      return oldu;
    } catch (e) { return false; }
  }

  /* ---------- Dosya ekleme ---------- */

  // Büyük fotoğrafları okunaklı kalacak ölçüde küçültür; küçük olanlara ve PDF'lere dokunmaz.
  async function resimKucult(dosya) {
    if (!/^image\/(jpeg|png|webp)$/.test(dosya.type) || dosya.size <= 1.2 * 1024 * 1024) return dosya;
    const url = URL.createObjectURL(dosya);
    try {
      const resim = new Image();
      resim.src = url;
      await resim.decode();
      const oran = Math.min(1, RESIM_KENAR / Math.max(resim.naturalWidth, resim.naturalHeight));
      const tuval = document.createElement('canvas');
      tuval.width = Math.round(resim.naturalWidth * oran);
      tuval.height = Math.round(resim.naturalHeight * oran);
      const c = tuval.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, tuval.width, tuval.height);
      c.drawImage(resim, 0, 0, tuval.width, tuval.height);
      const kucuk_ = await new Promise(coz => tuval.toBlob(coz, 'image/jpeg', 0.86));
      tuval.width = tuval.height = 0;
      return kucuk_ && kucuk_.size < dosya.size ? kucuk_ : dosya;
    } catch (e) { return dosya; } finally { URL.revokeObjectURL(url); }
  }

  async function dosyaHazirla(dosya) {
    const tip = dosya.type || (/\.pdf$/i.test(dosya.name) ? 'application/pdf' : 'application/octet-stream');
    const icerik = await resimKucult(dosya);
    const sonTip = icerik === dosya ? tip : 'image/jpeg';
    let ad = (dosya.name || 'dosya').slice(0, 120);
    if (icerik !== dosya) ad = ad.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return { id: kimlik(), ad, tip: sonTip, boyut: icerik.size, veri: await icerik.arrayBuffer() };
  }

  // Telefonun verdiği anlamsız adlar ("image.jpg") yerine "Fotoğraf 1" gibi bir ad gösterilir.
  // Numara, kayıttaki fotoğraflar arasındaki sıradır.
  const adsizFoto = d => dosyaTuru(d.tip) === 'resim' && /^(image|img[_-]?\d*|photo|foto[gğ]raf)\.\w+$/i.test(d.ad);
  function dosyaEtiket(liste, sira) {
    const d = liste[sira];
    return adsizFoto(d) ? `Fotoğraf ${liste.slice(0, sira + 1).filter(adsizFoto).length}` : d.ad;
  }

  /* ---------- Dosya gösterici ---------- */

  const gosterici = $('#gosterici');
  let acikDosya = null, gostericiSira = 0, gostericiAdresler = [], pdfKitap = null;

  function pdfYukle() {
    return pdfKitap || (pdfKitap = import('./pdf/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('pdf/pdf.worker.min.mjs', document.baseURI).href;
      return m;
    }).catch(e => { pdfKitap = null; throw e; }));
  }

  // PDF sayfaları resme çevrilerek alt alta dizilir; böylece her telefonda aynı biçimde görünür.
  async function pdfCiz(veri, kutu, sira) {
    try {
      const pdfjs = await pdfYukle();
      const belge = await pdfjs.getDocument({ data: new Uint8Array(veri.slice(0)) }).promise;
      const guncel = () => sira === gostericiSira && gosterici.open;
      if (!guncel()) { belge.destroy(); return; }
      kutu.innerHTML = '';
      const genislik = Math.max(240, Math.min(kutu.clientWidth - 24, 880));
      // Yakınlaştırınca da okunaklı kalsın diye sayfa, ekranda görünenden daha yüksek çözünürlükte çizilir.
      const hedef = Math.min(2200, Math.max(1100, genislik * Math.min(3, (window.devicePixelRatio || 1) * 1.5)));
      const tuval = document.createElement('canvas');
      const adet = Math.min(belge.numPages, PDF_SAYFA);
      for (let i = 1; i <= adet && guncel(); i++) {
        const sayfa = await belge.getPage(i);
        const gv = sayfa.getViewport({ scale: hedef / sayfa.getViewport({ scale: 1 }).width });
        tuval.width = Math.floor(gv.width); tuval.height = Math.floor(gv.height);
        await sayfa.render({ canvasContext: tuval.getContext('2d'), viewport: gv }).promise;
        const parca = await new Promise(coz => tuval.toBlob(coz, 'image/jpeg', 0.9));
        if (!guncel() || !parca) break;
        const url = URL.createObjectURL(parca);
        gostericiAdresler.push(url);
        const resim = new Image();
        resim.alt = `Sayfa ${i}`; resim.width = tuval.width; resim.height = tuval.height;
        resim.style.width = genislik + 'px';
        resim.src = url;
        kutu.appendChild(resim);
      }
      tuval.width = tuval.height = 0;
      if (guncel() && belge.numPages > adet) kutu.insertAdjacentHTML('beforeend', `<p>İlk ${adet} sayfa gösterildi. Tamamı için İndir ya da Paylaş düğmesini kullanın.</p>`);
      belge.destroy();
    } catch (e) {
      if (sira === gostericiSira) kutu.innerHTML = '<p>Bu PDF burada görüntülenemedi. Paylaş ya da İndir ile başka bir uygulamada açabilirsiniz.</p>';
    }
  }

  // meta: { id, ad, tip, boyut }; veri verilmişse (henüz kaydedilmemiş ek) depoya bakılmaz.
  async function dosyaGoster(meta, etiket, veri) {
    let icerik = veri || null;
    if (!icerik) {
      try { const k = await dosyaDeposu.oku(meta.id); icerik = k && k.veri; } catch (e) { icerik = null; }
    }
    if (!icerik) { bildir('Dosya bu cihazda bulunamadı. Yedekten yükleyerek geri getirebilirsiniz.'); return; }
    gostericiKapat();
    const tur = dosyaTuru(meta.tip), sira = ++gostericiSira;
    const blob = new Blob([icerik], { type: meta.tip });
    const uzanti = tur === 'pdf' ? '.pdf' : meta.tip === 'image/png' ? '.png' : meta.tip === 'image/webp' ? '.webp' : tur === 'resim' ? '.jpg' : '';
    const ad = /\.\w{2,5}$/.test(meta.ad) ? meta.ad : meta.ad + uzanti;
    acikDosya = { ad, tip: meta.tip, blob };
    let paylasilir = false;
    try { paylasilir = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], ad, { type: meta.tip })] })); } catch (e) { paylasilir = false; }
    gosterici.innerHTML = `<header class="pencere-bas"><h2>${esc(etiket || meta.ad)}</h2><button type="button" class="simge-dugme" data-act="gosterici-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="gosterici-ic" id="gostericiIc"><p>${tur === 'pdf' ? 'Sayfalar hazırlanıyor…' : tur === 'resim' ? '' : 'Bu dosya türü burada görüntülenemiyor. Paylaş ya da İndir ile başka bir uygulamada açabilirsiniz.'}</p></div>
      <footer class="pencere-alt"><span class="kucuk">${esc(boyutMetni(blob.size))}</span><span class="bosluk"></span>
        ${paylasilir ? `<button type="button" class="dugme dugme-ana" data-act="dosya-paylas">${ikon('paylas')}Paylaş</button>` : ''}
        <button type="button" class="dugme${paylasilir ? '' : ' dugme-ana'}" data-act="dosya-indir">${ikon('indir')}İndir</button>
      </footer>`;
    modalAc(gosterici);
    const kutu = $('#gostericiIc');
    if (tur === 'resim') {
      const url = URL.createObjectURL(blob);
      gostericiAdresler.push(url);
      kutu.innerHTML = '';
      const resim = new Image();
      resim.alt = etiket || meta.ad; resim.src = url;
      kutu.appendChild(resim);
    } else if (tur === 'pdf') pdfCiz(icerik, kutu, sira);
  }

  function gostericiKapat() {
    gostericiSira++;
    modalKapat(gosterici);
    gosterici.innerHTML = '';
    gostericiAdresler.forEach(u => URL.revokeObjectURL(u));
    gostericiAdresler = [];
    acikDosya = null;
  }

  /* ---------- Çizim: ortak parçalar ---------- */

  function acilisNotlari() {
    let h = '';
    if (!kurulu() && !cihaz.kurNotKapali) {
      h += `<div class="kart yaklasan" style="align-items:flex-start"><span><small>Kurulum</small>Uygulamayı ana ekrana ekleyin; kayıtlarınızı kurduktan sonra girin.
        <button type="button" class="metin-dugme" data-git="ayarlar" style="display:flex">Kurulum adımlarını göster</button></span>
        <button type="button" class="simge-dugme" data-act="kur-not-kapat" aria-label="Kapat" style="margin:-6px -6px 0 0">${ikon('kapat')}</button></div>`;
    }
    const y = yaklasanlar();
    if (y.length) {
      h += `<button type="button" class="kart yaklasan" data-git="tarihler">${ikon('tarih')}
        <span><small>Yaklaşan</small>${esc(y[0].t.ad)}${y.length > 1 ? ` ve ${y.length - 1} tarih daha` : ''}</span><b>${esc(sayimMetni(y[0].t))}</b></button>`;
    }
    return h;
  }

  // Kayıt sayısı azken arama kutusu gösterilmez.
  function aramaKutusu(bolum, sayi, yazi) {
    if (sayi < 6) { ui.ara[bolum] = ''; return ''; }
    return `<div class="ara">${ikon('ara')}<label class="gizli" for="ara">${yazi}</label><input type="search" id="ara" placeholder="${yazi}" value="${esc(ui.ara[bolum])}" autocomplete="off" enterkeyhint="search"></div>`;
  }
  const aranan = bolum => kucuk(ui.ara[bolum].trim());

  /* ---------- Çizim: notlar ---------- */

  function notlarHtml() {
    const q = aranan('notlar');
    const l = veri.notlar
      .filter(n => !q || kucuk(n.baslik + ' ' + n.metin).includes(q))
      .sort((a, b) => (Number(b.sabit) - Number(a.sabit)) || (b.g - a.g));
    if (!l.length) return '<div class="bos">Aramayla eşleşen not yok.</div>';
    return `<div class="notlar">${l.map(n => {
      const satirlar = n.metin.trim().split('\n');
      const baslik = n.baslik.trim() || satirlar[0].slice(0, 80);
      const govde = n.baslik.trim() ? n.metin.trim() : satirlar.slice(1).join('\n').trim();
      return `<div class="not-sar">
        <button type="button" class="not-sil" data-act="not-kaydir-sil" data-id="${n.id}" tabindex="-1" aria-hidden="true">${ikon('cop')}<span>Sil</span></button>
        <button type="button" class="kart not-kart${n.sabit ? ' sabit' : ''}" data-act="not-ac" data-id="${n.id}">
          <h3>${n.sabit ? ikon('igne', 'ikon-k') : ''}<span>${esc(baslik)}</span></h3>
          <p>${esc(govde.slice(0, 400))}</p>
          <time>${esc(yakinTarih(n.g || n.olusturma || simdi()))}</time>
        </button>
        <button type="button" class="simge-dugme not-cop" data-act="not-kaydir-sil" data-id="${n.id}" aria-label="Sil: ${esc(baslik)}">${ikon('cop')}</button>
      </div>`;
    }).join('')}</div>`;
  }

  function cizNotlar() {
    const ust = acilisNotlari();
    if (!veri.notlar.length) {
      return ust + `<div class="bos"><strong>Henüz not yok</strong>Aklınıza geleni yazın; önemli olanı başa sabitleyebilirsiniz.
        <div class="baslangic"><button type="button" class="dugme dugme-ana" data-act="ekle">${ikon('arti')}Not yaz</button></div></div>`;
    }
    return ust + aramaKutusu('notlar', veri.notlar.length, 'Notlarda ara') + `<div id="liste">${notlarHtml()}</div>`;
  }

  /* ---------- Çizim: hazır bilgiler ---------- */

  // Başlık türün adını zaten içeriyorsa ("Fatura bilgileri", "Büro adresi") tür ayrıca yazılmaz.
  function kartEtiket(k) {
    if (!k.baslik) return TURLER[k.tur];
    if (k.tur === 'diger' || kucuk(k.baslik).includes(kucuk(TURLER[k.tur]))) return k.baslik;
    return `${TURLER[k.tur]} · ${k.baslik}`;
  }
  const haritaAdresi = adres => (appleCihaz() ? 'https://maps.apple.com/?q=' : 'https://www.google.com/maps/search/?api=1&query=') + encodeURIComponent(adres.replace(/\s+/g, ' '));

  function kartlarHtml() {
    const q = aranan('bilgiler');
    const l = veri.kartlar
      .filter(k => (ui.tur === 'tum' || k.tur === ui.tur) && (!q || kucuk(k.baslik + ' ' + k.icerik + ' ' + TURLER[k.tur]).includes(q)))
      .sort((a, b) => (Number(b.sabit) - Number(a.sabit)) || (a.olusturma - b.olusturma));
    if (!l.length) return '<div class="bos">Aramayla eşleşen bilgi yok.</div>';
    return `<div class="bilgiler">${l.map(k => `<article class="kart bilgi${k.sabit ? ' sabit' : ''}">
      <div class="bilgi-bas">
        <p class="bas">${k.sabit ? ikon('igne', 'ikon-k') : ''}<span>${esc(kartEtiket(k))}</span></p>
        <button type="button" class="simge-dugme" data-act="kart-ac" data-id="${k.id}" aria-label="Düzenle: ${esc(kartEtiket(k))}">${ikon('kalem')}</button>
      </div>
      <p class="bilgi-icerik">${esc(k.icerik)}</p>
      <div class="bilgi-dugmeler">
        <button type="button" class="dugme dugme-ana" data-act="kopyala" data-id="${k.id}">Kopyala</button>
        ${navigator.share ? `<button type="button" class="dugme" data-act="paylas" data-id="${k.id}">Paylaş</button>` : ''}
        ${k.tur === 'adres' ? `<a class="dugme" href="${esc(haritaAdresi(k.icerik))}" target="_blank" rel="noopener noreferrer">Haritada aç</a>` : ''}
      </div>
    </article>`).join('')}</div>`;
  }

  function cizBilgiler() {
    if (!veri.kartlar.length) {
      return `<div class="bos"><strong>Sık paylaştığınız bilgileri ekleyin</strong>IBAN, adres, fatura bilgileri ya da hazır bir mesaj. Sonra tek dokunuşla kopyalar, dilediğiniz uygulamaya gönderirsiniz.
        <div class="baslangic">${KART_ORNEK.map((o, i) => `<button type="button" class="dugme" data-act="kart-ornek" data-sira="${i}">${ikon('arti')}${esc(o.baslik)}</button>`).join('')}</div></div>`;
    }
    let h = '';
    const turler = Object.keys(TURLER).filter(t => veri.kartlar.some(k => k.tur === t));
    if (ui.tur !== 'tum' && !turler.includes(ui.tur)) ui.tur = 'tum';
    if (turler.length > 1) {
      h += `<div class="cipler" role="group" aria-label="Tür">
        <button type="button" class="cip" data-act="tur" data-tur="tum" aria-pressed="${ui.tur === 'tum'}">Tümü</button>
        ${turler.map(t => `<button type="button" class="cip" data-act="tur" data-tur="${t}" aria-pressed="${ui.tur === t}">${TURLER[t]}</button>`).join('')}
      </div>`;
    }
    return h + aramaKutusu('bilgiler', veri.kartlar.length, 'Bilgilerde ara') + `<div id="liste">${kartlarHtml()}</div>`;
  }

  /* ---------- Çizim: önemli tarihler ---------- */

  function tarihKart(t) {
    const k = kalan(t), hedef = sonraki(t), s = sayim(k, hedef);
    const sinif = k < 0 ? ' gecti' : k <= YAKIN_GUN ? ' yakin' : '';
    const alt = [tarihMetni(hedef)];
    if (k === 1) alt.push('Yarın');
    if (t.yillik) alt.push('Her yıl');
    return `<article class="kart tarih${sinif}">
      <button type="button" class="tarih-govde" data-act="tarih-ac" data-id="${t.id}">
        <span class="gun"><b${s[1] ? '' : ' class="yazi"'}>${s[0]}</b>${s[1] ? `<span>${s[1]}</span>` : ''}</span>
        <span class="tarih-yazi"><strong>${esc(t.ad)}</strong><span class="kucuk">${esc(alt.join(' · '))}</span>${t.not ? `<span class="kucuk">${esc(t.not)}</span>` : ''}</span>
      </button>
      ${k >= 0 ? `<div class="tarih-alt"><button type="button" class="metin-dugme" data-act="takvim" data-id="${t.id}">${ikon('takvim', 'ikon-k')}Takvime ekle</button></div>` : ''}
    </article>`;
  }

  function cizTarihler() {
    if (!veri.tarihler.length) {
      return `<div class="bos"><strong>Unutmak istemediğiniz tarihleri ekleyin</strong>Kaç gün kaldığı burada görünür; yaklaşanlar öne çıkar. "Takvime ekle" ile iPhone'un takvimi size zamanında haber verir.
        <div class="baslangic">${TARIH_ORNEK.map((o, i) => `<button type="button" class="dugme" data-act="tarih-ornek" data-sira="${i}">${ikon('arti')}${esc(o.ad)}</button>`).join('')}</div></div>`;
    }
    const hepsi = veri.tarihler.map(t => ({ t, k: kalan(t) }));
    const gelecek = hepsi.filter(x => x.k >= 0).sort((a, b) => (a.k - b.k) || (a.t.olusturma - b.t.olusturma));
    const gecen = hepsi.filter(x => x.k < 0).sort((a, b) => b.k - a.k);
    let h = gelecek.length ? `<div class="tarihler">${gelecek.map(x => tarihKart(x.t)).join('')}</div>` : '<div class="bos">Yaklaşan tarih yok.</div>';
    if (gecen.length) {
      h += `<section class="bolum"><div class="bolum-bas"><h2>Geçenler</h2></div><div class="tarihler">${gecen.map(x => tarihKart(x.t)).join('')}</div></section>`;
    }
    return h;
  }

  /* ---------- Çizim: tıbbi kayıtlar ve dekontlar ---------- */

  const dosyaCipleri = b => (b.dosyalar.length ? `<div class="belge-dosyalar">${b.dosyalar.map((d, i) =>
    `<button type="button" class="dosya-cip" data-act="dosya-ac" data-belge="${b.id}" data-id="${d.id}">${ikon(dosyaTuru(d.tip) === 'resim' ? 'resim' : 'dosya')}<span>${esc(dosyaEtiket(b.dosyalar, i))}</span></button>`).join('')}</div>` : '');

  function belgeKart(b) {
    const dekont = b.bolum === 'dekont';
    return `<article class="kart belge">
      <button type="button" class="belge-govde" data-act="belge-ac" data-id="${b.id}">
        ${dekont
          ? `<span class="belge-ust"><strong>${esc(b.baslik)}</strong>${b.tutar !== null ? `<b class="tutar">${esc(tutarYaz(b.tutar))}</b>` : ''}</span><span class="kucuk">${esc(tarihMetni(b.tarih))}</span>`
          : `<span class="bas">${esc(TIBBI_TURLER[b.tur])} · ${esc(tarihMetni(b.tarih))}</span><strong>${esc(b.baslik)}</strong>`}
        ${b.not ? `<span class="kucuk belge-not">${esc(b.not)}</span>` : ''}
      </button>
      ${dosyaCipleri(b)}
    </article>`;
  }

  function belgelerHtml(bolum) {
    const q = aranan(bolum), dekont = bolum === 'dekont';
    const l = veri.belgeler
      .filter(b => b.bolum === bolum && (dekont || ui.tibbiTur === 'tum' || b.tur === ui.tibbiTur))
      .filter(b => !q || kucuk([b.baslik, b.not, dekont ? '' : TIBBI_TURLER[b.tur], b.tutar !== null ? tutarYaz(b.tutar) : '', tarihMetni(b.tarih)].join(' ')).includes(q))
      .sort((a, b) => (a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : b.olusturma - a.olusturma));
    if (!l.length) return `<div class="bos">Aramayla eşleşen ${dekont ? 'dekont' : 'kayıt'} yok.</div>`;
    // Dekontlar aya, tıbbi kayıtlar yıla göre öbeklenir.
    const obekler = new Map();
    for (const b of l) {
      const k = dekont ? b.tarih.slice(0, 7) : b.tarih.slice(0, 4);
      if (!obekler.has(k)) obekler.set(k, []);
      obekler.get(k).push(b);
    }
    return [...obekler].map(([k, kayitlar]) => {
      const baslik = dekont ? bicimAyYil.format(tarihOku(k + '-01')) : k;
      const toplam = kayitlar.reduce((t, b) => t + (b.tutar || 0), 0);
      const ozet = dekont ? `${kayitlar.length} dekont${toplam ? ' · ' + tutarYaz(toplam) : ''}` : `${kayitlar.length} kayıt`;
      return `<section class="bolum"><div class="bolum-bas"><h2>${esc(baslik)}</h2><span class="kucuk">${esc(ozet)}</span></div>
        <div class="belgeler">${kayitlar.map(belgeKart).join('')}</div></section>`;
    }).join('');
  }

  function cizBelgeler(bolum) {
    const dekont = bolum === 'dekont';
    const hepsi = veri.belgeler.filter(b => b.bolum === bolum);
    if (!hepsi.length) {
      return dekont
        ? `<div class="bos"><strong>Dekontlarınızı burada saklayın</strong>Ödemenin kime ve ne için yapıldığını, tutarını yazın; dekontun PDF'ini ya da fotoğrafını ekleyin. Gerektiğinde buradan açar, karşı tarafa gönderirsiniz.
            <div class="baslangic"><button type="button" class="dugme dugme-ana" data-act="ekle">${ikon('arti')}Dekont ekle</button></div></div>`
        : `<div class="bos"><strong>Tıbbi kayıtlarınızı burada saklayın</strong>Tahlil sonucu, rapor, reçete ya da görüntüleme çıktısını fotoğraf ya da PDF olarak ekleyin. Tarihine göre sıralanır, muayenede elinizin altında olur.
            <div class="baslangic"><button type="button" class="dugme dugme-ana" data-act="ekle">${ikon('arti')}Kayıt ekle</button></div></div>`;
    }
    let h = '';
    if (!dekont) {
      const turler = Object.keys(TIBBI_TURLER).filter(t => hepsi.some(b => b.tur === t));
      if (ui.tibbiTur !== 'tum' && !turler.includes(ui.tibbiTur)) ui.tibbiTur = 'tum';
      if (turler.length > 1) {
        h += `<div class="cipler" role="group" aria-label="Tür">
          <button type="button" class="cip" data-act="tibbi-tur" data-tur="tum" aria-pressed="${ui.tibbiTur === 'tum'}">Tümü</button>
          ${turler.map(t => `<button type="button" class="cip" data-act="tibbi-tur" data-tur="${t}" aria-pressed="${ui.tibbiTur === t}">${TIBBI_TURLER[t]}</button>`).join('')}
        </div>`;
      }
    }
    return h + aramaKutusu(bolum, hepsi.length, dekont ? 'Dekontlarda ara' : 'Kayıtlarda ara') + `<div id="liste">${belgelerHtml(bolum)}</div>`;
  }

  /* ---------- Çizim: ayarlar ---------- */

  function cizAyarlar() {
    const dosyalar = veri.belgeler.reduce((t, b) => t + b.dosyalar.length, 0);
    const yer = veri.belgeler.reduce((t, b) => t + b.dosyalar.reduce((x, d) => x + d.boyut, 0), 0);
    let h = `<section class="bolum"><div class="bolum-bas"><h2>Yedek ve aktarım</h2></div>
      <div class="kart ayar-kart">
        <p>Kayıtlarınız ve eklediğiniz dosyalar yalnızca bu cihazda durur, internete gönderilmez. Yedek, hepsini tek dosyada toplar. Telefon ile bilgisayar arasında aktarmak için bir cihazda yedek alın, dosyayı diğerine gönderip orada yükleyin; iki cihazın kayıtları birleştirilir.</p>
        <p>Uygulama silinirse ya da tarayıcı verileri temizlenirse kayıtlar da gider. Belge eklediğiniz günlerde yedek almanızda yarar var.</p>
        <p>${veri.sonYedek ? 'Son yedek: <strong>' + esc(bicimSaat.format(new Date(veri.sonYedek))) + '</strong>' : 'Henüz yedek alınmadı.'}</p>
        <div class="dugmeler">
          <button type="button" class="dugme dugme-ana" data-act="yedek-al">${ikon('indir')}Yedek al</button>
          <label class="dugme">${ikon('yukle')}Yedekten yükle<input type="file" id="yedekDosya" class="gizli" accept=".zip,application/zip,application/x-zip-compressed"></label>
        </div>
      </div></section>

    <section class="bolum"><div class="bolum-bas"><h2>Kurulum</h2></div>
      <div class="kart ayar-kart">`;
    if (kurulu()) {
      h += '<p><strong>Uygulama bu cihaza kurulu.</strong> Diğer cihazınıza kurmak için aynı adresi orada açın.</p>';
    } else if (kurIstegi) {
      h += `<p>Uygulamayı bu bilgisayara kurabilirsiniz; kendi penceresinde açılır, Başlat menüsüne ve görev çubuğuna sabitlenebilir.</p>
        <div class="dugmeler"><button type="button" class="dugme dugme-ana" data-act="kur">Bu cihaza kur</button></div>`;
    }
    h += `<h3>iPhone</h3>
        <ol><li>Bu sayfayı Safari'de açın.</li><li>Paylaş düğmesine dokunun.</li><li>"Ana Ekrana Ekle" seçeneğine, ardından "Ekle"ye dokunun.</li></ol>
        <h3>Windows 11</h3>
        <ol><li>Bu sayfayı Edge ya da Chrome'da açın.</li><li>Adres çubuğunun sağındaki kur simgesine ya da tarayıcı menüsündeki "uygulama olarak yükle" seçeneğine tıklayın.</li><li>"Yükle"yi seçin; dilerseniz görev çubuğuna sabitleyin.</li></ol>
        <p style="margin-top:12px">iPhone'da tarayıcı sekmesinde girilen kayıtlar kurulan uygulamaya taşınmaz. Önce kurun, kayıtları sonra girin.</p>
      </div></section>

    <section class="bolum"><div class="bolum-bas"><h2>Kayıtlar</h2></div>
      <div class="kart ayar-kart">
        <p>${veri.notlar.length} not, ${veri.kartlar.length} bilgi, ${veri.tarihler.length} tarih, ${veri.belgeler.filter(b => b.bolum === 'tibbi').length} tıbbi kayıt ve ${veri.belgeler.filter(b => b.bolum === 'dekont').length} dekont var.${dosyalar ? ` Eklenen ${dosyalar} dosya ${esc(boyutMetni(yer))} yer tutuyor.` : ''}${depoCalisiyor ? '' : ' <strong>Tarayıcı deposuna yazılamıyor; kayıtlar kalıcı olmayabilir.</strong>'}</p>
        <p>Bu uygulama parola korumalı değildir; cihazınızın ekran kilidine güvenir. Banka şifresi, kart şifresi gibi gizli bilgileri buraya yazmayın.</p>
        <div class="dugmeler"><button type="button" class="dugme dugme-tehlike" data-act="hepsini-sil">Bütün kayıtları sil</button></div>
      </div></section>
    <p class="surum">Cebimde ${SURUM}</p>`;
    return h;
  }

  const CIZIMLER = { notlar: cizNotlar, bilgiler: cizBilgiler, tarihler: cizTarihler, tibbi: () => cizBelgeler('tibbi'), dekont: () => cizBelgeler('dekont'), ayarlar: cizAyarlar };
  const LISTELER = { notlar: notlarHtml, bilgiler: kartlarHtml, tibbi: () => belgelerHtml('tibbi'), dekont: () => belgelerHtml('dekont') };

  function ustEtiket() {
    const say = bolum => veri.belgeler.filter(b => b.bolum === bolum).length;
    if (gorunum === 'notlar') return `${veri.notlar.length} not`;
    if (gorunum === 'bilgiler') return `${veri.kartlar.length} bilgi`;
    if (gorunum === 'tarihler') return `${veri.tarihler.length} tarih`;
    if (gorunum === 'tibbi') return `${say('tibbi')} kayıt`;
    if (gorunum === 'dekont') return `${say('dekont')} dekont`;
    return 'Cebimde';
  }

  function ciz() {
    document.documentElement.dataset.gorunum = gorunum;
    $$('[data-git]').forEach(b => {
      if (b.closest('.yan, .alt') && b.dataset.git === gorunum) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const n = yaklasanlar().length;
    $$('[data-rozet]').forEach(r => { r.hidden = !n; r.textContent = n ? String(n) : ''; });
    $('#ustEtiket').textContent = ustEtiket();
    $('#ustBaslik').textContent = GORUNUMLER[gorunum];
    const yazi = EKLE_YAZI[gorunum];
    $('#ustEkle').hidden = !yazi;
    $('#yuzenEkle').hidden = !yazi;
    if (yazi) { $('#ustEkleYazi').textContent = yazi; $('#yuzenEkle').setAttribute('aria-label', yazi); }
    acikSar = null;
    $('#icerik').innerHTML = CIZIMLER[gorunum]();
  }

  function git(g) {
    if (!GORUNUMLER[g]) g = 'notlar';
    const degisti = g !== gorunum;
    gorunum = g;
    try { history.replaceState(null, '', g === 'notlar' ? location.pathname + location.search : '#' + g); } catch (e) { /* adres değişmese de olur */ }
    ciz();
    if (degisti) window.scrollTo(0, 0);
  }

  /* ---------- Bildirim çubuğu ---------- */

  const bildirimKutu = $('#bildirim');
  let bildirimSayac = 0, geriAlVeri = null;

  function bildir(metin, geriAl) {
    clearTimeout(bildirimSayac);
    geriAlVeri = geriAl || null;
    bildirimKutu.innerHTML = `<span>${esc(metin)}</span>${geriAl ? '<button type="button" data-act="geri-al">Geri al</button>' : ''}`;
    bildirimKutu.hidden = false;
    bildirimSayac = setTimeout(() => { bildirimKutu.hidden = true; geriAlVeri = null; }, geriAl ? 7000 : 4500);
  }

  /* ---------- Pencereler ---------- */

  const pencere = $('#pencere'), onay = $('#onay');
  let pencereKapaninca = null;
  let formDosyalar = []; // açık tıbbi kayıt ya da dekont penceresindeki ekler; yeni eklenenlerde "veri" doludur

  function modalAc(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function modalKapat(d) {
    if (!d.open) return;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function pencereAc(html, kapaninca) {
    pencere.innerHTML = html;
    pencereKapaninca = kapaninca || null;
    delete pencere.dataset.kirli;
    modalAc(pencere);
    pencere.scrollTop = 0;
  }
  // Kapanış işlemi (not penceresinde kaydetme) pencere kapanmadan hemen önce yapılır.
  function pencereKapat(sonuc) {
    const f = pencereKapaninca;
    pencereKapaninca = null;
    if (f) f(sonuc || '');
    modalKapat(pencere);
    pencere.innerHTML = '';
    formDosyalar = [];
  }

  pencere.addEventListener('cancel', e => { e.preventDefault(); pencereKapat(); });
  pencere.addEventListener('close', () => pencereKapat());
  pencere.addEventListener('input', () => {
    pencere.dataset.kirli = '1';
    const h = $('#formHata', pencere);
    if (h) h.hidden = true; // kullanıcı düzeltmeye başlayınca eski uyarı kalkar
  });
  pencere.addEventListener('click', e => {
    if (e.target !== pencere) return;
    const r = pencere.getBoundingClientRect();
    const disarida = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    // Yazılmış bir form yanlışlıkla kapanmasın; not penceresi kapanırken zaten kaydeder.
    if (disarida && (!pencere.dataset.kirli || $('form[data-form="not"]', pencere))) pencereKapat();
  });
  gosterici.addEventListener('cancel', e => { e.preventDefault(); gostericiKapat(); });
  gosterici.addEventListener('click', e => { if (e.target === gosterici) gostericiKapat(); });

  function sor(s) {
    return new Promise(coz => {
      let bitti = false;
      onay.innerHTML = `<form novalidate>
        <header class="pencere-bas"><h2>${esc(s.baslik)}</h2></header>
        <div class="pencere-ic">${s.metin ? `<p>${esc(s.metin)}</p>` : ''}</div>
        <footer class="pencere-alt"><span class="bosluk"></span>
          <button type="button" class="dugme dugme-sade" data-sonuc="vazgec">Vazgeç</button>
          ${s.ikinci ? `<button type="button" class="dugme dugme-tehlike" data-sonuc="ikinci">${esc(s.ikinci)}</button>` : ''}
          <button type="submit" class="dugme ${s.tehlike ? 'dugme-tehlike' : 'dugme-ana'}">${esc(s.dugme || 'Tamam')}</button>
        </footer></form>`;
      const bitir = sonuc => {
        if (bitti) return;
        bitti = true;
        onay.onclick = onay.onclose = null;
        modalKapat(onay);
        onay.innerHTML = '';
        coz(sonuc);
      };
      $('form', onay).onsubmit = e => { e.preventDefault(); bitir('tamam'); };
      onay.onclick = e => { const b = e.target.closest('[data-sonuc]'); if (b) bitir(b.dataset.sonuc); };
      onay.onclose = () => bitir('vazgec');
      modalAc(onay);
    });
  }

  const pencereBas = baslik => `<header class="pencere-bas"><h2>${baslik}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>`;
  const pencereAlt = (silIslemi, id, kaydet_) => `<footer class="pencere-alt">
      ${id ? `<button type="button" class="dugme dugme-tehlike" data-act="${silIslemi}" data-id="${id}">Sil</button>` : ''}
      <span class="bosluk"></span>
      <button type="button" class="dugme dugme-sade" data-act="pencere-kapat">Vazgeç</button>
      <button type="submit" class="dugme dugme-ana">${kaydet_ || 'Kaydet'}</button>
    </footer>`;
  const secenekler = (ad, liste, secili) => `<div class="secenekler">${Object.keys(liste).map(t => `<label class="secenek"><input type="radio" name="${ad}" value="${t}"${secili === t ? ' checked' : ''}><span>${liste[t]}</span></label>`).join('')}</div>`;

  // Not penceresi nasıl kapanırsa kapansın (Tamam, Esc, dışarı dokunma) yazılanı kaydeder.
  function notPenceresi(id) {
    const n = id ? veri.notlar.find(x => x.id === id) : null;
    if (id && !n) return;
    pencereAc(`<form data-form="not" novalidate>
      ${pencereBas(n ? 'Not' : 'Yeni not')}
      <div class="pencere-ic">
        <label class="alan"><span class="gizli">Başlık</span><input type="text" class="not-baslik" name="baslik" maxlength="120" value="${esc(n ? n.baslik : '')}" placeholder="Başlık" autocomplete="off" enterkeyhint="next"></label>
        <label class="alan"><span class="gizli">Not</span><textarea class="not-metin" name="metin" maxlength="20000" placeholder="Notunuzu yazın"${n ? '' : ' autofocus'}>${esc(n ? n.metin : '')}</textarea></label>
        <label class="anahtar"><span>Başa sabitle</span><input type="checkbox" name="sabit"${n && n.sabit ? ' checked' : ''}><i></i></label>
      </div>
      <footer class="pencere-alt">
        ${n ? `<button type="button" class="dugme dugme-tehlike" data-act="not-sil" data-id="${n.id}">Sil</button>` : ''}
        <span class="bosluk"></span>
        <button type="submit" class="dugme dugme-ana">Tamam</button>
      </footer></form>`, sonuc => {
      if (sonuc === 'sil') return;
      const f = $('form', pencere);
      const baslik = f.elements.baslik.value.trim(), metin = f.elements.metin.value.replace(/\s+$/, ''), sabit = f.elements.sabit.checked;
      if (!baslik && !metin) return; // boşaltılan not silinmez; silmek için Sil düğmesi kullanılır
      const t = simdi();
      const kayitli = id ? veri.notlar.find(x => x.id === id) : null;
      if (kayitli) {
        if (kayitli.baslik === baslik && kayitli.metin === metin && kayitli.sabit === sabit) return;
        kayitli.baslik = baslik; kayitli.metin = metin; kayitli.sabit = sabit; kayitli.g = t;
      } else veri.notlar.push({ id: kimlik(), baslik, metin, sabit, olusturma: t, g: t });
      kaydet(); ciz();
    });
  }

  function kartPenceresi(id, ontanim) {
    const k = id ? veri.kartlar.find(x => x.id === id) : null;
    if (id && !k) return;
    const d = k || Object.assign({ tur: ui.tur !== 'tum' ? ui.tur : 'banka', baslik: '', icerik: '', sabit: false }, ontanim);
    pencereAc(`<form data-form="kart" data-id="${k ? k.id : ''}" novalidate>
      ${pencereBas(k ? 'Bilgiyi düzenle' : 'Yeni bilgi')}
      <div class="pencere-ic">
        <fieldset class="alan"><legend>Tür</legend>${secenekler('tur', TURLER, d.tur)}</fieldset>
        <label class="alan"><span>Başlık</span><input type="text" name="baslik" maxlength="60" value="${esc(d.baslik)}" placeholder="Örneğin IBAN, büro adresi" autocomplete="off" enterkeyhint="next"></label>
        <label class="alan"><span>Kopyalanacak bilgi</span><textarea name="icerik" rows="4" maxlength="2000" placeholder="${esc(TUR_IPUCU[d.tur])}" autocomplete="off"${k ? '' : ' autofocus'}>${esc(d.icerik)}</textarea></label>
        <p class="hata" id="formHata" hidden></p>
        <label class="anahtar"><span>Başa sabitle</span><input type="checkbox" name="sabit"${d.sabit ? ' checked' : ''}><i></i></label>
      </div>
      ${pencereAlt('kart-sil', k && k.id)}</form>`);
  }

  function tarihPenceresi(id, ontanim) {
    const t = id ? veri.tarihler.find(x => x.id === id) : null;
    if (id && !t) return;
    const d = t || Object.assign({ ad: '', tarih: '', yillik: false, not: '' }, ontanim);
    pencereAc(`<form data-form="tarih" data-id="${t ? t.id : ''}" novalidate>
      ${pencereBas(t ? 'Tarihi düzenle' : 'Yeni tarih')}
      <div class="pencere-ic">
        <label class="alan"><span>Ne için</span><input type="text" name="ad" maxlength="80" value="${esc(d.ad)}" placeholder="Örneğin kasko yenileme" autocomplete="off" enterkeyhint="next"${t || d.ad ? '' : ' autofocus'}></label>
        <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${esc(d.tarih)}"></label>
        <p class="hata" id="formHata" hidden></p>
        <label class="anahtar"><span>Her yıl tekrarlar<small>Doğum günü, yıllık yenileme gibi tarihler için.</small></span><input type="checkbox" name="yillik"${d.yillik ? ' checked' : ''}><i></i></label>
        <label class="alan"><span>Not (isteğe bağlı)</span><input type="text" name="not" maxlength="300" value="${esc(d.not)}" placeholder="Örneğin poliçe numarası" autocomplete="off" enterkeyhint="done"></label>
      </div>
      ${pencereAlt('tarih-sil', t && t.id)}</form>`);
  }

  function dosyaListeCiz() {
    const kutu = $('#dosyaListe', pencere);
    if (!kutu) return;
    kutu.innerHTML = formDosyalar.map((d, i) => `<div class="dosya-satir">${ikon(dosyaTuru(d.tip) === 'resim' ? 'resim' : 'dosya')}
      <button type="button" class="ad" data-act="form-dosya-ac" data-sira="${i}">${esc(dosyaEtiket(formDosyalar, i))}</button>
      <small>${esc(boyutMetni(d.boyut))}</small>
      <button type="button" class="simge-dugme" data-act="form-dosya-sil" data-sira="${i}" aria-label="Kaldır: ${esc(dosyaEtiket(formDosyalar, i))}">${ikon('kapat')}</button></div>`).join('');
  }

  function belgePenceresi(bolum, id) {
    const b = id ? veri.belgeler.find(x => x.id === id) : null;
    if (id && !b) return;
    const dekont = (b ? b.bolum : bolum) === 'dekont';
    const d = b || { baslik: '', tur: ui.tibbiTur !== 'tum' ? ui.tibbiTur : 'tahlil', tarih: bugun(), tutar: null, not: '', dosyalar: [] };
    pencereAc(`<form data-form="belge" data-bolum="${dekont ? 'dekont' : 'tibbi'}" data-id="${b ? b.id : ''}" novalidate>
      ${pencereBas(dekont ? (b ? 'Dekontu düzenle' : 'Yeni dekont') : (b ? 'Kaydı düzenle' : 'Yeni tıbbi kayıt'))}
      <div class="pencere-ic">
        ${dekont ? '' : `<fieldset class="alan"><legend>Tür</legend>${secenekler('tur', TIBBI_TURLER, d.tur)}</fieldset>`}
        <label class="alan"><span>${dekont ? 'Kime, ne için' : 'Kayıt'}</span><input type="text" name="baslik" maxlength="120" value="${esc(d.baslik)}" placeholder="${dekont ? 'Örneğin kira ödemesi' : 'Örneğin kan tahlili sonucu'}" autocomplete="off" enterkeyhint="next"${b ? '' : ' autofocus'}></label>
        ${dekont
          ? `<div class="iki">
              <label class="alan"><span>Tutar (TL)</span><input type="text" name="tutar" inputmode="decimal" maxlength="20" value="${d.tutar !== null ? esc(bicimTutar.format(d.tutar)) : ''}" placeholder="0,00" autocomplete="off"></label>
              <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${esc(d.tarih)}"></label>
            </div>`
          : `<label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${esc(d.tarih)}"></label>`}
        <label class="alan"><span>Not (isteğe bağlı)</span><input type="text" name="not" maxlength="500" value="${esc(d.not)}" placeholder="${dekont ? 'Örneğin kasım ayı' : 'Örneğin hastane, hekim adı'}" autocomplete="off" enterkeyhint="done"></label>
        <div class="alan"><span>Dosyalar</span>
          <div class="dosya-liste" id="dosyaListe"></div>
          <label class="dugme dosya-ekle">${ikon('arti')}Fotoğraf ya da PDF ekle<input type="file" id="formDosya" class="gizli" accept="image/*,application/pdf" multiple></label>
        </div>
        <p class="hata" id="formHata" hidden></p>
      </div>
      ${pencereAlt('belge-sil', b && b.id)}</form>`);
    formDosyalar = d.dosyalar.map(x => Object.assign({}, x));
    dosyaListeCiz();
  }

  async function formDosyaSecildi(girdi) {
    const secilen = Array.from(girdi.files || []);
    girdi.value = '';
    if (!secilen.length) return;
    const form = $('form[data-form="belge"]', pencere);
    const etiket = girdi.closest('label');
    pencere.dataset.kirli = '1';
    if (etiket) etiket.style.opacity = '0.5';
    let atlanan = '';
    for (const dosya of secilen) {
      if (formDosyalar.length >= DOSYA_ADEDI) { atlanan = `Bir kayda en çok ${DOSYA_ADEDI} dosya eklenebilir.`; break; }
      if (dosya.size > DOSYA_SINIRI) { atlanan = `"${dosya.name}" çok büyük; en çok ${boyutMetni(DOSYA_SINIRI)} olabilir.`; continue; }
      try {
        const hazir = await dosyaHazirla(dosya);
        if ($('form[data-form="belge"]', pencere) !== form) return; // pencere bu arada kapandı
        formDosyalar.push(hazir);
        dosyaListeCiz();
      } catch (e) { atlanan = `"${dosya.name}" okunamadı.`; }
    }
    if (etiket && etiket.isConnected) etiket.style.opacity = '';
    if (atlanan) formHata(atlanan);
  }

  function formHata(metin) {
    const h = $('#formHata', pencere);
    if (h) { h.textContent = metin; h.hidden = false; }
  }

  const FORMLAR = {
    not() { pencereKapat('tamam'); },
    kart(f) {
      const e = f.elements, icerik = e.icerik.value.trim();
      if (!icerik) { formHata('Kopyalanacak bilgiyi yazın.'); e.icerik.focus(); return; }
      const alan = { tur: e.tur.value || 'diger', baslik: e.baslik.value.trim(), icerik, sabit: e.sabit.checked };
      const t = simdi();
      const k = f.dataset.id ? veri.kartlar.find(x => x.id === f.dataset.id) : null;
      if (k) Object.assign(k, alan, { g: t }); else veri.kartlar.push(Object.assign({ id: kimlik(), olusturma: t, g: t }, alan));
      kaydet(); pencereKapat(); ciz();
    },
    tarih(f) {
      const e = f.elements, ad = e.ad.value.trim();
      if (!ad) { formHata('Tarihin ne için olduğunu yazın.'); e.ad.focus(); return; }
      if (!tarihMi(e.tarih.value)) { formHata('Bir tarih seçin.'); e.tarih.focus(); return; }
      const alan = { ad, tarih: e.tarih.value, yillik: e.yillik.checked, not: e.not.value.trim() };
      const z = simdi();
      const t = f.dataset.id ? veri.tarihler.find(x => x.id === f.dataset.id) : null;
      if (t) Object.assign(t, alan, { g: z }); else veri.tarihler.push(Object.assign({ id: kimlik(), olusturma: z, g: z }, alan));
      kaydet(); pencereKapat(); ciz();
    },
    async belge(f) {
      const e = f.elements, dekont = f.dataset.bolum === 'dekont', baslik = e.baslik.value.trim();
      if (!baslik) { formHata(dekont ? 'Ödemenin kime ya da ne için yapıldığını yazın.' : 'Kayda kısa bir ad verin.'); e.baslik.focus(); return; }
      if (!tarihMi(e.tarih.value)) { formHata('Bir tarih seçin.'); e.tarih.focus(); return; }
      let tutar = null;
      if (dekont && e.tutar.value.trim()) {
        tutar = tutarOku(e.tutar.value);
        if (tutar === null) { formHata('Tutarı rakamla yazın; örneğin 1.250,50'); e.tutar.focus(); return; }
      }
      const dugme = $('button[type="submit"]', f);
      if (dugme.disabled) return;
      dugme.disabled = true;
      try {
        for (const d of formDosyalar) if (d.veri) await dosyaDeposu.yaz(d.id, { tip: d.tip, veri: d.veri });
      } catch (err) {
        dugme.disabled = false;
        formHata('Dosya bu cihaza kaydedilemedi. Cihazda yer kalmamış ya da tarayıcı gizli modda olabilir.');
        return;
      }
      const alan = {
        bolum: dekont ? 'dekont' : 'tibbi', baslik, tur: dekont ? '' : (e.tur.value || 'diger'), tarih: e.tarih.value, tutar,
        not: e.not.value.trim(),
        dosyalar: formDosyalar.map(d => ({ id: d.id, ad: d.ad, tip: d.tip, boyut: d.boyut })),
      };
      const z = simdi();
      const b = f.dataset.id ? veri.belgeler.find(x => x.id === f.dataset.id) : null;
      if (b) Object.assign(b, alan, { g: z }); else veri.belgeler.push(Object.assign({ id: kimlik(), olusturma: z, g: z }, alan));
      kaydet(); pencereKapat(); ciz();
    },
  };

  /* ---------- Yedek ---------- */

  // Yedek, sıkıştırmasız bir zip dosyasıdır: içinde veri.json ve dosyalar/ klasörü bulunur.
  const CRC_TABLO = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC_TABLO[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipYaz(girdiler) {
    const kod = new TextEncoder(), parcalar = [], dizin = [];
    const d = new Date();
    const saat = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const tarih = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let konum = 0, dizinBoy = 0;
    for (const g of girdiler) {
      const ad = kod.encode(g.ad), crc = crc32(g.veri), boy = g.veri.length;
      const y = new DataView(new ArrayBuffer(30));
      y.setUint32(0, 0x04034b50, true); y.setUint16(4, 20, true); y.setUint16(6, 0x0800, true);
      y.setUint16(10, saat, true); y.setUint16(12, tarih, true);
      y.setUint32(14, crc, true); y.setUint32(18, boy, true); y.setUint32(22, boy, true); y.setUint16(26, ad.length, true);
      parcalar.push(y.buffer, ad, g.veri);
      const m = new DataView(new ArrayBuffer(46));
      m.setUint32(0, 0x02014b50, true); m.setUint16(4, 20, true); m.setUint16(6, 20, true); m.setUint16(8, 0x0800, true);
      m.setUint16(12, saat, true); m.setUint16(14, tarih, true);
      m.setUint32(16, crc, true); m.setUint32(20, boy, true); m.setUint32(24, boy, true); m.setUint16(28, ad.length, true);
      m.setUint32(42, konum, true);
      dizin.push(m.buffer, ad);
      konum += 30 + ad.length + boy;
      dizinBoy += 46 + ad.length;
    }
    const s = new DataView(new ArrayBuffer(22));
    s.setUint32(0, 0x06054b50, true); s.setUint16(8, girdiler.length, true); s.setUint16(10, girdiler.length, true);
    s.setUint32(12, dizinBoy, true); s.setUint32(16, konum, true);
    return new Blob([...parcalar, ...dizin, s.buffer], { type: 'application/zip' });
  }

  async function zipOku(dosya) {
    const kuyruk = new DataView(await dosya.slice(Math.max(0, dosya.size - 66000)).arrayBuffer());
    let i = kuyruk.byteLength - 22;
    while (i >= 0 && kuyruk.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) throw new Error('zip değil');
    const adet = kuyruk.getUint16(i + 10, true), dizinBoy = kuyruk.getUint32(i + 12, true), dizinBas = kuyruk.getUint32(i + 16, true);
    const dz = new DataView(await dosya.slice(dizinBas, dizinBas + dizinBoy).arrayBuffer());
    const coz = new TextDecoder(), girdiler = new Map();
    let k = 0;
    for (let n = 0; n < adet; n++) {
      if (dz.getUint32(k, true) !== 0x02014b50) throw new Error('zip bozuk');
      const adBoy = dz.getUint16(k + 28, true);
      girdiler.set(coz.decode(new Uint8Array(dz.buffer, k + 46, adBoy)), { yontem: dz.getUint16(k + 10, true), boy: dz.getUint32(k + 20, true), yerel: dz.getUint32(k + 42, true) });
      k += 46 + adBoy + dz.getUint16(k + 30, true) + dz.getUint16(k + 32, true);
    }
    return {
      async oku(ad) {
        const g = girdiler.get(ad);
        if (!g || g.yontem !== 0) return null;
        const y = new DataView(await dosya.slice(g.yerel, g.yerel + 30).arrayBuffer());
        const bas = g.yerel + 30 + y.getUint16(26, true) + y.getUint16(28, true);
        return dosya.slice(bas, bas + g.boy).arrayBuffer();
      },
    };
  }

  async function yedekAl(el) {
    if (el && el.disabled) return;
    if (el) el.disabled = true;
    try {
      const ad = `cebimde-yedek-${bugun()}.zip`;
      const zaman = simdi();
      const kopya = Object.assign({}, veri, { sonYedek: zaman });
      const girdiler = [{ ad: 'veri.json', veri: new TextEncoder().encode(JSON.stringify({ uygulama: 'cebimde', surum: 1, tarih: new Date(zaman).toISOString(), veri: kopya }, null, 1)) }];
      let eksik = 0;
      for (const id of dosyaKimlikleri(veri)) {
        let k = null;
        try { k = await dosyaDeposu.oku(id); } catch (e) { k = null; }
        if (k && k.veri) girdiler.push({ ad: 'dosyalar/' + id, veri: new Uint8Array(k.veri) }); else eksik++;
      }
      const zip = zipYaz(girdiler);
      // Dosyalar okunurken geçen süre yüzünden paylaşım ekranı açılamayabilir; bu yüzden yeni bir dokunuş istenir.
      const c = await sor({
        baslik: 'Yedek hazır',
        metin: `${girdiler.length - 1} dosya ile birlikte ${boyutMetni(zip.size)}.${eksik ? ` ${eksik} dosya bu cihazda bulunamadığı için yedeğe girmedi.` : ''} Kaydetmek ya da başka cihaza göndermek için devam edin.`,
        dugme: 'Kaydet',
      });
      if (c !== 'tamam') return;
      if (!(dokunmatik() && await dosyaPaylas(zip, ad, 'application/zip'))) indir(zip, ad, 'application/zip');
      veri.sonYedek = zaman;
      kaydet();
      if (gorunum === 'ayarlar') ciz();
    } finally { if (el && el.isConnected) el.disabled = false; }
  }

  async function yedekOku(girdi) {
    const dosya = girdi.files && girdi.files[0];
    girdi.value = '';
    if (!dosya) return;
    let zip = null, ham = null;
    try {
      zip = await zipOku(dosya);
      ham = JSON.parse(new TextDecoder().decode(await zip.oku('veri.json')));
    } catch (e) { ham = null; }
    if (!ham || ham.uygulama !== 'cebimde' || !ham.veri || typeof ham.veri !== 'object') {
      bildir('Bu dosya bir Cebimde yedeği değil.');
      return;
    }
    const gelen = duzelt(ham.veri);
    const tarih = ham.tarih && !isNaN(Date.parse(ham.tarih)) ? bicimSaat.format(new Date(ham.tarih)) + ' tarihli yedekte ' : 'Yedekte ';
    const c = await sor({
      baslik: 'Yedekten yükle',
      metin: `${tarih}${gelen.notlar.length} not, ${gelen.kartlar.length} bilgi, ${gelen.tarihler.length} tarih ve ${gelen.belgeler.length} belge kaydı var. Birleştirirseniz bu cihazdaki kayıtlar korunur, yedektekiler eklenir.`,
      dugme: 'Birleştir',
      ikinci: 'Buradakileri sil, yedeği yükle',
    });
    if (c === 'vazgec') return;
    const once = JSON.stringify(veri);
    const yeni = c === 'tamam' ? birlestir(veri, gelen) : Object.assign(gelen, { sonYedek: veri.sonYedek });
    let eksik = 0, varOlan = new Set();
    try { varOlan = new Set(await dosyaDeposu.anahtarlar()); } catch (e) { /* aşağıda yazarken anlaşılır */ }
    for (const id of dosyaKimlikleri(yeni)) {
      if (varOlan.has(id)) continue;
      const tip = (yeni.belgeler.flatMap(b => b.dosyalar).find(d => d.id === id) || {}).tip;
      try {
        const icerik = await zip.oku('dosyalar/' + id);
        if (icerik) await dosyaDeposu.yaz(id, { tip, veri: icerik }); else eksik++;
      } catch (e) { eksik++; }
    }
    veri = yeni;
    kaydet(); ciz();
    bildir((c === 'tamam' ? 'Yedek bu cihazdaki kayıtlarla birleştirildi.' : 'Yedek yüklendi.') + (eksik ? ` ${eksik} dosya alınamadı.` : ''), once);
  }

  /* ---------- İşlemler ---------- */

  function ekle() {
    if (gorunum === 'bilgiler') kartPenceresi();
    else if (gorunum === 'tarihler') tarihPenceresi();
    else if (gorunum === 'tibbi' || gorunum === 'dekont') belgePenceresi(gorunum);
    else notPenceresi();
  }

  function kayitSil(liste, id, mesaj, sonuc) {
    const once = JSON.stringify(veri);
    veri[liste] = veri[liste].filter(x => x.id !== id);
    silindi(id);
    kaydet(); pencereKapat(sonuc); ciz();
    bildir(mesaj, once);
  }

  const ISLEMLER = {
    ekle,
    'pencere-kapat': () => pencereKapat(),
    'gosterici-kapat': gostericiKapat,
    'geri-al'() {
      if (!geriAlVeri) return;
      try { veri = duzelt(JSON.parse(geriAlVeri)); } catch (e) { return; }
      geriAlVeri = null; bildirimKutu.hidden = true;
      kaydet(); ciz();
    },
    'kur-not-kapat'() { cihaz.kurNotKapali = true; depoYaz(CIHAZ_ANAHTAR, JSON.stringify(cihaz)); ciz(); },

    'not-ac'(el) {
      if (acikSar) { sarKapat(); return; } // Sil düğmesi açıkken nota dokunmak yalnızca satırı kapatır
      notPenceresi(el.dataset.id);
    },
    'not-sil': el => kayitSil('notlar', el.dataset.id, 'Not silindi.', 'sil'),
    'not-kaydir-sil'(el) { acikSar = null; kayitSil('notlar', el.dataset.id, 'Not silindi.', 'sil'); },

    tur(el) { ui.tur = el.dataset.tur; ciz(); },
    'kart-ornek'(el) { const o = KART_ORNEK[Number(el.dataset.sira)]; if (o) kartPenceresi(null, o); },
    'kart-ac': el => kartPenceresi(el.dataset.id),
    'kart-sil': el => kayitSil('kartlar', el.dataset.id, 'Bilgi silindi.'),
    async kopyala(el) {
      const k = veri.kartlar.find(x => x.id === el.dataset.id);
      if (!k) return;
      if (!(await panoyaYaz(k.icerik))) { bildir('Kopyalanamadı. Metni basılı tutarak seçip kopyalayabilirsiniz.'); return; }
      el.innerHTML = `${ikon('tik')}Kopyalandı`;
      clearTimeout(el._sayac);
      el._sayac = setTimeout(() => { if (el.isConnected) el.textContent = 'Kopyala'; }, 1600);
    },
    async paylas(el) {
      const k = veri.kartlar.find(x => x.id === el.dataset.id);
      if (!k || !navigator.share) return;
      try { await navigator.share({ text: k.icerik }); } catch (e) { /* kullanıcı vazgeçti */ }
    },

    'tarih-ornek'(el) { const o = TARIH_ORNEK[Number(el.dataset.sira)]; if (o) tarihPenceresi(null, o); },
    'tarih-ac': el => tarihPenceresi(el.dataset.id),
    'tarih-sil': el => kayitSil('tarihler', el.dataset.id, 'Tarih silindi.'),
    takvim(el) {
      const t = veri.tarihler.find(x => x.id === el.dataset.id);
      if (t) indir(takvimMetni(t), sadeAd(t.ad, 'tarih') + '.ics', 'text/calendar;charset=utf-8');
    },

    'tibbi-tur'(el) { ui.tibbiTur = el.dataset.tur; ciz(); },
    'belge-ac': el => belgePenceresi(null, el.dataset.id),
    'belge-sil'(el) {
      const b = veri.belgeler.find(x => x.id === el.dataset.id);
      if (b) kayitSil('belgeler', b.id, b.bolum === 'dekont' ? 'Dekont silindi.' : 'Kayıt silindi.');
    },
    'dosya-ac'(el) {
      const b = veri.belgeler.find(x => x.id === el.dataset.belge);
      const sira = b ? b.dosyalar.findIndex(d => d.id === el.dataset.id) : -1;
      if (sira >= 0) dosyaGoster(b.dosyalar[sira], dosyaEtiket(b.dosyalar, sira));
    },
    'form-dosya-ac'(el) {
      const sira = Number(el.dataset.sira), d = formDosyalar[sira];
      if (d) dosyaGoster(d, dosyaEtiket(formDosyalar, sira), d.veri);
    },
    'form-dosya-sil'(el) {
      formDosyalar.splice(Number(el.dataset.sira), 1);
      pencere.dataset.kirli = '1';
      dosyaListeCiz();
    },
    async 'dosya-paylas'() {
      if (acikDosya && !(await dosyaPaylas(acikDosya.blob, acikDosya.ad, acikDosya.tip))) indir(acikDosya.blob, acikDosya.ad, acikDosya.tip);
    },
    'dosya-indir'() { if (acikDosya) indir(acikDosya.blob, acikDosya.ad, acikDosya.tip); },

    'yedek-al': yedekAl,
    async kur() {
      if (!kurIstegi) return;
      const k = kurIstegi; kurIstegi = null;
      try { k.prompt(); await k.userChoice; } catch (e) { /* kullanıcı vazgeçti */ }
      ciz();
    },
    async 'hepsini-sil'() {
      const c = await sor({ baslik: 'Bütün kayıtlar silinsin mi?', metin: 'Notlar, bilgiler, tarihler, tıbbi kayıtlar, dekontlar ve eklenen dosyalar bu cihazdan silinir. Yedeğiniz yoksa geri getirilemez.', dugme: 'Hepsini sil', tehlike: true });
      if (c !== 'tamam') return;
      const once = JSON.stringify(veri);
      veri = bosVeri();
      kaydet(); ciz();
      bildir('Bütün kayıtlar silindi.', once);
    },
  };

  /* ---------- Notu kaydırarak silme ---------- */

  // Parmakla sola kaydırılan notun arkasından Sil düğmesi çıkar. Yarıdan fazla açılırsa açık kalır;
  // başka bir yere dokunulunca ya da not geri itilince kapanır. Fareyle kaydırma yoktur.
  const KAYDIR = 84;
  let kaydir = null, acikSar = null, tiklamaYut = false;

  function sarDurum(sar, acik) {
    sar.classList.toggle('acik', acik);
    const kart = $('.not-kart', sar), dugme = $('.not-sil', sar);
    if (kart) kart.style.clipPath = kart.style.webkitClipPath = '';
    if (dugme) { dugme.tabIndex = acik ? 0 : -1; dugme.setAttribute('aria-hidden', String(!acik)); }
  }
  function sarKapat() {
    if (acikSar && acikSar.isConnected) sarDurum(acikSar, false);
    acikSar = null;
  }

  document.addEventListener('pointerdown', e => {
    const kart = e.target.closest ? e.target.closest('.not-sar .not-kart') : null;
    tiklamaYut = false;
    // Bir satır açıkken başka yere dokunmak yalnızca o satırı kapatır; bu dokunuş başka işlem başlatmaz.
    if (acikSar && !acikSar.contains(e.target)) { sarKapat(); tiklamaYut = true; }
    if (!kart || e.pointerType === 'mouse') return;
    kaydir = { sar: kart.parentElement, kart, id: e.pointerId, x0: e.clientX, y0: e.clientY, taban: kart.parentElement === acikSar ? -KAYDIR : 0, x: 0, yatay: false };
  }, { passive: true });

  document.addEventListener('pointermove', e => {
    if (!kaydir || e.pointerId !== kaydir.id) return;
    const dx = e.clientX - kaydir.x0, dy = e.clientY - kaydir.y0;
    if (!kaydir.yatay) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { kaydir = null; return; } // dikey hareket: sayfa kayar
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      kaydir.yatay = true;
      if (acikSar && acikSar !== kaydir.sar) sarKapat();
      kaydir.sar.classList.add('surukleniyor');
      try { kaydir.kart.setPointerCapture(e.pointerId); } catch (err) { /* yakalanamasa da sürükleme sürer */ }
    }
    let x = kaydir.taban + dx;
    if (x > 0) x = 0;
    if (x < -KAYDIR) x = -KAYDIR + (x + KAYDIR) * 0.2; // sınırın ötesinde direnç
    kaydir.x = x;
    // Kart yerinden oynamaz; sağ yanı parmakla birlikte açılır, yazı okunur kalır.
    kaydir.kart.style.clipPath = kaydir.kart.style.webkitClipPath = `inset(0 ${-x}px 0 0 round 8px)`;
  }, { passive: true });

  function kaydirBitir(e) {
    if (!kaydir || e.pointerId !== kaydir.id) return;
    const k = kaydir;
    kaydir = null;
    if (!k.yatay) return;
    k.sar.classList.remove('surukleniyor');
    tiklamaYut = true; // sürüklemenin ardından gelebilecek tıklama işlem başlatmasın
    setTimeout(() => { tiklamaYut = false; }, 80);
    const ac = k.x < -KAYDIR / 2;
    sarDurum(k.sar, ac);
    acikSar = ac ? k.sar : (acikSar === k.sar ? null : acikSar);
  }
  document.addEventListener('pointerup', kaydirBitir);
  document.addEventListener('pointercancel', kaydirBitir);

  /* ---------- Olaylar ---------- */

  document.addEventListener('click', e => {
    // Kaydırmanın ya da açık satırı kapatan dokunuşun ardından gelen tıklama işlem başlatmaz.
    if (tiklamaYut && !e.target.closest('.not-sil')) { tiklamaYut = false; e.preventDefault(); return; }
    const hedef = e.target.closest('[data-git]');
    if (hedef) { git(hedef.dataset.git); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const f = ISLEMLER[el.dataset.act];
    if (f) f(el);
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    FORMLAR[f.dataset.form](f);
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'yedekDosya') yedekOku(el);
    else if (el.id === 'formDosya') formDosyaSecildi(el);
    else if (el.name === 'tur' && $('form[data-form="kart"]', pencere)) {
      const a = $('textarea[name="icerik"]', pencere);
      if (a) a.placeholder = TUR_IPUCU[el.value] || '';
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'ara' || !LISTELER[gorunum]) return;
    ui.ara[gorunum] = e.target.value;
    const k = $('#liste');
    acikSar = null;
    if (k) k.innerHTML = LISTELER[gorunum]();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.ctrlKey || e.metaKey || e.altKey || pencere.open || onay.open || gosterici.open || !EKLE_YAZI[gorunum]) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    e.preventDefault();
    ekle();
  });

  // Başka bir pencerede yapılan değişiklik ya da gün dönümü ekrana yansıtılır;
  // kullanıcı o sırada yazıyorsa ekran bozulmaz.
  function yenile() {
    if (pencere.open || onay.open || gosterici.open) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && (a.value || '') !== '') return;
    ciz();
  }
  function gunKontrol() {
    if (bugun() !== sonGun) { sonGun = bugun(); yenile(); }
  }

  window.addEventListener('storage', e => {
    if (e.key !== VERI_ANAHTAR || !e.newValue) return;
    try { veri = duzelt(JSON.parse(e.newValue)); } catch (err) { return; }
    yenile();
  });
  window.addEventListener('hashchange', () => git(location.hash.slice(1)));
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); kurIstegi = e;
    if (gorunum === 'ayarlar') yenile();
  });
  window.addEventListener('appinstalled', () => { kurIstegi = null; yenile(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') gunKontrol(); });
  setInterval(gunKontrol, 60000);

  git(location.hash.slice(1));
  setTimeout(artiklariTemizle, 4000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
