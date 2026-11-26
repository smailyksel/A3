/* Park Yeri: aracın bırakıldığı yeri saklar; dönüşte uzaklığı ve yönü gösterir.
   Konum, fotoğraf ve not yalnızca bu cihazda, tarayıcının deposunda durur.
   Konum yalnızca "Yol tarifi al" ya da "Paylaş" seçildiğinde cihazdan çıkar. */

(() => {
  'use strict';

  const SURUM = '1.0';
  const YETERLI_HASSASIYET = 10;   // metre; bu kadar net konum gelince beklemeden kaydedilir
  const EN_UZUN_BEKLEME = 8000;    // ms; konum geldiyse en çok bu kadar netleşmesi beklenir
  const VAZGECME_SURESI = 20000;   // ms; hiç konum gelmezse

  const $ = (s, k) => (k || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ikon = ad => `<svg class="ikon" aria-hidden="true"><use href="#i-${ad}"/></svg>`;

  /* ---------- Depo (IndexedDB) ---------- */

  let db = null;

  function dbAc() {
    return new Promise((coz, red) => {
      const i = indexedDB.open('park-yeri', 1);
      i.onupgradeneeded = () => {
        if (!i.result.objectStoreNames.contains('kayit')) i.result.createObjectStore('kayit');
      };
      i.onsuccess = () => coz(i.result);
      i.onerror = () => red(i.error);
    });
  }
  function islem(kip, is) {
    return new Promise((coz, red) => {
      const t = db.transaction('kayit', kip);
      let sonuc;
      t.oncomplete = () => coz(sonuc);
      t.onerror = t.onabort = () => red(t.error || new Error('Depo işlemi yarıda kaldı'));
      const r = is(t.objectStore('kayit'));
      if (r) r.onsuccess = () => { sonuc = r.result; };
    });
  }
  const kayitOku = () => islem('readonly', d => d.get('simdi'));
  const kayitYaz = () => islem('readwrite', d => { d.put(kayit, 'simdi'); });
  const kayitSil = () => islem('readwrite', d => { d.delete('simdi'); });

  /* ---------- Durum ---------- */

  let kayit = null;        // { lat, lon, dogruluk, zaman, not, foto, fotoTur }; konum alınamadıysa lat ve lon null
  let durum = 'bos';       // 'bos' | 'araniyor' | 'bulunamadi' | 'kayitli'
  let arama = null;        // { izle, sayac, basla, enIyi, ekle }
  let aramaHata = '';      // 'izin' | 'bulunamadi' | 'desteksiz'
  let simdi = null;        // son bilinen konum { lat, lon, dogruluk }
  let izleyici = null;
  let konumIzniYok = false;
  let pusula = null;       // cihazın baktığı yön (derece); pusula kapalıysa null
  let pusulaDinleniyor = false;
  let okAci = 0, halkaAci = 0;
  let fotoUrl = '';
  let notSayac = 0;

  const konumVar = () => !!kayit && typeof kayit.lat === 'number' && typeof kayit.lon === 'number';

  /* ---------- Hesap ve biçim ---------- */

  const RAD = Math.PI / 180;

  function uzaklikHesapla(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  // a noktasından b noktasına bakış yönü; 0 kuzey, 90 doğu.
  function yonHesapla(a, b) {
    const dLon = (b.lon - a.lon) * RAD;
    const y = Math.sin(dLon) * Math.cos(b.lat * RAD);
    const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const YONLER = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
  const yonAdi = derece => YONLER[Math.round(derece / 45) % 8];

  function uzaklikYaz(m) {
    if (m < 100) return Math.round(m) + ' m';
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
  }
  const iki = s => String(s).padStart(2, '0');
  const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  function saatYaz(ms) {
    const d = new Date(ms), bugun = new Date();
    const gun = t => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const fark = Math.round((gun(bugun) - gun(d)) / 864e5);
    const s = iki(d.getHours()) + ':' + iki(d.getMinutes());
    if (fark === 0) return { gun: 'Bugün', saat: s };
    if (fark === 1) return { gun: 'Dün', saat: s };
    return { gun: d.getDate() + ' ' + AYLAR[d.getMonth()], saat: s };
  }
  function gecenYaz(ms) {
    const dk = Math.floor(Math.max(0, ms) / 60000);
    if (dk < 1) return 'az önce';
    if (dk < 60) return dk + ' dk';
    const sa = Math.floor(dk / 60);
    if (sa < 24) return sa + ' sa ' + (dk % 60) + ' dk';
    return Math.floor(sa / 24) + ' gün ' + (sa % 24) + ' sa';
  }

  const appleCihaz = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  function haritaBaglantisi(tarif) {
    const k = kayit.lat.toFixed(6) + ',' + kayit.lon.toFixed(6);
    if (appleCihaz) return tarif ? `https://maps.apple.com/?daddr=${k}&dirflg=w` : `https://maps.apple.com/?ll=${k}&q=${encodeURIComponent('Park yeri')}`;
    return tarif ? `https://www.google.com/maps/dir/?api=1&destination=${k}&travelmode=walking` : `https://www.google.com/maps/search/?api=1&query=${k}`;
  }

  /* ---------- Bildirim ve pencereler ---------- */

  const bildirimKutu = $('#bildirim');
  let bildirimSayac = 0;
  function bildir(metin) {
    clearTimeout(bildirimSayac);
    bildirimKutu.textContent = metin;
    bildirimKutu.hidden = false;
    bildirimSayac = setTimeout(() => { bildirimKutu.hidden = true; }, 4500);
  }

  const pencere = $('#pencere'), onay = $('#onay');
  function modalAc(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function modalKapat(d) {
    if (!d.open) return;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }
  function pencereAc(html) { pencere.innerHTML = html; modalAc(pencere); pencere.scrollTop = 0; }
  function pencereKapat() { modalKapat(pencere); pencere.innerHTML = ''; }
  pencere.addEventListener('cancel', e => { e.preventDefault(); pencereKapat(); });
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
          <button type="button" class="dugme dugme-sade" data-sonuc="vazgec">Vazgeç</button>
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

  /* ---------- Çizim ---------- */

  const govde = $('#govde'), eylemCubugu = $('#eylemCubugu');

  function pusulaSvg() {
    let cizikler = '';
    for (let a = 0; a < 360; a += 15) {
      const ana = a % 90 === 0;
      if (ana) continue; // ana yönlerde harf durur
      const orta = a % 45 === 0;
      cizikler += `<line class="cizik${orta ? ' ana' : ''}" x1="100" y1="${orta ? 11 : 13}" x2="100" y2="${orta ? 21 : 18}" transform="rotate(${a} 100 100)"/>`;
    }
    // Harfler: Kuzey, Doğu, Güney, Batı.
    return `<svg viewBox="0 0 200 200" role="img" aria-label="Yön göstergesi">
      <circle class="cember" cx="100" cy="100" r="96"/>
      <circle class="ic-cember" cx="100" cy="100" r="68"/>
      <g class="halka" id="halka">${cizikler}
        <text class="kuzey" x="100" y="16">K</text><text x="184" y="100">D</text><text x="100" y="184">G</text><text x="16" y="100">B</text>
      </g>
      <g class="ok" id="ok"><path class="golge" d="M100 40 100 108 78 124z"/><path d="M100 40 122 124 100 108z"/></g>
      <circle class="gobek" cx="100" cy="100" r="6"/>
    </svg>`;
  }

  function bosCiz() {
    if (durum === 'araniyor') {
      const h = arama && arama.enIyi ? `Konum netleşiyor: yaklaşık ±${Math.round(arama.enIyi.dogruluk)} m` : 'Konum alınıyor';
      govde.innerHTML = `<div class="bos">
        <div class="bos-simge">${ikon('igne')}</div><strong>Park yeri kaydediliyor</strong>
        <p>Açık havada birkaç saniye sürer. Kapalı otoparkta konum alınamayabilir.</p>
        <div class="cubuk-satir"><span class="cubuk belirsiz"><i></i></span><span id="aramaYazi">${esc(h)}</span></div>
        <div class="bos-islem">
          <button type="button" class="dugme dugme-sade" data-act="arama-iptal">Vazgeç</button>
          <button type="button" class="dugme" data-act="arama-yeter" id="yeterDugme"${arama && arama.enIyi ? '' : ' hidden'}>Bu kadarı yeterli</button>
        </div></div>`;
      return;
    }
    if (durum === 'bulunamadi') {
      const neden = aramaHata === 'izin'
        ? 'Konum izni verilmedi. İzni telefonun Ayarlar bölümünden açabilirsiniz.'
        : aramaHata === 'desteksiz' ? 'Bu tarayıcı konum bilgisini desteklemiyor.'
        : 'Konum alınamadı. Kapalı otoparkta ya da bodrum katta uydu sinyali ulaşmayabilir.';
      govde.innerHTML = `<div class="bos">
        <div class="bos-simge">${ikon('igne')}</div><strong>Konum alınamadı</strong>
        <p>${esc(neden)}</p><p>Yeri konumsuz da kaydedebilir, fotoğraf ve notla hatırlayabilirsiniz.</p>
        <div class="bos-islem">
          <button type="button" class="dugme dugme-sade" data-act="arama-iptal">Vazgeç</button>
          ${aramaHata === 'desteksiz' ? '' : '<button type="button" class="dugme" data-act="kaydet">Yeniden dene</button>'}
          <button type="button" class="dugme dugme-ana" data-act="konumsuz">Konumsuz kaydet</button>
        </div></div>`;
      return;
    }
    govde.innerHTML = `<div class="bos">
      <div class="bos-simge">${ikon('igne')}</div><strong>Aracınızı nereye bıraktınız?</strong>
      <p>Park ettiğinizde alttaki düğmeye dokunun. Konum, isterseniz bir fotoğraf ve kısa bir notla birlikte bu cihazda saklanır.</p>
      <p>Dönerken uygulama araca olan uzaklığı ve yönü gösterir.</p></div>`;
  }

  function kayitliCiz() {
    const z = saatYaz(kayit.zaman);
    const yonBolumu = konumVar()
      ? `<section class="yon kart">
          <div class="pusula yok" id="pusula">${pusulaSvg()}</div>
          <p class="uzaklik" id="uzaklik">&nbsp;</p>
          <p class="yon-yazi" id="yonYazi"></p>
          <button type="button" class="metin-dugme" data-act="pusula" id="pusulaDugme" hidden>${ikon('pusula')}Pusulayı aç</button>
          <p class="kucuk" id="pusulaNot" hidden></p>
        </section>`
      : `<section class="konumsuz kart"><p><strong>Konum kaydedilmedi.</strong> Aracın yanındaysanız ve açık havadaysanız konumu şimdi ekleyebilirsiniz.</p>
          <button type="button" class="dugme" data-act="konum-ekle">${ikon('igne')}Konumu ekle</button></section>`;

    govde.innerHTML = `<div class="park">
      ${yonBolumu}
      <dl class="bilgi kart">
        <div><dt>Park saati</dt><dd>${esc(z.saat)}</dd></div>
        <div><dt>Geçen süre</dt><dd id="gecen">${esc(gecenYaz(Date.now() - kayit.zaman))}</dd></div>
        <div><dt>Hassasiyet</dt><dd>${konumVar() ? '±' + Math.max(1, Math.round(kayit.dogruluk)) + ' m' : '—'}</dd></div>
      </dl>
      ${konumVar() ? `<div class="islemler">
        <a class="dugme dugme-ana" id="tarif" href="${esc(haritaBaglantisi(true))}" target="_blank" rel="noopener">${ikon('yol')}Yol tarifi al</a>
        <button type="button" class="dugme" data-act="paylas" aria-label="Konumu paylaş">${ikon('paylas')}</button>
      </div>` : ''}
      <section class="foto" id="foto"></section>
      <label class="alan"><span>Not</span>
        <input type="text" id="not" maxlength="200" autocomplete="off" placeholder="Kat, sıra, blok, cadde adı" value="${esc(kayit.not || '')}">
      </label>
      <div class="alt-islem"><button type="button" class="metin-dugme tehlike" data-act="temizle">Aracı aldım, kaydı sil</button></div>
    </div>`;
    fotoCiz();
    yonCiz();
    $('#not').addEventListener('input', e => {
      kayit.not = e.target.value;
      clearTimeout(notSayac);
      notSayac = setTimeout(() => { kayitYaz().catch(() => bildir('Not saklanamadı.')); }, 500);
    });
  }

  function fotoCiz() {
    const kutu = $('#foto');
    if (!kutu || !kayit) return;
    if (fotoUrl) { URL.revokeObjectURL(fotoUrl); fotoUrl = ''; }
    if (kayit.foto) {
      fotoUrl = URL.createObjectURL(new Blob([kayit.foto], { type: kayit.fotoTur || 'image/jpeg' }));
      kutu.className = 'foto kart';
      kutu.innerHTML = `<button type="button" class="foto-resim" data-act="foto-ac" aria-label="Fotoğrafı büyüt"><img src="${fotoUrl}" alt="Park yerinin fotoğrafı"></button>`;
    } else {
      kutu.className = 'foto';
      kutu.innerHTML = `<button type="button" class="foto-ekle" data-act="foto-cek">${ikon('kamera')}Fotoğraf ekle</button>`;
    }
  }

  // Kısa yoldan dönsün diye açı, önceki açıya en yakın eşdeğerine taşınır (350° -> 10° geçişinde geri sarmaz).
  const yakinAci = (hedef, onceki) => onceki + ((((hedef - onceki) % 360) + 540) % 360 - 180);

  function yonCiz() {
    const kutu = $('#pusula');
    if (!kutu || !konumVar()) return;
    const u = $('#uzaklik'), y = $('#yonYazi'), pd = $('#pusulaDugme');
    const bas = pusula === null ? 0 : pusula;
    halkaAci = yakinAci(-bas, halkaAci);
    $('#halka').style.transform = `rotate(${halkaAci.toFixed(1)}deg)`;

    const pn = $('#pusulaNot');
    pd.hidden = pn.hidden = true;

    if (!simdi) {
      kutu.className = 'pusula yok';
      u.className = 'uzaklik yazi';
      u.textContent = konumIzniYok ? 'Konum izni yok' : 'Konumunuz alınıyor';
      y.textContent = konumIzniYok ? 'Uzaklık gösterilemiyor; yol tarifi yine de çalışır.' : 'Açık havada birkaç saniye sürer.';
      return;
    }
    const m = uzaklikHesapla(simdi, kayit);
    const yakin = m <= Math.max(12, simdi.dogruluk || 0);
    if (yakin) {
      kutu.className = 'pusula yakin';
      u.className = 'uzaklik yazi';
      u.textContent = 'Aracın yanındasınız';
      y.textContent = m < 3 ? 'Kaydedilen noktadasınız.' : `Kaydedilen nokta yaklaşık ${Math.max(1, Math.round(m))} m ötede.`;
      return;
    }
    const yon = yonHesapla(simdi, kayit);
    okAci = yakinAci(yon - bas, okAci);
    $('#ok').style.transform = `rotate(${okAci.toFixed(1)}deg)`;
    kutu.className = 'pusula';
    u.className = 'uzaklik';
    u.textContent = uzaklikYaz(m);
    y.textContent = `${yonAdi(yon)} yönünde`;
    // Pusula düğmesi: yön algılayıcısı olan cihazlarda, pusula açılana kadar görünür.
    pd.hidden = pusula !== null || !window.DeviceOrientationEvent || !('ontouchstart' in window);
    pn.hidden = false;
    pn.textContent = pusula === null
      ? 'Pusula kapalıyken göstergenin üstü kuzeydir.'
      : 'Ok aracın bulunduğu yönü gösterir. Telefonu yere paralel tutun.';
  }

  function ciz() {
    document.documentElement.dataset.durum = durum === 'kayitli' ? 'kayitli' : 'bos';
    eylemCubugu.hidden = durum !== 'bos';
    if (durum === 'kayitli' && kayit) {
      const z = saatYaz(kayit.zaman);
      $('#ustEtiket').textContent = `Park edildi · ${z.gun} ${z.saat}`;
      kayitliCiz();
    } else {
      $('#ustEtiket').textContent = '';
      if (fotoUrl) { URL.revokeObjectURL(fotoUrl); fotoUrl = ''; }
      bosCiz();
    }
  }

  /* ---------- Konum alma ---------- */

  function aramaTemizle() {
    if (!arama) return;
    try { navigator.geolocation.clearWatch(arama.izle); } catch (e) { /* zaten durmuş */ }
    clearInterval(arama.sayac);
    arama = null;
  }

  // ekle: var olan kayda konum eklenir; yoksa yeni kayıt açılır.
  function aramaBaslat(ekle) {
    if (arama) return;
    if (!navigator.geolocation) {
      if (ekle) { bildir('Bu tarayıcı konum bilgisini desteklemiyor.'); return; }
      aramaHata = 'desteksiz'; durum = 'bulunamadi'; ciz();
      return;
    }
    arama = { izle: 0, sayac: 0, basla: Date.now(), enIyi: null, ekle: !!ekle };
    aramaHata = '';
    if (!ekle) { durum = 'araniyor'; ciz(); } else bildir('Konum alınıyor.');

    arama.izle = navigator.geolocation.watchPosition(p => {
      if (!arama) return;
      const k = { lat: p.coords.latitude, lon: p.coords.longitude, dogruluk: p.coords.accuracy || 0 };
      if (!arama.enIyi || k.dogruluk <= arama.enIyi.dogruluk) arama.enIyi = k;
      if (arama.enIyi.dogruluk <= YETERLI_HASSASIYET) { aramaBitir(); return; }
      const yazi = $('#aramaYazi'), yeter = $('#yeterDugme');
      if (yazi) yazi.textContent = `Konum netleşiyor: yaklaşık ±${Math.round(arama.enIyi.dogruluk)} m`;
      if (yeter) yeter.hidden = false;
    }, e => {
      if (!arama) return;
      // İzin reddi kesindir; öteki hatalarda süre dolana kadar beklenir.
      if (e && e.code === 1) aramaBasarisiz('izin');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: VAZGECME_SURESI });

    arama.sayac = setInterval(() => {
      if (!arama) return;
      const gecen = Date.now() - arama.basla;
      if (arama.enIyi && gecen >= EN_UZUN_BEKLEME) aramaBitir();
      else if (!arama.enIyi && gecen >= VAZGECME_SURESI) aramaBasarisiz('bulunamadi');
    }, 400);
  }

  function aramaBasarisiz(neden) {
    const ekle = arama && arama.ekle;
    aramaTemizle();
    if (neden === 'izin') konumIzniYok = true;
    if (ekle) {
      bildir(neden === 'izin' ? 'Konum izni verilmedi.' : 'Konum alınamadı.');
      return;
    }
    aramaHata = neden;
    durum = 'bulunamadi';
    ciz();
  }

  async function aramaBitir() {
    if (!arama || !arama.enIyi) return;
    const k = arama.enIyi, ekle = arama.ekle;
    aramaTemizle();
    if (ekle && kayit) {
      kayit.lat = k.lat; kayit.lon = k.lon; kayit.dogruluk = k.dogruluk;
    } else {
      kayit = { lat: k.lat, lon: k.lon, dogruluk: k.dogruluk, zaman: Date.now(), not: '', foto: null, fotoTur: '' };
    }
    simdi = { lat: k.lat, lon: k.lon, dogruluk: k.dogruluk };
    konumIzniYok = false;
    await kaydetVeGoster(ekle ? 'Konum eklendi.' : 'Park yeri kaydedildi.');
  }

  async function kaydetVeGoster(mesaj) {
    try {
      await kayitYaz();
    } catch (e) {
      bildir('Kayıt saklanamadı.');
      kayit = null; durum = 'bos'; ciz();
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    durum = 'kayitli';
    ciz();
    window.scrollTo(0, 0);
    izlemeBaslat();
    bildir(mesaj);
  }

  /* ---------- Dönüşte canlı uzaklık ve yön ---------- */

  function izlemeBaslat() {
    if (izleyici !== null || !navigator.geolocation || !konumVar() || document.hidden) return;
    izleyici = navigator.geolocation.watchPosition(p => {
      simdi = { lat: p.coords.latitude, lon: p.coords.longitude, dogruluk: p.coords.accuracy || 0 };
      konumIzniYok = false;
      yonCiz();
    }, e => {
      if (e && e.code === 1) { konumIzniYok = true; yonCiz(); }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function izlemeDurdur() {
    if (izleyici === null) return;
    try { navigator.geolocation.clearWatch(izleyici); } catch (e) { /* zaten durmuş */ }
    izleyici = null;
  }

  function yonOlayi(e) {
    let b = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) b = e.webkitCompassHeading; // iPhone
    else if (e.absolute === true && typeof e.alpha === 'number') b = 360 - e.alpha;
    if (b === null) return;
    const ekranAci = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    pusula = (b + ekranAci + 360) % 360;
    yonCiz();
  }
  function pusulaDinle() {
    if (pusulaDinleniyor) return;
    pusulaDinleniyor = true;
    window.addEventListener('deviceorientationabsolute', yonOlayi, true);
    window.addEventListener('deviceorientation', yonOlayi, true);
  }
  // iPhone pusula için her açılışta bir dokunuşla izin ister.
  async function pusulaAc() {
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    if (typeof D.requestPermission === 'function') {
      let sonuc = '';
      try { sonuc = await D.requestPermission(); } catch (e) { /* aşağıda bildirilir */ }
      if (sonuc !== 'granted') { bildir('Pusula izni verilmedi.'); return; }
    }
    pusulaDinle();
    setTimeout(() => { if (pusula === null) bildir('Bu cihazda pusula bilgisi alınamadı.'); }, 2500);
  }

  /* ---------- Fotoğraf ---------- */

  const fotoSec = $('#fotoSec');

  function resimYukle(url) {
    return new Promise((coz, red) => {
      const r = new Image();
      r.onload = () => coz(r);
      r.onerror = () => red(new Error('Resim okunamadı'));
      r.src = url;
    });
  }
  // Fotoğraf en çok 1600 piksele küçültülür; depoda az yer tutar.
  async function fotoKucult(dosya) {
    const url = URL.createObjectURL(dosya);
    try {
      const r = await resimYukle(url);
      const oran = Math.min(1, 1600 / Math.max(r.naturalWidth, r.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(r.naturalWidth * oran));
      c.height = Math.max(1, Math.round(r.naturalHeight * oran));
      c.getContext('2d').drawImage(r, 0, 0, c.width, c.height);
      const blob = await new Promise(coz => c.toBlob(coz, 'image/jpeg', 0.82));
      if (!blob) throw new Error('Resim dönüştürülemedi');
      return await blob.arrayBuffer();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  fotoSec.addEventListener('change', async () => {
    const dosya = fotoSec.files && fotoSec.files[0];
    fotoSec.value = '';
    if (!dosya || !kayit) return;
    try {
      kayit.foto = await fotoKucult(dosya);
      kayit.fotoTur = 'image/jpeg';
      await kayitYaz();
    } catch (e) {
      bildir('Fotoğraf eklenemedi.');
      return;
    }
    if (pencere.open) pencereKapat();
    fotoCiz();
  });

  function fotoAc() {
    if (!kayit || !kayit.foto || !fotoUrl) return;
    pencereAc(`
      <header class="pencere-bas"><h2>Fotoğraf</h2>
        <button type="button" class="simge-dugme" data-act="kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="buyuk-foto"><img src="${fotoUrl}" alt="Park yerinin fotoğrafı"></div>
      <footer class="pencere-alt">
        <button type="button" class="dugme" data-act="foto-cek">${ikon('kamera')}Yeniden çek</button>
        <button type="button" class="dugme dugme-tehlike" data-act="foto-sil">Sil</button>
        <span class="bosluk"></span>
        <button type="button" class="dugme dugme-sade" data-act="kapat">Kapat</button>
      </footer>`);
  }

  /* ---------- Öteki işlemler ---------- */

  async function paylas() {
    if (!konumVar()) return;
    const url = haritaBaglantisi(false);
    const metin = 'Aracın park yeri' + (kayit.not ? ' (' + kayit.not + ')' : '');
    if (navigator.share) {
      try { await navigator.share({ title: 'Park yeri', text: metin, url }); } catch (e) { /* kullanıcı vazgeçti */ }
      return;
    }
    try { await navigator.clipboard.writeText(metin + ': ' + url); bildir('Konum bağlantısı kopyalandı.'); }
    catch (e) { bildir('Bağlantı kopyalanamadı.'); }
  }

  async function temizle() {
    const c = await sor({ baslik: 'Kayıt silinsin mi?', metin: 'Park yeri, fotoğraf ve not bu cihazdan silinir.', dugme: 'Sil', tehlike: true });
    if (c !== 'tamam') return;
    clearTimeout(notSayac);
    izlemeDurdur();
    try { await kayitSil(); } catch (e) { bildir('Kayıt silinemedi.'); return; }
    kayit = null;
    durum = 'bos';
    ciz();
    window.scrollTo(0, 0);
  }

  function bilgiAc() {
    const ayakta = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    pencereAc(`
      <header class="pencere-bas"><h2>Park Yeri</h2>
        <button type="button" class="simge-dugme" data-act="kapat" aria-label="Kapat">${ikon('kapat')}</button></header>
      <div class="pencere-ic">
        <p>Park ettiğinizde düğmeye dokunun; konum birkaç saniyede kaydedilir. Dönerken uygulamayı açtığınızda araca olan uzaklık ve yön gösterilir, "Yol tarifi al" ise Haritalar uygulamasında yürüme tarifini açar.</p>
        <p>Kapalı otoparkta uydu sinyali ulaşmadığı için konum alınamayabilir. Bu durumda kat ve sıra bilgisini nota yazmak ya da bir fotoğraf eklemek işinizi görür.</p>
        <p>Konum, fotoğraf ve not yalnızca bu cihazda durur. Konum yalnızca yol tarifi aldığınızda ya da paylaştığınızda cihazdan çıkar. Uygulama ana ekrandan kaldırılırsa ya da site verileri temizlenirse kayıt silinir.</p>
        ${ayakta ? '' : '<p>Ana ekrana eklemek için Safari\'de Paylaş düğmesine, ardından "Ana Ekrana Ekle" seçeneğine dokunun.</p>'}
        <p class="kucuk">Park Yeri ${SURUM}</p>
      </div>
      <footer class="pencere-alt"><span class="bosluk"></span><button type="button" class="dugme dugme-ana" data-act="kapat">Tamam</button></footer>`);
  }

  /* ---------- Olaylar ---------- */

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'kaydet') aramaBaslat(false);
    else if (act === 'arama-iptal') { aramaTemizle(); durum = 'bos'; ciz(); }
    else if (act === 'arama-yeter') aramaBitir();
    else if (act === 'konumsuz') {
      aramaTemizle();
      kayit = { lat: null, lon: null, dogruluk: 0, zaman: Date.now(), not: '', foto: null, fotoTur: '' };
      await kaydetVeGoster('Kaydedildi. Bir fotoğraf ya da not ekleyin.');
    }
    else if (act === 'konum-ekle') aramaBaslat(true);
    else if (act === 'pusula') pusulaAc();
    else if (act === 'paylas') paylas();
    else if (act === 'temizle') temizle();
    else if (act === 'bilgi') bilgiAc();
    else if (act === 'kapat') pencereKapat();
    else if (act === 'foto-cek') fotoSec.click();
    else if (act === 'foto-ac') fotoAc();
    else if (act === 'foto-sil') {
      const c = await sor({ baslik: 'Fotoğraf silinsin mi?', dugme: 'Sil', tehlike: true });
      if (c !== 'tamam' || !kayit) return;
      kayit.foto = null;
      kayit.fotoTur = '';
      try { await kayitYaz(); } catch (h) { bildir('Fotoğraf silinemedi.'); return; }
      pencereKapat();
      fotoCiz();
    }
  });

  // Ekran kapalıyken konum izlenmez; pil harcanmasın.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      izlemeDurdur();
      if (kayit && durum === 'kayitli') { clearTimeout(notSayac); kayitYaz().catch(() => {}); }
    } else if (durum === 'kayitli') {
      izlemeBaslat();
      const g = $('#gecen');
      if (g && kayit) g.textContent = gecenYaz(Date.now() - kayit.zaman);
    }
  });

  setInterval(() => {
    const g = $('#gecen');
    if (g && kayit && !document.hidden) g.textContent = gecenYaz(Date.now() - kayit.zaman);
  }, 20000);

  /* ---------- Başlangıç ---------- */

  async function basla() {
    if (!window.indexedDB) {
      govde.innerHTML = '<div class="bos"><strong>Depo kullanılamıyor</strong><p>Tarayıcı bu sayfaya kayıt saklama izni vermiyor. Gizli sekmede açtıysanız normal sekmede deneyin.</p></div>';
      return;
    }
    try {
      db = await dbAc();
      kayit = (await kayitOku()) || null;
    } catch (e) {
      govde.innerHTML = '<div class="bos"><strong>Kayıt açılamadı</strong><p>Tarayıcının deposuna ulaşılamadı. Sayfayı yeniden açmayı deneyin.</p></div>';
      return;
    }
    durum = kayit ? 'kayitli' : 'bos';
    ciz();
    if (kayit) izlemeBaslat();
    // İzin sorusu gerektirmeyen cihazlarda pusula kendiliğinden dinlenir.
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission !== 'function') pusulaDinle();
  }

  basla();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
