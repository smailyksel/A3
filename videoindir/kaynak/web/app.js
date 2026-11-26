// Video İndir arayüzü. Aynı sayfa bilgisayardaki pencerede ve telefonda çalışır;
// sunucu, isteğin bilgisayarın kendisinden gelip gelmediğini "yerel" ile bildirir.
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = {
    bagli: $('#bagli'), bagliYazi: $('#bagliYazi'), kopuk: $('#kopuk'),
    kurulum: $('#kurulum'), kurulumYazi: $('#kurulumYazi'), kurulumCubuk: $('#kurulumCubuk'),
    kurulumAlt: $('#kurulumAlt'), kurulumYeniden: $('#kurulumYeniden'),
    baglanti: $('#baglanti'), yapistir: $('#yapistir'), ileti: $('#ileti'),
    onizleme: $('#onizleme'), onKapak: $('#onKapak'), onSaat: $('#onSaat'), onAd: $('#onAd'), onKanal: $('#onKanal'),
    turSecim: $('#turSecim'), kaliteSecim: $('#kaliteSecim'), kaliteGrubu: $('#kaliteGrubu'), kaliteNotu: $('#kaliteNotu'),
    indir: $('#indir'),
    surenBolum: $('#surenBolum'), suren: $('#suren'), hazirBolum: $('#hazirBolum'),
    gecmisBolum: $('#gecmisBolum'), gecmis: $('#gecmis'),
    anaEkran: $('#anaEkran'), anaEkranTamam: $('#anaEkranTamam'),
    panel: $('#bilgisayarPaneli'), telefonAnahtari: $('#telefonAnahtari'), telefonKur: $('#telefonKur'),
    karekod: $('#karekod'), agYok: $('#agYok'),
    otomatikSatiri: $('#otomatikSatiri'), otomatikAnahtari: $('#otomatikAnahtari'), kapat: $('#kapat'),
    altSerit: $('#altSerit'), klasor: $('#klasor'), klasorAc: $('#klasorAc'),
    sayfa: $('#sayfa'), kapandi: $('#kapandi'),
  };

  const sakla = {
    oku(ad) { try { return localStorage.getItem('vi-' + ad); } catch (e) { return null; } },
    yaz(ad, deger) { try { localStorage.setItem('vi-' + ad, deger); } catch (e) { /* gizli sekme */ } },
  };

  let durum = null;
  let yerel = false;
  let ilkDurum = true;
  let kapatildi = false;
  let hataSayisi = 0;
  let zamanlayici = 0;
  let bilgiSirasi = 0;
  let bilgiZamanlayici = 0;
  let bilgiHatasi = false;
  let canli = false;
  let gonderiliyor = false;
  let karekodAdresi = '';
  let gecmisImzasi = '';
  const buradanBaslayan = new Set();
  const secim = { tur: sakla.oku('tur') === 'ses' ? 'ses' : 'video', kalite: sakla.oku('kalite') || '' };

  async function istek(ad, govde) {
    const secenek = govde === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde) };
    const yanit = await fetch('api/' + ad, secenek);
    let veri = null;
    try { veri = await yanit.json(); } catch (e) { /* gövde yok */ }
    if (!yanit.ok) throw new Error((veri && veri.hata) || 'İstek tamamlanamadı.');
    return veri;
  }

  // ---- biçimlendirme ----
  const ondalik = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function boyut(b) {
    if (!b || b <= 0) return '';
    const mb = b / 1048576;
    if (mb >= 1024) return ondalik.format(mb / 1024) + ' GB';
    if (mb >= 100) return Math.round(mb) + ' MB';
    return ondalik.format(mb) + ' MB';
  }
  function sureYazi(sn) {
    if (!sn || sn <= 0) return '';
    const sa = Math.floor(sn / 3600), dk = Math.floor((sn % 3600) / 60), s = Math.floor(sn % 60);
    if (sa) return sa + ' sa ' + dk + ' dk';
    if (dk) return dk + ' dk ' + s + ' sn';
    return s + ' sn';
  }
  function saat(sn) {
    if (!sn || sn <= 0) return '';
    const sa = Math.floor(sn / 3600), dk = Math.floor((sn % 3600) / 60), s = Math.floor(sn % 60);
    const iki = (n) => String(n).padStart(2, '0');
    return sa ? sa + ':' + iki(dk) + ':' + iki(s) : dk + ':' + iki(s);
  }
  function kalanYazi(sn) {
    if (!sn || sn <= 0) return '';
    if (sn < 60) return sn + ' sn kaldı';
    if (sn < 3600) return Math.ceil(sn / 60) + ' dk kaldı';
    return Math.floor(sn / 3600) + ' sa ' + Math.round((sn % 3600) / 60) + ' dk kaldı';
  }
  function kacis(metin) {
    return String(metin == null ? '' : metin).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Kapak yalnızca https adresinden yüklenir; adres stil içine yazıldığı için ayıklanır.
  function kapakStili(adres) {
    if (!adres || !/^https:\/\/[^\s"'()\\]+$/.test(adres)) return '';
    return ' style="background-image:url(&quot;' + kacis(adres) + '&quot;)"';
  }
  function kaliteYazi(is) {
    if (is.tur === 'ses') return 'MP3';
    const m = (is.dosyaAdi || '').match(/\((\d{3,4})p\)/);
    if (m) return m[1] + 'p';
    return is.kalite === 'eniyi' ? 'En iyi' : is.kalite + 'p';
  }

  // ---- seçimler ----
  function secimCiz() {
    for (const d of el.turSecim.children) d.setAttribute('aria-checked', String(d.dataset.deger === secim.tur));
    for (const d of el.kaliteSecim.children) d.setAttribute('aria-checked', String(d.dataset.deger === secim.kalite));
    el.kaliteGrubu.classList.toggle('pasif', secim.tur === 'ses');
    el.kaliteNotu.hidden = !(secim.tur === 'video' && secim.kalite === 'eniyi');
  }
  el.turSecim.addEventListener('click', (e) => {
    const d = e.target.closest('.hap');
    if (!d) return;
    secim.tur = d.dataset.deger;
    sakla.yaz('tur', secim.tur);
    secimCiz();
  });
  el.kaliteSecim.addEventListener('click', (e) => {
    const d = e.target.closest('.hap');
    if (!d) return;
    secim.kalite = d.dataset.deger;
    sakla.yaz('kalite', secim.kalite);
    secimCiz();
  });

  // ---- bağlantı ve önizleme ----
  function baglantiVar() { return /(https?:\/\/\S+|youtu\S+\/\S+)/i.test(el.baglanti.value.trim()); }

  function iletiGoster(metin, hata) {
    el.ileti.hidden = !metin;
    el.ileti.textContent = metin || '';
    el.ileti.classList.toggle('hata', !!hata);
  }

  function dugmeDurumu() {
    const hazir = durum && durum.kurulum.durum === 'hazir';
    el.indir.disabled = !baglantiVar() || bilgiHatasi || canli || gonderiliyor || !hazir;
  }

  function onizlemeGizle() {
    el.onizleme.hidden = true;
    el.onKapak.style.backgroundImage = '';
  }

  function baglantiDegisti(hemen) {
    clearTimeout(bilgiZamanlayici);
    bilgiSirasi++;
    bilgiHatasi = false;
    canli = false;
    onizlemeGizle();
    iletiGoster('');
    dugmeDurumu();
    if (!baglantiVar()) return;
    bilgiZamanlayici = setTimeout(bilgiGetir, hemen ? 0 : 500);
  }

  async function bilgiGetir() {
    if (!durum || durum.kurulum.durum !== 'hazir') return;
    const sira = ++bilgiSirasi;
    iletiGoster('Video bilgisi alınıyor…');
    try {
      const b = await istek('bilgi', { adres: el.baglanti.value.trim() });
      if (sira !== bilgiSirasi) return;
      iletiGoster('');
      el.onAd.textContent = b.baslik || 'YouTube videosu';
      el.onKanal.textContent = [b.kanal, sureYazi(b.sure)].filter(Boolean).join(' · ');
      el.onSaat.textContent = saat(b.sure);
      el.onKapak.style.backgroundImage = b.kapak && /^https:\/\//.test(b.kapak) ? 'url("' + encodeURI(b.kapak) + '")' : '';
      el.onizleme.hidden = false;
      canli = !!b.canli;
      if (canli) iletiGoster('Canlı yayın sürerken indirilemez; yayın bitince yeniden deneyin.', true);
    } catch (e) {
      if (sira !== bilgiSirasi) return;
      bilgiHatasi = true;
      iletiGoster(e.message, true);
    }
    dugmeDurumu();
  }

  el.baglanti.addEventListener('input', () => baglantiDegisti(false));
  el.baglanti.addEventListener('paste', () => setTimeout(() => baglantiDegisti(true), 0));
  el.baglanti.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !el.indir.disabled) el.indir.click();
  });

  el.yapistir.addEventListener('click', async () => {
    try {
      const metin = await navigator.clipboard.readText();
      if (metin) {
        el.baglanti.value = metin.trim();
        baglantiDegisti(true);
      }
    } catch (e) {
      el.baglanti.focus();
      iletiGoster('Pano okunamadı; bağlantıyı Ctrl+V ile yapıştırın.');
    }
  });

  el.indir.addEventListener('click', async () => {
    if (el.indir.disabled) return;
    gonderiliyor = true;
    dugmeDurumu();
    try {
      const y = await istek('indir', { adres: el.baglanti.value.trim(), tur: secim.tur, kalite: secim.kalite });
      buradanBaslayan.add(y.id);
      el.baglanti.value = '';
      clearTimeout(bilgiZamanlayici);
      bilgiSirasi++;
      onizlemeGizle();
      iletiGoster('');
      yenile();
    } catch (e) {
      iletiGoster(e.message, true);
    }
    gonderiliyor = false;
    dugmeDurumu();
  });

  // ---- süren işler ve geçmiş ----
  function surenCiz(isler) {
    const suren = isler.filter((i) => i.durum !== 'bitti');
    el.surenBolum.hidden = suren.length === 0;
    el.suren.innerHTML = suren.map((is) => {
      const alt = [kaliteYazi(is), is.kanal].filter(Boolean).join(' · ');
      let govde = '';
      if (is.durum === 'hata') {
        govde = '<p class="hata-yazi">' + kacis(is.hata) + '</p>' +
          (is.ayrinti ? '<p class="ayrinti">' + kacis(is.ayrinti) + '</p>' : '');
      } else if (is.durum === 'indiriliyor' && is.toplam > 0) {
        const yuzde = Math.min(99, Math.floor((is.inen / is.toplam) * 100));
        const sag = ['<b>%' + yuzde + '</b>', kalanYazi(is.kalan)].filter(Boolean).join(' · ');
        govde = '<div class="satir"><span>İndiriliyor · <b>' + boyut(is.inen) + '</b> / ' + boyut(is.toplam) + '</span><span>' + sag + '</span></div>' +
          '<div class="cubuk"><i style="width:' + yuzde + '%"></i></div>';
      } else {
        const yazi = {
          sirada: 'Sırada bekliyor',
          hazirlaniyor: 'Hazırlanıyor…',
          indiriliyor: 'İndiriliyor…',
          isleniyor: is.tur === 'ses' ? 'MP3 dosyasına çevriliyor…' : 'Görüntü ile ses birleştiriliyor…',
        }[is.durum] || '';
        govde = '<div class="satir"><span>' + yazi + '</span><span></span></div>' +
          '<div class="cubuk' + (is.durum === 'sirada' ? '' : ' belirsiz') + '"><i></i></div>';
      }
      return '<div class="is' + (is.durum === 'hata' ? ' hatali' : '') + '" data-id="' + kacis(is.id) + '">' +
        '<div class="is-ust"><div class="ad">' + kacis(is.baslik) + '<div class="is-alt">' + kacis(alt) + '</div></div>' +
        '<button class="bag" type="button" data-islem="kaldir">' + (is.durum === 'hata' ? 'Kapat' : 'İptal') + '</button></div>' +
        govde + '</div>';
    }).join('');
  }

  function gecmisCiz(isler) {
    let biten = isler.filter((i) => i.durum === 'bitti');
    const imza = JSON.stringify([yerel, biten.map((i) => [i.id, i.boyut]), [...buradanBaslayan]]);
    if (imza === gecmisImzasi) return;
    gecmisImzasi = imza;

    // Telefonda, bu telefondan başlatılıp yeni biten indirme öne çıkarılır.
    let hazir = null;
    if (!yerel) {
      hazir = biten.find((i) => buradanBaslayan.has(i.id)) || null;
      if (hazir) biten = biten.filter((i) => i !== hazir);
    }
    el.hazirBolum.hidden = !hazir;
    el.hazirBolum.innerHTML = hazir
      ? '<div class="hazir"><div class="video"><div class="kapak"' + kapakStili(hazir.kapak) + '><span>' + saat(hazir.sure) + '</span></div>' +
        '<div class="video-yazi"><div class="ad">' + kacis(hazir.baslik) + '</div>' +
        '<div class="kanal">' + ['Hazır', kaliteYazi(hazir), boyut(hazir.boyut)].filter(Boolean).join(' · ') + '</div></div></div>' +
        '<a class="dugme dolu genis" href="dosya/' + kacis(hazir.id) + '" download>Telefona kaydet</a>' +
        '<p class="aciklama">iPhone indirmeyi sorar; dosya Dosyalar uygulamasında İndirilenler klasörüne iner.</p></div>'
      : '';

    el.gecmisBolum.hidden = biten.length === 0;
    el.gecmis.innerHTML = biten.map((is) => {
      const islem = yerel
        ? '<button class="bag" type="button" data-islem="ac">Aç</button>'
        : '<a class="bag" href="dosya/' + kacis(is.id) + '" download>Kaydet</a>';
      return '<div class="oge" data-id="' + kacis(is.id) + '"><div class="tik"></div>' +
        '<div class="oge-ad">' + kacis(is.baslik) + '</div>' +
        '<div class="bilgi">' + [kaliteYazi(is), boyut(is.boyut)].filter(Boolean).join(' · ') + '</div>' + islem + '</div>';
    }).join('');
  }

  function isTiklandi(e) {
    const dugme = e.target.closest('[data-islem]');
    if (!dugme) return;
    const kutu = dugme.closest('[data-id]');
    if (!kutu) return;
    const id = kutu.dataset.id;
    if (dugme.dataset.islem === 'kaldir') {
      istek('kaldir', { id }).then(yenile).catch(() => {});
    } else if (dugme.dataset.islem === 'ac') {
      istek('ac', { id }).catch((hata) => iletiGoster(hata.message, true));
    }
  }
  el.suren.addEventListener('click', isTiklandi);
  el.gecmis.addEventListener('click', isTiklandi);

  // ---- kurulum ----
  function kurulumCiz(k) {
    const goster = k.durum !== 'hazir';
    el.kurulum.hidden = !goster;
    if (!goster) return;
    const hata = k.durum === 'hata';
    el.kurulum.classList.toggle('hatali', hata);
    el.kurulumYeniden.hidden = !hata;
    el.kurulumCubuk.hidden = hata;
    el.kurulumAlt.hidden = hata;
    if (hata) {
      el.kurulumYazi.textContent = k.hata || 'Kurulum tamamlanamadı.';
      return;
    }
    const cubuk = el.kurulumCubuk.firstElementChild;
    if (k.toplam > 0) {
      el.kurulumCubuk.classList.remove('belirsiz');
      cubuk.style.width = Math.floor((k.inen / k.toplam) * 100) + '%';
      el.kurulumYazi.textContent = 'Gerekli parçalar indiriliyor (' + k.sira + ' / ' + k.adet + '): ' + k.adim +
        ', ' + boyut(k.inen) + ' / ' + boyut(k.toplam);
    } else {
      el.kurulumCubuk.classList.add('belirsiz');
      cubuk.style.width = '';
      el.kurulumYazi.textContent = k.adim ? 'Gerekli parçalar indiriliyor: ' + k.adim : 'Hazırlanıyor…';
    }
  }
  el.kurulumYeniden.addEventListener('click', () => istek('kurulum', {}).then(yenile).catch(() => {}));

  // ---- bilgisayar paneli ----
  function panelCiz(d) {
    el.panel.hidden = !yerel;
    el.altSerit.hidden = !yerel;
    if (!yerel) return;
    el.klasor.textContent = d.klasor || '';
    const t = d.telefon || { acik: false };
    el.telefonAnahtari.setAttribute('aria-checked', String(t.acik));
    el.telefonKur.hidden = !(t.acik && t.adres);
    el.agYok.hidden = !(t.acik && !t.adres);
    if (t.acik && t.adres && t.adres !== karekodAdresi) {
      karekodAdresi = t.adres;
      el.karekod.src = 'qr.png?' + Date.now();
    }
    if (!t.acik) karekodAdresi = '';
    el.otomatikSatiri.hidden = typeof d.otomatik !== 'boolean';
    el.otomatikAnahtari.setAttribute('aria-checked', String(d.otomatik === true));
  }
  el.telefonAnahtari.addEventListener('click', async () => {
    const acik = el.telefonAnahtari.getAttribute('aria-checked') !== 'true';
    el.telefonAnahtari.setAttribute('aria-checked', String(acik));
    try { await istek('telefon', { acik }); } catch (e) { /* aşağıda yenilenir */ }
    // Sunucu dinleme adresini değiştirirken kısa bir an yanıt vermez.
    setTimeout(yenile, 700);
  });
  el.otomatikAnahtari.addEventListener('click', async () => {
    const acik = el.otomatikAnahtari.getAttribute('aria-checked') !== 'true';
    try { await istek('otomatik', { acik }); } catch (e) { iletiGoster(e.message, true); }
    yenile();
  });
  el.klasorAc.addEventListener('click', () => istek('klasor', {}).catch(() => {}));
  el.kapat.addEventListener('click', async () => {
    const suren = durum && durum.isler.some((i) => i.durum !== 'bitti' && i.durum !== 'hata');
    if (suren && !confirm('Süren indirme yarıda kalacak. Program kapatılsın mı?')) return;
    kapatildi = true;
    clearTimeout(zamanlayici);
    try { await istek('kapat', {}); } catch (e) { /* zaten kapanmış olabilir */ }
    el.sayfa.hidden = true;
    el.altSerit.hidden = true;
    el.kapandi.hidden = false;
    setTimeout(() => window.close(), 1500);
  });

  // ---- telefon: ana ekran ipucu ve kalıcı adres ----
  function anaEkranIpucu() {
    const ekli = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    el.anaEkran.hidden = yerel || ekli || sakla.oku('ipucu') === 'tamam';
  }
  el.anaEkranTamam.addEventListener('click', () => {
    sakla.yaz('ipucu', 'tamam');
    el.anaEkran.hidden = true;
  });

  // Bilgisayarın ağ adresi zamanla değişebilir; adı değişmez. Telefon bilgisayarı
  // adıyla bulabiliyorsa sayfa o adrese geçer, ana ekrana eklenen simge böylece
  // adres değişse de çalışır. Bulamıyorsa olduğu gibi kalır.
  async function kaliciAdreseGec(d) {
    if (yerel || !d.yerelAd || !/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)) return;
    if (!window.AbortController) return;
    const kes = new AbortController();
    const sure = setTimeout(() => kes.abort(), 2500);
    try {
      const kok = location.protocol + '//' + d.yerelAd + (location.port ? ':' + location.port : '');
      const y = await fetch(kok + '/api/ping', { signal: kes.signal, cache: 'no-store' });
      const v = await y.json();
      if (v && v.uygulama === 'videoindir') location.replace(kok + location.pathname);
    } catch (e) { /* ad çözülemiyor; sayı adresiyle devam */ }
    clearTimeout(sure);
  }

  // ---- durum döngüsü ----
  function ciz(d) {
    durum = d;
    yerel = !!d.yerel;
    if (ilkDurum) {
      ilkDurum = false;
      if (!['eniyi', '1080', '720'].includes(secim.kalite)) secim.kalite = yerel ? '1080' : '720';
      secimCiz();
      // Pano yalnızca bilgisayardaki pencerede okunabilir.
      el.yapistir.hidden = !(yerel && navigator.clipboard && navigator.clipboard.readText);
      el.bagli.hidden = yerel;
      anaEkranIpucu();
      kaliciAdreseGec(d);
      if (yerel) el.baglanti.focus();
    }
    kurulumCiz(d.kurulum);
    surenCiz(d.isler);
    gecmisCiz(d.isler);
    panelCiz(d);
    dugmeDurumu();
  }

  function baglantiYok(yok) {
    el.kopuk.hidden = !yok;
    el.bagli.classList.toggle('yok', yok);
    el.bagliYazi.textContent = yok ? 'Bilgisayara ulaşılamıyor' : 'Bilgisayar açık, bağlı';
    if (yok) {
      el.kopuk.textContent = yerel
        ? 'Program yanıt vermiyor. Masaüstündeki Video İndir simgesinden yeniden açın.'
        : 'Bilgisayara ulaşılamıyor. Bilgisayarın açık olduğunu ve telefonla aynı Wi-Fi ağında bulunduğunu denetleyin.';
    }
  }

  async function yenile() {
    if (kapatildi) return;
    clearTimeout(zamanlayici);
    let bekle = 3000;
    try {
      const d = await istek('durum');
      hataSayisi = 0;
      baglantiYok(false);
      const bilgiBekliyordu = durum && durum.kurulum.durum !== 'hazir' && d.kurulum.durum === 'hazir';
      ciz(d);
      if (bilgiBekliyordu && baglantiVar()) baglantiDegisti(true);
      const hareketli = d.kurulum.durum === 'indiriliyor' || d.isler.some((i) => i.durum !== 'bitti' && i.durum !== 'hata');
      if (hareketli) bekle = 1000;
    } catch (e) {
      hataSayisi++;
      if (hataSayisi >= 3) baglantiYok(true);
      bekle = 2000;
    }
    if (!kapatildi) zamanlayici = setTimeout(yenile, bekle);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') yenile();
  });

  secimCiz();
  yenile();
})();
