/* Sesli Not: konuşmayı kaydeder, cihazın içinde yazıya döker.
   Ses kayıtları ve metinler yalnızca bu cihazda, tarayıcının deposunda durur.
   Yazıya dökme ayrı bir iş parçacığında (yazici.js) yapılır; ses dışarı gönderilmez. */

(() => {
  'use strict';

  const SURUM = '1.0';
  const HIZ = 16000;               // kayıt saklama ve yazıya dökme örnekleme hızı
  const EN_UZUN_SN = 30 * 60;      // tek kayıt için üst sınır
  const DEPO_ADI = 'transformers-cache';

  const MODELLER = {
    dogru: {
      ad: 'Yüksek doğruluk', boyut: 'yaklaşık 250 MB', depo: 'onnx-community/whisper-small',
      aciklama: 'Türkçede belirgin biçimde daha az hata yapar; yazıya dökme daha uzun sürer.',
    },
    hizli: {
      ad: 'Hızlı', boyut: 'yaklaşık 80 MB', depo: 'onnx-community/whisper-base',
      aciklama: 'Yaklaşık üç kat hızlıdır, ancak Türkçede çok daha fazla kelimeyi yanlış yazar.',
    },
  };

  const $ = (s, k) => (k || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ikon = (ad, sinif) => `<svg class="ikon${sinif ? ' ' + sinif : ''}" aria-hidden="true"><use href="#i-${ad}"/></svg>`;

  /* ---------- Küçük ayar deposu ---------- */

  function depoOku(anahtar) {
    try { const v = localStorage.getItem(anahtar); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function depoYaz(anahtar, deger) {
    try { localStorage.setItem(anahtar, JSON.stringify(deger)); } catch (e) { /* depo kapalıysa ayar kalıcı olmaz */ }
  }
  function depoSil(anahtar) {
    try { localStorage.removeItem(anahtar); } catch (e) { /* önemli değil */ }
  }

  const ayar = { model: 'dogru' };
  {
    const a = depoOku('sn-ayar');
    if (a && MODELLER[a.model]) ayar.model = a.model;
  }
  const ayarYaz = () => depoYaz('sn-ayar', ayar);

  /* ---------- Kayıt deposu (IndexedDB) ---------- */

  let db = null;

  function dbAc() {
    return new Promise((coz, red) => {
      const i = indexedDB.open('sesli-not', 1);
      i.onupgradeneeded = () => {
        const d = i.result;
        if (!d.objectStoreNames.contains('notlar')) d.createObjectStore('notlar', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('sesler')) d.createObjectStore('sesler', { keyPath: 'id' });
      };
      i.onsuccess = () => coz(i.result);
      i.onerror = () => red(i.error);
    });
  }
  function islem(depolar, kip, is) {
    return new Promise((coz, red) => {
      const t = db.transaction(depolar, kip);
      let sonuc;
      t.oncomplete = () => coz(sonuc);
      t.onerror = t.onabort = () => red(t.error || new Error('Depo işlemi yarıda kaldı'));
      const r = is(t);
      if (r) r.onsuccess = () => { sonuc = r.result; };
    });
  }
  const tumNotlar = () => islem('notlar', 'readonly', t => t.objectStore('notlar').getAll());
  const notYaz = n => islem('notlar', 'readwrite', t => { t.objectStore('notlar').put(n); });
  const sesAl = id => islem('sesler', 'readonly', t => t.objectStore('sesler').get(id));
  const notVeSesYaz = (n, wav) => islem(['notlar', 'sesler'], 'readwrite', t => {
    t.objectStore('notlar').put(n);
    t.objectStore('sesler').put({ id: n.id, wav });
  });
  const notVeSesSil = id => islem(['notlar', 'sesler'], 'readwrite', t => {
    t.objectStore('notlar').delete(id);
    t.objectStore('sesler').delete(id);
  });

  /* ---------- Durum ---------- */

  let notlar = [];                 // yeniden eskiye
  let arama = '';
  let serit = null;                // { metin, uyari, islemler: [{ yazi, act }] }
  const cihazda = { dogru: false, hizli: false };  // model dosyaları indirilmiş mi
  let indirme = null;              // { model, oran, elle } sürmekte olan model indirmesi
  let indirmeOnayi = false;        // bu oturumda indirmeye izin verildi mi
  let kuyruk = [];                 // yazıya dökülmeyi bekleyen kayıt kimlikleri
  let suren = null;                // { id, model, asama: 'model' | 'yazim', oran, parca, metin }
  let kuyrukMesgul = false;
  let acik = null;                 // açık kayıt penceresi

  const notBul = id => notlar.find(n => n.id === id);

  // Hata iletisindeki uzun adresler "sunucu/…/dosya" biçimine indirilir.
  function ayrintiKisalt(mesaj) {
    return String(mesaj || '')
      .replace(/https?:\/\/([^\/\s"']+)\/[^\s"']*?([^\/\s"']+)(?=["'\s]|$)/g, '$1/…/$2')
      .replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  // Sunucu yoğunken ya da geçici bir arıza verdiğinde dönen yanıtlar.
  const sunucuYogun = mesaj => /\((429|5\d\d)\)/.test(String(mesaj || ''));
  const kimlik = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- Tarih ve süre ---------- */

  const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const iki = s => String(s).padStart(2, '0');
  const saat = d => iki(d.getHours()) + ':' + iki(d.getMinutes());

  function kisaTarih(ms) {
    const d = new Date(ms), bugun = new Date();
    const gun = t => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const fark = Math.round((gun(bugun) - gun(d)) / 864e5);
    if (fark === 0) return 'Bugün ' + saat(d);
    if (fark === 1) return 'Dün ' + saat(d);
    return d.getDate() + ' ' + AYLAR[d.getMonth()] + (d.getFullYear() === bugun.getFullYear() ? '' : ' ' + d.getFullYear()) + ' ' + saat(d);
  }
  function uzunTarih(ms) {
    const d = new Date(ms);
    const yil = d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear();
    return `${d.getDate()} ${AYLAR[d.getMonth()]}${yil}, ${GUNLER[d.getDay()]}`;
  }
  function sureYaz(sn) {
    sn = Math.max(0, Math.round(sn));
    return Math.floor(sn / 60) + ':' + iki(sn % 60);
  }
  function boyutYaz(bayt) {
    if (bayt < 1048576) return Math.max(1, Math.round(bayt / 1024)) + ' KB';
    return (bayt / 1048576).toFixed(bayt < 10485760 ? 1 : 0).replace('.', ',') + ' MB';
  }

  /* ---------- Çizim ---------- */

  const liste = $('#liste'), bos = $('#bos'), seritKutu = $('#serit'), araKutu = $('#araKutu');

  function cubuk(oran, yazi) {
    const belirsiz = oran === null || oran === undefined;
    return `<span class="cubuk${belirsiz ? ' belirsiz' : ''}"><i${belirsiz ? '' : ` style="width:${Math.round(oran * 100)}%"`}></i></span><span>${esc(yazi)}</span>`;
  }

  // Sürmekte olan iş için çubuk ve açıklama; kayıt listesinde ve kayıt penceresinde kullanılır.
  function surenYazi() {
    if (suren.asama === 'model') {
      if (indirme && !cihazda[suren.model]) return cubuk(indirme.oran, 'Model indiriliyor %' + Math.round(indirme.oran * 100));
      return cubuk(null, 'Model hazırlanıyor');
    }
    return cubuk(suren.parca > 1 ? suren.oran : null, 'Yazıya dökülüyor, uygulamayı açık tutun');
  }

  function durumSatiri(n) {
    if (suren && suren.id === n.id) return `<span class="not-durum">${surenYazi()}</span>`;
    if (kuyruk.includes(n.id)) return '<span class="not-durum">Sırada bekliyor</span>';
    if (n.durum === 'hata') return '<span class="not-durum uyari">Yazıya dökülemedi</span>';
    if (n.durum !== 'tamam') return '<span class="not-durum">Henüz yazıya dökülmedi</span>';
    return '';
  }

  function kartIci(n) {
    const canli = suren && suren.id === n.id && suren.metin;
    const metin = canli || n.metin;
    const yer = n.durum === 'tamam' ? 'Konuşma algılanamadı' : 'Ses kaydı';
    return `<span class="not-ust"><time>${esc(kisaTarih(n.tarih))}</time><span class="not-sure">${sureYaz(n.sure)}</span></span>
      <span class="not-metin${metin ? '' : ' silik'}">${esc(metin || yer)}</span>${durumSatiri(n)}`;
  }

  function kartGuncelle(id) {
    const n = notBul(id);
    const d = n && liste.querySelector(`[data-id="${id}"]`);
    if (d) d.innerHTML = kartIci(n);
    if (acik && acik.id === id) pencereDurumu();
  }

  function seritCiz() {
    let s = serit;
    // Kayıt beklemeden başlatılan model indirmesi şeritte gösterilir.
    if (!s && indirme && indirme.elle) {
      s = { ham: `<div class="serit-satir">${cubuk(indirme.oran, 'Model indiriliyor %' + Math.round(indirme.oran * 100))}</div>` };
    }
    seritKutu.hidden = !s;
    if (!s) return;
    seritKutu.className = 'serit' + (s.uyari ? ' uyari' : '');
    seritKutu.innerHTML = s.ham || `<p>${esc(s.metin)}</p>${s.ayrinti ? `<p class="kucuk">Ayrıntı: ${esc(s.ayrinti)}</p>` : ''}${s.islemler && s.islemler.length
      ? `<div class="serit-islem">${s.islemler.map(i => `<button type="button" class="metin-dugme" data-act="${i.act}">${esc(i.yazi)}</button>`).join('')}</div>` : ''}`;
  }

  function ciz() {
    const toplam = notlar.reduce((t, n) => t + n.sure, 0);
    $('#ustEtiket').textContent = notlar.length
      ? `${notlar.length} kayıt · ${toplam < 60 ? Math.round(toplam) + ' sn' : Math.round(toplam / 60) + ' dk'}` : '';
    seritCiz();
    araKutu.hidden = !notlar.length;

    const aranan = arama.trim().toLocaleLowerCase('tr');
    const gorunen = aranan ? notlar.filter(n => (n.metin || '').toLocaleLowerCase('tr').includes(aranan)) : notlar;
    liste.innerHTML = gorunen.map(n => `<li><button type="button" class="not kart" data-act="ac" data-id="${n.id}">${kartIci(n)}</button></li>`).join('');

    if (!notlar.length) {
      const m = MODELLER[ayar.model];
      const modelBilgi = cihazda[ayar.model]
        ? '<p>Yazıya dökme modeli bu cihazda hazır; internet gerekmez.</p>'
        : `<p>Yazıya dökme için ${m.boyut} bir model dosyası bir kez indirilir. İlk kayıtta sorulur; Wi-Fi bağlantısındayken şimdiden de indirebilirsiniz.</p>
           ${indirme ? '' : `<button type="button" class="dugme" data-act="model-indir">${ikon('indir')}Modeli şimdi indir</button>`}`;
      bos.className = 'bos';
      bos.innerHTML = `<div class="bos-simge">${ikon('mikrofon')}</div><strong>Henüz kayıt yok</strong>
        <p>Alttaki düğmeye dokunup konuşun. Kayıt bitince söyledikleriniz bu cihazın içinde yazıya dökülür; ses hiçbir yere gönderilmez.</p>${modelBilgi}`;
      bos.hidden = false;
    } else if (!gorunen.length) {
      bos.className = 'bos';
      bos.innerHTML = '<strong>Sonuç yok</strong><p>Aranan söz hiçbir notta geçmiyor.</p>';
      bos.hidden = false;
    } else {
      bos.hidden = true;
      bos.innerHTML = '';
    }
  }

  /* ---------- Bildirim ---------- */

  const bildirimKutu = $('#bildirim');
  let bildirimSayac = 0;

  function bildir(metin) {
    clearTimeout(bildirimSayac);
    bildirimKutu.textContent = metin;
    bildirimKutu.hidden = false;
    bildirimSayac = setTimeout(() => { bildirimKutu.hidden = true; }, 4500);
  }

  /* ---------- Pencereler ---------- */

  const pencere = $('#pencere'), onay = $('#onay');
  let pencereKapaninca = null;

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
    modalAc(pencere);
    pencere.scrollTop = 0;
  }
  function pencereKapat() {
    const f = pencereKapaninca;
    pencereKapaninca = null;
    if (f) f();
    modalKapat(pencere);
    pencere.innerHTML = '';
  }
  pencere.addEventListener('cancel', e => { e.preventDefault(); pencereKapat(); });
  pencere.addEventListener('close', () => pencereKapat());
  pencere.addEventListener('click', e => {
    if (e.target !== pencere) return;
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
          <button type="button" class="dugme dugme-sade" data-sonuc="vazgec">${esc(s.vazgec || 'Vazgeç')}</button>
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

  /* ---------- Ses: örnekleme hızını düşürme ve dosya biçimi ---------- */

  // Mikrofonun hızından (çoğunlukla 48 kHz) 16 kHz'e iner. Önce 7,2 kHz üstü
  // süzülür, sonra aradaki noktalar doğrusal olarak hesaplanır.
  function ornekleyici(kaynakHiz, yaz) {
    if (kaynakHiz === HIZ) return parca => { for (let i = 0; i < parca.length; i++) yaz(parca[i]); };
    const TAP = 63, ORTA = (TAP - 1) / 2;
    const kesim = Math.min(7200, kaynakHiz * 0.45) / kaynakHiz;
    const h = new Float32Array(TAP);
    let toplam = 0;
    for (let k = 0; k < TAP; k++) {
      const x = k - ORTA;
      const sinc = x === 0 ? 2 * kesim : Math.sin(2 * Math.PI * kesim * x) / (Math.PI * x);
      const p = 0.42 - 0.5 * Math.cos(2 * Math.PI * k / (TAP - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (TAP - 1));
      h[k] = sinc * p;
      toplam += h[k];
    }
    for (let k = 0; k < TAP; k++) h[k] /= toplam;

    const KUYRUK = TAP + 1;
    const adim = kaynakHiz / HIZ;
    let kuyruk = new Float32Array(KUYRUK);
    let konum = TAP;
    const suz = (w, j) => { let t = 0; for (let k = 0; k < TAP; k++) t += h[k] * w[j - k]; return t; };

    return parca => {
      const w = new Float32Array(KUYRUK + parca.length);
      w.set(kuyruk, 0);
      w.set(parca, KUYRUK);
      const son = w.length - 1;
      while (konum + 1 <= son) {
        const i = Math.floor(konum), f = konum - i;
        const a = suz(w, i);
        yaz(f > 0 ? a + (suz(w, i + 1) - a) * f : a);
        konum += adim;
      }
      kuyruk = w.slice(w.length - KUYRUK);
      konum -= parca.length;
    };
  }

  // 16 bit örnekleri onar saniyelik bloklarda biriktirir.
  function sesDeposu() {
    const BLOK = HIZ * 10;
    const bloklar = [];
    let b = new Int16Array(BLOK), dolu = 0, toplam = 0;
    return {
      yaz(v) {
        if (dolu === BLOK) { bloklar.push(b); b = new Int16Array(BLOK); dolu = 0; }
        b[dolu++] = v <= -1 ? -32768 : v >= 1 ? 32767 : Math.round(v * 32767);
        toplam++;
      },
      get toplam() { return toplam; },
      birlestir() {
        const s = new Int16Array(toplam);
        let o = 0;
        for (const x of bloklar) { s.set(x, o); o += x.length; }
        s.set(b.subarray(0, dolu), o);
        return s;
      },
    };
  }

  function wavYap(i16) {
    const tampon = new ArrayBuffer(44 + i16.length * 2), g = new DataView(tampon);
    const yaz = (o, s) => { for (let i = 0; i < s.length; i++) g.setUint8(o + i, s.charCodeAt(i)); };
    yaz(0, 'RIFF'); g.setUint32(4, 36 + i16.length * 2, true); yaz(8, 'WAVE');
    yaz(12, 'fmt '); g.setUint32(16, 16, true); g.setUint16(20, 1, true); g.setUint16(22, 1, true);
    g.setUint32(24, HIZ, true); g.setUint32(28, HIZ * 2, true); g.setUint16(32, 2, true); g.setUint16(34, 16, true);
    yaz(36, 'data'); g.setUint32(40, i16.length * 2, true);
    for (let i = 0; i < i16.length; i++) g.setInt16(44 + i * 2, i16[i], true);
    return tampon;
  }
  function wavdanPcm(tampon) {
    const g = new DataView(tampon), n = (tampon.byteLength - 44) >> 1;
    const s = new Int16Array(n);
    for (let i = 0; i < n; i++) s[i] = g.getInt16(44 + i * 2, true);
    return s;
  }

  /* ---------- Kayıt ---------- */

  const kayitEkrani = $('#kayitEkrani'), kayitSure = $('#kayitSure'), dalga = $('#dalga');
  const kayitDugme = $('#kayitDugme');
  let kayit = null;          // sürmekte olan kayıt
  let kayitAciliyor = false;

  function kayitSureYaz(sn) {
    const m = iki(Math.floor(sn / 60)), s = iki(sn % 60);
    kayitSure.innerHTML = `<b>${m[0]}</b><b>${m[1]}</b><span>:</span><b>${s[0]}</b><b>${s[1]}</b>`;
    kayitSure.setAttribute('aria-label', `${Math.floor(sn / 60)} dakika ${sn % 60} saniye`);
  }

  function dalgaCiz() {
    const k = kayit;
    if (!k) return;
    const sn = Math.floor(k.depo.toplam / HIZ);
    if (sn !== k.yazilanSn) { k.yazilanSn = sn; kayitSureYaz(sn); }

    const oran = window.devicePixelRatio || 1;
    const w = dalga.clientWidth, h = dalga.clientHeight;
    if (dalga.width !== Math.round(w * oran) || dalga.height !== Math.round(h * oran)) {
      dalga.width = Math.round(w * oran);
      dalga.height = Math.round(h * oran);
    }
    const g = dalga.getContext('2d');
    g.setTransform(oran, 0, 0, oran, 0, 0);
    g.clearRect(0, 0, w, h);
    const ADIM = 5, EN = 3, adet = Math.floor(w / ADIM), s = k.seviyeler;
    const kayma = (w - adet * ADIM + (ADIM - EN)) / 2;
    g.fillStyle = k.duraklat ? '#6c675e' : '#cfa85a';
    for (let i = 0; i < adet; i++) {
      const v = s[s.length - adet + i];
      const y = v === undefined ? 2 : Math.max(2, Math.min(h, Math.sqrt(v) * h * 1.15));
      const x = kayma + i * ADIM;
      g.globalAlpha = v === undefined ? 0.35 : 1;
      if (g.roundRect) { g.beginPath(); g.roundRect(x, (h - y) / 2, EN, y, 1.5); g.fill(); }
      else g.fillRect(x, (h - y) / 2, EN, y);
    }
    g.globalAlpha = 1;
    k.cizim = requestAnimationFrame(dalgaCiz);
  }

  function kayitDonanimKapat(k) {
    cancelAnimationFrame(k.cizim);
    try { if (k.akis) k.akis.getTracks().forEach(t => t.stop()); } catch (e) { /* zaten durmuş */ }
    try {
      if (k.dugum) {
        if (k.dugum.port) k.dugum.port.onmessage = null;
        k.dugum.onaudioprocess = null;
        k.dugum.disconnect();
      }
    } catch (e) { /* zaten ayrılmış */ }
    clearTimeout(k.bekci);
    try { if (k.ctx) { k.ctx.onstatechange = null; k.ctx.close(); } } catch (e) { /* zaten kapalı */ }
    try { if (k.kilit) k.kilit.release(); } catch (e) { /* zaten bırakılmış */ }
  }

  async function kayitBasla() {
    if (kayit || kayitAciliyor) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      bildir('Bu tarayıcı mikrofon kaydını desteklemiyor.');
      return;
    }
    kayitAciliyor = true;
    kayitDugme.disabled = true;
    const k = { ctx: null, akis: null, dugum: null, depo: sesDeposu(), seviyeler: [], duraklat: false, bitiyor: false, kilit: null, cizim: 0, yazilanSn: -1, bekci: 0 };
    try {
      k.akis = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      // Ses bağlamı mikrofon açıldıktan sonra kurulur; böylece mikrofonun örnekleme hızıyla açılır.
      const ctx = k.ctx = new Ctx();
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      ctx.onstatechange = () => {
        if (kayit === k && !k.bitiyor && !document.hidden && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
      };

      const kaynak = ctx.createMediaStreamSource(k.akis);
      const ornekle = ornekleyici(ctx.sampleRate, v => k.depo.yaz(v));
      const parcaGeldi = parca => {
        if (kayit !== k || k.bitiyor || k.duraklat) return;
        let tepe = 0;
        for (let i = 0; i < parca.length; i += 2) { const a = parca[i] < 0 ? -parca[i] : parca[i]; if (a > tepe) tepe = a; }
        k.seviyeler.push(tepe);
        if (k.seviyeler.length > 600) k.seviyeler.splice(0, 300);
        ornekle(parca);
        if (k.depo.toplam >= EN_UZUN_SN * HIZ) kayitBitir('sinir');
      };
      // Düğümün çalışması için çıkışa bağlı olması gerekir; ses kısılarak hoparlöre verilmez.
      const sessiz = ctx.createGain();
      sessiz.gain.value = 0;
      sessiz.connect(ctx.destination);
      try {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('desteklenmiyor');
        await ctx.audioWorklet.addModule('kayit-isleyici.js');
        k.dugum = new AudioWorkletNode(ctx, 'kayit-isleyici', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        k.dugum.port.onmessage = e => parcaGeldi(e.data);
      } catch (e) {
        k.dugum = ctx.createScriptProcessor(4096, 1, 1);
        k.dugum.onaudioprocess = e => parcaGeldi(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
      kaynak.connect(k.dugum);
      k.dugum.connect(sessiz);
      k.akis.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (kayit === k) kayitBitir('kesildi'); }));
    } catch (e) {
      kayitDonanimKapat(k);
      kayitAciliyor = false;
      kayitDugme.disabled = false;
      const ad = e && e.name;
      bildir(ad === 'NotAllowedError' || ad === 'SecurityError'
        ? 'Mikrofon izni verilmedi. İzni telefonun Ayarlar bölümünden açabilirsiniz.'
        : ad === 'NotFoundError' ? 'Mikrofon bulunamadı.' : 'Mikrofona ulaşılamadı.');
      return;
    }
    kayitAciliyor = false;
    kayitDugme.disabled = false;
    if (document.hidden) { kayitDonanimKapat(k); return; }

    kayit = k;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(l => { if (kayit === k) k.kilit = l; else l.release(); }).catch(() => {});
    }
    kayitEkrani.classList.remove('durakladi');
    $('#kayitEtiket span').textContent = 'Kaydediliyor';
    $('#duraklatDugme').textContent = 'Duraklat';
    kayitSureYaz(0);
    kayitEkrani.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.durdur-dugme', kayitEkrani).focus();
    k.cizim = requestAnimationFrame(dalgaCiz);
    // Birkaç saniye içinde hiç ses gelmezse kayıt boşuna sürmesin.
    k.bekci = setTimeout(() => {
      if (kayit !== k || k.bitiyor || k.depo.toplam > 0) return;
      k.ctx.resume().catch(() => {});
      k.bekci = setTimeout(() => {
        if (kayit !== k || k.bitiyor || k.depo.toplam > 0) return;
        k.bitiyor = true;
        kayitDonanimKapat(k);
        kayit = null;
        kayitEkraniKapat();
        bildir('Mikrofondan ses alınamadı. Uygulamayı kapatıp açtıktan sonra yeniden deneyin.');
      }, 2500);
    }, 2000);
  }

  function kayitEkraniKapat() {
    kayitEkrani.hidden = true;
    document.body.style.overflow = '';
  }

  function kayitDuraklat() {
    const k = kayit;
    if (!k || k.bitiyor) return;
    k.duraklat = !k.duraklat;
    kayitEkrani.classList.toggle('durakladi', k.duraklat);
    $('#kayitEtiket span').textContent = k.duraklat ? 'Duraklatıldı' : 'Kaydediliyor';
    $('#duraklatDugme').textContent = k.duraklat ? 'Sürdür' : 'Duraklat';
  }

  async function kayitIptal() {
    const k = kayit;
    if (!k || k.bitiyor) return;
    if (k.depo.toplam / HIZ >= 5) {
      const once = k.duraklat;
      k.duraklat = true;
      const c = await sor({ baslik: 'Kayıt silinsin mi?', metin: 'Bu kayıt saklanmayacak.', dugme: 'Sil', tehlike: true, vazgec: 'Kayda dön' });
      if (kayit !== k || k.bitiyor) return;
      if (c !== 'tamam') { k.duraklat = once; return; }
    }
    k.bitiyor = true;
    kayitDonanimKapat(k);
    kayit = null;
    kayitEkraniKapat();
  }

  async function kayitBitir(neden) {
    const k = kayit;
    if (!k || k.bitiyor) return;
    k.bitiyor = true;
    kayitDonanimKapat(k);
    kayit = null;
    kayitEkraniKapat();
    if (onay.open) modalKapat(onay);

    const pcm = k.depo.birlestir();
    const sure = pcm.length / HIZ;
    if (sure < 0.6) { bildir('Kayıt çok kısa olduğu için saklanmadı.'); return; }
    const wav = wavYap(pcm);
    const n = { id: kimlik(), tarih: Date.now(), sure, metin: '', durum: 'bekliyor', boyut: wav.byteLength };
    try {
      await notVeSesYaz(n, wav);
    } catch (e) {
      bildir('Kayıt saklanamadı. Cihazda yer kalmamış olabilir.');
      return;
    }
    notlar.unshift(n);
    if (arama) { arama = ''; $('#ara').value = ''; }
    ciz();
    window.scrollTo(0, 0);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (neden === 'arka-plan') bildir('Uygulama arka plana geçtiği için kayıt durduruldu ve saklandı.');
    else if (neden === 'sinir') bildir('Otuz dakikalık sınıra ulaşıldı; kayıt saklandı.');
    else if (neden === 'kesildi') bildir('Mikrofon bağlantısı kesildi; kayıt saklandı.');
    yazimIste(n.id);
  }

  /* ---------- Yazıya dökme ---------- */

  let isci = null;

  // Ekran kilitlenirse telefon sayfayı durdurur ve iş yarıda kalır; iş sürerken ekran açık tutulur.
  let isKilidi = null;
  function isKilidiAl() {
    if (isKilidi || document.hidden || !navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(l => {
      if (!suren) { l.release().catch(() => {}); return; }
      isKilidi = l;
      l.addEventListener('release', () => { if (isKilidi === l) isKilidi = null; });
    }).catch(() => {});
  }
  function isKilidiBirak() {
    const l = isKilidi;
    isKilidi = null;
    if (l) l.release().catch(() => {});
  }

  function isciAl() {
    if (isci) return isci;
    isci = new Worker('yazici.js', { type: 'module' });
    isci.onmessage = e => isciIleti(e.data || {});
    isci.onerror = () => isciCoktu();
    return isci;
  }

  // İş parçacığı açılamaz ya da çökerse süren iş hataya çevrilir, kuyruk boşaltılır.
  function isciCoktu() {
    try { if (isci) isci.terminate(); } catch (e) { /* önemli değil */ }
    isci = null;
    indirme = null;
    const s = suren;
    suren = null;
    kuyruk = [];
    isKilidiBirak();
    depoSil('sn-suren');
    if (s) {
      const n = notBul(s.id);
      if (n) { n.durum = 'hata'; n.hata = 'yazim'; notYaz(n).catch(() => {}); }
    }
    serit = { uyari: true, metin: 'Yazıya dökme başlatılamadı. Kayıtlarınız duruyor; uygulamayı kapatıp açtıktan sonra yeniden deneyebilirsiniz.', islemler: [{ yazi: 'Kapat', act: 'serit-kapat' }] };
    ciz();
    if (acik) pencereDurumu();
  }

  async function modelDurumYenile() {
    for (const kod of Object.keys(MODELLER)) cihazda[kod] = false;
    try {
      if (!('caches' in window) || !(await caches.has(DEPO_ADI))) return;
      const anahtarlar = await (await caches.open(DEPO_ADI)).keys();
      for (const kod of Object.keys(MODELLER)) {
        const d = MODELLER[kod].depo;
        cihazda[kod] = ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx']
          .every(dosya => anahtarlar.some(r => r.url.includes(d) && r.url.includes(dosya)));
      }
    } catch (e) { /* depo okunamadıysa indirilmemiş sayılır */ }
  }

  function bekleyenler() {
    return notlar.filter(n => n.durum === 'bekliyor' || (n.durum === 'hata' && n.hata === 'model')).map(n => n.id).reverse();
  }

  function yazimIste(id) {
    if ((suren && suren.id === id) || kuyruk.includes(id)) return;
    kuyruk.push(id);
    kartGuncelle(id);
    kuyrukIslet();
  }

  async function kuyrukIslet() {
    if (suren || kuyrukMesgul || !kuyruk.length) return;
    kuyrukMesgul = true;
    try {
      const model = ayar.model;
      if (!cihazda[model] && !indirmeOnayi && !(indirme && indirme.model === model)) {
        const m = MODELLER[model];
        const c = await sor({
          baslik: 'Model indirilsin mi?',
          metin: `Yazıya dökme için ${m.boyut} bir model dosyası bir kez indirilir; sonraki kayıtlarda internet gerekmez. Mobil veri kullanıyorsanız Wi-Fi bağlantısını bekleyebilirsiniz. Kaydınız her durumda saklanır.`,
          dugme: 'İndir', vazgec: 'Sonra',
        });
        if (c !== 'tamam') { kuyruk = []; ciz(); return; }
        indirmeOnayi = true;
      }
      while (kuyruk.length && !suren) {
        const id = kuyruk.shift();
        const n = notBul(id);
        if (!n) continue;
        let kayitli = null;
        try { kayitli = await sesAl(id); } catch (e) { /* aşağıda ele alınır */ }
        if (!notBul(id)) continue;
        if (!kayitli || !kayitli.wav) {
          n.durum = 'hata'; n.hata = 'ses';
          await notYaz(n).catch(() => {});
          kartGuncelle(id);
          continue;
        }
        const pcm = wavdanPcm(kayitli.wav);
        suren = { id, model, asama: 'model', oran: 0, parca: 1, metin: '' };
        depoYaz('sn-suren', { id, model, gizli: document.hidden });
        n.durum = 'yaziliyor';
        delete n.hata;
        delete n.ayrinti;
        await notYaz(n).catch(() => {});
        serit = null;
        ciz();
        if (acik) pencereDurumu();
        isKilidiAl();
        isciAl().postMessage({ tip: 'yaz', id, model, pcm: pcm.buffer }, [pcm.buffer]);
      }
    } finally {
      kuyrukMesgul = false;
    }
  }

  function yazimBitti(id) {
    suren = null;
    depoSil('sn-suren');
    kartGuncelle(id);
    kuyrukIslet();
    if (!suren) isKilidiBirak();
  }

  async function isciIleti(d) {
    if (d.tip === 'indirme') {
      if (cihazda[d.model]) return;
      indirme = { model: d.model, oran: d.oran, elle: !!(indirme && indirme.elle) };
      if (suren && suren.asama === 'model') kartGuncelle(suren.id);
      if (indirme.elle) { seritCiz(); if ($('#ayarDurum')) ayarDurumCiz(); }
      return;
    }
    if (d.tip === 'hazir') {
      const elle = indirme && indirme.elle;
      const ilkKez = !cihazda[d.model];
      cihazda[d.model] = true;
      indirme = null;
      if (elle && ilkKez) bildir('Model indirildi. Yazıya dökme artık internetsiz çalışır.');
      if (suren && suren.asama === 'model') { suren.asama = 'yazim'; kartGuncelle(suren.id); }
      if (!notlar.length || elle) ciz();
      if ($('#ayarDurum')) ayarDurumCiz();
      return;
    }
    if (d.tip === 'basladi') {
      if (suren && suren.id === d.id) { suren.asama = 'yazim'; suren.parca = d.parca; kartGuncelle(d.id); }
      return;
    }
    if (d.tip === 'ilerleme') {
      if (suren && suren.id === d.id) { suren.oran = d.oran; suren.metin = d.metin || ''; kartGuncelle(d.id); }
      return;
    }
    if (d.tip === 'bitti') {
      const n = notBul(d.id);
      if (n) {
        n.metin = d.metin || '';
        n.durum = 'tamam';
        delete n.hata;
        delete n.ayrinti;
        delete n.duzenlendi;
        await notYaz(n).catch(() => {});
      }
      yazimBitti(d.id);
      return;
    }
    if (d.tip === 'hata') {
      const modelHatasi = d.asama === 'model';
      indirme = null;
      if (d.id) {
        const n = notBul(d.id);
        if (n) { n.durum = 'hata'; n.hata = modelHatasi ? 'model' : 'yazim'; n.ayrinti = ayrintiKisalt(d.mesaj); await notYaz(n).catch(() => {}); }
      }
      if (modelHatasi) {
        // İndirme başarısızsa sıradakiler de başarısız olur; kuyruk boşaltılır, kayıtlar bekler.
        kuyruk = [];
        indirmeOnayi = false;
        serit = {
          uyari: true,
          ayrinti: ayrintiKisalt(d.mesaj),
          metin: navigator.onLine === false
            ? 'Yazıya dökme modeli indirilemedi; internet bağlantısı yok. Kayıtlarınız duruyor, bağlantı gelince yeniden deneyebilirsiniz.'
            : sunucuYogun(d.mesaj)
              ? 'Model sunucusu şu an yanıt vermiyor. Kayıtlarınız duruyor; birkaç dakika sonra yeniden deneyebilirsiniz.'
              : 'Yazıya dökme modeli indirilemedi. Kayıtlarınız duruyor; bağlantınızı denetleyip yeniden deneyebilirsiniz.',
          islemler: [{ yazi: 'Yeniden dene', act: bekleyenler().length ? 'bekleyenleri-yaz' : 'model-indir' }, { yazi: 'Kapat', act: 'serit-kapat' }],
        };
      } else if (d.id) {
        bildir('Kayıt yazıya dökülemedi. Kaydı açıp yeniden deneyebilirsiniz.');
      }
      suren = null;
      depoSil('sn-suren');
      ciz();
      if (acik) pencereDurumu();
      if ($('#ayarDurum')) ayarDurumCiz();
      kuyrukIslet();
      if (!suren) isKilidiBirak();
    }
  }

  function modelIndir() {
    const model = ayar.model;
    if (cihazda[model] || (indirme && indirme.model === model)) return;
    indirmeOnayi = true;
    indirme = { model, oran: 0, elle: true };
    serit = null;
    ciz();
    if ($('#ayarDurum')) ayarDurumCiz();
    isciAl().postMessage({ tip: 'hazirla', model });
  }

  /* ---------- Kayıt penceresi ---------- */

  function pencereDurumu() {
    if (!acik) return;
    const n = notBul(acik.id);
    const kutu = $('#notBilgi'), alan = $('#notMetin');
    if (!n || !kutu || !alan) return;
    const surüyor = suren && suren.id === n.id;
    const sirada = kuyruk.includes(n.id);
    alan.readOnly = !!(surüyor || sirada);
    if (surüyor) {
      kutu.className = 'not-bilgi';
      kutu.innerHTML = surenYazi();
      if (suren.metin) alan.value = suren.metin;
    } else if (sirada) {
      kutu.className = 'not-bilgi';
      kutu.textContent = 'Sırada bekliyor.';
    } else if (n.durum === 'hata') {
      kutu.className = 'not-bilgi uyari';
      kutu.textContent = (n.hata === 'model' ? 'Model indirilemediği için yazıya dökülemedi.'
        : n.hata === 'ses' ? 'Ses kaydı bulunamadı.'
        : n.hata === 'kesildi' ? 'Yazıya dökme yarıda kesildi.' : 'Yazıya dökme sırasında bir sorun oluştu.')
        + (n.ayrinti && n.hata !== 'kesildi' ? ' Ayrıntı: ' + n.ayrinti : '');
    } else if (n.durum !== 'tamam') {
      kutu.className = 'not-bilgi';
      kutu.textContent = 'Bu kayıt henüz yazıya dökülmedi.';
    } else if (!n.metin && !alan.value) {
      kutu.className = 'not-bilgi';
      kutu.textContent = 'Kayıtta konuşma algılanamadı. Dilerseniz metni elle yazabilirsiniz.';
    } else {
      kutu.className = 'not-bilgi';
      kutu.textContent = '';
    }
    kutu.hidden = !kutu.innerHTML;
    // İş bittiğinde pencere açıksa metin yerine konur.
    if (!surüyor && !sirada && acik.bekleniyor) {
      acik.bekleniyor = false;
      alan.value = n.metin || '';
    }
    if (surüyor || sirada) acik.bekleniyor = true;
    const yeniden = $('[data-act="yeniden"]', pencere);
    if (yeniden) {
      yeniden.hidden = !!(surüyor || sirada) || n.hata === 'ses';
      yeniden.textContent = n.durum === 'tamam' ? 'Yeniden yazıya dök' : 'Yazıya dök';
    }
  }

  function calarGuncelle() {
    if (!acik || !acik.ses) return;
    const a = acik.ses, n = notBul(acik.id);
    const toplam = isFinite(a.duration) && a.duration > 0 ? a.duration : (n ? n.sure : 0);
    const c = $('#calarCubuk'), s = $('#calarSure'), d = $('#calarDugme');
    if (!c) return;
    if (!acik.surukleniyor) {
      const oran = toplam ? Math.min(1, a.currentTime / toplam) : 0;
      c.value = Math.round(oran * 1000);
      c.style.setProperty('--dolu', (oran * 100).toFixed(1) + '%');
    }
    s.textContent = sureYaz(a.currentTime) + ' / ' + sureYaz(toplam);
    const caliyor = !a.paused && !a.ended;
    d.innerHTML = ikon(caliyor ? 'durakla' : 'oynat');
    d.setAttribute('aria-label', caliyor ? 'Duraklat' : 'Dinle');
  }

  async function notAc(id) {
    const n = notBul(id);
    if (!n) return;
    let kayitli = null;
    try { kayitli = await sesAl(id); } catch (e) { /* ses okunamazsa yalnızca metin gösterilir */ }
    const wav = kayitli && kayitli.wav;
    const url = wav ? URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })) : '';
    acik = { id, url, wav, ses: null, sayac: 0, bekleniyor: false, surukleniyor: false };

    pencereAc(`
      <header class="pencere-bas">
        <h2>${esc(uzunTarih(n.tarih))}<small>${saat(new Date(n.tarih))} · ${sureYaz(n.sure)} · ${boyutYaz(n.boyut || 0)}</small></h2>
        <button type="button" class="simge-dugme" data-act="kapat" aria-label="Kapat">${ikon('kapat')}</button>
      </header>
      <div class="pencere-ic">
        ${url ? `<div class="calar">
          <button type="button" class="calar-dugme" id="calarDugme" data-act="cal" aria-label="Dinle">${ikon('oynat')}</button>
          <input type="range" class="calar-cubuk" id="calarCubuk" min="0" max="1000" step="1" value="0" aria-label="Kayıttaki konum">
          <span class="calar-sure" id="calarSure">0:00 / ${sureYaz(n.sure)}</span>
        </div>` : ''}
        <div class="not-bilgi" id="notBilgi" hidden></div>
        <label class="alan not-alan"><span>Metin</span>
          <textarea id="notMetin" rows="8" placeholder="Yazıya dökülen metin burada görünür; dilediğiniz gibi düzeltebilirsiniz.">${esc(n.metin || '')}</textarea>
        </label>
        <div class="not-islem">
          ${url ? '<button type="button" class="metin-dugme" data-act="ses-paylas">Sesi paylaş</button>' : ''}
          <button type="button" class="metin-dugme" data-act="yeniden">Yeniden yazıya dök</button>
          <button type="button" class="metin-dugme tehlike" data-act="sil">Sil</button>
        </div>
      </div>
      <footer class="pencere-alt">
        <button type="button" class="dugme dugme-ana" data-act="kopyala">${ikon('kopya')}Kopyala</button>
        <button type="button" class="dugme" data-act="paylas">${ikon('paylas')}Paylaş</button>
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="kapat">Kapat</button>
      </footer>`, () => {
      const a = acik;
      acik = null;
      if (!a) return;
      clearTimeout(a.sayac);
      metinSakla(a.id);
      if (a.ses) { a.ses.pause(); a.ses.removeAttribute('src'); a.ses.load(); }
      if (a.url) URL.revokeObjectURL(a.url);
    });

    if (url) {
      const a = acik.ses = new Audio();
      a.preload = 'metadata';
      a.src = url;
      ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata'].forEach(o => a.addEventListener(o, calarGuncelle));
      const c = $('#calarCubuk');
      const konumla = () => {
        const toplam = isFinite(a.duration) && a.duration > 0 ? a.duration : n.sure;
        c.style.setProperty('--dolu', (c.value / 10) + '%');
        try { a.currentTime = (c.value / 1000) * toplam; } catch (e) { /* ses henüz hazır değil */ }
      };
      c.addEventListener('input', () => { acik.surukleniyor = true; konumla(); });
      c.addEventListener('change', () => { konumla(); if (acik) acik.surukleniyor = false; });
    }
    $('#notMetin').addEventListener('input', () => {
      if (!acik) return;
      clearTimeout(acik.sayac);
      acik.sayac = setTimeout(() => metinSakla(id), 600);
    });
    pencereDurumu();
  }

  function metinSakla(id) {
    const n = notBul(id), alan = $('#notMetin');
    if (!n || !alan || alan.readOnly) return;
    const yeni = alan.value;
    if (yeni === (n.metin || '')) return;
    n.metin = yeni;
    n.duzenlendi = true;
    if (n.durum !== 'tamam' && yeni.trim()) { n.durum = 'tamam'; delete n.hata; }
    notYaz(n).catch(() => bildir('Değişiklik saklanamadı.'));
    const d = liste.querySelector(`[data-id="${id}"]`);
    if (d) d.innerHTML = kartIci(n);
  }

  const acikMetin = () => { const a = $('#notMetin'); return a ? a.value.trim() : ''; };

  async function kopyala(metin) {
    if (!metin) { bildir('Kopyalanacak metin yok.'); return; }
    try {
      await navigator.clipboard.writeText(metin);
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = metin;
      t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      (pencere.open ? pencere : document.body).appendChild(t);
      t.select();
      let oldu = false;
      try { oldu = document.execCommand('copy'); } catch (h) { /* aşağıda bildirilir */ }
      t.remove();
      if (!oldu) { bildir('Metin kopyalanamadı.'); return; }
    }
    bildir('Metin kopyalandı.');
  }

  function dosyaAdi(n, uzanti) {
    const d = new Date(n.tarih);
    return `sesli-not-${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}-${iki(d.getHours())}${iki(d.getMinutes())}.${uzanti}`;
  }

  // Paylaşım penceresi varsa onu açar, yoksa dosyayı indirir.
  async function dosyaVer(dosya) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [dosya] })) {
        await navigator.share({ files: [dosya] });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(dosya);
    const a = document.createElement('a');
    a.href = url;
    a.download = dosya.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function notSil(id) {
    const c = await sor({ baslik: 'Kayıt silinsin mi?', metin: 'Ses kaydı ve metni bu cihazdan kalıcı olarak silinir.', dugme: 'Sil', tehlike: true });
    if (c !== 'tamam') return;
    if (acik && acik.id === id) {
      const alan = $('#notMetin');
      if (alan) alan.readOnly = true; // kapanırken yeniden saklanmasın
      pencereKapat();
    }
    kuyruk = kuyruk.filter(k => k !== id);
    notlar = notlar.filter(n => n.id !== id);
    try { await notVeSesSil(id); } catch (e) { bildir('Kayıt silinemedi.'); }
    ciz();
  }

  /* ---------- Ayarlar ---------- */

  function ayarDurumCiz() {
    const kutu = $('#ayarDurum');
    if (!kutu) return;
    const model = ayar.model, m = MODELLER[model];
    if (indirme && indirme.model === model && !cihazda[model]) {
      kutu.innerHTML = `<div class="ayar-satir">${cubuk(indirme.oran, 'İndiriliyor %' + Math.round(indirme.oran * 100))}</div>`;
    } else if (cihazda[model]) {
      kutu.innerHTML = `<p><strong>${esc(m.ad)}</strong> modeli bu cihazda hazır. Yazıya dökme internetsiz çalışır.</p>`;
    } else {
      kutu.innerHTML = `<p><strong>${esc(m.ad)}</strong> modeli henüz indirilmedi (${m.boyut}). İlk yazıya dökmede sorulur.</p>
        <div class="ayar-satir"><button type="button" class="dugme" data-act="model-indir">${ikon('indir')}Şimdi indir</button></div>`;
    }
    const sil = $('#modelSil');
    if (sil) sil.hidden = !(cihazda.dogru || cihazda.hizli) || !!suren || !!indirme;
  }

  function ayarlarAc() {
    const toplam = notlar.reduce((t, n) => t + (n.boyut || 0), 0);
    const ayakta = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    pencereAc(`
      <header class="pencere-bas"><h2>Ayarlar</h2>
        <button type="button" class="simge-dugme" data-act="kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <section class="ayar-bolum">
          <h3 class="bas">Yazıya dökme</h3>
          ${Object.keys(MODELLER).map(kod => `<label class="model"><input type="radio" name="model" value="${kod}"${ayar.model === kod ? ' checked' : ''}>
            <span class="model-ic"><b>${esc(MODELLER[kod].ad)}<em>${MODELLER[kod].boyut}</em></b><small>${esc(MODELLER[kod].aciklama)}</small></span></label>`).join('')}
          <div id="ayarDurum"></div>
          <button type="button" class="metin-dugme tehlike" id="modelSil" data-act="model-sil" hidden>İndirilen modelleri cihazdan sil</button>
        </section>
        <section class="ayar-bolum">
          <h3 class="bas">Kayıtlar</h3>
          <p>${notlar.length ? `${notlar.length} kayıt, ${boyutYaz(toplam)} yer tutuyor.` : 'Henüz kayıt yok.'} Kayıtlar yalnızca bu cihazda durur; uygulama ana ekrandan kaldırılırsa ya da site verileri temizlenirse silinir.</p>
          ${notlar.length ? `<div class="ayar-satir"><button type="button" class="dugme" data-act="disa-aktar">${ikon('paylas')}Metinleri dışa aktar</button></div>` : ''}
        </section>
        <section class="ayar-bolum">
          <h3 class="bas">Gizlilik</h3>
          <p>Ses kaydı ve yazıya dökme bu cihazın içinde yapılır; sesiniz ve metinleriniz internete gönderilmez. İnternet yalnızca uygulamanın kendi dosyaları, yazıya dökme kitaplığı ve model dosyası indirilirken kullanılır; kitaplık jsDelivr, model ise Hugging Face adlı açık depolardan gelir.</p>
          ${ayakta ? '' : '<p>Ana ekrana eklemek için Safari\'de Paylaş düğmesine, ardından "Ana Ekrana Ekle" seçeneğine dokunun.</p>'}
          <p class="surum">Sesli Not ${SURUM}</p>
        </section>
      </div>
      <footer class="pencere-alt"><span class="bosluk"></span><button type="button" class="dugme dugme-ana" data-act="kapat">Tamam</button></footer>`);
    ayarDurumCiz();
  }

  async function modelSil() {
    const c = await sor({ baslik: 'Modeller silinsin mi?', metin: 'İndirilen model dosyaları cihazdan silinir. Kayıtlarınız ve metinleriniz etkilenmez; yazıya dökme için model yeniden indirilir.', dugme: 'Sil', tehlike: true });
    if (c !== 'tamam' || suren) return;
    if (isci) { try { isci.terminate(); } catch (e) { /* önemli değil */ } isci = null; }
    indirme = null;
    indirmeOnayi = false;
    try { await caches.delete(DEPO_ADI); } catch (e) { /* depo yoksa silinecek bir şey de yoktur */ }
    await modelDurumYenile();
    ciz();
    ayarDurumCiz();
    bildir('Model dosyaları silindi.');
  }

  function disaAktar() {
    const satirlar = [...notlar].reverse().map(n => {
      const d = new Date(n.tarih);
      return `${uzunTarih(n.tarih)} ${saat(d)} (${sureYaz(n.sure)})\n${(n.metin || '').trim() || '[metin yok]'}`;
    });
    const d = new Date();
    const ad = `sesli-notlar-${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}.txt`;
    dosyaVer(new File(['﻿' + satirlar.join('\n\n') + '\n'], ad, { type: 'text/plain' }));
  }

  /* ---------- Olaylar ---------- */

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'kayit') kayitBasla();
    else if (act === 'kayit-bitir') kayitBitir();
    else if (act === 'kayit-iptal') kayitIptal();
    else if (act === 'kayit-duraklat') kayitDuraklat();
    else if (act === 'ac') notAc(b.dataset.id);
    else if (act === 'kapat') pencereKapat();
    else if (act === 'ayarlar') ayarlarAc();
    else if (act === 'model-indir') modelIndir();
    else if (act === 'model-sil') modelSil();
    else if (act === 'disa-aktar') disaAktar();
    else if (act === 'serit-kapat') { serit = null; seritCiz(); }
    else if (act === 'bekleyenleri-yaz') {
      serit = null;
      seritCiz();
      bekleyenler().forEach(id => { if (!kuyruk.includes(id)) kuyruk.push(id); });
      ciz();
      kuyrukIslet();
    } else if (acik) {
      const n = notBul(acik.id);
      if (!n) return;
      if (act === 'cal') {
        const a = acik.ses;
        if (!a) return;
        if (a.paused || a.ended) { if (a.ended) a.currentTime = 0; a.play().catch(() => bildir('Ses çalınamadı.')); } else a.pause();
      } else if (act === 'kopyala') kopyala(acikMetin());
      else if (act === 'paylas') {
        const metin = acikMetin();
        if (!metin) { bildir('Paylaşılacak metin yok.'); return; }
        if (navigator.share) { try { await navigator.share({ text: metin }); } catch (h) { /* kullanıcı vazgeçti */ } }
        else kopyala(metin);
      } else if (act === 'ses-paylas') {
        if (acik.wav) dosyaVer(new File([acik.wav], dosyaAdi(n, 'wav'), { type: 'audio/wav' }));
      } else if (act === 'yeniden') {
        if (n.durum === 'tamam' && (n.metin || '').trim()) {
          const c = await sor({ baslik: 'Yeniden yazıya dökülsün mü?', metin: n.duzenlendi ? 'Metinde yaptığınız düzeltmeler silinir ve kayıt baştan yazıya dökülür.' : 'Mevcut metin silinir ve kayıt baştan yazıya dökülür.', dugme: 'Yeniden dök' });
          if (c !== 'tamam' || !acik) return;
        }
        clearTimeout(acik.sayac);
        const alan = $('#notMetin');
        if (alan) { alan.readOnly = true; alan.value = ''; }
        n.metin = '';
        n.durum = 'bekliyor';
        delete n.hata;
        delete n.duzenlendi;
        await notYaz(n).catch(() => {});
        yazimIste(n.id);
        pencereDurumu();
      } else if (act === 'sil') notSil(n.id);
    }
  });

  pencere.addEventListener('change', e => {
    const r = e.target;
    if (r.name !== 'model' || !MODELLER[r.value]) return;
    ayar.model = r.value;
    ayarYaz();
    ayarDurumCiz();
    ciz();
  });

  $('#ara').addEventListener('input', e => { arama = e.target.value; ciz(); });

  // iPhone arka plandaki sayfanın mikrofonunu keser; elde olan kısım kaybolmasın diye kayıt saklanır.
  function gizlendi() {
    if (kayit && !kayit.bitiyor) kayitBitir('arka-plan');
    if (acik) metinSakla(acik.id);
    if (suren) depoYaz('sn-suren', { id: suren.id, model: suren.model, gizli: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) gizlendi();
    else if (suren) { depoYaz('sn-suren', { id: suren.id, model: suren.model, gizli: false }); isKilidiAl(); }
  });
  window.addEventListener('pagehide', gizlendi);

  /* ---------- Başlangıç ---------- */

  async function basla() {
    if (!window.indexedDB) {
      bos.className = 'bos';
      bos.innerHTML = '<strong>Depo kullanılamıyor</strong><p>Tarayıcı bu sayfaya kayıt saklama izni vermiyor. Gizli sekmede açtıysanız normal sekmede deneyin.</p>';
      bos.hidden = false;
      kayitDugme.disabled = true;
      return;
    }
    try {
      db = await dbAc();
      notlar = (await tumNotlar() || []).sort((a, b) => b.tarih - a.tarih);
    } catch (e) {
      bos.className = 'bos';
      bos.innerHTML = '<strong>Kayıtlar açılamadı</strong><p>Tarayıcının deposuna ulaşılamadı. Sayfayı yeniden açmayı deneyin.</p>';
      bos.hidden = false;
      kayitDugme.disabled = true;
      return;
    }
    await modelDurumYenile();

    // Önceki açılışta yarım kalan iş. Uygulama ekrandayken kapandıysa bellek yetmemiş
    // olabilir; büyük modelde bu olduysa küçük modele geçilir.
    const yarim = depoOku('sn-suren');
    depoSil('sn-suren');
    const cokme = yarim && !yarim.gizli;
    for (const n of notlar) {
      if (n.durum !== 'yaziliyor') continue;
      if (cokme && yarim.id === n.id) { n.durum = 'hata'; n.hata = 'kesildi'; }
      else n.durum = 'bekliyor';
      await notYaz(n).catch(() => {});
    }
    if (cokme) {
      if (yarim.model === 'dogru' && ayar.model === 'dogru') {
        ayar.model = 'hizli';
        ayarYaz();
        serit = { uyari: true, metin: 'Yazıya dökme sırasında uygulama kapandı. Cihazın belleğini zorlamamak için "Hızlı" modele geçildi; Ayarlar bölümünden yeniden değiştirebilirsiniz.', islemler: [{ yazi: 'Kapat', act: 'serit-kapat' }] };
      } else {
        serit = { uyari: true, metin: 'Yazıya dökme yarıda kesildi. İlgili kaydı açıp yeniden deneyebilirsiniz.', islemler: [{ yazi: 'Kapat', act: 'serit-kapat' }] };
      }
    }
    ciz();
    // Model cihazdaysa bekleyen kayıtlar kendiliğinden işlenir; değilse kullanıcı başlatır.
    if (cihazda[ayar.model]) {
      kuyruk = bekleyenler().filter(id => { const n = notBul(id); return n && n.durum === 'bekliyor'; });
      if (kuyruk.length) { ciz(); kuyrukIslet(); }
    }
  }

  basla();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
