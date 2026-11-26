/* Seslendir: yazılan ya da yapıştırılan metni Türkçe kadın sesiyle okur.

   Ses, cihazın ya da tarayıcının kendi seslendirme motorundan gelir
   (iPhone'da Yelda, Windows'ta Microsoft Edge'in Emel sesi). Metin cümlelere
   bölünür ve sırayla okutulur; böylece okunan cümle işaretlenir, okuma
   duraklatılıp aynı cümleden sürdürülür ve uzun metinlerde ses yarıda kesilmez.
   Metin ve ayarlar yalnızca bu cihazda, tarayıcı deposunda tutulur. */

(function () {
  'use strict';

  const synth = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null;
  const $ = id => document.getElementById(id);

  const el = {
    uyg: $('uyg'), metin: $('metin'), okuma: $('okuma'), ozet: $('ozet'), bosYardim: $('bosYardim'),
    yapistir: $('yapistir'), temizle: $('temizle'), ornek: $('ornek'), duzenle: $('duzenle'),
    yer: $('yer'), yerYazi: $('yerYazi'), kalan: $('kalan'),
    hiz: $('hiz'), hizYazi: $('hizYazi'), geri: $('geri'), oynat: $('oynat'), ileri: $('ileri'), bastan: $('bastan'),
    sesSatiri: $('sesSatiri'), sesYazi: $('sesYazi'),
    ayarAc: $('ayarAc'), pencere: $('pencere'), pencereKapat: $('pencereKapat'),
    sesListesi: $('sesListesi'), sesUyari: $('sesUyari'), sesNot: $('sesNot'),
    kisaltma: $('kisaltma'), kurulum: $('kurulum'), kurulumYazi: $('kurulumYazi'),
    bildirim: $('bildirim'),
  };

  const HIZLAR = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const PARCA_SINIRI = 280;
  const ORNEK = 'Merhaba. Bu uygulama, yazdığınız ya da yapıştırdığınız metni sizin için sesli okur.\n\n' +
    'Okuma sırasında o an söylenen cümle işaretlenir; başka bir cümleye dokunarak okumayı oradan sürdürebilirsiniz. ' +
    'Hızı alttaki düğmeden değiştirebilir, dilediğiniz yerde duraklatabilirsiniz.';
  const DENEME = 'Merhaba. Metinlerinizi bu sesle okuyacağım.';

  /* ---------- Depo ---------- */

  const depo = {
    al(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    yaz(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* depo kapalıysa kayıt tutulmaz */ } },
    sil(k) { try { localStorage.removeItem(k); } catch (e) { /* aynı */ } },
    nesne(k) { try { return JSON.parse(this.al(k) || 'null') || {}; } catch (e) { return {}; } },
  };

  const ayar = Object.assign({ ses: '', hiz: 1, kisaltma: true }, depo.nesne('seslendir.ayar'));
  if (HIZLAR.indexOf(ayar.hiz) < 0) ayar.hiz = 1;
  const ayarKaydet = () => depo.yaz('seslendir.ayar', JSON.stringify(ayar));

  /* ---------- Durum ---------- */

  const S = {
    parcalar: [],     // { yazi, soz, par, bas }
    dugumler: [],     // okuma görünümündeki cümle kutuları
    kaynak: null,     // parçaların üretildiği metin
    toplam: 0,        // okunacak toplam harf sayısı
    i: 0,             // sıradaki parça
    okuyor: false,
    dinle: false,     // okuma görünümü açık mı
    cps: 14,          // saniyede okunan harf (1× hızda), okudukça ölçülür
    seslerGeldi: false,
  };

  /* ---------- Metni okunacak parçalara ayırma ---------- */

  const NOKTA_SONU = /[.!?…:;]["'”’»)\]]*$/;
  const MADDE_BASI = /^(?:\d+|[a-zçğıöşü])[.)]\s|^[-–—•*·]\s/;
  const KISALTMALAR = new Set(['av', 'dr', 'prof', 'doç', 'yrd', 'uzm', 'op', 'md', 'no', 'vb', 'vs', 'vd', 'bkz',
    'örn', 'sn', 'sy', 'mah', 'cad', 'sok', 'sk', 'tel', 'ltd', 'şti', 'st', 'krş', 'çev', 'haz', 'müd', 'bşk', 'hk']);

  // PDF ve benzeri kaynaklardan kopyalanan metinde satır sonları cümleyi böler.
  // Cümle bitmeden kırılmış satırlar birleştirilir, boş satır paragraf ayırır.
  // Bir satır, cümle bitmediği halde metnin en uzun satırına yakın uzunluktaysa
  // sayfa genişliğinde kırılmış sayılır; devamı büyük harfle ya da rakamla
  // başlasa da ("... Ankara / 3. Asliye Ceza Mahkemesi") birleştirilir.
  function paragraflar(metin) {
    const satirlar = metin.replace(/\r\n?/g, '\n').replace(/[\u00a0\t]+/g, ' ').split('\n')
      .map(x => x.replace(/ {2,}/g, ' ').trim());
    const enUzun = satirlar.reduce((m, x) => Math.max(m, x.length), 0);
    const dolu = x => enUzun >= 60 && x.length >= enUzun * 0.7;
    const sonuc = [];
    let p = '', onceki = '';
    satirlar.forEach(s => {
      if (!s) { if (p) { sonuc.push(p); p = ''; } return; }
      if (!p) { p = s; onceki = s; return; }
      const kucukBaslar = /^[a-zçğıöşü]/.test(s) && !MADDE_BASI.test(s);
      if (kucukBaslar && /[A-Za-zÇĞİÖŞÜçğıöşü]-$/.test(p)) p = p.slice(0, -1) + s;
      else if (!NOKTA_SONU.test(p) && (kucukBaslar || /,$/.test(p) || (dolu(onceki) && !/^[-–—•*·]\s/.test(s)))) p += ' ' + s;
      else { sonuc.push(p); p = s; }
      onceki = s;
    });
    if (p) sonuc.push(p);
    return sonuc;
  }

  function cumleler(p) {
    const sonuc = [];
    const re = /([.!?…]+)(["'”’»)\]]*)\s+/g;
    let bas = 0, m;
    while ((m = re.exec(p))) {
      const sonraki = p.charAt(re.lastIndex);
      if (!/[!?]/.test(m[1])) {
        // Nokta her zaman cümle sonu değildir: "Av.", "T.C.", "3. Ceza Dairesi", "2024/15 E."
        if (/[a-zçğıöşü]/.test(sonraki)) continue;
        if (m[1] === '.') {
          const kelime = (p.slice(bas, m.index).match(/[^\s(\["'“‘]+$/) || [''])[0];
          const son = kelime.toLocaleLowerCase('tr').split(/[./]/).pop();
          if (KISALTMALAR.has(son) || /^\p{L}$/u.test(son) || /^\d{1,2}$/.test(son)) continue;
        }
      }
      sonuc.push(p.slice(bas, m.index + m[1].length + m[2].length).trim());
      bas = re.lastIndex;
    }
    const kalan = p.slice(bas).trim();
    if (kalan) sonuc.push(kalan);
    return sonuc;
  }

  // Çok uzun cümleler virgül ya da noktalı virgülden bölünür.
  function bol(c) {
    const sonuc = [];
    while (c.length > PARCA_SINIRI) {
      const pencere = c.slice(0, PARCA_SINIRI);
      let k = Math.max(pencere.lastIndexOf('; '), pencere.lastIndexOf(', '), pencere.lastIndexOf(': '));
      if (k < PARCA_SINIRI * 0.35) k = pencere.lastIndexOf(' ');
      if (k < 1) k = PARCA_SINIRI - 1;
      sonuc.push(c.slice(0, k + 1).trim());
      c = c.slice(k + 1).trim();
    }
    if (c) sonuc.push(c);
    return sonuc;
  }

  const ONCE = '(^|[^\\p{L}\\p{N}])';
  const SONRA = '(?=$|[\\s,;:)\\]"\'])';
  const ACILIMLAR = [
    [new RegExp(ONCE + 'T\\.\\s?C\\.' + SONRA, 'gu'), '$1Türkiye Cumhuriyeti'],
    [new RegExp(ONCE + 'Av\\.\\s', 'gu'), '$1Avukat '],
    [new RegExp(ONCE + 'Dr\\.\\s', 'gu'), '$1Doktor '],
    [new RegExp(ONCE + 'Prof\\.\\s', 'gu'), '$1Profesör '],
    [new RegExp(ONCE + 'Doç\\.\\s', 'gu'), '$1Doçent '],
    [new RegExp(ONCE + 'Uzm\\.\\s', 'gu'), '$1Uzman '],
    [new RegExp(ONCE + 'Sn\\.\\s', 'gu'), '$1Sayın '],
    [new RegExp(ONCE + '[Mm]d\\.\\s?(?=\\d)', 'gu'), '$1madde '],
    [new RegExp(ONCE + 'm\\.\\s?(?=\\d)', 'gu'), '$1madde '],
    [new RegExp(ONCE + 'f\\.\\s?(?=\\d)', 'gu'), '$1fıkra '],
    [new RegExp('(\\d)\\s?E\\.' + SONRA, 'g'), '$1 Esas'],
    [new RegExp('(\\d)\\s?K\\.' + SONRA, 'g'), '$1 Karar'],
    [new RegExp(ONCE + 'vb\\.' + SONRA, 'gu'), '$1ve benzeri'],
    [new RegExp(ONCE + 'vs\\.' + SONRA, 'gu'), '$1vesaire'],
    [new RegExp(ONCE + 'vd\\.' + SONRA, 'gu'), '$1ve devamı'],
    [new RegExp(ONCE + '[Bb]kz\\.\\s?', 'gu'), '$1bakınız '],
    [new RegExp(ONCE + '[Öö]rn\\.\\s?', 'gu'), '$1örneğin '],
    [new RegExp(ONCE + 'No\\s?[:.]\\s?(?=\\d)', 'gu'), '$1numara '],
    [/(\d)\s?TL(?![\p{L}\p{N}])/gu, '$1 lira'],
    [/₺\s?(\d[\d.,]*\d|\d)/g, '$1 lira'],
    [/%\s?(?=\d)/g, 'yüzde '],
    [/(\d)\s?m²/g, '$1 metrekare'],
  ];

  // Ekranda görünen yazıdan, ses motoruna verilecek yazıyı üretir.
  function sozeCevir(yazi, ac) {
    let t = yazi.replace(/[\u200b-\u200d\ufeff\u00ad]/g, '')
      .replace(/[“”„«»]/g, '"').replace(/[‘’]/g, "'")
      .replace(/https?:\/\/\S+/g, ' bağlantı ');
    if (ac) ACILIMLAR.forEach(a => { t = t.replace(a[0], a[1]); });
    return t.replace(/\s+/g, ' ').trim();
  }

  function hazirla() {
    const anahtar = (ayar.kisaltma ? '1' : '0') + el.metin.value;
    if (S.kaynak === anahtar) return S.parcalar.length > 0;
    const liste = [];
    let toplam = 0;
    paragraflar(el.metin.value).forEach((p, pi) => {
      cumleler(p).forEach(c => bol(c).forEach(yazi => {
        const soz = sozeCevir(yazi, ayar.kisaltma);
        if (!/[\p{L}\p{N}]/u.test(soz)) return;
        liste.push({ yazi, soz, par: pi, bas: toplam });
        toplam += soz.length;
      }));
    });
    S.parcalar = liste;
    S.toplam = toplam;
    S.kaynak = anahtar;
    if (S.i >= liste.length) S.i = 0;
    okumayiKur();
    return liste.length > 0;
  }

  function okumayiKur() {
    el.okuma.textContent = '';
    S.dugumler = [];
    sonIsaret = -1;
    let p = null, sonPar = -1;
    S.parcalar.forEach((x, i) => {
      if (x.par !== sonPar) { p = document.createElement('p'); el.okuma.appendChild(p); sonPar = x.par; }
      else p.appendChild(document.createTextNode(' '));
      const s = document.createElement('span');
      s.textContent = x.yazi;
      s.dataset.i = i;
      p.appendChild(s);
      S.dugumler.push(s);
    });
  }

  /* ---------- Sesler ---------- */

  let sesler = [];
  let secili = null;

  const cins = v => {
    const ad = (v.name || '').toLowerCase();
    if (/emel|yelda|seda|filiz|kadın|kadin|female/.test(ad)) return 'kadin';
    if (/tolga|ahmet|cem|erkek|male/.test(ad)) return 'erkek';
    return 'belirsiz';
  };

  function sesPuani(v) {
    const ad = (v.name || '').toLowerCase();
    const c = cins(v);
    let p = c === 'kadin' ? 100 : c === 'erkek' ? -100 : 0;
    if (/natural|neural|doğal/.test(ad)) p += 30;
    if (/enhanced|premium|geliştirilmiş|yüksek/.test(ad)) p += 20;
    if (/compact/.test(ad)) p -= 5;
    if (v.default) p += 1;
    return p;
  }

  function sesAdi(v) {
    let ad = (v.name || '').replace(/\s*-\s*Turkish.*$/i, '').replace(/^Microsoft\s+/i, '')
      .replace(/\bOnline\b/i, '').replace(/\(Natural\)/i, '(doğal)').replace(/\(Enhanced\)/i, '(geliştirilmiş)')
      .replace(/\(Premium\)/i, '(üst kalite)').replace(/\s+/g, ' ').trim();
    if (!ad || /^(turkish|tr[-_]tr)/i.test(ad)) ad = 'Türkçe';
    return ad;
  }

  const sesYeri = v => (v.localService === false ? 'internet üzerinden' : 'bu cihazda');

  function sesleriYukle() {
    if (!synth) return;
    let hepsi = [];
    try { hepsi = synth.getVoices() || []; } catch (e) { hepsi = []; }
    const gorulen = new Set();
    const tr = hepsi.filter(v => {
      if (!/^tr(?:[-_]|$)/i.test(v.lang || '')) return false;
      const k = v.name + '|' + v.lang;
      if (gorulen.has(k)) return false;
      gorulen.add(k);
      return true;
    });
    if (hepsi.length) S.seslerGeldi = true;
    sesler = tr.sort((a, b) => sesPuani(b) - sesPuani(a));
    secili = sesler.find(v => v.voiceURI === ayar.ses) || sesler[0] || null;
    sesSatiriniYaz();
    if (el.pencere.open) sesListesiniYaz();
  }

  function cihaz() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return {
      ios,
      android: /Android/.test(ua),
      windows: /Windows/.test(ua),
      mac: /Macintosh/.test(ua) && !ios,
      edge: /Edg\//.test(ua),
    };
  }

  function sesOnerisi() {
    const c = cihaz();
    if (c.windows && !c.edge) return 'Windows’ta Türkçe kadın sesi Microsoft Edge ile gelir. Bu sayfayı Edge’de açın.';
    if (c.windows) return 'Edge’in Türkçe sesleri internet üzerinden gelir. Bağlantıyı kontrol edip sayfayı yenileyin.';
    if (c.ios) return 'iPhone ayarlarında Erişilebilirlik bölümündeki seslendirme seslerinden Türkçe (Yelda) sesini indirin.';
    if (c.mac) return 'Sistem ayarlarında Erişilebilirlik bölümündeki seslendirme seslerinden Türkçe (Yelda) sesini indirin ya da sayfayı Microsoft Edge’de açın.';
    if (c.android) return 'Telefon ayarlarındaki metin okuma bölümünden Türkçe ses verisini indirin.';
    return 'Sayfayı Microsoft Edge ya da Safari ile açmayı deneyin.';
  }

  function sesSatiriniYaz() {
    let yazi, uyari = false;
    if (!synth) { yazi = 'Bu tarayıcı sesli okumayı desteklemiyor'; uyari = true; }
    else if (!secili) {
      if (S.seslerGeldi) { yazi = 'Türkçe ses bulunamadı'; uyari = true; }
      else yazi = 'Ses hazırlanıyor';
    } else if (cins(secili) === 'erkek' && !sesler.some(v => cins(v) !== 'erkek')) {
      yazi = 'Türkçe kadın sesi bulunamadı · ' + sesAdi(secili) + ' okuyor';
      uyari = true;
    } else yazi = 'Ses: ' + sesAdi(secili) + ' · ' + sesYeri(secili);
    el.sesYazi.textContent = yazi;
    el.sesSatiri.classList.toggle('uyarili', uyari);
  }

  function sesListesiniYaz() {
    el.sesListesi.textContent = '';
    sesler.forEach((v, n) => {
      const satir = document.createElement('label');
      satir.className = 'ses-sec';
      const giris = document.createElement('input');
      giris.type = 'radio'; giris.name = 'ses'; giris.value = String(n); giris.checked = v === secili;
      const nokta = document.createElement('span');
      nokta.className = 'nokta';
      const ad = document.createElement('span');
      ad.className = 'ses-ad';
      const b = document.createElement('b');
      b.textContent = sesAdi(v);
      const kucuk = document.createElement('small');
      const c = cins(v);
      kucuk.textContent = (c === 'kadin' ? 'Kadın sesi · ' : c === 'erkek' ? 'Erkek sesi · ' : '') + sesYeri(v);
      ad.appendChild(b); ad.appendChild(kucuk);
      satir.appendChild(giris); satir.appendChild(ad); satir.appendChild(nokta);
      el.sesListesi.appendChild(satir);
    });

    const kadinYok = !sesler.some(v => cins(v) !== 'erkek');
    let uyari = '';
    if (!synth) uyari = 'Bu tarayıcı sesli okumayı desteklemiyor. ' + sesOnerisi();
    else if (!sesler.length) uyari = S.seslerGeldi ? 'Bu cihazda Türkçe ses bulunamadı. ' + sesOnerisi() : 'Sesler henüz yüklenmedi. Birkaç saniye sonra yeniden deneyin.';
    else if (kadinYok) uyari = 'Bu tarayıcıda Türkçe kadın sesi yok. ' + sesOnerisi();
    el.sesUyari.textContent = uyari;
    el.sesUyari.hidden = !uyari;

    el.sesNot.textContent = sesler.length
      ? 'Cihazda çalışan seslerde metin cihazdan çıkmaz. İnternet üzerinden çalışan seslerde metin, sesi üreten şirketin sunucusuna gönderilir.'
      : '';
  }

  /* ---------- Okuma ---------- */

  let sonIsaret = -1;   // en son ortalanan cümle
  let oturum = 0;       // her yeni konuşmada artar; eski konuşmadan gelen haberler yok sayılır
  let aktif = null;     // tarayıcı konuşma nesnesini erken silmesin diye tutulur
  let baslangic = 0;
  let bekleme = 0;
  let yenidenDenendi = false;
  let arkadaKaldi = false;
  let sonHaber = 0;     // ses motorundan gelen son başlama, sözcük ya da bitiş haberi

  function konus(i) {
    if (!synth || !S.parcalar.length) return;
    clearTimeout(bekleme);
    const benim = ++oturum;
    S.i = Math.max(0, Math.min(i, S.parcalar.length - 1));
    S.okuyor = true;
    baslangic = 0;
    arkadaKaldi = false;
    yerKaydet();
    ciz();

    const p = S.parcalar[S.i];
    const baslat = () => {
      if (benim !== oturum) return;
      try {
        const u = new SpeechSynthesisUtterance(p.soz);
        if (secili) { u.voice = secili; u.lang = secili.lang || 'tr-TR'; } else u.lang = 'tr-TR';
        u.rate = ayar.hiz;
        u.onstart = () => { if (benim === oturum) { baslangic = sonHaber = performance.now(); yenidenDenendi = false; } };
        u.onboundary = () => { if (benim === oturum) sonHaber = performance.now(); };
        u.onend = () => {
          if (benim !== oturum) return;
          sonHaber = performance.now();
          olc(p);
          sonraki();
        };
        u.onerror = e => {
          if (benim !== oturum || e.error === 'interrupted' || e.error === 'canceled') return;
          hata(e.error);
        };
        aktif = u;
        baslangic = performance.now();
        synth.speak(u);
        if (synth.paused) synth.resume();
      } catch (e) { hata('synthesis-failed'); }
    };

    // Süren bir konuşma varsa önce kesilir; hemen ardından verilen yeni konuşma
    // bazı tarayıcılarda yutulduğu için kısa bir ara verilir.
    if (synth.speaking || synth.pending) { synth.cancel(); bekleme = setTimeout(baslat, 120); }
    else baslat();
  }

  function olc(p) {
    if (!baslangic || arkadaKaldi) return;
    const sn = (performance.now() - baslangic) / 1000;
    if (sn < 1 || p.soz.length < 25) return;
    const olcum = p.soz.length / sn / ayar.hiz;
    if (olcum > 6 && olcum < 30) S.cps = S.cps * 0.7 + olcum * 0.3;
  }

  function sonraki() {
    if (S.i + 1 < S.parcalar.length) { konus(S.i + 1); return; }
    sustur();
    S.i = 0;
    depo.sil('seslendir.yer');
    ciz();
    bildir('Okuma tamamlandı.');
  }

  function sustur() {
    oturum++;
    clearTimeout(bekleme);
    S.okuyor = false;
    baslangic = 0;
    aktif = null;
    if (synth) { try { synth.cancel(); } catch (e) { /* ses motoru yanıt vermiyorsa yapılacak bir şey yok */ } }
  }

  function duraklat() {
    sustur();
    ciz();
  }

  function hata(tur) {
    duraklat();
    const mesajlar = {
      'not-allowed': 'Tarayıcı sesi başlatmadı. Oynat düğmesine yeniden basın.',
      'network': 'Ses internet üzerinden alınamadı. Bağlantıyı kontrol edin.',
      'voice-unavailable': 'Seçili ses kullanılamıyor. Ses ayarlarından başka bir ses seçin.',
      'language-unavailable': 'Bu cihazda Türkçe ses bulunamadı.',
    };
    bildir(mesajlar[tur] || 'Seslendirme başlatılamadı. Yeniden deneyin.');
  }

  // Ses motoru bitiş haberini vermeden susarsa (telefon kilitlenince ya da
  // tarayıcı konuşmayı düşürünce) okuma takılı kalmasın.
  function nobet() {
    if (!S.okuyor || !baslangic || !synth) return;
    if (synth.speaking || synth.pending) return;
    const sn = (performance.now() - baslangic) / 1000;
    if (sn < 1.5) return;
    const p = S.parcalar[S.i];
    const beklenen = p.soz.length / (S.cps * ayar.hiz);
    if (arkadaKaldi || sn < beklenen * 0.6) {
      if (yenidenDenendi) { duraklat(); return; }
      yenidenDenendi = true;
      konus(S.i);
    } else sonraki();
  }

  function oynatDuraklat() {
    if (!synth) { bildir('Bu tarayıcı sesli okumayı desteklemiyor.'); return; }
    if (S.okuyor) { duraklat(); return; }
    if (!hazirla()) {
      bildir('Önce okunacak metni yazın ya da yapıştırın.');
      return;
    }
    S.dinle = true;
    yenidenDenendi = false;
    konus(S.i);
  }

  function git(i) {
    if (!S.parcalar.length) return;
    S.i = Math.max(0, Math.min(i, S.parcalar.length - 1));
    if (S.okuyor) konus(S.i);
    else { yerKaydet(); ciz(); }
  }

  function duzenle() {
    sustur();
    S.dinle = false;
    ciz();
  }

  function denemeOku() {
    if (!synth) return;
    const mesgul = S.okuyor || synth.speaking || synth.pending;
    const okuyordu = S.okuyor;
    sustur();
    if (okuyordu) ciz();
    const benim = oturum;
    const soyle = () => {
      if (benim !== oturum) return;
      try {
        const u = new SpeechSynthesisUtterance(DENEME);
        if (secili) { u.voice = secili; u.lang = secili.lang || 'tr-TR'; } else u.lang = 'tr-TR';
        u.rate = ayar.hiz;
        aktif = u;
        synth.speak(u);
      } catch (e) { /* deneme okunamadıysa sessiz kalır */ }
    };
    // iPhone ilk konuşmayı ancak dokunuşla aynı anda başlatır.
    if (mesgul) setTimeout(soyle, 120); else soyle();
  }

  /* ---------- Ekran ---------- */

  const sayi = n => n.toLocaleString('tr-TR');

  function sureYazisi(sn) {
    if (sn < 45) return '1 dakikadan az';
    const dk = Math.max(1, Math.round(sn / 60));
    if (dk < 60) return 'yaklaşık ' + dk + ' dk';
    return 'yaklaşık ' + Math.floor(dk / 60) + ' sa ' + (dk % 60) + ' dk';
  }

  const hizYazisi = h => String(h).replace('.', ',') + '×';

  function ciz() {
    const n = S.parcalar.length;
    const dolu = el.metin.value.trim().length > 0;
    el.uyg.dataset.gorunum = S.dinle ? 'dinle' : 'duzen';
    el.uyg.dataset.durum = S.okuyor ? 'okuyor' : 'durdu';

    el.oynat.setAttribute('aria-label', S.okuyor ? 'Duraklat' : 'Oku');
    el.oynat.disabled = !synth;
    el.hizYazi.textContent = hizYazisi(ayar.hiz);
    el.hiz.setAttribute('aria-label', 'Okuma hızı ' + hizYazisi(ayar.hiz) + '. Değiştirmek için basın.');
    el.temizle.hidden = !dolu;
    el.bosYardim.hidden = dolu;

    const gezilir = S.dinle && n > 0;
    el.geri.disabled = !gezilir || S.i === 0;
    el.ileri.disabled = !gezilir || S.i >= n - 1;
    el.bastan.disabled = !gezilir || (S.i === 0 && !S.okuyor);
    el.yer.disabled = !gezilir || n < 2;

    if (S.dinle && n) {
      el.yer.max = String(n);
      el.yer.value = String(S.i + 1);
      el.yer.style.setProperty('--oran', (n > 1 ? (S.i / (n - 1)) * 100 : 100) + '%');
      el.yerYazi.textContent = sayi(S.i + 1) + ' / ' + sayi(n);
      el.kalan.textContent = 'kalan ' + sureYazisi((S.toplam - S.parcalar[S.i].bas) / (S.cps * ayar.hiz));
      el.ozet.textContent = '';
      isaretle();
    } else {
      el.yer.max = '1'; el.yer.value = '1';
      el.yer.style.setProperty('--oran', '0%');
      el.yerYazi.textContent = '';
      el.kalan.textContent = '';
      const uz = el.metin.value.trim().length;
      el.ozet.textContent = '';
      if (uz) {
        const adet = document.createElement('span');
        adet.className = 'ozet-sayi';
        adet.textContent = sayi(uz) + ' karakter · ';
        el.ozet.appendChild(adet);
        el.ozet.appendChild(document.createTextNode(sureYazisi(uz / (S.cps * ayar.hiz))));
      }
    }
    ekraniAcikTut(S.okuyor);
  }

  function isaretle() {
    S.dugumler.forEach((s, k) => {
      const sinif = k < S.i ? 'gecti' : k === S.i ? 'simdi' : '';
      if (s.className !== sinif) s.className = sinif;
    });
    const s = S.dugumler[S.i];
    if (!s || (sonIsaret === S.i && sonIsaret !== -1)) return;
    sonIsaret = S.i;
    const hedef = s.offsetTop - (el.okuma.clientHeight - s.offsetHeight) / 2;
    const yumusak = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    try { el.okuma.scrollTo({ top: Math.max(0, hedef), behavior: yumusak ? 'smooth' : 'auto' }); }
    catch (e) { el.okuma.scrollTop = Math.max(0, hedef); }
  }

  let bildirimSuresi = 0;
  function bildir(yazi, eylem) {
    clearTimeout(bildirimSuresi);
    el.bildirim.textContent = '';
    const s = document.createElement('span');
    s.textContent = yazi;
    el.bildirim.appendChild(s);
    if (eylem) {
      const d = document.createElement('button');
      d.type = 'button';
      d.textContent = eylem.ad;
      d.addEventListener('click', () => { el.bildirim.hidden = true; eylem.is(); });
      el.bildirim.appendChild(d);
    }
    el.bildirim.hidden = false;
    bildirimSuresi = setTimeout(() => { el.bildirim.hidden = true; }, eylem ? 7000 : 3800);
  }

  // Okuma sürerken telefon ekranı kapanmasın; ekran kapanınca ses de durur.
  let kilit = null;
  function ekraniAcikTut(ac) {
    if (!navigator.wakeLock) return;
    if (ac && !kilit && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(k => {
        kilit = k;
        k.addEventListener('release', () => { if (kilit === k) kilit = null; });
        if (!S.okuyor) ekraniAcikTut(false);
      }).catch(() => {});
    } else if (!ac && kilit) {
      const k = kilit;
      kilit = null;
      k.release().catch(() => {});
    }
  }

  /* ---------- Metin ve kayıt ---------- */

  let kayitSuresi = 0;
  function metinDegisti() {
    S.i = 0;
    depo.sil('seslendir.yer');
    clearTimeout(kayitSuresi);
    kayitSuresi = setTimeout(metniKaydet, 400);
    ciz();
  }

  function metniKaydet() {
    clearTimeout(kayitSuresi);
    if (el.metin.value) depo.yaz('seslendir.metin', el.metin.value);
    else depo.sil('seslendir.metin');
  }

  function yerKaydet() {
    if (S.i > 0) depo.yaz('seslendir.yer', JSON.stringify({ i: S.i, uz: el.metin.value.length }));
    else depo.sil('seslendir.yer');
  }

  function metniKoy(yazi) {
    el.metin.value = yazi;
    el.metin.scrollTop = 0;
    metinDegisti();
  }

  function yapistir() {
    const elle = () => { el.metin.focus(); bildir('Metin alanına uzun basıp “Yapıştır”ı seçin.'); };
    if (!navigator.clipboard || !navigator.clipboard.readText) { elle(); return; }
    navigator.clipboard.readText().then(t => {
      if (!t || !t.trim()) { bildir('Panoda metin yok.'); return; }
      const onceki = el.metin.value;
      metniKoy(t);
      el.metin.blur();
      if (onceki.trim() && onceki !== t) bildir('Önceki metnin yerine yapıştırıldı.', { ad: 'Geri al', is: () => metniKoy(onceki) });
    }).catch(elle);
  }

  function temizle() {
    const onceki = el.metin.value;
    if (!onceki) return;
    metniKoy('');
    bildir('Metin silindi.', { ad: 'Geri al', is: () => metniKoy(onceki) });
  }

  /* ---------- Ayar penceresi ---------- */

  const kurulu = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  function ayarlariAc() {
    sesListesiniYaz();
    el.kisaltma.checked = !!ayar.kisaltma;
    const c = cihaz();
    let yazi = '';
    if (!kurulu()) {
      if (c.ios) yazi = 'Safari’de Paylaş düğmesine, ardından “Ana Ekrana Ekle”ye dokunun. Uygulama ana ekranda kendi simgesiyle açılır.';
      else if (c.android) yazi = 'Tarayıcı menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle” seçeneğine dokunun.';
      else if (c.edge) yazi = 'Edge menüsünde Uygulamalar bölümünden “Bu siteyi uygulama olarak yükle”yi seçin. Uygulama başlat menüsüne ve görev çubuğuna eklenebilir.';
      else if (c.windows) yazi = 'Türkçe kadın sesi için sayfayı Microsoft Edge’de açın; Edge menüsünde Uygulamalar bölümünden “Bu siteyi uygulama olarak yükle”yi seçin.';
    }
    el.kurulumYazi.textContent = yazi;
    el.kurulum.hidden = !yazi;
    if (typeof el.pencere.showModal === 'function') { if (!el.pencere.open) el.pencere.showModal(); }
    else el.pencere.setAttribute('open', '');
  }

  function ayarlariKapat() {
    if (typeof el.pencere.close === 'function') el.pencere.close();
    else el.pencere.removeAttribute('open');
  }

  /* ---------- Olaylar ---------- */

  el.oynat.addEventListener('click', oynatDuraklat);
  el.geri.addEventListener('click', () => git(S.i - 1));
  el.ileri.addEventListener('click', () => git(S.i + 1));
  el.bastan.addEventListener('click', () => git(0));
  el.duzenle.addEventListener('click', duzenle);
  el.yapistir.addEventListener('click', yapistir);
  el.temizle.addEventListener('click', temizle);
  el.ornek.addEventListener('click', () => metniKoy(ORNEK));

  el.hiz.addEventListener('click', () => {
    ayar.hiz = HIZLAR[(HIZLAR.indexOf(ayar.hiz) + 1) % HIZLAR.length];
    ayarKaydet();
    if (S.okuyor) konus(S.i); else ciz();
  });

  el.metin.addEventListener('input', metinDegisti);

  el.okuma.addEventListener('click', e => {
    const s = e.target.closest ? e.target.closest('span[data-i]') : null;
    if (!s) return;
    yenidenDenendi = false;
    konus(Number(s.dataset.i));
  });

  el.yer.addEventListener('input', () => {
    const n = S.parcalar.length;
    const v = Number(el.yer.value);
    el.yer.style.setProperty('--oran', (n > 1 ? ((v - 1) / (n - 1)) * 100 : 100) + '%');
    el.yerYazi.textContent = sayi(v) + ' / ' + sayi(n);
  });
  el.yer.addEventListener('change', () => git(Number(el.yer.value) - 1));

  el.sesSatiri.addEventListener('click', ayarlariAc);
  el.ayarAc.addEventListener('click', ayarlariAc);
  el.pencereKapat.addEventListener('click', ayarlariKapat);
  el.pencere.addEventListener('click', e => { if (e.target === el.pencere) ayarlariKapat(); });

  // Seçili sese yeniden dokunulduğunda da deneme cümlesi okunur.
  el.sesListesi.addEventListener('click', e => {
    if (!e.target || e.target.tagName !== 'INPUT') return;
    const v = sesler[Number(e.target.value)];
    if (!v) return;
    secili = v;
    ayar.ses = v.voiceURI;
    ayarKaydet();
    sesSatiriniYaz();
    denemeOku();
  });

  el.kisaltma.addEventListener('change', () => {
    ayar.kisaltma = el.kisaltma.checked;
    ayarKaydet();
    if (S.dinle) { hazirla(); if (S.okuyor) konus(S.i); else ciz(); }
  });

  document.addEventListener('keydown', e => {
    if (el.pencere.open) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); oynatDuraklat(); return; }
    const etiket = e.target && e.target.tagName;
    if (etiket === 'TEXTAREA' || etiket === 'INPUT' || etiket === 'BUTTON' || etiket === 'SELECT') return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); oynatDuraklat(); }
    else if (S.dinle && e.key === 'ArrowLeft') { e.preventDefault(); git(S.i - 1); }
    else if (S.dinle && e.key === 'ArrowRight') { e.preventDefault(); git(S.i + 1); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { metniKaydet(); if (S.okuyor) arkadaKaldi = true; return; }
    if (!S.okuyor) return;
    ekraniAcikTut(true);
    // iPhone, uygulama arka plana geçince konuşmayı keser ve geri dönüşte her
    // zaman sürdürmez. Dönüşten sonra ses motorundan haber gelmiyorsa cümle
    // baştan okutulur.
    if (arkadaKaldi && cihaz().ios) {
      const benim = oturum;
      const donus = performance.now();
      setTimeout(() => { if (benim === oturum && S.okuyor && sonHaber < donus) konus(S.i); }, 1500);
    }
  });
  window.addEventListener('pagehide', () => {
    metniKaydet();
    if (synth) { try { synth.cancel(); } catch (e) { /* sayfa kapanıyor */ } }
  });

  /* ---------- Açılış ---------- */

  const kayitliMetin = depo.al('seslendir.metin');
  if (kayitliMetin) {
    el.metin.value = kayitliMetin;
    const yer = depo.nesne('seslendir.yer');
    if (yer.uz === kayitliMetin.length && yer.i > 0) S.i = yer.i;
  }

  if (synth) {
    // Önceki sayfadan kalmış bir konuşma varsa susturulur.
    try { synth.cancel(); } catch (e) { /* önemli değil */ }
    sesleriYukle();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', sesleriYukle);
    else synth.onvoiceschanged = sesleriYukle;
    // Bazı tarayıcılar seslerin geldiğini haber vermez; birkaç kez yoklanır.
    [250, 800, 2000, 4000].forEach(ms => setTimeout(() => { if (!sesler.length) sesleriYukle(); }, ms));
    setTimeout(() => { if (!S.seslerGeldi) { S.seslerGeldi = true; sesSatiriniYaz(); } }, 4500);
    setInterval(nobet, 1500);
  } else sesSatiriniYaz();

  ciz();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
