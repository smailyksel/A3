/* Cebimde: sık paylaşılan bilgiler ve önemli tarihler.
   Bütün kayıtlar yalnızca bu cihazın tarayıcı deposunda (localStorage) tutulur;
   hiçbir sunucuya veri gönderilmez. Cihazlar arası aktarım yedek dosyasıyla yapılır.
   Birleştirme, her kaydın değişme zamanına (g) ve silinenlerin izine (silinen) bakar. */
(() => {
  'use strict';

  const VERI_ANAHTAR = 'cebimde.veri.v1';
  const CIHAZ_ANAHTAR = 'cebimde.cihaz.v1';
  const SURUM = '1.0';
  const YAKIN_GUN = 14;  // bu kadar gün ve azı kalan tarihler öne çıkarılır
  const ROZET_GUN = 7;   // bu kadar gün ve azı kalanlar ilk ekranda ve sekmede haber verilir

  const TURLER = { banka: 'Banka', adres: 'Adres', fatura: 'Fatura', mesaj: 'Mesaj', diger: 'Diğer' };
  const TUR_IPUCU = {
    banka: 'TR00 0000 0000 0000 0000 0000 00',
    adres: 'Mahalle, cadde, numara, ilçe / il',
    fatura: 'Ad soyad ya da unvan, vergi dairesi, vergi numarası',
    mesaj: 'Sık gönderdiğiniz mesajı yazın',
    diger: 'Kopyalamak istediğiniz bilgiyi yazın',
  };
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
  const GORUNUMLER = { bilgiler: 'Hazır Bilgiler', tarihler: 'Önemli Tarihler', ayarlar: 'Ayarlar' };
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
  const bicimSaat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function tarihMetni(s) {
    const d = tarihOku(s);
    const govde = d.getFullYear() === new Date().getFullYear() ? bicimGunAy.format(d) : bicimTam.format(d);
    return `${govde} ${GUN_UZUN[haftaGunu(s)]}`;
  }

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

  const bosVeri = () => ({ surum: 1, kartlar: [], tarihler: [], silinen: {}, sonYedek: 0 });

  // Depodan ya da yedek dosyasından gelen veriyi beklenen biçime sokar.
  function duzelt(h) {
    const v = bosVeri();
    if (!h || typeof h !== 'object') return v;
    const dizi = x => (Array.isArray(x) ? x : []);
    const metin = (x, enFazla) => (typeof x === 'string' ? x : '').slice(0, enFazla);
    const zaman = x => { const n = Number(x); return Number.isFinite(n) ? Math.min(1e15, Math.max(0, n)) : 0; };

    v.kartlar = dizi(h.kartlar).filter(x => x && x.id != null && typeof x.icerik === 'string' && x.icerik.trim()).map(x => ({
      id: temizKimlik(x.id),
      tur: Object.prototype.hasOwnProperty.call(TURLER, x.tur) ? x.tur : 'diger',
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
      kartlar: sec(yerel.kartlar, gelen.kartlar),
      tarihler: sec(yerel.tarihler, gelen.tarihler),
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

  /* ---------- Durum ---------- */

  let gorunum = 'bilgiler';
  const ui = { tur: 'tum', ara: '' };
  let sonGun = bugun();
  let kurIstegi = null;

  const kurulu = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const appleCihaz = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

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

  function dosyaAdi(ad) {
    const harf = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
    const sade = kucuk(ad).replace(/[çğıöşü]/g, c => harf[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return (sade || 'tarih') + '.ics';
  }

  function indir(icerik, ad, tip) {
    const url = URL.createObjectURL(new Blob([icerik], { type: tip }));
    const a = document.createElement('a');
    a.href = url; a.download = ad;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ---------- Kopyalama ve paylaşma ---------- */

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

  /* ---------- Çizim ---------- */

  // Başlık türün adını zaten içeriyorsa ("Fatura bilgileri", "Büro adresi") tür ayrıca yazılmaz.
  function kartEtiket(k) {
    if (!k.baslik) return TURLER[k.tur];
    if (k.tur === 'diger' || kucuk(k.baslik).includes(kucuk(TURLER[k.tur]))) return k.baslik;
    return `${TURLER[k.tur]} · ${k.baslik}`;
  }
  const haritaAdresi = adres => (appleCihaz() ? 'https://maps.apple.com/?q=' : 'https://www.google.com/maps/search/?api=1&query=') + encodeURIComponent(adres.replace(/\s+/g, ' '));

  function kartlarHtml() {
    const q = kucuk(ui.ara.trim());
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
    if (!veri.kartlar.length) {
      return h + `<div class="bos"><strong>Sık paylaştığınız bilgileri ekleyin</strong>IBAN, adres, fatura bilgileri ya da hazır bir mesaj. Sonra tek dokunuşla kopyalar, dilediğiniz uygulamaya gönderirsiniz.
        <div class="baslangic">${KART_ORNEK.map((o, i) => `<button type="button" class="dugme" data-act="kart-ornek" data-sira="${i}">${ikon('arti')}${esc(o.baslik)}</button>`).join('')}</div></div>`;
    }
    const turler = Object.keys(TURLER).filter(t => veri.kartlar.some(k => k.tur === t));
    if (ui.tur !== 'tum' && !turler.includes(ui.tur)) ui.tur = 'tum';
    if (turler.length > 1) {
      h += `<div class="cipler" role="group" aria-label="Tür">
        <button type="button" class="cip" data-act="tur" data-tur="tum" aria-pressed="${ui.tur === 'tum'}">Tümü</button>
        ${turler.map(t => `<button type="button" class="cip" data-act="tur" data-tur="${t}" aria-pressed="${ui.tur === t}">${TURLER[t]}</button>`).join('')}
      </div>`;
    }
    if (veri.kartlar.length >= 6) {
      h += `<div class="ara">${ikon('ara')}<label class="gizli" for="ara">Bilgilerde ara</label><input type="search" id="ara" placeholder="Ara" value="${esc(ui.ara)}" autocomplete="off" enterkeyhint="search"></div>`;
    } else ui.ara = '';
    return h + `<div id="kartlar">${kartlarHtml()}</div>`;
  }

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

  function cizAyarlar() {
    let h = `<section class="bolum"><div class="bolum-bas"><h2>Yedek ve aktarım</h2></div>
      <div class="kart ayar-kart">
        <p>Kayıtlarınız yalnızca bu cihazda durur, internete gönderilmez. Telefon ile bilgisayar arasında aktarmak için bir cihazda yedek alın, dosyayı diğerine gönderip orada yükleyin. Yükleme sırasında iki cihazın kayıtları birleştirilir.</p>
        <p>${veri.sonYedek ? 'Son yedek: <strong>' + esc(bicimSaat.format(new Date(veri.sonYedek))) + '</strong>' : 'Henüz yedek alınmadı.'}</p>
        <div class="dugmeler">
          <button type="button" class="dugme dugme-ana" data-act="yedek-al">${ikon('indir')}Yedek al</button>
          <label class="dugme">${ikon('yukle')}Yedekten yükle<input type="file" id="yedekDosya" class="gizli" accept=".json,application/json"></label>
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
        <p>${veri.kartlar.length} bilgi ve ${veri.tarihler.length} tarih kayıtlı.${depoCalisiyor ? '' : ' <strong>Tarayıcı deposuna yazılamıyor; kayıtlar kalıcı olmayabilir.</strong>'}</p>
        <p>Bu uygulama parola korumalı değildir. Banka şifresi, kart şifresi gibi gizli bilgileri buraya yazmayın.</p>
        <div class="dugmeler"><button type="button" class="dugme dugme-tehlike" data-act="hepsini-sil">Bütün kayıtları sil</button></div>
      </div></section>
    <p class="surum">Cebimde ${SURUM}</p>`;
    return h;
  }

  const CIZIMLER = { bilgiler: cizBilgiler, tarihler: cizTarihler, ayarlar: cizAyarlar };
  const EKLE_YAZI = { bilgiler: 'Yeni bilgi', tarihler: 'Yeni tarih' };

  function ciz() {
    document.documentElement.dataset.gorunum = gorunum;
    $$('[data-git]').forEach(b => {
      if (b.closest('.yan, .alt') && b.dataset.git === gorunum) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const n = yaklasanlar().length;
    $$('[data-rozet]').forEach(r => { r.hidden = !n; r.textContent = n ? String(n) : ''; });
    $('#ustEtiket').textContent = gorunum === 'bilgiler' ? `${veri.kartlar.length} bilgi` : gorunum === 'tarihler' ? `${veri.tarihler.length} tarih` : 'Cebimde';
    $('#ustBaslik').textContent = GORUNUMLER[gorunum];
    const yazi = EKLE_YAZI[gorunum];
    $('#ustEkle').hidden = !yazi;
    $('#yuzenEkle').hidden = !yazi;
    if (yazi) { $('#ustEkleYazi').textContent = yazi; $('#yuzenEkle').setAttribute('aria-label', yazi); }
    $('#icerik').innerHTML = CIZIMLER[gorunum]();
  }

  function git(g) {
    if (!GORUNUMLER[g]) g = 'bilgiler';
    const degisti = g !== gorunum;
    gorunum = g;
    try { history.replaceState(null, '', g === 'bilgiler' ? location.pathname + location.search : '#' + g); } catch (e) { /* adres değişmese de olur */ }
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
    bildirimSayac = setTimeout(() => { bildirimKutu.hidden = true; geriAlVeri = null; }, geriAl ? 7000 : 4000);
  }

  /* ---------- Pencereler ---------- */

  const pencere = $('#pencere'), onay = $('#onay');

  function modalAc(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function modalKapat(d) {
    if (!d.open) return;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function pencereAc(html) {
    pencere.innerHTML = html;
    delete pencere.dataset.kirli;
    modalAc(pencere);
    pencere.scrollTop = 0;
  }
  function pencereKapat() {
    modalKapat(pencere);
    pencere.innerHTML = '';
  }

  pencere.addEventListener('close', () => { pencere.innerHTML = ''; });
  pencere.addEventListener('input', () => { pencere.dataset.kirli = '1'; });
  pencere.addEventListener('click', e => {
    if (e.target !== pencere || pencere.dataset.kirli) return; // yazılmış bir form yanlışlıkla kapanmasın
    const r = pencere.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) pencereKapat();
  });

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

  function kartPenceresi(id, ontanim) {
    const k = id ? veri.kartlar.find(x => x.id === id) : null;
    if (id && !k) return;
    const d = k || Object.assign({ tur: ui.tur !== 'tum' ? ui.tur : 'banka', baslik: '', icerik: '', sabit: false }, ontanim);
    pencereAc(`<form data-form="kart" data-id="${k ? k.id : ''}" novalidate>
      <header class="pencere-bas"><h2>${k ? 'Bilgiyi düzenle' : 'Yeni bilgi'}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <fieldset class="alan"><legend>Tür</legend><div class="secenekler">${Object.keys(TURLER).map(t => `<label class="secenek"><input type="radio" name="tur" value="${t}"${d.tur === t ? ' checked' : ''}><span>${TURLER[t]}</span></label>`).join('')}</div></fieldset>
        <label class="alan"><span>Başlık</span><input type="text" name="baslik" maxlength="60" value="${esc(d.baslik)}" placeholder="Örneğin IBAN, büro adresi" autocomplete="off" enterkeyhint="next"></label>
        <label class="alan"><span>Kopyalanacak bilgi</span><textarea name="icerik" rows="4" maxlength="2000" placeholder="${esc(TUR_IPUCU[d.tur])}" autocomplete="off"${k ? '' : ' autofocus'}>${esc(d.icerik)}</textarea></label>
        <p class="hata" id="formHata" hidden></p>
        <label class="anahtar"><span>Başa sabitle</span><input type="checkbox" name="sabit"${d.sabit ? ' checked' : ''}><i></i></label>
      </div>
      <footer class="pencere-alt">
        ${k ? `<button type="button" class="dugme dugme-tehlike" data-act="kart-sil" data-id="${k.id}">Sil</button>` : ''}
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="pencere-kapat">Vazgeç</button>
        <button type="submit" class="dugme dugme-ana">Kaydet</button>
      </footer></form>`);
  }

  function tarihPenceresi(id, ontanim) {
    const t = id ? veri.tarihler.find(x => x.id === id) : null;
    if (id && !t) return;
    const d = t || Object.assign({ ad: '', tarih: '', yillik: false, not: '' }, ontanim);
    pencereAc(`<form data-form="tarih" data-id="${t ? t.id : ''}" novalidate>
      <header class="pencere-bas"><h2>${t ? 'Tarihi düzenle' : 'Yeni tarih'}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <label class="alan"><span>Ne için</span><input type="text" name="ad" maxlength="80" value="${esc(d.ad)}" placeholder="Örneğin kasko yenileme" autocomplete="off" enterkeyhint="next"${t || d.ad ? '' : ' autofocus'}></label>
        <label class="alan"><span>Tarih</span><input type="date" name="tarih" value="${esc(d.tarih)}"></label>
        <p class="hata" id="formHata" hidden></p>
        <label class="anahtar"><span>Her yıl tekrarlar<small>Doğum günü, yıllık yenileme gibi tarihler için.</small></span><input type="checkbox" name="yillik"${d.yillik ? ' checked' : ''}><i></i></label>
        <label class="alan"><span>Not (isteğe bağlı)</span><input type="text" name="not" maxlength="300" value="${esc(d.not)}" placeholder="Örneğin poliçe numarası" autocomplete="off" enterkeyhint="done"></label>
      </div>
      <footer class="pencere-alt">
        ${t ? `<button type="button" class="dugme dugme-tehlike" data-act="tarih-sil" data-id="${t.id}">Sil</button>` : ''}
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="pencere-kapat">Vazgeç</button>
        <button type="submit" class="dugme dugme-ana">Kaydet</button>
      </footer></form>`);
  }

  function formHata(metin) {
    const h = $('#formHata', pencere);
    if (h) { h.textContent = metin; h.hidden = false; }
  }

  const FORMLAR = {
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
  };

  /* ---------- Yedek ---------- */

  async function yedekAl() {
    const ad = `cebimde-yedek-${bugun()}.json`;
    const once = veri.sonYedek;
    veri.sonYedek = simdi();
    const metin = JSON.stringify({ uygulama: 'cebimde', surum: 1, tarih: new Date().toISOString(), veri }, null, 1);
    const tamam = () => { kaydet(); if (gorunum === 'ayarlar') ciz(); bildir('Yedek dosyası hazırlandı.'); };
    let dosya = null;
    try { dosya = new File([metin], ad, { type: 'application/json' }); } catch (e) { /* eski tarayıcı */ }
    const dokunmatik = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (dosya && dokunmatik && navigator.canShare && navigator.canShare({ files: [dosya] })) {
      try { await navigator.share({ files: [dosya], title: 'Cebimde yedeği' }); tamam(); return; }
      catch (e) { if (e && e.name === 'AbortError') { veri.sonYedek = once; return; } }
    }
    indir(metin, ad, 'application/json');
    tamam();
  }

  async function yedekOku(girdi) {
    const dosya = girdi.files && girdi.files[0];
    girdi.value = '';
    if (!dosya) return;
    let ham;
    try { ham = JSON.parse(await dosya.text()); } catch (e) { ham = null; }
    if (!ham || ham.uygulama !== 'cebimde' || !ham.veri || typeof ham.veri !== 'object') {
      bildir('Bu dosya bir Cebimde yedeği değil.');
      return;
    }
    const gelen = duzelt(ham.veri);
    const tarih = ham.tarih && !isNaN(Date.parse(ham.tarih)) ? bicimSaat.format(new Date(ham.tarih)) + ' tarihli yedekte ' : 'Yedekte ';
    const c = await sor({
      baslik: 'Yedekten yükle',
      metin: `${tarih}${gelen.kartlar.length} bilgi ve ${gelen.tarihler.length} tarih var. Birleştirirseniz bu cihazdaki kayıtlar korunur, yedektekiler eklenir.`,
      dugme: 'Birleştir',
      ikinci: 'Buradakileri sil, yedeği yükle',
    });
    if (c === 'vazgec') return;
    const once = JSON.stringify(veri);
    if (c === 'tamam') veri = birlestir(veri, gelen);
    else { gelen.sonYedek = veri.sonYedek; veri = gelen; }
    kaydet(); ciz();
    bildir(c === 'tamam' ? 'Yedek bu cihazdaki kayıtlarla birleştirildi.' : 'Yedek yüklendi.', once);
  }

  /* ---------- İşlemler ---------- */

  const ekle = () => (gorunum === 'tarihler' ? tarihPenceresi() : kartPenceresi());

  const ISLEMLER = {
    ekle,
    'pencere-kapat': pencereKapat,
    'geri-al'() {
      if (!geriAlVeri) return;
      try { veri = duzelt(JSON.parse(geriAlVeri)); } catch (e) { return; }
      geriAlVeri = null; bildirimKutu.hidden = true;
      kaydet(); ciz();
    },
    'kur-not-kapat'() { cihaz.kurNotKapali = true; depoYaz(CIHAZ_ANAHTAR, JSON.stringify(cihaz)); ciz(); },

    tur(el) { ui.tur = el.dataset.tur; ciz(); },
    'kart-ornek'(el) { const o = KART_ORNEK[Number(el.dataset.sira)]; if (o) kartPenceresi(null, o); },
    'kart-ac': el => kartPenceresi(el.dataset.id),
    'kart-sil'(el) {
      const once = JSON.stringify(veri);
      veri.kartlar = veri.kartlar.filter(k => k.id !== el.dataset.id);
      silindi(el.dataset.id);
      kaydet(); pencereKapat(); ciz();
      bildir('Bilgi silindi.', once);
    },
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
    'tarih-sil'(el) {
      const once = JSON.stringify(veri);
      veri.tarihler = veri.tarihler.filter(t => t.id !== el.dataset.id);
      silindi(el.dataset.id);
      kaydet(); pencereKapat(); ciz();
      bildir('Tarih silindi.', once);
    },
    takvim(el) {
      const t = veri.tarihler.find(x => x.id === el.dataset.id);
      if (t) indir(takvimMetni(t), dosyaAdi(t.ad), 'text/calendar;charset=utf-8');
    },

    'yedek-al': yedekAl,
    async kur() {
      if (!kurIstegi) return;
      const k = kurIstegi; kurIstegi = null;
      try { k.prompt(); await k.userChoice; } catch (e) { /* kullanıcı vazgeçti */ }
      ciz();
    },
    async 'hepsini-sil'() {
      const c = await sor({ baslik: 'Bütün kayıtlar silinsin mi?', metin: 'Bilgiler ve tarihler bu cihazdan silinir. Yedeğiniz yoksa geri getirilemez.', dugme: 'Hepsini sil', tehlike: true });
      if (c !== 'tamam') return;
      const once = JSON.stringify(veri);
      veri = bosVeri();
      kaydet(); ciz();
      bildir('Bütün kayıtlar silindi.', once);
    },
  };

  /* ---------- Olaylar ---------- */

  document.addEventListener('click', e => {
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
    else if (el.name === 'tur' && pencere.contains(el)) {
      const a = $('textarea[name="icerik"]', pencere);
      if (a) a.placeholder = TUR_IPUCU[el.value] || '';
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'ara') return;
    ui.ara = e.target.value;
    const k = $('#kartlar');
    if (k) k.innerHTML = kartlarHtml();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.ctrlKey || e.metaKey || e.altKey || pencere.open || onay.open || !EKLE_YAZI[gorunum]) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    e.preventDefault();
    ekle();
  });

  // Başka bir pencerede yapılan değişiklik ya da gün dönümü ekrana yansıtılır;
  // kullanıcı o sırada yazıyorsa ekran bozulmaz.
  function yenile() {
    if (pencere.open || onay.open) return;
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

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
