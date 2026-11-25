/* Günüm: görevler, alışkanlıklar, notlar ve odak sayacı.
   Bütün kayıtlar yalnızca bu cihazın tarayıcı deposunda (localStorage) tutulur;
   hiçbir sunucuya veri gönderilmez. Cihazlar arası aktarım yedek dosyasıyla yapılır.
   Birleştirme, her kaydın değişme zamanına (g) ve silinenlerin izine (silinen) bakar. */
(() => {
  'use strict';

  const VERI_ANAHTAR = 'gunum.veri.v1';
  const SAYAC_ANAHTAR = 'gunum.sayac.v1';
  const CIHAZ_ANAHTAR = 'gunum.cihaz.v1';
  const TEMA_ANAHTAR = 'gunum.tema';
  const SURUM = '1.0';

  const TEMALAR = [
    { id: 'altin', ad: 'Siyah ve Altın', zemin: '#0d0e11', yuzey: '#16181d', yazi: '#ece7dc', vurgu: '#cfa85a' },
    { id: 'gumus', ad: 'Siyah ve Gümüş', zemin: '#0f1012', yuzey: '#191b1f', yazi: '#e9eaed', vurgu: '#cdd2da' },
    { id: 'lacivert', ad: 'Gece Mavisi', zemin: '#0a101c', yuzey: '#121b2c', yazi: '#e4eaf4', vurgu: '#a3bfe8' },
  ];
  const TEKRARLAR = { '': 'Tekrarlamaz', gun: 'Her gün', haftaici: 'Hafta içi her gün', hafta: 'Her hafta', ay: 'Her ay', yil: 'Her yıl' };
  const ONCELIKLER = ['Normal', 'Orta', 'Yüksek'];
  const GORUNUMLER = { bugun: 'Bugün', gorevler: 'Görevler', aliskanliklar: 'Alışkanlıklar', notlar: 'Notlar', odak: 'Odak', ayarlar: 'Ayarlar' };
  const MODLAR = { odak: 'Odak', mola: 'Kısa mola', uzun: 'Uzun mola' };
  const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
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
  const tarihMi = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const bugun = () => tarihYaz(new Date());
  const gunEkle = (s, n) => { const d = tarihOku(s); d.setDate(d.getDate() + n); return tarihYaz(d); };
  const ayEkle = (s, n) => {
    const d = tarihOku(s), g = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(g, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return tarihYaz(d);
  };
  const haftaGunu = s => (tarihOku(s).getDay() + 6) % 7; // 0: Pazartesi
  const gunFarki = (a, b) => Math.round((tarihOku(a) - tarihOku(b)) / 864e5);

  const bicimUzun = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const bicimKisa = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
  const bicimYil = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const bicimSaat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function tarihEtiket(s) {
    const f = gunFarki(s, bugun());
    if (f === 0) return 'Bugün';
    if (f === 1) return 'Yarın';
    if (f === -1) return 'Dün';
    if (f > 1 && f < 7) return GUN_UZUN[haftaGunu(s)];
    const d = tarihOku(s);
    return d.getFullYear() === new Date().getFullYear() ? bicimKisa.format(d) : bicimYil.format(d);
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

  function varsayilan() {
    return {
      surum: 1,
      ayar: { tema: 'altin', odakDk: 25, molaDk: 5, uzunMolaDk: 15, ses: true, g: 0 },
      listeler: [
        { id: 'kisisel', ad: 'Kişisel', g: 0 },
        { id: 'ev', ad: 'Ev', g: 0 },
        { id: 'alisveris', ad: 'Alışveriş', g: 0 },
      ],
      gorevler: [], aliskanliklar: [], notlar: [], odak: [], silinen: {}, sonYedek: 0,
    };
  }

  // Depodan ya da yedek dosyasından gelen veriyi beklenen biçime sokar.
  function duzelt(h) {
    const v = varsayilan();
    if (!h || typeof h !== 'object') return v;
    const dizi = x => (Array.isArray(x) ? x : []);
    const metin = (x, enFazla) => (typeof x === 'string' ? x : '').slice(0, enFazla);
    const sayi = (x, vars, enAz, enCok) => { const n = Number(x); return Number.isFinite(n) ? Math.min(enCok, Math.max(enAz, n)) : vars; };
    const zaman = x => sayi(x, 0, 0, 1e15);

    const a = h.ayar && typeof h.ayar === 'object' ? h.ayar : {};
    v.ayar = {
      tema: TEMALAR.some(t => t.id === a.tema) ? a.tema : 'altin',
      odakDk: Math.round(sayi(a.odakDk, 25, 1, 180)),
      molaDk: Math.round(sayi(a.molaDk, 5, 1, 60)),
      uzunMolaDk: Math.round(sayi(a.uzunMolaDk, 15, 1, 90)),
      ses: a.ses !== false,
      g: zaman(a.g),
    };

    if (Array.isArray(h.listeler)) {
      v.listeler = h.listeler.filter(l => l && l.id != null && temizKimlik(l.id))
        .map(l => ({ id: temizKimlik(l.id), ad: metin(l.ad, 40).trim() || 'Liste', g: zaman(l.g) }));
    }
    const listeVar = id => id != null && v.listeler.some(l => l.id === String(id));

    v.gorevler = dizi(h.gorevler).filter(x => x && x.id != null && typeof x.baslik === 'string' && x.baslik.trim()).map(x => ({
      id: temizKimlik(x.id),
      baslik: metin(x.baslik, 200).trim(),
      not: metin(x.not, 4000),
      tarih: tarihMi(x.tarih) ? x.tarih : null,
      listeId: listeVar(x.listeId) ? String(x.listeId) : null,
      oncelik: Math.round(sayi(x.oncelik, 0, 0, 2)),
      tekrar: typeof x.tekrar === 'string' && Object.prototype.hasOwnProperty.call(TEKRARLAR, x.tekrar) ? x.tekrar : '',
      bitti: x.bitti === true,
      bittiTarih: tarihMi(x.bittiTarih) ? x.bittiTarih : null,
      olusturma: zaman(x.olusturma),
      g: zaman(x.g),
    }));

    v.aliskanliklar = dizi(h.aliskanliklar).filter(x => x && x.id != null && typeof x.ad === 'string' && x.ad.trim()).map(x => {
      const kayit = {};
      if (x.kayit && typeof x.kayit === 'object') {
        for (const k of Object.keys(x.kayit)) {
          const n = Number(x.kayit[k]);
          if (tarihMi(k) && Number.isFinite(n) && n !== 0) kayit[k] = n;
        }
      }
      let gunler = [...new Set(dizi(x.gunler).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
      if (!gunler.length) gunler = [0, 1, 2, 3, 4, 5, 6];
      return { id: temizKimlik(x.id), ad: metin(x.ad, 80).trim(), gunler, kayit, olusturma: zaman(x.olusturma), g: zaman(x.g) };
    });

    v.notlar = dizi(h.notlar).filter(x => x && x.id != null && (String(x.baslik || '').trim() || String(x.metin || '').trim())).map(x => ({
      id: temizKimlik(x.id),
      baslik: metin(x.baslik, 120),
      metin: metin(x.metin, 20000),
      sabit: x.sabit === true,
      olusturma: zaman(x.olusturma),
      g: zaman(x.g),
    }));

    v.odak = dizi(h.odak).filter(x => x && x.id != null && Number(x.t) > 0 && Number(x.dk) > 0)
      .map(x => ({ id: temizKimlik(x.id), t: zaman(x.t), dk: Math.round(sayi(x.dk, 1, 1, 600)) }));

    if (h.silinen && typeof h.silinen === 'object') {
      const sinir = simdi() - 400 * 864e5; // çok eski silme izleri tutulmaz
      for (const k of Object.keys(h.silinen)) {
        const n = Number(h.silinen[k]);
        if (Number.isFinite(n) && n > sinir && temizKimlik(k) === k) v.silinen[k] = n;
      }
    }
    v.sonYedek = zaman(h.sonYedek);
    for (const k of ['listeler', 'gorevler', 'aliskanliklar', 'notlar', 'odak']) v[k] = v[k].filter(x => x.id);
    return v;
  }

  // İki cihazın kayıtlarını birleştirir: aynı kayıtta sonradan değişen kalır, silinenler geri gelmez.
  function birlestir(yerel, gelen) {
    const silinen = Object.assign({}, yerel.silinen);
    for (const k of Object.keys(gelen.silinen)) silinen[k] = Math.max(silinen[k] || 0, gelen.silinen[k]);
    const sec = (a, b, ozel) => {
      const m = new Map();
      for (const x of a) m.set(x.id, x);
      for (const y of b) {
        const x = m.get(y.id);
        m.set(y.id, !x ? y : ozel ? ozel(x, y) : (y.g > x.g ? y : x));
      }
      return [...m.values()].filter(x => !(silinen[x.id] && silinen[x.id] >= (x.g || x.t || 0)));
    };
    const aliskanlikSec = (x, y) => {
      const temel = y.g > x.g ? y : x;
      const kayit = Object.assign({}, x.kayit);
      for (const k of Object.keys(y.kayit)) {
        if (!kayit[k] || Math.abs(y.kayit[k]) > Math.abs(kayit[k])) kayit[k] = y.kayit[k];
      }
      return Object.assign({}, temel, { kayit });
    };
    return duzelt({
      surum: 1,
      ayar: gelen.ayar.g > yerel.ayar.g ? gelen.ayar : yerel.ayar,
      listeler: sec(yerel.listeler, gelen.listeler),
      gorevler: sec(yerel.gorevler, gelen.gorevler),
      aliskanliklar: sec(yerel.aliskanliklar, gelen.aliskanliklar, aliskanlikSec),
      notlar: sec(yerel.notlar, gelen.notlar),
      odak: sec(yerel.odak, gelen.odak, x => x),
      silinen,
      sonYedek: yerel.sonYedek,
    });
  }

  let veri = duzelt(jsonOku(VERI_ANAHTAR));
  let cihaz = Object.assign({ bildirim: false, ekranAcik: false, kurNotKapali: false }, jsonOku(CIHAZ_ANAHTAR) || {});
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
  const cihazKaydet = () => depoYaz(CIHAZ_ANAHTAR, JSON.stringify(cihaz));
  const silindi = id => { veri.silinen[id] = simdi(); };

  /* ---------- Durum ---------- */

  let gorunum = 'bugun';
  const ui = { gorevSekme: 'acik', gorevListe: 'tum', notAra: '' };
  let sonGun = bugun();
  let kurIstegi = null;

  const kurulu = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const listeAd = id => { const l = veri.listeler.find(x => x.id === id); return l ? l.ad : ''; };
  const sirala = l => l.slice().sort((a, b) => {
    const x = a.tarih || '9999', y = b.tarih || '9999';
    return x < y ? -1 : x > y ? 1 : (b.oncelik - a.oncelik) || (a.olusturma - b.olusturma);
  });

  /* ---------- Görevler ---------- */

  function sonrakiTarih(tarih, tekrar) {
    const t = bugun();
    const adim = x => {
      if (tekrar === 'gun') return gunEkle(x, 1);
      if (tekrar === 'hafta') return gunEkle(x, 7);
      if (tekrar === 'ay') return ayEkle(x, 1);
      if (tekrar === 'yil') return ayEkle(x, 12);
      let y = gunEkle(x, 1);
      while (haftaGunu(y) > 4) y = gunEkle(y, 1);
      return y;
    };
    let s = tarih || t, i = 0;
    do { s = adim(s); } while (s <= t && ++i < 4000);
    return s;
  }

  function gorevEkle(alanlar) {
    const t = simdi();
    const g = Object.assign({ id: kimlik(), baslik: '', not: '', tarih: null, listeId: null, oncelik: 0, tekrar: '', bitti: false, bittiTarih: null, olusturma: t, g: t }, alanlar);
    if (g.tekrar && !g.tarih) g.tarih = bugun();
    veri.gorevler.push(g);
    return g;
  }

  function gorevIsaret(id) {
    const g = veri.gorevler.find(x => x.id === id);
    if (!g) return;
    const once = JSON.stringify(veri), t = simdi();
    if (g.bitti) {
      g.bitti = false; g.bittiTarih = null; g.g = t;
      kaydet(); ciz();
      return;
    }
    let ek = '';
    if (g.tekrar) {
      const yeni = Object.assign({}, g, { id: kimlik(), tarih: sonrakiTarih(g.tarih, g.tekrar), olusturma: t, g: t });
      veri.gorevler.push(yeni);
      g.tekrar = '';
      ek = ` Sıradaki: ${tarihEtiket(yeni.tarih)}.`;
    }
    g.bitti = true; g.bittiTarih = bugun(); g.g = t;
    kaydet(); ciz();
    bildir('Görev tamamlandı.' + ek, once);
  }

  function gorevSatir(g, sec) {
    sec = sec || {};
    const t = bugun(), parca = [];
    if (g.tarih && !sec.tarihGizle && !(sec.bugunGizle && g.tarih === t)) {
      parca.push(`<span class="${!g.bitti && g.tarih < t ? 'gecikmis' : ''}">${esc(tarihEtiket(g.tarih))}</span>`);
    }
    const l = listeAd(g.listeId);
    if (l && !sec.listeGizle) parca.push(`<span>${esc(l)}</span>`);
    if (g.tekrar) parca.push(`<span>${ikon('tekrar', 'ikon-k')}${TEKRARLAR[g.tekrar]}</span>`);
    if (g.oncelik === 2 && !g.bitti) parca.push('<span class="onemli">Yüksek öncelik</span>');
    if (g.not) parca.push(`<span>${ikon('not', 'ikon-k')}Not</span>`);
    return `<li class="gorev${g.bitti ? ' bitti' : ''} oncelik-${g.bitti ? 0 : g.oncelik}">
      <button type="button" class="kutu" role="checkbox" aria-checked="${g.bitti}" aria-label="${esc(g.baslik)}" data-act="gorev-isaret" data-id="${g.id}"><i>${ikon('tik')}</i></button>
      <button type="button" class="gorev-govde" data-act="gorev-ac" data-id="${g.id}">
        <span class="gorev-baslik">${esc(g.baslik)}</span>${parca.length ? `<span class="gorev-alt">${parca.join('')}</span>` : ''}
      </button>
    </li>`;
  }

  const gorevKart = (l, sec) => `<ul class="kart satirlar">${l.map(g => gorevSatir(g, sec)).join('')}</ul>`;
  const bolumBas = (ad, sayi, ek, sinif) =>
    `<div class="bolum-bas${sinif ? ' ' + sinif : ''}"><h2>${ad}${sayi != null ? `<b>${sayi}</b>` : ''}</h2>${ek || ''}</div>`;
  const bos = (baslik, metin, dugme) =>
    `<div class="bos"><strong>${baslik}</strong>${metin}${dugme ? `<div><button type="button" class="dugme dugme-ana" data-act="ekle">${ikon('arti')}${dugme}</button></div>` : ''}</div>`;

  /* ---------- Alışkanlıklar ---------- */

  const yapildi = (a, tarih) => (a.kayit[tarih] || 0) > 0;

  function seri(a) {
    const anahtarlar = Object.keys(a.kayit).filter(k => a.kayit[k] > 0);
    if (!anahtarlar.length) return 0;
    const ilk = anahtarlar.sort()[0];
    let t = bugun(), n = 0;
    if (!yapildi(a, t)) t = gunEkle(t, -1); // bugün henüz yapılmadıysa seri bozulmuş sayılmaz
    while (t >= ilk) {
      if (yapildi(a, t)) n++;
      else if (a.gunler.includes(haftaGunu(t))) break;
      t = gunEkle(t, -1);
    }
    return n;
  }

  function gunMetni(gunler) {
    if (gunler.length === 7) return 'Her gün';
    const s = gunler.join('');
    if (s === '01234') return 'Hafta içi';
    if (s === '56') return 'Hafta sonu';
    return gunler.map(i => GUN_KISA[i]).join(', ');
  }

  function aliskanlikIsaret(id, tarih) {
    const a = veri.aliskanliklar.find(x => x.id === id);
    if (!a || !tarihMi(tarih) || tarih > bugun()) return;
    const t = simdi();
    a.kayit[tarih] = yapildi(a, tarih) ? -t : t;
    kaydet(); ciz();
  }

  /* ---------- Odak ---------- */

  function odakGunleri() {
    const m = {};
    for (const o of veri.odak) {
      const k = tarihYaz(new Date(o.t));
      const x = m[k] || (m[k] = { dk: 0, tur: 0 });
      x.dk += o.dk; x.tur++;
    }
    return m;
  }

  let sayac = (() => {
    const s = jsonOku(SAYAC_ANAHTAR);
    if (s && MODLAR[s.mod] && ['bos', 'calisiyor', 'durdu'].includes(s.durum)) {
      return { mod: s.mod, durum: s.durum, bitis: Number(s.bitis) || 0, kalan: Number(s.kalan) || 0, toplam: Number(s.toplam) || 0, dongu: Number(s.dongu) || 0 };
    }
    return { mod: 'odak', durum: 'bos', bitis: 0, kalan: 0, toplam: 0, dongu: 0 };
  })();
  let sayacIz = '';
  let ses = null;
  let kilit = null;

  const sayacKaydet = () => depoYaz(SAYAC_ANAHTAR, JSON.stringify(sayac));
  const modSure = mod => (mod === 'odak' ? veri.ayar.odakDk : mod === 'mola' ? veri.ayar.molaDk : veri.ayar.uzunMolaDk) * 60000;
  const sayacKalan = () => (sayac.durum === 'calisiyor' ? Math.max(0, sayac.bitis - simdi()) : sayac.durum === 'durdu' ? sayac.kalan : modSure(sayac.mod));
  const sayacToplam = () => (sayac.durum === 'bos' ? modSure(sayac.mod) : sayac.toplam || modSure(sayac.mod));
  const sureYaz = ms => { const sn = Math.ceil(ms / 1000); return `${iki(Math.floor(sn / 60))}:${iki(sn % 60)}`; };

  function sesHazirla() {
    try {
      const S = window.AudioContext || window.webkitAudioContext;
      if (!S) return;
      ses = ses || new S();
      if (ses.state === 'suspended') ses.resume();
    } catch (e) { ses = null; }
  }

  function zil() {
    if (!veri.ayar.ses || !ses) return;
    try {
      const t = ses.currentTime;
      [[0, 660], [0.32, 660], [0.64, 880]].forEach(([b, hz]) => {
        const o = ses.createOscillator(), k = ses.createGain();
        o.type = 'sine'; o.frequency.value = hz;
        k.gain.setValueAtTime(0.0001, t + b);
        k.gain.exponentialRampToValueAtTime(0.28, t + b + 0.02);
        k.gain.exponentialRampToValueAtTime(0.0001, t + b + 0.28);
        o.connect(k); k.connect(ses.destination);
        o.start(t + b); o.stop(t + b + 0.3);
      });
    } catch (e) { /* ses çalınamadıysa sessiz geçilir */ }
  }

  async function ekranKilidi(ac) {
    try {
      if (ac && cihaz.ekranAcik && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        if (!kilit) {
          kilit = await navigator.wakeLock.request('screen');
          kilit.addEventListener('release', () => { kilit = null; });
        }
      } else if (!ac && kilit) {
        const k = kilit; kilit = null;
        await k.release();
      }
    } catch (e) { kilit = null; }
  }

  function disBildirim(baslik, govde) {
    if (!cihaz.bildirim || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready
      .then(k => k.showNotification(baslik, { body: govde, icon: 'icons/icon-192.png', tag: 'gunum-odak' }))
      .catch(() => {});
  }

  function sayacBaslat() {
    sesHazirla();
    const kalan = sayac.durum === 'durdu' ? sayac.kalan : modSure(sayac.mod);
    if (sayac.durum === 'bos') sayac.toplam = kalan;
    sayac.durum = 'calisiyor'; sayac.bitis = simdi() + kalan;
    sayacKaydet(); ekranKilidi(true); sayacGoster();
  }

  function sayacDuraklat() {
    sayac.kalan = sayacKalan(); sayac.durum = 'durdu';
    sayacKaydet(); ekranKilidi(false); sayacGoster();
  }

  function sayacSifirla(mod) {
    sayac.durum = 'bos'; sayac.kalan = 0; sayac.toplam = 0; sayac.bitis = 0;
    if (mod) sayac.mod = mod;
    sayacKaydet(); ekranKilidi(false); sayacGoster();
  }

  // Süre dolduğunda (elle = false) ya da kullanıcı erken bitirdiğinde (elle = true) çağrılır.
  function sayacBitir(elle) {
    const mod = sayac.mod;
    let mesaj;
    if (mod === 'odak') {
      const gecen = sayacToplam() - (elle ? sayacKalan() : 0);
      const dk = Math.round(gecen / 60000);
      if (dk >= 1) {
        veri.odak.push({ id: kimlik(), t: elle ? simdi() : sayac.bitis, dk });
        kaydet();
      }
      sayac.dongu++;
      sayac.mod = sayac.dongu % 4 === 0 ? 'uzun' : 'mola';
      mesaj = dk >= 1 ? `${dk} dakikalık odak kaydedildi. Mola zamanı.` : 'Bir dakikadan kısa süre kaydedilmedi.';
    } else {
      sayac.mod = 'odak';
      mesaj = 'Mola bitti.';
    }
    sayac.durum = 'bos'; sayac.kalan = 0; sayac.toplam = 0; sayac.bitis = 0;
    sayacKaydet(); ekranKilidi(false);
    if (!elle) {
      zil();
      disBildirim(mod === 'odak' ? 'Odak süresi doldu' : 'Mola bitti', mod === 'odak' ? 'Mola zamanı.' : 'Yeni odak turuna başlayabilirsiniz.');
    }
    if (gorunum === 'odak' || gorunum === 'bugun') ciz(); else sayacGoster();
    bildir(mesaj);
  }

  function sayacGoster() {
    const kalan = sayacKalan(), toplam = sayacToplam();
    document.title = sayac.durum === 'calisiyor' ? `${sureYaz(kalan)} · ${MODLAR[sayac.mod]} · Günüm` : 'Günüm';
    if (gorunum !== 'odak') return;
    const sure = $('#sure');
    if (!sure) return;
    sure.textContent = sureYaz(kalan);
    const C = 2 * Math.PI * 54;
    $('#halkaDolu').setAttribute('stroke-dashoffset', String(C * (1 - (toplam ? kalan / toplam : 1))));
    const iz = sayac.mod + sayac.durum;
    if (iz === sayacIz) return;
    sayacIz = iz;
    $('#sureAlt').textContent = sayac.durum === 'durdu' ? 'Duraklatıldı' : MODLAR[sayac.mod];
    $$('[data-act="sayac-mod"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mod === sayac.mod)));
    const calisiyor = sayac.durum === 'calisiyor';
    $('#odakDugmeler').innerHTML =
      `<button type="button" class="dugme dugme-ana" data-act="${calisiyor ? 'sayac-duraklat' : 'sayac-baslat'}">${ikon(calisiyor ? 'durdur' : 'oynat')}${calisiyor ? 'Duraklat' : sayac.durum === 'durdu' ? 'Sürdür' : 'Başlat'}</button>` +
      (sayac.durum !== 'bos'
        ? `<button type="button" class="dugme" data-act="sayac-bitir">${sayac.mod === 'odak' ? 'Bitir' : 'Molayı geç'}</button><button type="button" class="dugme dugme-sade" data-act="sayac-sifirla">Sıfırla</button>`
        : '');
  }

  function tik() {
    if (sayac.durum !== 'calisiyor') return;
    if (sayac.bitis - simdi() <= 0) sayacBitir(false); else sayacGoster();
  }

  /* ---------- Çizim ---------- */

  function cizBugun() {
    const t = bugun(), hg = haftaGunu(t);
    const acik = veri.gorevler.filter(g => !g.bitti);
    const geciken = sirala(acik.filter(g => g.tarih && g.tarih < t));
    const bugunku = sirala(acik.filter(g => g.tarih === t));
    const biten = veri.gorevler.filter(g => g.bitti && g.bittiTarih === t).sort((a, b) => b.g - a.g);
    const als = veri.aliskanliklar.filter(a => a.gunler.includes(hg) || yapildi(a, t));
    const alYapilan = als.filter(a => yapildi(a, t)).length;
    const odak = odakGunleri()[t] || { dk: 0, tur: 0 };
    const toplam = geciken.length + bugunku.length + biten.length;
    const oran = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);

    let h = '';
    if (!kurulu() && !cihaz.kurNotKapali) {
      h += `<div class="kart kur-not"><div><strong>Uygulamayı cihazınıza kurun</strong>
        <p>Kendi simgesiyle açılır ve internet olmadan da çalışır.</p>
        <button type="button" class="metin-dugme" data-git="ayarlar">Kurulum adımlarını göster</button></div>
        <button type="button" class="simge-dugme" data-act="kur-not-kapat" aria-label="Kapat">${ikon('kapat')}</button></div>`;
    }
    h += `<div class="ozet">
      <button type="button" class="kart ozet-kutu" data-git="gorevler"><span class="ozet-ad">Görev</span><span class="ozet-sayi">${biten.length}<small>/ ${toplam}</small></span><span class="cubuk"><i style="width:${oran(biten.length, toplam)}%"></i></span></button>
      <button type="button" class="kart ozet-kutu" data-git="aliskanliklar"><span class="ozet-ad">Alışkanlık</span><span class="ozet-sayi">${alYapilan}<small>/ ${als.length}</small></span><span class="cubuk"><i style="width:${oran(alYapilan, als.length)}%"></i></span></button>
      <button type="button" class="kart ozet-kutu" data-git="odak"><span class="ozet-ad">Odak</span><span class="ozet-sayi">${odak.dk}<small>dk</small></span><span class="cubuk"><i style="width:${oran(odak.dk, veri.ayar.odakDk * 4)}%"></i></span></button>
    </div>
    <form class="hizli" data-form="hizli" novalidate>
      <label class="gizli" for="hizliGirdi">Bugüne görev ekle</label>
      <input id="hizliGirdi" name="baslik" type="text" maxlength="200" placeholder="Bugüne görev ekle" autocomplete="off" enterkeyhint="done">
      <button type="submit" class="dugme dugme-ana" aria-label="Görevi ekle">${ikon('arti')}</button>
    </form>
    <div class="bugun-izgara"><div>`;

    if (geciken.length) h += `<section class="bolum">${bolumBas('Geciken', geciken.length, '', 'uyari')}${gorevKart(geciken)}</section>`;
    h += `<section class="bolum">${bolumBas('Bugün', bugunku.length + biten.length || null)}`;
    h += bugunku.length + biten.length
      ? gorevKart(bugunku.concat(biten), { bugunGizle: true })
      : `<div class="bos"><strong>Bugün için görev yok</strong>Yukarıdaki kutuya yazıp ekleyebilirsiniz.</div>`;
    h += '</section></div><div>';

    h += `<section class="bolum">${bolumBas('Alışkanlıklar', als.length || null)}`;
    if (als.length) {
      h += `<ul class="kart satirlar">${als.map(a => {
        const s = seri(a), y = yapildi(a, t);
        return `<li class="gorev${y ? ' bitti' : ''}">
          <button type="button" class="kutu yuvarlak" role="checkbox" aria-checked="${y}" aria-label="${esc(a.ad)}" data-act="aliskanlik-isaret" data-id="${a.id}" data-tarih="${t}"><i>${ikon('tik')}</i></button>
          <button type="button" class="gorev-govde" data-git="aliskanliklar"><span class="gorev-baslik">${esc(a.ad)}</span><span class="gorev-alt"><span class="seri${s ? ' seri-var' : ''}">${s ? s + ' gün seri' : 'Seri henüz başlamadı'}</span></span></button>
        </li>`;
      }).join('')}</ul>`;
    } else {
      h += `<div class="bos">${veri.aliskanliklar.length ? 'Bugün için planlı alışkanlık yok.' : 'Düzenli yapmak istediğiniz işleri Alışkanlıklar bölümünden ekleyebilirsiniz.'}</div>`;
    }
    h += '</section></div></div>';
    return h;
  }

  function cizGorevler() {
    const t = bugun();
    if (ui.gorevListe !== 'tum' && !veri.listeler.some(l => l.id === ui.gorevListe)) ui.gorevListe = 'tum';
    const biten = ui.gorevSekme === 'biten';
    const say = id => veri.gorevler.filter(g => g.bitti === biten && (id === 'tum' || g.listeId === id)).length;
    const liste = veri.gorevler.filter(g => g.bitti === biten && (ui.gorevListe === 'tum' || g.listeId === ui.gorevListe));
    const sec = { listeGizle: ui.gorevListe !== 'tum' };

    let h = `<div class="sekme" role="group" aria-label="Görev durumu">
      <button type="button" data-act="gorev-sekme" data-sekme="acik" aria-pressed="${!biten}">Açık</button>
      <button type="button" data-act="gorev-sekme" data-sekme="biten" aria-pressed="${biten}">Tamamlanan</button>
    </div>
    <div class="cipler" role="group" aria-label="Liste" style="margin-top:12px">
      <button type="button" class="cip" data-act="gorev-liste" data-liste="tum" aria-pressed="${ui.gorevListe === 'tum'}">Tümü <b>${say('tum')}</b></button>
      ${veri.listeler.map(l => `<button type="button" class="cip" data-act="gorev-liste" data-liste="${l.id}" aria-pressed="${ui.gorevListe === l.id}">${esc(l.ad)} <b>${say(l.id)}</b></button>`).join('')}
    </div>`;

    if (!liste.length) {
      return h + `<section class="bolum">${biten
        ? '<div class="bos">Tamamlanan görev yok.</div>'
        : bos('Açık görev yok', 'Yapılacak bir iş eklediğinizde burada, tarihine göre sıralı görünür.', 'Görev ekle')}</section>`;
    }

    if (biten) {
      const sirali = liste.slice().sort((a, b) => b.g - a.g);
      return h + `<section class="bolum">${bolumBas('Tamamlanan', sirali.length, '<button type="button" class="metin-dugme" data-act="bitenleri-sil">Hepsini sil</button>')}${gorevKart(sirali.slice(0, 200), sec)}</section>`;
    }

    const grup = [['Geciken', [], 'uyari'], ['Bugün', []], ['Yarın', []], ['Önümüzdeki 7 gün', []], ['Daha sonra', []], ['Tarihsiz', []]];
    for (const g of sirala(liste)) {
      const f = g.tarih ? gunFarki(g.tarih, t) : null;
      grup[f === null ? 5 : f < 0 ? 0 : f === 0 ? 1 : f === 1 ? 2 : f <= 7 ? 3 : 4][1].push(g);
    }
    for (const [ad, l, sinif] of grup) {
      if (l.length) h += `<section class="bolum">${bolumBas(ad, l.length, '', sinif)}${gorevKart(l, Object.assign({ tarihGizle: ad === 'Bugün' || ad === 'Yarın' }, sec))}</section>`;
    }
    return h;
  }

  function cizAliskanliklar() {
    if (!veri.aliskanliklar.length) {
      return bos('Henüz alışkanlık yok', 'Her gün ya da belirli günlerde yapmak istediğiniz bir işi ekleyin; kaç gündür aksatmadığınız burada görünür.', 'Alışkanlık ekle');
    }
    const t = bugun(), pzt = gunEkle(t, -haftaGunu(t));
    return veri.aliskanliklar.map(a => {
      const s = seri(a);
      const gunler = GUN_KISA.map((ad, i) => {
        const d = gunEkle(pzt, i), y = yapildi(a, d);
        return `<button type="button" class="gun${d === t ? ' bugun' : ''}${a.gunler.includes(i) ? '' : ' plansiz'}" data-act="aliskanlik-isaret" data-id="${a.id}" data-tarih="${d}" aria-pressed="${y}" aria-label="${GUN_UZUN[i]}"${d > t ? ' disabled' : ''}><span>${ad}</span><i>${ikon('tik')}</i></button>`;
      }).join('');
      return `<article class="kart aliskanlik">
        <div class="aliskanlik-bas">
          <div class="aliskanlik-ad">${esc(a.ad)}<small>${gunMetni(a.gunler)} · <span class="seri${s ? ' seri-var' : ''}">${s ? s + ' gün seri' : 'Seri henüz başlamadı'}</span></small></div>
          <button type="button" class="simge-dugme" data-act="aliskanlik-ac" data-id="${a.id}" aria-label="Düzenle: ${esc(a.ad)}">${ikon('kalem')}</button>
        </div>
        <div class="hafta" role="group" aria-label="Bu hafta">${gunler}</div>
      </article>`;
    }).join('');
  }

  function notIzgara() {
    const q = kucuk(ui.notAra.trim());
    const l = veri.notlar
      .filter(n => !q || kucuk(n.baslik + ' ' + n.metin).includes(q))
      .sort((a, b) => (Number(b.sabit) - Number(a.sabit)) || (b.g - a.g));
    if (!l.length) return `<div class="bos">Aramayla eşleşen not yok.</div>`;
    return `<div class="notlar">${l.map(n => {
      const baslik = n.baslik.trim() || n.metin.trim().split('\n')[0].slice(0, 80);
      const govde = n.baslik.trim() ? n.metin.trim() : n.metin.trim().split('\n').slice(1).join('\n').trim();
      return `<button type="button" class="kart not-kart" data-act="not-ac" data-id="${n.id}">
        <h3>${n.sabit ? ikon('igne', 'ikon-k') : ''}<span>${esc(baslik)}</span></h3>
        <p>${esc(govde.slice(0, 400))}</p>
        <time>${esc(tarihEtiket(tarihYaz(new Date(n.g || n.olusturma || simdi()))))}</time>
      </button>`;
    }).join('')}</div>`;
  }

  function cizNotlar() {
    if (!veri.notlar.length) {
      return bos('Henüz not yok', 'Aklınıza geleni hızlıca yazın; önemli olanları başa sabitleyebilirsiniz.', 'Not yaz');
    }
    return `<div class="ara">${ikon('ara')}<label class="gizli" for="notAra">Notlarda ara</label><input type="search" id="notAra" placeholder="Notlarda ara" value="${esc(ui.notAra)}" autocomplete="off" enterkeyhint="search"></div>
      <div id="notIzgara">${notIzgara()}</div>`;
  }

  function cizOdak() {
    const t = bugun(), gunler = odakGunleri(), C = 2 * Math.PI * 54;
    const son = [];
    for (let i = 6; i >= 0; i--) { const d = gunEkle(t, -i); son.push({ d, dk: (gunler[d] || {}).dk || 0 }); }
    const enCok = Math.max(1, ...son.map(x => x.dk));
    const bugunku = gunler[t] || { dk: 0, tur: 0 };
    sayacIz = '';
    return `<div class="odak">
      <div class="sekme" role="group" aria-label="Sayaç türü">
        ${Object.keys(MODLAR).map(m => `<button type="button" data-act="sayac-mod" data-mod="${m}" aria-pressed="${sayac.mod === m}">${MODLAR[m]}</button>`).join('')}
      </div>
      <div class="halka">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="iz" cx="60" cy="60" r="54"/><circle class="dolu" id="halkaDolu" cx="60" cy="60" r="54" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
        <div class="halka-ic"><div class="sure" id="sure" role="timer"></div><div class="sure-alt" id="sureAlt"></div></div>
      </div>
      <div class="odak-dugmeler" id="odakDugmeler"></div>
      <section class="bolum odak-ozet">
        ${bolumBas('Son 7 gün', null, `<span class="gorev-alt">Bugün ${bugunku.tur} tur · ${bugunku.dk} dk</span>`)}
        <ul class="kart gunler">${son.map(x => `<li class="${x.d === t ? 'bugun' : ''}"><b>${x.dk || ''}</b><span class="sutun"><i style="height:${Math.round((x.dk / enCok) * 100)}%"></i></span><span>${GUN_KISA[haftaGunu(x.d)]}</span></li>`).join('')}</ul>
      </section>
    </div>`;
  }

  function cizAyarlar() {
    const bildirimVar = 'Notification' in window && 'serviceWorker' in navigator;
    const bildirimAcik = cihaz.bildirim && bildirimVar && Notification.permission === 'granted';
    let h = `<section class="bolum">${bolumBas('Görünüm')}
      <div class="temalar" role="group" aria-label="Görünüm">
        ${TEMALAR.map(t => `<button type="button" class="tema" data-act="tema" data-tema="${t.id}" aria-pressed="${veri.ayar.tema === t.id}">
          <span class="tema-ornek" style="background:${t.zemin}"><i style="background:${t.vurgu}"></i><i style="background:${t.yuzey}"></i><i style="background:${t.yuzey}"></i></span>${t.ad}</button>`).join('')}
      </div></section>

    <section class="bolum">${bolumBas('Odak sayacı')}
      <div class="kart ayar-kart">
        <div class="sureler">
          <label class="alan"><span>Odak (dk)</span><input type="number" inputmode="numeric" min="1" max="180" data-ayar="odakDk" value="${veri.ayar.odakDk}"></label>
          <label class="alan"><span>Kısa mola (dk)</span><input type="number" inputmode="numeric" min="1" max="60" data-ayar="molaDk" value="${veri.ayar.molaDk}"></label>
          <label class="alan"><span>Uzun mola (dk)</span><input type="number" inputmode="numeric" min="1" max="90" data-ayar="uzunMolaDk" value="${veri.ayar.uzunMolaDk}"></label>
        </div>
        <label class="anahtar"><span>Süre bitince ses çal</span><input type="checkbox" data-ayar="ses"${veri.ayar.ses ? ' checked' : ''}><i></i></label>
        ${bildirimVar ? `<label class="anahtar"><span>Süre bitince bildirim göster<small>Uygulama arka plandayken haber verir.</small></span><input type="checkbox" data-ayar="bildirim"${bildirimAcik ? ' checked' : ''}><i></i></label>` : ''}
        ${'wakeLock' in navigator ? `<label class="anahtar"><span>Sayaç çalışırken ekranı açık tut<small>Telefon kilitlenirse süre bittiğinde ses çalmaz.</small></span><input type="checkbox" data-ayar="ekranAcik"${cihaz.ekranAcik ? ' checked' : ''}><i></i></label>` : ''}
      </div></section>

    <section class="bolum">${bolumBas('Listeler', null, '<button type="button" class="metin-dugme" data-act="liste-ekle">Liste ekle</button>')}
      ${veri.listeler.length ? `<ul class="kart satirlar">${veri.listeler.map(l => {
        const n = veri.gorevler.filter(g => !g.bitti && g.listeId === l.id).length;
        return `<li class="liste-satir"><span>${esc(l.ad)}</span><small>${n} açık görev</small>
          <button type="button" class="simge-dugme" data-act="liste-ad" data-id="${l.id}" aria-label="Yeniden adlandır: ${esc(l.ad)}">${ikon('kalem')}</button>
          <button type="button" class="simge-dugme" data-act="liste-sil" data-id="${l.id}" aria-label="Sil: ${esc(l.ad)}">${ikon('cop')}</button></li>`;
      }).join('')}</ul>` : '<div class="bos">Liste yok.</div>'}
    </section>

    <section class="bolum">${bolumBas('Yedek ve aktarım')}
      <div class="kart ayar-kart">
        <p>Kayıtlarınız yalnızca bu cihazda durur, internete gönderilmez. Telefon ile bilgisayar arasında aktarmak için bir cihazda yedek alın, dosyayı diğerine gönderip orada yükleyin. Yükleme sırasında iki cihazın kayıtları birleştirilir.</p>
        <p>${veri.sonYedek ? 'Son yedek: <strong>' + esc(bicimSaat.format(new Date(veri.sonYedek))) + '</strong>' : 'Henüz yedek alınmadı.'}</p>
        <div class="dugmeler">
          <button type="button" class="dugme dugme-ana" data-act="yedek-al">${ikon('indir')}Yedek al</button>
          <label class="dugme">${ikon('yukle')}Yedekten yükle<input type="file" id="yedekDosya" class="gizli" accept=".json,application/json"></label>
        </div>
      </div></section>

    <section class="bolum">${bolumBas('Kurulum')}
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

    <section class="bolum">${bolumBas('Kayıtlar')}
      <div class="kart ayar-kart">
        <p>${veri.gorevler.length} görev, ${veri.aliskanliklar.length} alışkanlık, ${veri.notlar.length} not ve ${veri.odak.length} odak turu kayıtlı.${depoCalisiyor ? '' : ' <strong>Tarayıcı deposuna yazılamıyor; kayıtlar kalıcı olmayabilir.</strong>'}</p>
        <div class="dugmeler"><button type="button" class="dugme dugme-tehlike" data-act="hepsini-sil">Bütün kayıtları sil</button></div>
      </div></section>
    <p class="surum">Günüm ${SURUM} · Kısayol: N ile yeni kayıt</p>`;
    return h;
  }

  const CIZIMLER = { bugun: cizBugun, gorevler: cizGorevler, aliskanliklar: cizAliskanliklar, notlar: cizNotlar, odak: cizOdak, ayarlar: cizAyarlar };
  const EKLE_YAZI = { bugun: 'Yeni görev', gorevler: 'Yeni görev', aliskanliklar: 'Yeni alışkanlık', notlar: 'Yeni not' };

  function ustEtiket() {
    const t = bugun();
    if (gorunum === 'bugun') return bicimUzun.format(new Date());
    if (gorunum === 'gorevler') return `${veri.gorevler.filter(g => !g.bitti).length} açık görev`;
    if (gorunum === 'aliskanliklar') {
      const als = veri.aliskanliklar.filter(a => a.gunler.includes(haftaGunu(t)) || yapildi(a, t));
      return als.length ? `Bugün ${als.filter(a => yapildi(a, t)).length} / ${als.length}` : 'Günüm';
    }
    if (gorunum === 'notlar') return `${veri.notlar.length} not`;
    if (gorunum === 'odak') return `Bugün ${(odakGunleri()[t] || { dk: 0 }).dk} dk`;
    return 'Günüm';
  }

  function ciz() {
    document.documentElement.dataset.gorunum = gorunum;
    $$('[data-git]').forEach(b => {
      if (b.closest('.yan, .alt') && b.dataset.git === gorunum) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#ustEtiket').textContent = ustEtiket();
    $('#ustBaslik').textContent = GORUNUMLER[gorunum];
    const yazi = EKLE_YAZI[gorunum];
    $('#ustEkle').hidden = !yazi;
    $('#yuzenEkle').hidden = !yazi;
    if (yazi) { $('#ustEkleYazi').textContent = yazi; $('#yuzenEkle').setAttribute('aria-label', yazi); }
    $('#icerik').innerHTML = CIZIMLER[gorunum]();
    sayacGoster();
  }

  function git(g) {
    if (!GORUNUMLER[g]) g = 'bugun';
    const degisti = g !== gorunum;
    gorunum = g;
    try { history.replaceState(null, '', g === 'bugun' ? location.pathname + location.search : '#' + g); } catch (e) { /* adres değişmese de olur */ }
    ciz();
    if (degisti) window.scrollTo(0, 0);
  }

  function temaUygula(id) {
    const t = TEMALAR.find(x => x.id === id) || TEMALAR[0];
    document.documentElement.dataset.tema = t.id;
    const m = $('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t.zemin);
    depoYaz(TEMA_ANAHTAR, t.id);
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
  let pencereKapaninca = null;

  function modalAc(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function modalKapat(d, sonuc) {
    if (!d.open) return;
    if (typeof d.close === 'function') d.close(sonuc || ''); else { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); }
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
  }

  pencere.addEventListener('cancel', e => { e.preventDefault(); pencereKapat(); });
  pencere.addEventListener('close', () => pencereKapat());
  pencere.addEventListener('input', () => { pencere.dataset.kirli = '1'; });
  pencere.addEventListener('click', e => {
    if (e.target !== pencere) return;
    const r = pencere.getBoundingClientRect();
    const disarida = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    // Yazılmış bir form yanlışlıkla kapanmasın; not penceresi kapanırken zaten kaydeder.
    if (disarida && (!pencere.dataset.kirli || $('form[data-form="not"]', pencere))) pencereKapat();
  });

  function sor(s) {
    return new Promise(coz => {
      let bitti = false;
      onay.innerHTML = `<form novalidate>
        <header class="pencere-bas"><h2>${esc(s.baslik)}</h2></header>
        <div class="pencere-ic">${s.metin ? `<p>${esc(s.metin)}</p>` : ''}${s.girdi != null ? `<label class="alan"><span class="gizli">${esc(s.baslik)}</span><input type="text" name="girdi" maxlength="40" value="${esc(s.girdi)}" autocomplete="off" enterkeyhint="done"></label>` : ''}</div>
        <footer class="pencere-alt"><span class="bosluk"></span>
          <button type="button" class="dugme dugme-sade" data-sonuc="vazgec">Vazgeç</button>
          ${s.ikinci ? `<button type="button" class="dugme dugme-tehlike" data-sonuc="ikinci">${esc(s.ikinci)}</button>` : ''}
          <button type="submit" class="dugme ${s.tehlike ? 'dugme-tehlike' : 'dugme-ana'}">${esc(s.dugme || 'Tamam')}</button>
        </footer></form>`;
      const bitir = sonuc => {
        if (bitti) return;
        bitti = true;
        const g = $('[name="girdi"]', onay);
        const deger = g ? g.value.trim() : '';
        onay.onclick = onay.onclose = null;
        modalKapat(onay);
        onay.innerHTML = '';
        coz({ sonuc, deger });
      };
      $('form', onay).onsubmit = e => { e.preventDefault(); bitir('tamam'); };
      onay.onclick = e => { const b = e.target.closest('[data-sonuc]'); if (b) bitir(b.dataset.sonuc); };
      onay.onclose = () => bitir('vazgec');
      modalAc(onay);
      const g = $('[name="girdi"]', onay);
      if (g) { g.focus(); g.select(); }
    });
  }

  const secenekler = (ad, liste, secili) =>
    liste.map(([deger, yazi]) => `<label class="secenek"><input type="radio" name="${ad}" value="${deger}"${String(deger) === String(secili) ? ' checked' : ''}><span>${yazi}</span></label>`).join('');

  function gorevPenceresi(id, ontanim) {
    const g = id ? veri.gorevler.find(x => x.id === id) : null;
    if (id && !g) return;
    const d = g || Object.assign({ baslik: '', not: '', tarih: null, listeId: null, oncelik: 0, tekrar: '' }, ontanim);
    pencereAc(`<form data-form="gorev" data-id="${g ? g.id : ''}" novalidate>
      <header class="pencere-bas"><h2>${g ? 'Görevi düzenle' : 'Yeni görev'}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <label class="alan"><span>Görev</span><input type="text" name="baslik" maxlength="200" value="${esc(d.baslik)}" autocomplete="off" enterkeyhint="done"${g ? '' : ' autofocus'}></label>
        <p class="hata" id="formHata" hidden></p>
        <div class="alan"><span>Tarih</span>
          <div class="hizli-tarih">
            <button type="button" class="cip" data-act="tarih-sec" data-gun="0">Bugün</button>
            <button type="button" class="cip" data-act="tarih-sec" data-gun="1">Yarın</button>
            <button type="button" class="cip" data-act="tarih-sec" data-gun="7">Haftaya</button>
            <button type="button" class="cip" data-act="tarih-sec" data-gun="">Tarihsiz</button>
          </div>
          <input type="date" name="tarih" value="${d.tarih || ''}" aria-label="Tarih">
        </div>
        <div class="iki">
          <label class="alan"><span>Liste</span><select name="listeId"><option value="">Listesiz</option>${veri.listeler.map(l => `<option value="${l.id}"${d.listeId === l.id ? ' selected' : ''}>${esc(l.ad)}</option>`).join('')}</select></label>
          <label class="alan"><span>Tekrar</span><select name="tekrar">${Object.keys(TEKRARLAR).map(k => `<option value="${k}"${d.tekrar === k ? ' selected' : ''}>${TEKRARLAR[k]}</option>`).join('')}</select></label>
        </div>
        <fieldset class="alan"><legend>Öncelik</legend><div class="secenekler">${secenekler('oncelik', ONCELIKLER.map((o, i) => [i, o]), d.oncelik)}</div></fieldset>
        <label class="alan"><span>Not</span><textarea name="not" rows="3" maxlength="4000">${esc(d.not)}</textarea></label>
      </div>
      <footer class="pencere-alt">
        ${g ? `<button type="button" class="dugme dugme-tehlike" data-act="gorev-sil" data-id="${g.id}">Sil</button>` : ''}
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="pencere-kapat">Vazgeç</button>
        <button type="submit" class="dugme dugme-ana">Kaydet</button>
      </footer></form>`);
  }

  function aliskanlikPenceresi(id) {
    const a = id ? veri.aliskanliklar.find(x => x.id === id) : null;
    if (id && !a) return;
    const gunler = a ? a.gunler : [0, 1, 2, 3, 4, 5, 6];
    pencereAc(`<form data-form="aliskanlik" data-id="${a ? a.id : ''}" novalidate>
      <header class="pencere-bas"><h2>${a ? 'Alışkanlığı düzenle' : 'Yeni alışkanlık'}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <label class="alan"><span>Alışkanlık</span><input type="text" name="ad" maxlength="80" value="${esc(a ? a.ad : '')}" placeholder="Örneğin 30 dakika yürüyüş" autocomplete="off" enterkeyhint="done"${a ? '' : ' autofocus'}></label>
        <p class="hata" id="formHata" hidden></p>
        <fieldset class="alan"><legend>Hangi günler</legend>
          <div class="hizli-tarih" style="margin-bottom:8px">
            <button type="button" class="cip" data-act="gun-sec" data-gunler="0123456">Her gün</button>
            <button type="button" class="cip" data-act="gun-sec" data-gunler="01234">Hafta içi</button>
            <button type="button" class="cip" data-act="gun-sec" data-gunler="56">Hafta sonu</button>
          </div>
          <div class="secenekler gun-secim">${GUN_KISA.map((ad, i) => `<label class="secenek"><input type="checkbox" name="gun" value="${i}"${gunler.includes(i) ? ' checked' : ''} aria-label="${GUN_UZUN[i]}"><span>${ad}</span></label>`).join('')}</div>
        </fieldset>
      </div>
      <footer class="pencere-alt">
        ${a ? `<button type="button" class="dugme dugme-tehlike" data-act="aliskanlik-sil" data-id="${a.id}">Sil</button>` : ''}
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="pencere-kapat">Vazgeç</button>
        <button type="submit" class="dugme dugme-ana">Kaydet</button>
      </footer></form>`);
  }

  // Not penceresi nasıl kapanırsa kapansın (Tamam, Esc, dışarı dokunma) yazılanı kaydeder.
  function notPenceresi(id) {
    const n = id ? veri.notlar.find(x => x.id === id) : null;
    if (id && !n) return;
    pencereAc(`<form data-form="not" data-id="${n ? n.id : ''}" novalidate>
      <header class="pencere-bas"><h2>${n ? 'Not' : 'Yeni not'}</h2><button type="button" class="simge-dugme" data-act="pencere-kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
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
      const t = simdi();
      const kayitli = id ? veri.notlar.find(x => x.id === id) : null;
      if (kayitli) {
        if (!baslik && !metin) return; // boşaltılan not silinmez; silmek için Sil düğmesi kullanılır
        if (kayitli.baslik === baslik && kayitli.metin === metin && kayitli.sabit === sabit) return;
        kayitli.baslik = baslik; kayitli.metin = metin; kayitli.sabit = sabit; kayitli.g = t;
      } else {
        if (!baslik && !metin) return;
        veri.notlar.push({ id: kimlik(), baslik, metin, sabit, olusturma: t, g: t });
      }
      kaydet(); ciz();
    });
  }

  function formHata(metin) {
    const h = $('#formHata', pencere);
    if (h) { h.textContent = metin; h.hidden = false; }
  }

  const FORMLAR = {
    hizli(f) {
      const baslik = f.elements.baslik.value.trim();
      if (!baslik) { f.elements.baslik.focus(); return; }
      gorevEkle({ baslik, tarih: bugun() });
      kaydet(); ciz();
      const g = $('#hizliGirdi');
      if (g) g.focus();
    },
    gorev(f) {
      const e = f.elements, baslik = e.baslik.value.trim();
      if (!baslik) { formHata('Görev için kısa bir başlık yazın.'); e.baslik.focus(); return; }
      const alan = {
        baslik,
        not: e.not.value.trim(),
        tarih: tarihMi(e.tarih.value) ? e.tarih.value : null,
        listeId: e.listeId.value || null,
        oncelik: Number(e.oncelik.value) || 0,
        tekrar: e.tekrar.value,
      };
      if (alan.tekrar && !alan.tarih) alan.tarih = bugun();
      const g = f.dataset.id ? veri.gorevler.find(x => x.id === f.dataset.id) : null;
      if (g) Object.assign(g, alan, { g: simdi() }); else gorevEkle(alan);
      kaydet(); pencereKapat(); ciz();
    },
    aliskanlik(f) {
      const ad = f.elements.ad.value.trim();
      const gunler = $$('input[name="gun"]:checked', f).map(x => Number(x.value));
      if (!ad) { formHata('Alışkanlığa bir ad verin.'); f.elements.ad.focus(); return; }
      if (!gunler.length) { formHata('En az bir gün seçin.'); return; }
      const t = simdi();
      const a = f.dataset.id ? veri.aliskanliklar.find(x => x.id === f.dataset.id) : null;
      if (a) { a.ad = ad; a.gunler = gunler; a.g = t; }
      else veri.aliskanliklar.push({ id: kimlik(), ad, gunler, kayit: {}, olusturma: t, g: t });
      kaydet(); pencereKapat(); ciz();
    },
    not() { pencereKapat('tamam'); },
  };

  /* ---------- Yedek ---------- */

  async function yedekAl() {
    const ad = `gunum-yedek-${bugun()}.json`;
    const once = veri.sonYedek;
    veri.sonYedek = simdi();
    const metin = JSON.stringify({ uygulama: 'gunum', surum: 1, tarih: new Date().toISOString(), veri }, null, 1);
    const tamam = () => { kaydet(); if (gorunum === 'ayarlar') ciz(); bildir('Yedek dosyası hazırlandı.'); };
    let dosya = null;
    try { dosya = new File([metin], ad, { type: 'application/json' }); } catch (e) { /* eski tarayıcı */ }
    const dokunmatik = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (dosya && dokunmatik && navigator.canShare && navigator.canShare({ files: [dosya] })) {
      try { await navigator.share({ files: [dosya], title: 'Günüm yedeği' }); tamam(); return; }
      catch (e) { if (e && e.name === 'AbortError') { veri.sonYedek = once; return; } }
    }
    const url = URL.createObjectURL(dosya || new Blob([metin], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = ad;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    tamam();
  }

  async function yedekOku(girdi) {
    const dosya = girdi.files && girdi.files[0];
    girdi.value = '';
    if (!dosya) return;
    let ham;
    try { ham = JSON.parse(await dosya.text()); } catch (e) { ham = null; }
    if (!ham || ham.uygulama !== 'gunum' || !ham.veri || typeof ham.veri !== 'object') {
      bildir('Bu dosya bir Günüm yedeği değil.');
      return;
    }
    const gelen = duzelt(ham.veri);
    const tarih = ham.tarih && !isNaN(Date.parse(ham.tarih)) ? bicimSaat.format(new Date(ham.tarih)) + ' tarihli yedekte ' : 'Yedekte ';
    const c = await sor({
      baslik: 'Yedekten yükle',
      metin: `${tarih}${gelen.gorevler.length} görev, ${gelen.aliskanliklar.length} alışkanlık ve ${gelen.notlar.length} not var. Birleştirirseniz bu cihazdaki kayıtlar korunur, yedektekiler eklenir.`,
      dugme: 'Birleştir',
      ikinci: 'Buradakileri sil, yedeği yükle',
    });
    if (c.sonuc === 'vazgec') return;
    const once = JSON.stringify(veri);
    if (c.sonuc === 'tamam') veri = birlestir(veri, gelen);
    else { gelen.sonYedek = veri.sonYedek; veri = gelen; }
    temaUygula(veri.ayar.tema);
    kaydet(); ciz();
    bildir(c.sonuc === 'tamam' ? 'Yedek bu cihazdaki kayıtlarla birleştirildi.' : 'Yedek yüklendi.', once);
  }

  /* ---------- İşlemler ---------- */

  function ekle() {
    if (gorunum === 'aliskanliklar') aliskanlikPenceresi();
    else if (gorunum === 'notlar') notPenceresi();
    else if (gorunum === 'gorevler') gorevPenceresi(null, { listeId: ui.gorevListe === 'tum' ? null : ui.gorevListe });
    else gorevPenceresi(null, { tarih: bugun() });
  }

  const ISLEMLER = {
    ekle,
    'pencere-kapat': () => pencereKapat(),
    'geri-al'() {
      if (!geriAlVeri) return;
      try { veri = duzelt(JSON.parse(geriAlVeri)); } catch (e) { return; }
      geriAlVeri = null; bildirimKutu.hidden = true;
      temaUygula(veri.ayar.tema);
      kaydet(); ciz();
    },
    'kur-not-kapat'() { cihaz.kurNotKapali = true; cihazKaydet(); ciz(); },

    'gorev-isaret': el => gorevIsaret(el.dataset.id),
    'gorev-ac': el => gorevPenceresi(el.dataset.id),
    'gorev-sekme'(el) { ui.gorevSekme = el.dataset.sekme; ciz(); },
    'gorev-liste'(el) { ui.gorevListe = el.dataset.liste; ciz(); },
    'gorev-sil'(el) {
      const once = JSON.stringify(veri);
      veri.gorevler = veri.gorevler.filter(g => g.id !== el.dataset.id);
      silindi(el.dataset.id);
      kaydet(); pencereKapat(); ciz();
      bildir('Görev silindi.', once);
    },
    async 'bitenleri-sil'() {
      const hedef = veri.gorevler.filter(g => g.bitti && (ui.gorevListe === 'tum' || g.listeId === ui.gorevListe));
      if (!hedef.length) return;
      const c = await sor({ baslik: 'Tamamlananları sil', metin: `${hedef.length} tamamlanmış görev silinecek.`, dugme: 'Sil', tehlike: true });
      if (c.sonuc !== 'tamam') return;
      const once = JSON.stringify(veri), kimlikler = new Set(hedef.map(g => g.id));
      veri.gorevler = veri.gorevler.filter(g => !kimlikler.has(g.id));
      kimlikler.forEach(silindi);
      kaydet(); ciz();
      bildir('Tamamlanan görevler silindi.', once);
    },
    'tarih-sec'(el) {
      const g = $('input[name="tarih"]', pencere);
      if (g) { g.value = el.dataset.gun === '' ? '' : gunEkle(bugun(), Number(el.dataset.gun)); pencere.dataset.kirli = '1'; }
    },

    'aliskanlik-isaret': el => aliskanlikIsaret(el.dataset.id, el.dataset.tarih),
    'aliskanlik-ac': el => aliskanlikPenceresi(el.dataset.id),
    'gun-sec'(el) {
      $$('input[name="gun"]', pencere).forEach(k => { k.checked = el.dataset.gunler.includes(k.value); });
      pencere.dataset.kirli = '1';
    },
    'aliskanlik-sil'(el) {
      const once = JSON.stringify(veri);
      veri.aliskanliklar = veri.aliskanliklar.filter(a => a.id !== el.dataset.id);
      silindi(el.dataset.id);
      kaydet(); pencereKapat(); ciz();
      bildir('Alışkanlık silindi.', once);
    },

    'not-ac': el => notPenceresi(el.dataset.id),
    'not-sil'(el) {
      const once = JSON.stringify(veri);
      veri.notlar = veri.notlar.filter(n => n.id !== el.dataset.id);
      silindi(el.dataset.id);
      kaydet(); pencereKapat('sil'); ciz();
      bildir('Not silindi.', once);
    },

    'sayac-baslat': sayacBaslat,
    'sayac-duraklat': sayacDuraklat,
    'sayac-sifirla': () => sayacSifirla(),
    'sayac-bitir': () => sayacBitir(true),
    async 'sayac-mod'(el) {
      const mod = el.dataset.mod;
      if (mod === sayac.mod && sayac.durum === 'bos') return;
      if (sayac.durum !== 'bos') {
        const c = await sor({ baslik: 'Sayaç sıfırlansın mı?', metin: 'Çalışan sayaç durdurulacak ve geçen süre kaydedilmeyecek.', dugme: 'Sıfırla' });
        if (c.sonuc !== 'tamam') return;
      }
      sayacSifirla(mod);
    },

    tema(el) {
      veri.ayar.tema = el.dataset.tema; veri.ayar.g = simdi();
      temaUygula(veri.ayar.tema);
      kaydet(); ciz();
    },
    async 'liste-ekle'() {
      const c = await sor({ baslik: 'Yeni liste', girdi: '', dugme: 'Ekle' });
      if (c.sonuc !== 'tamam' || !c.deger) return;
      veri.listeler.push({ id: kimlik(), ad: c.deger.slice(0, 40), g: simdi() });
      kaydet(); ciz();
    },
    async 'liste-ad'(el) {
      const l = veri.listeler.find(x => x.id === el.dataset.id);
      if (!l) return;
      const c = await sor({ baslik: 'Listeyi yeniden adlandır', girdi: l.ad, dugme: 'Kaydet' });
      if (c.sonuc !== 'tamam' || !c.deger) return;
      l.ad = c.deger.slice(0, 40); l.g = simdi();
      kaydet(); ciz();
    },
    async 'liste-sil'(el) {
      const l = veri.listeler.find(x => x.id === el.dataset.id);
      if (!l) return;
      const n = veri.gorevler.filter(g => g.listeId === l.id).length;
      const c = await sor({ baslik: `"${l.ad}" listesi silinsin mi?`, metin: n ? `Listedeki ${n} görev silinmez, listesiz kalır.` : 'Liste boş.', dugme: 'Sil', tehlike: true });
      if (c.sonuc !== 'tamam') return;
      const once = JSON.stringify(veri), t = simdi();
      veri.gorevler.forEach(g => { if (g.listeId === l.id) { g.listeId = null; g.g = t; } });
      veri.listeler = veri.listeler.filter(x => x.id !== l.id);
      silindi(l.id);
      kaydet(); ciz();
      bildir('Liste silindi.', once);
    },
    'yedek-al': yedekAl,
    async kur() {
      if (!kurIstegi) return;
      const k = kurIstegi; kurIstegi = null;
      try { k.prompt(); await k.userChoice; } catch (e) { /* kullanıcı vazgeçti */ }
      ciz();
    },
    async 'hepsini-sil'() {
      const c = await sor({ baslik: 'Bütün kayıtlar silinsin mi?', metin: 'Görevler, alışkanlıklar, notlar ve odak kayıtları bu cihazdan silinir. Yedeğiniz yoksa geri getirilemez.', dugme: 'Hepsini sil', tehlike: true });
      if (c.sonuc !== 'tamam') return;
      const once = JSON.stringify(veri), tema = veri.ayar.tema;
      veri = varsayilan();
      veri.ayar.tema = tema;
      kaydet(); ciz();
      bildir('Bütün kayıtlar silindi.', once);
    },
  };

  async function ayarDegis(el) {
    const ad = el.dataset.ayar;
    if (ad === 'odakDk' || ad === 'molaDk' || ad === 'uzunMolaDk') {
      const n = Math.round(Number(el.value));
      const enCok = Number(el.max) || 180;
      if (!Number.isFinite(n) || n < 1) { el.value = veri.ayar[ad]; return; }
      veri.ayar[ad] = Math.min(enCok, n); veri.ayar.g = simdi();
      el.value = veri.ayar[ad];
      kaydet(); sayacGoster();
    } else if (ad === 'ses') {
      veri.ayar.ses = el.checked; veri.ayar.g = simdi();
      kaydet();
      if (el.checked) { sesHazirla(); zil(); }
    } else if (ad === 'bildirim') {
      if (el.checked) {
        let izin = Notification.permission;
        if (izin === 'default') { try { izin = await Notification.requestPermission(); } catch (e) { izin = 'denied'; } }
        cihaz.bildirim = izin === 'granted';
        if (!cihaz.bildirim) { el.checked = false; bildir('Bildirim izni verilmedi. Cihazın bildirim ayarlarından açabilirsiniz.'); }
      } else cihaz.bildirim = false;
      cihazKaydet();
    } else if (ad === 'ekranAcik') {
      cihaz.ekranAcik = el.checked; cihazKaydet();
      ekranKilidi(el.checked && sayac.durum === 'calisiyor');
    }
  }

  /* ---------- Olaylar ---------- */

  document.addEventListener('click', e => {
    const git_ = e.target.closest('[data-git]');
    if (git_) { git(git_.dataset.git); return; }
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
    if (el.dataset && el.dataset.ayar) ayarDegis(el);
    else if (el.id === 'yedekDosya') yedekOku(el);
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'notAra') return;
    ui.notAra = e.target.value;
    const k = $('#notIzgara');
    if (k) k.innerHTML = notIzgara();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.ctrlKey || e.metaKey || e.altKey || pencere.open || onay.open) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (!EKLE_YAZI[gorunum]) return;
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
    if (e.key === VERI_ANAHTAR && e.newValue) {
      try { veri = duzelt(JSON.parse(e.newValue)); } catch (err) { return; }
      temaUygula(veri.ayar.tema);
      yenile();
    }
  });
  window.addEventListener('hashchange', () => git(location.hash.slice(1)));
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); kurIstegi = e;
    if (gorunum === 'ayarlar') yenile();
  });
  window.addEventListener('appinstalled', () => { kurIstegi = null; yenile(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    gunKontrol();
    if (sayac.durum === 'calisiyor') ekranKilidi(true);
    tik();
  });

  setInterval(tik, 250);
  setInterval(gunKontrol, 30000);

  temaUygula(veri.ayar.tema);
  git(location.hash.slice(1));
  tik();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
