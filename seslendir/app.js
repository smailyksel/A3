/* Seslendir: yazılan ya da yapıştırılan metni Türkçe kadın sesiyle okur.

   Ses iki yerden gelebilir: cihazın kendi seslendirme motorundan (iPhone'da
   Yelda) ya da kullanıcının kendi Azure Konuşma anahtarıyla Microsoft'un
   Emel ve Ahmet seslerinden. Metin cümlelere bölünür ve sırayla okutulur;
   böylece okunan cümle işaretlenir, okuma duraklatılıp aynı yerden sürdürülür.
   Azure sesinde cümleler 600 harflik paketler halinde istenir, gelen ses
   dosyası çalınırken bir sonraki paket önceden alınır. Metin, ayarlar ve
   Azure anahtarı yalnızca bu cihazda, tarayıcı deposunda tutulur. */

(function () {
  'use strict';

  const synth = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null;
  const $ = id => document.getElementById(id);

  const el = {
    uyg: $('uyg'), metin: $('metin'), okuma: $('okuma'), ozet: $('ozet'), bosYardim: $('bosYardim'),
    yapistir: $('yapistir'), temizle: $('temizle'), ornek: $('ornek'), duzenle: $('duzenle'),
    dosyaAc: $('dosyaAc'), dosya: $('dosya'),
    yer: $('yer'), yerYazi: $('yerYazi'), kalan: $('kalan'),
    hiz: $('hiz'), hizYazi: $('hizYazi'), geri: $('geri'), oynat: $('oynat'), ileri: $('ileri'), bastan: $('bastan'),
    sesSatiri: $('sesSatiri'), sesYazi: $('sesYazi'),
    ayarAc: $('ayarAc'), pencere: $('pencere'), pencereKapat: $('pencereKapat'),
    sesListesi: $('sesListesi'), sesUyari: $('sesUyari'), sesNot: $('sesNot'), sesIpucu: $('sesIpucu'),
    kisaltma: $('kisaltma'), kurulum: $('kurulum'), kurulumYazi: $('kurulumYazi'),
    azureAnahtar: $('azureAnahtar'), azureBolge: $('azureBolge'), azureGoster: $('azureGoster'),
    azureKaydet: $('azureKaydet'), azureKaldir: $('azureKaldir'), azureDurum: $('azureDurum'),
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

  const ayar = Object.assign({ ses: '', hiz: 1, kisaltma: true, azure: null }, depo.nesne('seslendir.ayar'));
  if (HIZLAR.indexOf(ayar.hiz) < 0) ayar.hiz = 1;
  if (!ayar.azure || typeof ayar.azure !== 'object' || !ayar.azure.anahtar || !ayar.azure.bolge) ayar.azure = null;
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
    dosyaAdi: depo.al('seslendir.dosya') || '',   // açılan belgenin adı
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
    if (v.bulut) return v.cinsiyet === 'Female' ? 'kadin' : v.cinsiyet === 'Male' ? 'erkek' : 'belirsiz';
    const ad = (v.name || '').toLowerCase();
    if (/emel|yelda|seda|filiz|kadın|kadin|female/.test(ad)) return 'kadin';
    if (/tolga|ahmet|cem|erkek|male/.test(ad)) return 'erkek';
    return 'belirsiz';
  };

  // Aynı adlı sesin temel ve gelişmiş sürümleri ancak kimliğinden ayırt edilir
  // (iPhone'da ikisinin de adı "Yelda"dır).
  const kalite = v => {
    if (v.bulut) return 'gelismis';
    const k = ((v.voiceURI || '') + ' ' + (v.name || '')).toLowerCase();
    if (/premium/.test(k)) return 'premium';
    if (/enhanced|natural|neural|geliştirilmiş|doğal/.test(k)) return 'gelismis';
    return 'temel';
  };

  function sesPuani(v) {
    const c = cins(v);
    const k = kalite(v);
    let p = c === 'kadin' ? 100 : c === 'erkek' ? -100 : 0;
    if (v.bulut) p += 1000;
    if (k === 'premium') p += 40;
    else if (k === 'gelismis') p += 30;
    if (/compact/.test((v.voiceURI || '').toLowerCase())) p -= 5;
    if (v.default) p += 1;
    return p;
  }

  function sesAdi(v) {
    if (v.bulut) return v.name;
    let ad = (v.name || '').replace(/\s*-\s*Turkish.*$/i, '').replace(/^Microsoft\s+/i, '')
      .replace(/\bOnline\b/i, '').replace(/\(Natural\)/i, '(doğal)').replace(/\(Enhanced\)/i, '(gelişmiş)')
      .replace(/\(Premium\)/i, '(üst kalite)').replace(/\s+/g, ' ').trim();
    if (!ad || /^(turkish|tr[-_]tr)/i.test(ad)) ad = 'Türkçe';
    const uri = (v.voiceURI || '').toLowerCase();
    if (!/\(/.test(ad)) {
      if (/premium/.test(uri)) ad += ' (üst kalite)';
      else if (/enhanced/.test(uri)) ad += ' (gelişmiş)';
    }
    return ad;
  }

  const sesYeri = v => (v.bulut ? 'Azure, internet üzerinden' : v.localService === false ? 'internet üzerinden' : 'bu cihazda');

  function sesleriYukle() {
    let hepsi = [];
    if (synth) { try { hepsi = synth.getVoices() || []; } catch (e) { hepsi = []; } }
    const gorulen = new Set();
    const tr = hepsi.filter(v => {
      if (!/^tr(?:[-_]|$)/i.test(v.lang || '')) return false;
      const k = v.voiceURI || (v.name + '|' + v.lang);
      if (gorulen.has(k)) return false;
      gorulen.add(k);
      return true;
    });
    if (hepsi.length) S.seslerGeldi = true;
    sesler = azureSesleri().concat(tr).sort((a, b) => sesPuani(b) - sesPuani(a));
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
    if (!synth && !azureHazir()) { yazi = 'Bu tarayıcı sesli okumayı desteklemiyor'; uyari = true; }
    else if (!secili) {
      if (S.seslerGeldi || !synth) { yazi = 'Türkçe ses bulunamadı'; uyari = true; }
      else yazi = 'Ses hazırlanıyor';
    } else if (secili.bulut) {
      yazi = 'Ses: ' + sesAdi(secili) + ' · Azure';
    } else if (cins(secili) === 'erkek' && !sesler.some(v => cins(v) !== 'erkek')) {
      yazi = 'Türkçe kadın sesi bulunamadı · ' + sesAdi(secili) + ' okuyor';
      uyari = true;
    } else yazi = 'Ses: ' + sesAdi(secili) + ' · ' + sesYeri(secili);
    el.sesYazi.textContent = yazi;
    el.sesSatiri.classList.toggle('uyarili', uyari);
  }

  function sesListesiniYaz() {
    el.sesListesi.textContent = '';
    let sonGrup = null;
    sesler.forEach((v, n) => {
      const grup = v.bulut ? 'İnternet sesi (Azure)' : 'Bu cihaz';
      if (sesler.some(x => x.bulut) && grup !== sonGrup) {
        const b = document.createElement('p');
        b.className = 'ses-grup';
        b.textContent = grup;
        el.sesListesi.appendChild(b);
        sonGrup = grup;
      }
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
    if (!synth && !azureHazir()) uyari = 'Bu tarayıcı sesli okumayı desteklemiyor. ' + sesOnerisi();
    else if (!sesler.length) uyari = S.seslerGeldi ? 'Bu cihazda Türkçe ses bulunamadı. ' + sesOnerisi() : 'Sesler henüz yüklenmedi. Birkaç saniye sonra yeniden deneyin.';
    else if (kadinYok) uyari = 'Bu tarayıcıda Türkçe kadın sesi yok. ' + sesOnerisi();
    el.sesUyari.textContent = uyari;
    el.sesUyari.hidden = !uyari;

    el.sesNot.textContent = sesler.length
      ? 'Cihazda çalışan seslerde metin cihazdan çıkmaz. İnternet üzerinden çalışan seslerde metin, sesi üreten şirketin sunucusuna gönderilir.'
      : '';

    // iPhone'da yalnızca temel ses varsa gelişmiş sürümün nereden indirileceği söylenir.
    const ipucu = cihaz().ios && sesler.length > 0 && !sesler.some(v => kalite(v) !== 'temel');
    el.sesIpucu.hidden = !ipucu;
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
    if (!S.parcalar.length) return;
    if (bulutMu()) { bulutKonus(i); return; }
    if (!synth) return;
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
    bitir();
  }

  function bitir() {
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
    bulutDurdur();
  }

  function duraklat() {
    if (bulutMu()) bulutKaldigiYer();
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
    if (!S.okuyor || !baslangic || !synth || bulutMu()) return;
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
    if (!synth && !azureHazir()) { bildir('Bu tarayıcı sesli okumayı desteklemiyor.'); return; }
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
    if (bulutMu()) { bulutDeneme(); return; }
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

  /* ---------- İnternet sesi (Azure) ---------- */

  // Cümle parçaları 600 harflik paketlere toplanıp Azure'dan ses dosyası
  // olarak istenir. Bir paket çalarken bir sonraki önceden alınır. Paket
  // içinde hangi cümlenin okunduğu, harf sayısına göre tahmin edilir.
  const BULUT_SINIR = 600;
  const BULUT_ONBELLEK = 40;
  const AZURE_VARSAYILAN = [
    { ad: 'tr-TR-EmelNeural', kisa: 'Emel', cinsiyet: 'Female' },
    { ad: 'tr-TR-AhmetNeural', kisa: 'Ahmet', cinsiyet: 'Male' },
  ];

  const B = {
    parcalar: [],          // { bas, son, soz, basla: [], toplam }
    hangi: [],             // cümle parçası -> paket
    kaynak: null,          // paketlerin üretildiği metin
    onbellek: new Map(),   // ses|söz -> { url }
    bekleyen: new Map(),   // ses|söz -> Promise
    audio: null,
    sessiz: '',
    calan: -1,             // çalan paket
    bekliyor: false,       // paket indiriliyor
    kaldi: null,           // duraklatılan yer: { i, n, t }
    deneme: false,
    degisti: 0,            // son kaynak değişiminin zamanı
  };

  const azureHazir = () => !!(ayar.azure && ayar.azure.anahtar && ayar.azure.bolge);
  const bulutMu = () => !!(secili && secili.bulut && azureHazir());

  function azureSesleri() {
    if (!azureHazir()) return [];
    const liste = (ayar.azure.sesler && ayar.azure.sesler.length) ? ayar.azure.sesler : AZURE_VARSAYILAN;
    return liste.map(v => ({ bulut: true, name: v.kisa, azureAd: v.ad, cinsiyet: v.cinsiyet, voiceURI: 'azure:' + v.ad, lang: 'tr-TR', localService: false }));
  }

  const azureUrl = yol => 'https://' + ayar.azure.bolge + '.tts.speech.microsoft.com/cognitiveservices/' + yol;
  const xmlKac = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  function azureHataMesaji(e) {
    const m = /http (\d+)/.exec(e && e.message || '');
    const kod = m ? Number(m[1]) : 0;
    if (kod === 401) return 'Anahtar kabul edilmedi. Portaldan ANAHTAR 1’i yeniden kopyalayın.';
    if (kod === 403) return 'Erişim reddedildi: anahtar bu bölgeye ait olmayabilir ya da aylık ücretsiz kota dolmuş olabilir.';
    if (kod === 429) return 'Azure çok sık istek aldı; birkaç saniye bekleyip yeniden deneyin.';
    if (kod === 400) return 'Azure isteği kabul etmedi (400).';
    if (kod) return 'Azure hata verdi (' + kod + ').';
    return 'Azure’a bağlanılamadı. İnternet bağlantısını ve bölge adını kontrol edin.';
  }

  function bulutAudio() {
    if (B.audio) return B.audio;
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    B.sessiz = sessizlikUret();
    a.addEventListener('timeupdate', bulutIlerledi);
    a.addEventListener('loadedmetadata', () => {
      if (B.calan < 0 || a.src === B.sessiz || !a.duration || !isFinite(a.duration)) return;
      const p = B.parcalar[B.calan];
      if (!p || p.toplam < 40) return;
      const olcum = p.toplam / a.duration;
      if (olcum > 6 && olcum < 30) S.cps = S.cps * 0.5 + olcum * 0.5;
    });
    a.addEventListener('ended', () => {
      if (B.deneme) { B.deneme = false; return; }
      if (!S.okuyor || a.src === B.sessiz || B.calan < 0) return;
      const n = B.calan;
      if (n + 1 < B.parcalar.length) { S.i = B.parcalar[n + 1].bas; bulutKonus(S.i); }
      else bitir();
    });
    a.addEventListener('error', () => {
      if (!S.okuyor || a.src === B.sessiz) return;
      bulutHata(new Error('ses dosyası çalınamadı'));
    });
    B.audio = a;
    return a;
  }

  // Yarım saniyelik sessiz ses: iPhone'da ilk dokunuşta çalınır ki ses
  // dosyası sonradan geldiğinde izin istemeden başlasın; paket beklenirken de
  // çalma durumu korunur.
  function sessizlikUret() {
    const hz = 8000, n = hz / 2;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const yaz = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    yaz(0, 'RIFF'); v.setUint32(4, 36 + n, true); yaz(8, 'WAVE'); yaz(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, hz, true); v.setUint32(28, hz, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    yaz(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    try { return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); } catch (e) { return ''; }
  }

  function bulutSessizCal() {
    const a = bulutAudio();
    if (!B.sessiz) return;
    if (a.src === B.sessiz && !a.paused) return;
    B.calan = -1;
    B.degisti = performance.now();
    a.loop = true;
    a.src = B.sessiz;
    a.playbackRate = 1;
    a.play().catch(() => {});
  }

  function bulutParcalariKur() {
    if (B.kaynak === S.kaynak) return;
    B.parcalar = [];
    B.hangi = [];
    let p = null;
    S.parcalar.forEach((x, i) => {
      const yeniPar = p && x.par !== S.parcalar[p.son].par;
      if (!p || p.toplam + 1 + x.soz.length > BULUT_SINIR || (yeniPar && p.toplam >= BULUT_SINIR / 2)) {
        p = { bas: i, son: i, soz: x.soz, basla: [0], toplam: x.soz.length };
        B.parcalar.push(p);
      } else {
        p.son = i;
        p.basla.push(p.toplam + 1);
        p.soz += ' ' + x.soz;
        p.toplam += 1 + x.soz.length;
      }
      B.hangi.push(B.parcalar.length - 1);
    });
    B.kaynak = S.kaynak;
    B.calan = -1;
    B.kaldi = null;
  }

  const bulutAnahtar = soz => (secili ? secili.azureAd : '') + '|' + soz;

  function bulutIstek(soz, deneme) {
    const k = bulutAnahtar(soz);
    const hazir = B.onbellek.get(k);
    if (hazir) return Promise.resolve(hazir);
    if (B.bekleyen.has(k)) return B.bekleyen.get(k);
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR">' +
      '<voice name="' + xmlKac(secili.azureAd) + '">' + xmlKac(soz) + '</voice></speak>';
    const gonder = () => fetch(azureUrl('v1'), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': ayar.azure.anahtar,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: ssml,
    });
    const soz2 = gonder()
      .then(y => {
        if (y.status === 429 && !deneme) return new Promise(c => setTimeout(c, 2500)).then(gonder);
        return y;
      })
      .then(y => { if (!y.ok) throw new Error('http ' + y.status); return y.blob(); })
      .then(blob => {
        const kayit = { url: URL.createObjectURL(blob) };
        B.onbellek.set(k, kayit);
        while (B.onbellek.size > BULUT_ONBELLEK) {
          const eski = B.onbellek.keys().next().value;
          const e = B.onbellek.get(eski);
          B.onbellek.delete(eski);
          if (e && B.audio && B.audio.src !== e.url) { try { URL.revokeObjectURL(e.url); } catch (err) { /* önemsiz */ } }
        }
        return kayit;
      })
      .finally(() => { B.bekleyen.delete(k); });
    B.bekleyen.set(k, soz2);
    return soz2;
  }

  function bulutOnbellekTemizle() {
    B.onbellek.forEach(e => { try { URL.revokeObjectURL(e.url); } catch (err) { /* önemsiz */ } });
    B.onbellek.clear();
    B.kaynak = null;
  }

  function bulutOnYukle(n) {
    if (n < 0 || n >= B.parcalar.length) return;
    bulutIstek(B.parcalar[n].soz).catch(() => {});
  }

  function bulutKonus(i) {
    bulutParcalariKur();
    const benim = ++oturum;
    S.i = Math.max(0, Math.min(i, S.parcalar.length - 1));
    S.okuyor = true;
    B.deneme = false;
    const n = B.hangi[S.i];
    const p = B.parcalar[n];
    const a = bulutAudio();
    const kayit = B.onbellek.get(bulutAnahtar(p.soz));
    const konum = p.basla[S.i - p.bas] / Math.max(1, p.toplam);
    const surdur = !!(B.kaldi && B.kaldi.i === S.i && B.kaldi.n === n && kayit && a.src === kayit.url);
    B.kaldi = null;
    yerKaydet();
    ciz();
    bulutKunye();

    if (kayit && B.calan === n && a.src === kayit.url) {
      // Paket zaten yüklü: kaldığı yerden sürer ya da cümlenin başına atlar.
      B.bekliyor = false;
      B.degisti = performance.now();
      if (!surdur && a.duration && isFinite(a.duration)) a.currentTime = a.duration * konum;
      a.playbackRate = ayar.hiz;
      a.play().catch(e => bulutCalmaHatasi(e));
      bulutOnYukle(n + 1);
      return;
    }
    if (kayit) {
      bulutCal(n, kayit, konum, benim);
    } else {
      bulutSessizCal();
      B.bekliyor = true;
      bulutIstek(p.soz).then(k2 => {
        if (benim !== oturum) return;
        B.bekliyor = false;
        bulutCal(n, k2, konum, benim);
      }).catch(e => {
        if (benim !== oturum) return;
        B.bekliyor = false;
        bulutHata(e);
      });
    }
    bulutOnYukle(n + 1);
  }

  function bulutCal(n, kayit, konum, benim) {
    const a = bulutAudio();
    B.calan = n;
    B.degisti = performance.now();
    a.loop = false;
    a.src = kayit.url;
    a.playbackRate = ayar.hiz;
    const basla = () => {
      if (benim !== oturum) return;
      if (konum > 0 && a.duration && isFinite(a.duration)) a.currentTime = a.duration * konum;
      a.play().catch(e => bulutCalmaHatasi(e));
    };
    if (konum > 0) {
      if (a.readyState >= 1) basla();
      else a.addEventListener('loadedmetadata', basla, { once: true });
    } else basla();
  }

  function bulutIlerledi() {
    const a = B.audio;
    if (!S.okuyor || B.calan < 0 || B.deneme || !a || a.src === B.sessiz || !a.duration || !isFinite(a.duration)) return;
    const p = B.parcalar[B.calan];
    if (!p) return;
    const kon = (a.currentTime / a.duration) * p.toplam;
    let k = p.bas;
    for (let j = 1; j < p.basla.length; j++) { if (p.basla[j] <= kon + 1) k = p.bas + j; else break; }
    if (k !== S.i) { S.i = k; yerKaydet(); ciz(); }
  }

  function bulutKaldigiYer() {
    const a = B.audio;
    if (!a || B.calan < 0 || a.src === B.sessiz) { B.kaldi = null; return; }
    B.kaldi = { i: S.i, n: B.calan, t: a.currentTime };
  }

  function bulutDurdur() {
    B.bekliyor = false;
    if (B.audio && !B.audio.paused) { try { B.audio.pause(); } catch (e) { /* önemsiz */ } }
  }

  function bulutHiz() {
    if (B.audio) B.audio.playbackRate = ayar.hiz;
  }

  function bulutCalmaHatasi(e) {
    if (e && e.name === 'AbortError') return;
    if (e && e.name === 'NotAllowedError') { duraklat(); bildir('Tarayıcı sesi başlatmadı. Oynat düğmesine yeniden basın.'); return; }
    bulutHata(e);
  }

  function bulutHata(e) {
    duraklat();
    const yerel = sesler.find(v => !v.bulut);
    const mesaj = azureHataMesaji(e);
    if (yerel) bildir(mesaj, { ad: 'Cihaz sesiyle oku', is: () => { sesSec(yerel); konus(S.i); } });
    else bildir(mesaj);
  }

  // Telefon araması ya da kilit ekranındaki durdurma düğmesi sesi dışarıdan
  // durdurursa düğmeler de duraklatılmış görünsün.
  function bulutNobet() {
    const a = B.audio;
    if (!a || !S.okuyor || !bulutMu() || B.bekliyor || B.deneme) return;
    if (!a.paused || a.ended || a.src === B.sessiz) return;
    if (performance.now() - B.degisti < 2500) return;
    bulutKaldigiYer();
    S.okuyor = false;
    ciz();
  }

  function bulutDeneme() {
    const okuyordu = S.okuyor;
    if (okuyordu) bulutKaldigiYer();
    sustur();
    if (okuyordu) ciz();
    const benim = ++oturum;
    bulutSessizCal();
    bulutIstek(DENEME, true).then(k => {
      if (benim !== oturum) return;
      const a = bulutAudio();
      B.deneme = true;
      B.calan = -1;
      a.loop = false;
      a.src = k.url;
      a.playbackRate = ayar.hiz;
      a.play().catch(() => { B.deneme = false; });
    }).catch(e => {
      if (benim !== oturum) return;
      bulutDurdur();
      bildir(azureHataMesaji(e));
      if (el.pencere.open) azureDurumYaz(azureHataMesaji(e), 'hata');
    });
  }

  function bulutKunye() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    try {
      const ilk = (S.parcalar[0] ? S.parcalar[0].yazi : '').slice(0, 80);
      navigator.mediaSession.metadata = new MediaMetadata({ title: ilk || 'Seslendir', artist: 'Seslendir' });
    } catch (e) { /* desteklenmiyor */ }
  }

  function kumandayiBagla() {
    if (!('mediaSession' in navigator)) return;
    const bagla = (ad, is) => { try { navigator.mediaSession.setActionHandler(ad, is); } catch (e) { /* bu düğme yok */ } };
    bagla('play', () => { if (!S.okuyor) oynatDuraklat(); });
    bagla('pause', () => { if (S.okuyor) duraklat(); });
    bagla('nexttrack', () => git(S.i + 1));
    bagla('previoustrack', () => git(S.i - 1));
  }

  function sesSec(v) {
    secili = v;
    ayar.ses = v.voiceURI;
    ayarKaydet();
    sesSatiriniYaz();
    if (el.pencere.open) sesListesiniYaz();
  }

  /* ---------- Azure ayar formu ---------- */

  function azureDurumYaz(yazi, tur) {
    el.azureDurum.textContent = yazi || '';
    el.azureDurum.dataset.tur = tur || '';
    el.azureDurum.hidden = !yazi;
  }

  function azureFormuDoldur() {
    const a = ayar.azure || {};
    el.azureAnahtar.value = a.anahtar || '';
    el.azureBolge.value = a.bolge || '';
    el.azureKaldir.hidden = !azureHazir();
    el.azureKaydet.textContent = azureHazir() ? 'Kaydet ve dene' : 'Bağlan ve dene';
    if (azureHazir()) {
      const adlar = azureSesleri().map(v => v.name).join(', ');
      azureDurumYaz('Bağlı. Sesler: ' + adlar + '.', 'ok');
    } else azureDurumYaz('');
  }

  function azureKaydet() {
    const anahtar = el.azureAnahtar.value.trim();
    const bolge = el.azureBolge.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!anahtar || !bolge) { azureDurumYaz('Anahtar ve bölge alanlarının ikisi de gerekli.', 'hata'); return; }
    el.azureBolge.value = bolge;
    azureDurumYaz('Bağlanıyor…');
    el.azureKaydet.disabled = true;
    sustur();
    bulutSessizCal(); // iPhone'da ses iznini bu dokunuşla alır
    const onceki = ayar.azure;
    fetch('https://' + bolge + '.tts.speech.microsoft.com/cognitiveservices/voices/list', { headers: { 'Ocp-Apim-Subscription-Key': anahtar } })
      .then(y => { if (!y.ok) throw new Error('http ' + y.status); return y.json(); })
      .then(liste => {
        const tr = (Array.isArray(liste) ? liste : [])
          .filter(v => v && v.Locale === 'tr-TR' && !/HD/i.test(v.ShortName || ''))
          .map(v => ({ ad: v.ShortName, kisa: v.DisplayName || v.LocalName || v.ShortName, cinsiyet: v.Gender || '' }))
          .sort((x, y) => (y.cinsiyet === 'Female') - (x.cinsiyet === 'Female'));
        ayar.azure = { anahtar, bolge, sesler: tr.length ? tr : AZURE_VARSAYILAN };
        if (!onceki || onceki.anahtar !== anahtar || onceki.bolge !== bolge) bulutOnbellekTemizle();
        const yeni = azureSesleri();
        const kadin = yeni.find(v => cins(v) === 'kadin') || yeni[0];
        if (!onceki && kadin) ayar.ses = kadin.voiceURI;
        ayarKaydet();
        sesleriYukle();
        sesListesiniYaz();
        azureFormuDoldur();
        const deneme = bulutMu();
        azureDurumYaz('Bağlandı. Sesler: ' + yeni.map(v => v.name).join(', ') + '.' + (deneme ? ' Deneme cümlesi okunuyor.' : ''), 'ok');
        if (deneme) bulutDeneme();
      })
      .catch(e => azureDurumYaz(azureHataMesaji(e), 'hata'))
      .finally(() => { el.azureKaydet.disabled = false; });
  }

  function azureKaldir() {
    sustur();
    ayar.azure = null;
    if (/^azure:/.test(ayar.ses || '')) ayar.ses = '';
    ayarKaydet();
    bulutOnbellekTemizle();
    sesleriYukle();
    sesListesiniYaz();
    azureFormuDoldur();
    azureDurumYaz('Azure anahtarı bu cihazdan silindi.', '');
    ciz();
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
    el.oynat.disabled = !synth && !azureHazir();
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
      if (uz && S.dosyaAdi) {
        const ad = document.createElement('span');
        ad.className = 'ozet-dosya';
        ad.textContent = S.dosyaAdi + ' · ';
        el.ozet.appendChild(ad);
      }
      if (uz) {
        const adet = document.createElement('span');
        adet.className = 'ozet-sayi';
        adet.textContent = sayi(uz) + ' karakter · ';
        el.ozet.appendChild(adet);
        el.ozet.appendChild(document.createTextNode(sureYazisi(uz / (S.cps * ayar.hiz))));
      }
    }
    // Azure sesinde ses dosyası çaldığı için ekran kapanabilir; kilit ekranından yönetilir.
    ekraniAcikTut(S.okuyor && !bulutMu());
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = S.okuyor ? 'playing' : (S.dinle ? 'paused' : 'none'); } catch (e) { /* desteklenmiyor */ }
    }
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

  function metniKoy(yazi, dosyaAdi) {
    el.metin.value = yazi;
    el.metin.scrollTop = 0;
    S.dosyaAdi = dosyaAdi || '';
    if (S.dosyaAdi) depo.yaz('seslendir.dosya', S.dosyaAdi); else depo.sil('seslendir.dosya');
    metinDegisti();
  }

  /* ---------- Dosya açma ---------- */

  // Dosyalar uygulamasından (iCloud, Google Drive ve diğer konumlar) metin,
  // PDF, Word (.docx) ve UYAP (.udf) belgeleri açılır; metni çıkarılıp
  // okuma alanına konur. Dosya cihazdan çıkmaz.

  let pdfKitap = null;
  function pdfYukle() {
    return pdfKitap || (pdfKitap = import('./pdf/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('pdf/pdf.worker.min.mjs', document.baseURI).href;
      return m;
    }).catch(e => { pdfKitap = null; throw e; }));
  }

  function metinCoz(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { return new TextDecoder('windows-1254').decode(u8); }
  }

  // Sayfadaki yazı parçaları satırlara ve paragraflara toplanır; yalnız
  // sayfa numarasından oluşan satırlar atılır.
  async function pdfMetni(buf) {
    const pdfjs = await pdfYukle();
    const belge = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const sayfalar = [];
    for (let n = 1; n <= belge.numPages; n++) {
      const sayfa = await belge.getPage(n);
      const icerik = await sayfa.getTextContent();
      const satirlar = [];
      let satir = '', sonY = null, sonYuk = 0, sonX = null;
      icerik.items.forEach(x => {
        if (typeof x.str !== 'string') return;
        const y = x.transform ? x.transform[5] : 0;
        const xk = x.transform ? x.transform[4] : 0;
        const yuk = x.height || sonYuk || 10;
        if (sonY !== null) {
          const fark = Math.abs(y - sonY);
          if (fark > yuk * 0.5) {
            if (satir) satirlar.push(satir);
            if (fark > yuk * 1.9) satirlar.push('');
            satir = '';
          } else if (satir && sonX !== null && xk - sonX > yuk * 0.25 && !/\s$/.test(satir) && !/^\s/.test(x.str)) satir += ' ';
        }
        satir += x.str;
        sonY = y; sonYuk = yuk; sonX = xk + (x.width || 0);
        if (x.hasEOL) { satirlar.push(satir); satir = ''; }
      });
      if (satir) satirlar.push(satir);
      const temiz = satirlar.map(t => t.replace(/\s+/g, ' ').trim())
        .filter(t => !/^(sayfa\s*)?\d{1,4}(\s*[\/-]\s*\d{1,4})?$/i.test(t));
      sayfalar.push(temiz.join('\n'));
    }
    try { belge.destroy(); } catch (e) { /* önemsiz */ }
    return sayfalar.join('\n\n').replace(/\n{3,}/g, '\n\n');
  }

  // Zip paketinden (docx, udf) tek bir dosyayı çıkarır.
  async function zipDosyasi(buf, aranan) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip değil');
    const adet = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder('utf-8');
    for (let k = 0; k < adet; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const yontem = dv.getUint16(p + 10, true);
      const sikisik = dv.getUint32(p + 20, true);
      const adUz = dv.getUint16(p + 28, true), ekUz = dv.getUint16(p + 30, true), yorumUz = dv.getUint16(p + 32, true);
      const yerel = dv.getUint32(p + 42, true);
      const ad = td.decode(u8.subarray(p + 46, p + 46 + adUz));
      p += 46 + adUz + ekUz + yorumUz;
      if (ad !== aranan) continue;
      const bas = yerel + 30 + dv.getUint16(yerel + 26, true) + dv.getUint16(yerel + 28, true);
      const veri = u8.subarray(bas, bas + sikisik);
      if (yontem === 0) return veri;
      if (yontem === 8) {
        if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı sıkıştırılmış belgeleri açamıyor.');
        const akis = new Blob([veri]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(akis).arrayBuffer());
      }
      throw new Error('desteklenmeyen sıkıştırma');
    }
    return null;
  }

  const xmlOku = u8 => new DOMParser().parseFromString(new TextDecoder('utf-8').decode(u8), 'application/xml');

  async function docxMetni(buf) {
    const veri = await zipDosyasi(buf, 'word/document.xml');
    if (!veri) throw new Error('Word belgesi okunamadı.');
    const dom = xmlOku(veri);
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraflar = dom.getElementsByTagNameNS(W, 'p');
    const sonuc = [];
    for (let i = 0; i < paragraflar.length; i++) {
      let t = '';
      const gez = d => {
        for (let c = d.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const ad = c.localName;
          if (ad === 't') t += c.textContent;
          else if (ad === 'tab') t += ' ';
          else if (ad === 'br' || ad === 'cr') t += '\n';
          else if (ad !== 'del' && ad !== 'instrText') gez(c);
        }
      };
      gez(paragraflar[i]);
      sonuc.push(t.replace(/[ \t]+/g, ' ').trim());
    }
    return sonuc.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  async function udfMetni(buf) {
    const veri = await zipDosyasi(buf, 'content.xml');
    if (!veri) throw new Error('UYAP belgesi okunamadı.');
    const dom = xmlOku(veri);
    const icerik = dom.getElementsByTagName('content')[0];
    const t = icerik ? icerik.textContent : '';
    return t.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function dosyadanMetin(dosya) {
    const ad = (dosya.name || '').toLowerCase();
    const tip = dosya.type || '';
    const buf = await dosya.arrayBuffer();
    if (/\.pdf$/.test(ad) || tip === 'application/pdf') return pdfMetni(buf);
    if (/\.docx$/.test(ad) || /wordprocessingml/.test(tip)) return docxMetni(buf);
    if (/\.udf$/.test(ad)) return udfMetni(buf);
    if (/\.(txt|md|text|markdown)$/.test(ad) || /^text\//.test(tip) || !ad.includes('.')) return metinCoz(buf);
    if (/\.(doc|rtf|odt|pages)$/.test(ad)) throw new Error('Bu biçim desteklenmiyor. Belgeyi Word’de ya da Pages’te .docx ya da PDF olarak kaydedip yeniden deneyin.');
    throw new Error('Bu dosya türü desteklenmiyor. Metin, PDF, Word (.docx) ve UYAP (.udf) dosyaları açılabilir.');
  }

  async function dosyaSecildi() {
    const dosya = el.dosya.files && el.dosya.files[0];
    el.dosya.value = '';
    if (!dosya) return;
    sustur();
    S.dinle = false;
    ciz();
    bildir('“' + dosya.name + '” okunuyor…');
    try {
      const metin = (await dosyadanMetin(dosya)).trim();
      if (!metin) { bildir('Belgede okunacak yazı bulunamadı. Taranmış bir PDF ise yazı değil görüntü içeriyordur.'); return; }
      const onceki = el.metin.value;
      metniKoy(metin, dosya.name);
      el.metin.blur();
      const uz = sayi(metin.length) + ' karakter';
      if (onceki.trim() && onceki !== metin) bildir('“' + dosya.name + '” açıldı · ' + uz, { ad: 'Geri al', is: () => metniKoy(onceki) });
      else bildir('“' + dosya.name + '” açıldı · ' + uz);
    } catch (e) {
      bildir(e && e.message && !/^(zip değil|desteklenmeyen|http)/.test(e.message) && e.message.length < 140 ? e.message : 'Dosya okunamadı. Metin, PDF, Word (.docx) ve UYAP (.udf) dosyaları açılabilir.');
    }
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
    azureFormuDoldur();
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
  el.dosyaAc.addEventListener('click', () => el.dosya.click());
  el.dosya.addEventListener('change', dosyaSecildi);
  el.temizle.addEventListener('click', temizle);
  el.ornek.addEventListener('click', () => metniKoy(ORNEK));

  el.hiz.addEventListener('click', () => {
    ayar.hiz = HIZLAR[(HIZLAR.indexOf(ayar.hiz) + 1) % HIZLAR.length];
    ayarKaydet();
    if (S.okuyor && bulutMu()) { bulutHiz(); ciz(); }
    else if (S.okuyor) konus(S.i);
    else ciz();
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
    sesSec(v);
    denemeOku();
  });

  el.azureKaydet.addEventListener('click', azureKaydet);
  el.azureKaldir.addEventListener('click', azureKaldir);
  el.azureGoster.addEventListener('click', () => {
    const acik = el.azureAnahtar.classList.toggle('acik');
    el.azureGoster.textContent = acik ? 'Gizle' : 'Göster';
  });
  [el.azureAnahtar, el.azureBolge].forEach(g => g.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); azureKaydet(); } }));

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
    if (arkadaKaldi && cihaz().ios && !bulutMu()) {
      const benim = oturum;
      const donus = performance.now();
      setTimeout(() => { if (benim === oturum && S.okuyor && sonHaber < donus) konus(S.i); }, 1500);
    }
  });
  window.addEventListener('pagehide', () => {
    metniKaydet();
    if (synth) { try { synth.cancel(); } catch (e) { /* sayfa kapanıyor */ } }
    bulutDurdur();
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
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', sesleriYukle);
    else synth.onvoiceschanged = sesleriYukle;
    // Bazı tarayıcılar seslerin geldiğini haber vermez; birkaç kez yoklanır.
    [250, 800, 2000, 4000].forEach(ms => setTimeout(() => { if (!sesler.some(v => !v.bulut)) sesleriYukle(); }, ms));
    setTimeout(() => { if (!S.seslerGeldi) { S.seslerGeldi = true; sesSatiriniYaz(); } }, 4500);
    setInterval(nobet, 1500);
  }
  sesleriYukle();
  setInterval(bulutNobet, 1500);
  kumandayiBagla();

  ciz();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
