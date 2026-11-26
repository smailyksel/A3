/* Belge Dönüştür: arayüz.

   Üç bölüm vardır: Dönüştür, Birleştir, İmzala. Seçilen dosyalar yalnızca
   bellekte tutulur; sayfa kapanınca silinir. Cihazda saklanan tek şey,
   kullanıcı isterse, çizdiği imzanın görüntüsüdür. */

(function () {
  'use strict';
  const BD = window.BD;
  const $ = id => document.getElementById(id);

  const el = {
    uyg: $('uyg'), icerik: $('icerik'), eylem: $('eylem'), eylemDugme: $('eylemDugme'), bildirim: $('bildirim'),
    dBirak: $('dBirak'), dSec: $('dSec'), dEkle: $('dEkle'), dAkis: $('dAkis'), dListe: $('dListe'),
    dHedefler: $('dHedefler'), dPdfMod: $('dPdfMod'), dUyari: $('dUyari'),
    bBirak: $('bBirak'), bSec: $('bSec'), bEkle: $('bEkle'), bAkis: $('bAkis'), bListe: $('bListe'),
    bAd: $('bAd'), bSonuc: $('bSonuc'), bUyari: $('bUyari'),
    iBirak: $('iBirak'), iSec: $('iSec'), iAkis: $('iAkis'), iAd: $('iAd'), iKapat: $('iKapat'),
    iAlan: $('iAlan'), iKutu: $('iKutu'), iTuval: $('iTuval'), iOnceki: $('iOnceki'), iSonraki: $('iSonraki'), iSayfa: $('iSayfa'),
    iEkle: $('iEkle'), iYeni: $('iYeni'), iHepsine: $('iHepsine'), iIpucu: $('iIpucu'), iSonuc: $('iSonuc'), iUyari: $('iUyari'),
    imzaPencere: $('imzaPencere'), imzaKapat: $('imzaKapat'), imzaTuval: $('imzaTuval'), imzaYer: $('imzaYer'),
    imzaTemizle: $('imzaTemizle'), imzaSakla: $('imzaSakla'), imzaKullan: $('imzaKullan'),
    bilgiAc: $('bilgiAc'), bilgiPencere: $('bilgiPencere'), bilgiKapat: $('bilgiKapat'),
    sakliImzaBolum: $('sakliImzaBolum'), sakliImzaResim: $('sakliImzaResim'), sakliImzaSil: $('sakliImzaSil'),
    kurulum: $('kurulum'), kurulumYazi: $('kurulumYazi'),
  };

  const ROZET = { docx: 'WORD', pdf: 'PDF', udf: 'UDF', resim: 'RESİM' };
  const HEDEF_SIRA = ['pdf', 'docx', 'udf', 'jpg', 'png'];
  const EYLEM_YAZI = { pdf: 'PDF’ye dönüştür', docx: 'Word’e dönüştür', udf: 'UDF’ye dönüştür', jpg: 'JPEG’e dönüştür', png: 'PNG’ye dönüştür' };
  const IMZA_ANAHTAR = 'donustur.imza';
  const EN_BUYUK = 150 * 1024 * 1024;

  /* ---------- Yardımcılar ---------- */

  const ikon = (ad, sinif) => `<svg class="ikon${sinif ? ' ' + sinif : ''}" aria-hidden="true"><use href="#i-${ad}"/></svg>`;
  const kacis = s => BD.xmlKacis(s);
  const boyutYaz = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB');
  const bekle = () => new Promise(c => requestAnimationFrame(() => setTimeout(c, 0)));
  let kimlikSayaci = 0;

  let bildirimSuresi = 0;
  function bildir(yazi) {
    clearTimeout(bildirimSuresi);
    el.bildirim.textContent = yazi;
    el.bildirim.hidden = false;
    bildirimSuresi = setTimeout(() => { el.bildirim.hidden = true; }, 3800);
  }

  function hataMetni(e) {
    if (e && e.kullaniciya) return e.message;
    if (window.console) console.error(e);
    return 'İşlem tamamlanamadı. Dosya bozuk ya da desteklenmeyen bir yapıda olabilir.';
  }
  function uyar(kutu, yazi) {
    kutu.innerHTML = yazi ? ikon('uyari', 'ikon-k') + '<span>' + kacis(yazi) + '</span>' : '';
    kutu.hidden = !yazi;
  }

  function indir(veri, ad, tip) {
    const url = URL.createObjectURL(new Blob([veri], { type: tip }));
    const a = document.createElement('a');
    a.href = url; a.download = ad;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function paylasilir(ad, tip) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], ad, { type: tip })] })); }
    catch (e) { return false; }
  }
  async function paylas(veri, ad, tip) {
    try { await navigator.share({ files: [new File([veri], ad, { type: tip })] }); }
    catch (e) { if (!e || e.name !== 'AbortError') { indir(veri, ad, tip); bildir('Paylaşım açılamadı; dosya indirildi.'); } }
  }
  // Paylaş ve İndir düğmeleri; cihaz dosya paylaşamıyorsa yalnızca İndir.
  function cikisDugmeleri(ad, tip, kucuk) {
    const s = kucuk ? ' dugme-kucuk' : '';
    return (paylasilir(ad, tip) ? `<button type="button" class="dugme dugme-ana${s}" data-is="paylas">${ikon('paylas', 'ikon-k')}<span>Paylaş</span></button>` +
      `<button type="button" class="dugme${s}" data-is="indir">${ikon('indir', 'ikon-k')}<span>İndir</span></button>`
      : `<button type="button" class="dugme dugme-ana${s}" data-is="indir">${ikon('indir', 'ikon-k')}<span>İndir</span></button>`);
  }

  // Seçilen dosyaları okur ve türünü belirler; okunamayanlar için açıklama döner.
  async function dosyalariAl(liste) {
    const tamam = [], sorunlar = [];
    for (const f of Array.from(liste || [])) {
      if (f.size > EN_BUYUK) { sorunlar.push('“' + f.name + '” çok büyük (en çok 150 MB).'); continue; }
      try {
        const d = await BD.dosyaHazirla(f);
        if (d.tur === 'doc') sorunlar.push('“' + f.name + '” eski .doc biçiminde. Word’de “Farklı Kaydet” ile .docx yapıp yeniden deneyin.');
        else if (!d.tur) sorunlar.push('“' + f.name + '” desteklenen bir dosya türü değil.');
        else { d.kimlik = 'd' + (++kimlikSayaci); tamam.push(d); }
      } catch (e) { sorunlar.push('“' + f.name + '” okunamadı.'); }
    }
    return { tamam, sorun: sorunlar.join(' ') };
  }

  function birakmaKur(alan, girdi, is) {
    girdi.addEventListener('change', () => { const f = Array.from(girdi.files || []); girdi.value = ''; if (f.length) is(f); });
    if (!alan) return;
    ['dragenter', 'dragover'].forEach(o => alan.addEventListener(o, e => { e.preventDefault(); alan.classList.add('ustunde'); }));
    ['dragleave', 'dragend', 'drop'].forEach(o => alan.addEventListener(o, () => alan.classList.remove('ustunde')));
    alan.addEventListener('drop', e => { e.preventDefault(); const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (f.length) is(f); });
  }

  /* ---------- Eylem düğmesi ---------- */

  let eylemIs = null;
  function eylemAyarla(yazi, is, secenek) {
    const s = secenek || {};
    if (!yazi) { el.eylem.hidden = true; eylemIs = null; return; }
    el.eylem.hidden = false;
    el.eylemDugme.innerHTML = (s.calisiyor ? '<span class="halka" aria-hidden="true"></span>' : '') + '<span>' + kacis(yazi) + '</span>';
    el.eylemDugme.disabled = !!s.calisiyor || !!s.kapali;
    eylemIs = is;
  }
  el.eylemDugme.addEventListener('click', () => { if (eylemIs) eylemIs(); });

  function eylemGuncelle() {
    const sekme = el.uyg.dataset.sekme;
    if (sekme === 'donustur') {
      if (!D.dosyalar.length) eylemAyarla('');
      else if (D.calisiyor) eylemAyarla('Dönüştürülüyor…', null, { calisiyor: true });
      else eylemAyarla(EYLEM_YAZI[D.hedef] || 'Dönüştür', donustur, { kapali: !D.hedef });
    } else if (sekme === 'birlestir') {
      if (!B.dosyalar.length) eylemAyarla('');
      else if (B.calisiyor) eylemAyarla(B.ilerleme || 'Birleştiriliyor…', null, { calisiyor: true });
      else eylemAyarla(B.dosyalar.length < 2 ? 'Birleştirmek için en az iki dosya seçin' : B.dosyalar.length + ' dosyayı birleştir', birlestir, { kapali: B.dosyalar.length < 2 });
    } else {
      if (!I.pdf) eylemAyarla(I.yukleniyor ? 'Belge hazırlanıyor…' : '', null, { calisiyor: true });
      else if (I.calisiyor) eylemAyarla('Kaydediliyor…', null, { calisiyor: true });
      else eylemAyarla(I.yerlesimler.length ? 'İmzalı belgeyi kaydet' : 'Önce imza ekleyin', imzaliKaydet, { kapali: !I.yerlesimler.length });
    }
  }

  /* ---------- Bölüm sekmeleri ---------- */

  function sekmeAc(ad) {
    el.uyg.dataset.sekme = ad;
    document.querySelectorAll('.sekmeler button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sekme === ad)));
    document.querySelectorAll('.pano').forEach(p => { p.hidden = p.dataset.pano !== ad; });
    el.icerik.scrollTop = 0;
    eylemGuncelle();
    if (ad === 'imzala' && I.pdf) sayfaCiz();
  }
  document.querySelectorAll('.sekmeler button').forEach(b => b.addEventListener('click', () => sekmeAc(b.dataset.sekme)));

  /* ====================================================================
     DÖNÜŞTÜR
     ==================================================================== */

  const D = { dosyalar: [], hedef: null, calisiyor: false };

  function dHedefler() {
    const var_ = new Set();
    for (const d of D.dosyalar) for (const h of BD.HEDEFLER[d.tur] || []) var_.add(h);
    return HEDEF_SIRA.filter(h => var_.has(h));
  }

  function dCiz() {
    const dolu = D.dosyalar.length > 0;
    el.dBirak.hidden = dolu;
    el.dAkis.hidden = !dolu;
    if (!dolu) { D.hedef = null; uyar(el.dUyari, ''); eylemGuncelle(); return; }

    const hedefler = dHedefler();
    if (!hedefler.includes(D.hedef)) D.hedef = hedefler[0] || null;
    el.dHedefler.innerHTML = hedefler.map(h =>
      `<label class="hedef"><input type="radio" name="hedef" value="${h}"${h === D.hedef ? ' checked' : ''}${D.calisiyor ? ' disabled' : ''}><span>${BD.HEDEF_ADI[h]}</span></label>`).join('');
    el.dPdfMod.hidden = !(D.dosyalar.some(d => d.tur === 'pdf') && (D.hedef === 'docx' || D.hedef === 'udf'));

    el.dListe.innerHTML = D.dosyalar.map(d => {
      let alt = '';
      if (d.durum === 'calisiyor') alt = `<div class="oge-alt"><p class="durum"><span class="halka" aria-hidden="true"></span><span>Dönüştürülüyor…</span></p></div>`;
      else if (d.hata) alt = `<div class="oge-alt" data-tur="hata"><p class="durum">${ikon('uyari', 'ikon-k')}<span>${kacis(d.hata)}</span></p></div>`;
      else if (d.bilgi) alt = `<div class="oge-alt" data-tur="bilgi"><p class="durum">${ikon('bilgi', 'ikon-k')}<span>${kacis(d.bilgi)}</span></p></div>`;
      else if (d.sonuc) {
        alt = `<div class="oge-alt"><p class="durum">${ikon('tik', 'ikon-k')}<b>${kacis(d.sonuc.ad)}</b><span>${boyutYaz(d.sonuc.veri.length)}</span></p>` +
          `<div class="islemler">${cikisDugmeleri(d.sonuc.ad, d.sonuc.tip, true)}</div>` +
          (d.sonuc.bilgi ? `<p class="oge-not">${kacis(d.sonuc.bilgi)}</p>` : '') + '</div>';
      }
      return `<li class="oge" data-kimlik="${d.kimlik}"><div class="oge-ust"><span class="rozet">${ROZET[d.tur]}</span>` +
        `<div class="oge-yazi"><b>${kacis(d.ad)}</b><small>${BD.TUR_ADI[d.tur]} · ${boyutYaz(d.boyut)}</small></div>` +
        `<div class="oge-dugmeler"><button type="button" class="simge-dugme" data-is="kaldir" aria-label="Listeden çıkar"${D.calisiyor ? ' disabled' : ''}>${ikon('kapat')}</button></div></div>${alt}</li>`;
    }).join('');
    eylemGuncelle();
  }

  async function dEkle(liste) {
    const { tamam, sorun } = await dosyalariAl(liste);
    D.dosyalar.push(...tamam);
    dCiz();
    uyar(el.dUyari, sorun);
  }
  birakmaKur(el.dBirak, el.dSec, dEkle);
  birakmaKur(null, el.dEkle, dEkle);

  const dTemizle = () => { for (const d of D.dosyalar) { d.sonuc = null; d.hata = ''; d.bilgi = ''; d.durum = ''; } };

  el.dHedefler.addEventListener('change', e => {
    if (e.target.name !== 'hedef') return;
    D.hedef = e.target.value;
    dTemizle();
    dCiz();
  });
  el.dPdfMod.addEventListener('change', () => { dTemizle(); dCiz(); });

  el.dListe.addEventListener('click', e => {
    const dugme = e.target.closest('button[data-is]');
    if (!dugme) return;
    const d = D.dosyalar.find(x => x.kimlik === dugme.closest('.oge').dataset.kimlik);
    if (!d) return;
    if (dugme.dataset.is === 'kaldir') { D.dosyalar = D.dosyalar.filter(x => x !== d); uyar(el.dUyari, ''); dCiz(); }
    else if (dugme.dataset.is === 'indir' && d.sonuc) indir(d.sonuc.veri, d.sonuc.ad, d.sonuc.tip);
    else if (dugme.dataset.is === 'paylas' && d.sonuc) paylas(d.sonuc.veri, d.sonuc.ad, d.sonuc.tip);
  });

  async function donustur() {
    if (D.calisiyor || !D.hedef) return;
    const hedef = D.hedef;
    const pdfMod = (document.querySelector('input[name="pdfMod"]:checked') || {}).value || 'metin';
    D.calisiyor = true;
    uyar(el.dUyari, '');
    dTemizle();
    for (const d of D.dosyalar) {
      if (!(BD.HEDEFLER[d.tur] || []).includes(hedef)) {
        d.bilgi = d.tur === hedef ? 'Bu dosya zaten ' + BD.HEDEF_ADI[hedef] + ' biçiminde.' : BD.TUR_ADI[d.tur] + ' dosyası ' + BD.HEDEF_ADI[hedef] + ' biçimine çevrilmez.';
        continue;
      }
      d.durum = 'calisiyor';
      dCiz();
      await bekle();
      try { d.sonuc = await BD.cevir(d, hedef, { pdfMod }); }
      catch (e) { d.hata = hataMetni(e); }
      d.durum = '';
    }
    D.calisiyor = false;
    dCiz();
    const ilk = el.dListe.querySelector('.oge-alt');
    if (ilk && ilk.scrollIntoView) ilk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ====================================================================
     BİRLEŞTİR
     ==================================================================== */

  const B = { dosyalar: [], sonuc: null, calisiyor: false, ilerleme: '' };

  function bCiz() {
    const dolu = B.dosyalar.length > 0;
    el.bBirak.hidden = dolu;
    el.bAkis.hidden = !dolu;
    if (!dolu) { B.sonuc = null; uyar(el.bUyari, ''); }
    const n = B.dosyalar.length;
    el.bListe.innerHTML = B.dosyalar.map((d, i) =>
      `<li class="oge" data-kimlik="${d.kimlik}"><div class="oge-ust"><span class="sira">${i + 1}</span>` +
      `<div class="oge-yazi"><b>${kacis(d.ad)}</b><small>${BD.TUR_ADI[d.tur]} · ${boyutYaz(d.boyut)}</small></div>` +
      `<div class="oge-dugmeler">` +
      `<button type="button" class="simge-dugme" data-is="yukari" aria-label="Yukarı taşı"${i === 0 || B.calisiyor ? ' disabled' : ''}>${ikon('yukari')}</button>` +
      `<button type="button" class="simge-dugme" data-is="asagi" aria-label="Aşağı taşı"${i === n - 1 || B.calisiyor ? ' disabled' : ''}>${ikon('asagi')}</button>` +
      `<button type="button" class="simge-dugme" data-is="kaldir" aria-label="Listeden çıkar"${B.calisiyor ? ' disabled' : ''}>${ikon('kapat')}</button>` +
      `</div></div></li>`).join('');
    if (B.sonuc) {
      el.bSonuc.innerHTML = `<div class="sonuc-ust"><span class="tik">${ikon('tik')}</span><div class="sonuc-yazi"><b>${kacis(B.sonuc.ad)}</b>` +
        `<small>${B.sonuc.sayfa} sayfa · ${boyutYaz(B.sonuc.veri.length)}</small></div></div>` +
        `<div class="sonuc-dugmeler">${cikisDugmeleri(B.sonuc.ad, B.sonuc.tip)}<button type="button" class="dugme" data-is="imzala">${ikon('imza', 'ikon-k')}<span>İmzala</span></button></div>`;
    }
    el.bSonuc.hidden = !B.sonuc;
    eylemGuncelle();
  }

  async function bEkle(liste) {
    const { tamam, sorun } = await dosyalariAl(liste);
    B.dosyalar.push(...tamam);
    if (tamam.length) B.sonuc = null;
    bCiz();
    uyar(el.bUyari, sorun);
  }
  birakmaKur(el.bBirak, el.bSec, bEkle);
  birakmaKur(null, el.bEkle, bEkle);

  el.bListe.addEventListener('click', e => {
    const dugme = e.target.closest('button[data-is]');
    if (!dugme || B.calisiyor) return;
    const i = B.dosyalar.findIndex(x => x.kimlik === dugme.closest('.oge').dataset.kimlik);
    if (i < 0) return;
    const is = dugme.dataset.is;
    if (is === 'kaldir') B.dosyalar.splice(i, 1);
    else {
      const j = is === 'yukari' ? i - 1 : i + 1;
      if (j < 0 || j >= B.dosyalar.length) return;
      const gecici = B.dosyalar[i]; B.dosyalar[i] = B.dosyalar[j]; B.dosyalar[j] = gecici;
    }
    B.sonuc = null;
    uyar(el.bUyari, '');
    bCiz();
  });

  el.bSonuc.addEventListener('click', e => {
    const dugme = e.target.closest('button[data-is]');
    if (!dugme || !B.sonuc) return;
    const s = B.sonuc;
    if (dugme.dataset.is === 'indir') indir(s.veri, s.ad, s.tip);
    else if (dugme.dataset.is === 'paylas') paylas(s.veri, s.ad, s.tip);
    else if (dugme.dataset.is === 'imzala') { sekmeAc('imzala'); imzaBelgesiAc({ ad: s.ad, veri: s.veri, tur: 'pdf', boyut: s.veri.length }); }
  });

  const dosyaAdiTemiz = (ad, vars) => (String(ad || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 120) || vars);

  async function birlestir() {
    if (B.calisiyor || B.dosyalar.length < 2) return;
    B.calisiyor = true; B.sonuc = null; B.ilerleme = '';
    uyar(el.bUyari, '');
    bCiz();
    await bekle();
    try {
      const s = await BD.birlestir(B.dosyalar, (sira, toplam) => { B.ilerleme = 'Birleştiriliyor… ' + sira + ' / ' + toplam; eylemGuncelle(); });
      B.sonuc = { ad: dosyaAdiTemiz(el.bAd.value, 'birlesik') + '.pdf', veri: s.veri, sayfa: s.sayfa, tip: BD.MIME.pdf };
    } catch (e) { uyar(el.bUyari, hataMetni(e)); }
    B.calisiyor = false;
    bCiz();
    if (B.sonuc && el.bSonuc.scrollIntoView) el.bSonuc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ====================================================================
     İMZALA
     ==================================================================== */

  const I = { ad: '', pdfBayt: null, pdf: null, sayfaNo: 1, toplam: 0, yerlesimler: [], secili: null, imza: null, sonuc: null, yukleniyor: false, calisiyor: false, cizim: 0 };

  // Saklanan imza
  function sakliImzaOku() {
    try {
      const k = JSON.parse(localStorage.getItem(IMZA_ANAHTAR) || 'null');
      if (k && typeof k.url === 'string' && /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(k.url) && k.oran > 0 && k.oran < 100) return { url: k.url, oran: +k.oran, png: BD.b64Coz(k.url.split(',')[1]) };
    } catch (e) { /* kayıt yok ya da okunamadı */ }
    return null;
  }
  I.imza = sakliImzaOku();

  function iCiz() {
    const acik = !!I.pdf || I.yukleniyor;
    el.iBirak.hidden = acik;
    el.iAkis.hidden = !acik;
    el.iAd.textContent = I.ad;
    el.iKutu.classList.toggle('bekliyor', I.yukleniyor);
    el.iSayfa.textContent = I.toplam ? I.sayfaNo + ' / ' + I.toplam : '';
    el.iOnceki.disabled = I.sayfaNo <= 1;
    el.iSonraki.disabled = I.sayfaNo >= I.toplam;
    el.iYeni.hidden = !I.imza;
    el.iHepsine.hidden = !(I.secili && I.toplam > 1);
    el.iIpucu.hidden = !I.yerlesimler.length;
    if (I.sonuc) {
      el.iSonuc.innerHTML = `<div class="sonuc-ust"><span class="tik">${ikon('tik')}</span><div class="sonuc-yazi"><b>${kacis(I.sonuc.ad)}</b>` +
        `<small>${boyutYaz(I.sonuc.veri.length)}</small></div></div><div class="sonuc-dugmeler">${cikisDugmeleri(I.sonuc.ad, I.sonuc.tip)}</div>`;
    }
    el.iSonuc.hidden = !I.sonuc;
    kutulariCiz();
    eylemGuncelle();
  }

  async function imzaBelgesiKapat() {
    const pdf = I.pdf;
    I.pdf = null; I.pdfBayt = null; I.ad = ''; I.toplam = 0; I.sayfaNo = 1; I.yerlesimler = []; I.secili = null; I.sonuc = null; I.yukleniyor = false;
    I.cizim++;
    uyar(el.iUyari, '');
    iCiz();
    if (pdf) { try { await pdf.destroy(); } catch (e) { /* önemsiz */ } }
  }

  async function imzaBelgesiAc(dosya) {
    await imzaBelgesiKapat();
    I.ad = dosya.ad; I.yukleniyor = true;
    iCiz();
    await bekle();
    try {
      const bayt = await BD.pdfeCevir(dosya);
      const pdf = await BD.pdfAc(bayt);
      I.pdfBayt = bayt; I.pdf = pdf; I.toplam = pdf.numPages; I.sayfaNo = 1;
      I.ad = BD.adDegistir(dosya.ad, '.pdf');
    } catch (e) {
      I.yukleniyor = false; I.ad = '';
      iCiz();
      uyar(el.iUyari, hataMetni(e));
      return;
    }
    I.yukleniyor = false;
    iCiz();
    await sayfaCiz();
  }

  birakmaKur(el.iBirak, el.iSec, async liste => {
    const { tamam, sorun } = await dosyalariAl(liste.slice(0, 1));
    if (tamam.length) await imzaBelgesiAc(tamam[0]);
    else uyar(el.iUyari, sorun);
  });
  el.iKapat.addEventListener('click', imzaBelgesiKapat);

  async function sayfaCiz() {
    if (!I.pdf) return;
    const sira = ++I.cizim;
    el.iKutu.classList.add('bekliyor');
    try {
      const sayfa = await I.pdf.getPage(I.sayfaNo);
      const g = sayfa.getViewport({ scale: 1 });
      const en = Math.min(1600, Math.max(600, (el.iKutu.clientWidth || 360) * Math.min(2.5, window.devicePixelRatio || 1)));
      const tuval = await BD.pdfSayfaCiz(sayfa, en * Math.max(1, g.height / g.width));
      if (sira !== I.cizim) return;
      el.iTuval.width = tuval.width; el.iTuval.height = tuval.height;
      el.iTuval.getContext('2d').drawImage(tuval, 0, 0);
      el.iTuval.dataset.oran = String(g.width / g.height);
      tuval.width = tuval.height = 0;
    } catch (e) { if (sira === I.cizim) uyar(el.iUyari, 'Sayfa görüntülenemedi.'); }
    if (sira === I.cizim) { el.iKutu.classList.remove('bekliyor'); kutulariCiz(); }
  }

  function sayfayaGit(no) {
    if (!I.pdf || no < 1 || no > I.toplam || no === I.sayfaNo) return;
    I.sayfaNo = no; I.secili = null;
    iCiz();
    sayfaCiz();
  }
  el.iOnceki.addEventListener('click', () => sayfayaGit(I.sayfaNo - 1));
  el.iSonraki.addEventListener('click', () => sayfayaGit(I.sayfaNo + 1));

  // Sayfanın en/boy oranı (imzanın yüksekliğini hesaplamak için).
  const sayfaOrani = () => parseFloat(el.iTuval.dataset.oran) || (el.iTuval.width && el.iTuval.height ? el.iTuval.width / el.iTuval.height : 0.707);

  function kutulariCiz() {
    el.iKutu.querySelectorAll('.imza-kutu').forEach(k => k.remove());
    const oran = sayfaOrani();
    for (const y of I.yerlesimler) {
      if (y.sayfa !== I.sayfaNo) continue;
      // Yükseklik bu sayfanın biçimine göre hesaplanır; imza her sayfada aynı oranda görünür.
      y.boy = Math.min(1, y.en * oran / y.imza.oran);
      if (y.y + y.boy > 1) y.y = Math.max(0, 1 - y.boy);
      const k = document.createElement('div');
      k.className = 'imza-kutu' + (y.kimlik === I.secili ? ' secili' : '');
      k.dataset.kimlik = y.kimlik;
      k.style.left = (y.x * 100) + '%'; k.style.top = (y.y * 100) + '%';
      k.style.width = (y.en * 100) + '%'; k.style.height = (y.boy * 100) + '%';
      k.innerHTML = `<img src="${y.imza.url}" alt="İmza" draggable="false">` +
        `<button type="button" class="kaldir" aria-label="İmzayı kaldır">${ikon('kapat')}</button><span class="tutamak" aria-hidden="true"></span>`;
      el.iKutu.appendChild(k);
    }
  }

  function imzaYerlestir() {
    if (!I.pdf || !I.imza) return;
    const oran = sayfaOrani();
    const en = 0.3, boy = Math.min(0.5, en * oran / I.imza.oran);
    // Sayfanın o an ekranda görünen bölümünün ortasına konur.
    const kutu = el.iKutu.getBoundingClientRect(), alan = el.icerik.getBoundingClientRect();
    const ust = Math.max(kutu.top, alan.top), alt = Math.min(kutu.bottom, alan.bottom);
    const orta = kutu.height > 0 && alt > ust ? ((ust + alt) / 2 - kutu.top) / kutu.height : 0.5;
    const y = { kimlik: 'y' + (++kimlikSayaci), sayfa: I.sayfaNo, x: 0.5 - en / 2, y: Math.max(0, Math.min(1 - boy, orta - boy / 2)), en, boy, imza: I.imza };
    I.yerlesimler.push(y);
    I.secili = y.kimlik; I.sonuc = null;
    iCiz();
  }

  el.iEkle.addEventListener('click', () => { if (I.imza) imzaYerlestir(); else imzaPenceresiAc(); });
  el.iYeni.addEventListener('click', imzaPenceresiAc);
  el.iHepsine.addEventListener('click', () => {
    const y = I.yerlesimler.find(q => q.kimlik === I.secili);
    if (!y) return;
    let eklenen = 0;
    for (let no = 1; no <= I.toplam; no++) {
      if (no === y.sayfa) continue;
      I.yerlesimler.push(Object.assign({}, y, { kimlik: 'y' + (++kimlikSayaci), sayfa: no }));
      eklenen++;
    }
    I.sonuc = null;
    iCiz();
    bildir('İmza diğer ' + eklenen + ' sayfaya da aynı yere kondu.');
  });

  // Sürükleme ve boyutlandırma
  let tasima = null;
  el.iKutu.addEventListener('pointerdown', e => {
    const k = e.target.closest('.imza-kutu');
    if (!k) { if (I.secili) { I.secili = null; iCiz(); } return; }
    const y = I.yerlesimler.find(q => q.kimlik === k.dataset.kimlik);
    if (!y) return;
    if (e.target.closest('.kaldir')) return;
    e.preventDefault();
    if (I.secili !== y.kimlik) { I.secili = y.kimlik; el.iKutu.querySelectorAll('.imza-kutu').forEach(q => q.classList.toggle('secili', q === k)); el.iHepsine.hidden = !(I.toplam > 1); }
    const r = el.iKutu.getBoundingClientRect();
    tasima = { y, k, tur: e.target.closest('.tutamak') ? 'boyut' : 'tasi', bx: e.clientX, by: e.clientY, x0: y.x, y0: y.y, en0: y.en, W: r.width, H: r.height, id: e.pointerId, oynadi: false };
    try { k.setPointerCapture(e.pointerId); } catch (h) { /* desteklenmiyorsa belge üzerinden izlenir */ }
    k.classList.add('tasiniyor');
  });
  window.addEventListener('pointermove', e => {
    if (!tasima || e.pointerId !== tasima.id) return;
    const t = tasima, y = t.y, dx = (e.clientX - t.bx) / t.W, dy = (e.clientY - t.by) / t.H;
    if (t.tur === 'tasi') {
      y.x = Math.max(0, Math.min(1 - y.en, t.x0 + dx));
      y.y = Math.max(0, Math.min(1 - y.boy, t.y0 + dy));
    } else {
      const oran = sayfaOrani();
      let en = Math.max(0.06, Math.min(1 - y.x, t.en0 + dx));
      let boy = en * oran / y.imza.oran;
      if (y.y + boy > 1) { boy = 1 - y.y; en = boy * y.imza.oran / oran; }
      y.en = en; y.boy = boy;
    }
    t.oynadi = true;
    t.k.style.left = (y.x * 100) + '%'; t.k.style.top = (y.y * 100) + '%';
    t.k.style.width = (y.en * 100) + '%'; t.k.style.height = (y.boy * 100) + '%';
  });
  const tasimaBitir = e => {
    if (!tasima || (e && e.pointerId !== tasima.id)) return;
    tasima.k.classList.remove('tasiniyor');
    if (tasima.oynadi && I.sonuc) { I.sonuc = null; iCiz(); }
    tasima = null;
  };
  window.addEventListener('pointerup', tasimaBitir);
  window.addEventListener('pointercancel', tasimaBitir);
  el.iKutu.addEventListener('click', e => {
    const dugme = e.target.closest('.kaldir');
    if (!dugme) return;
    const kimlik = dugme.closest('.imza-kutu').dataset.kimlik;
    I.yerlesimler = I.yerlesimler.filter(q => q.kimlik !== kimlik);
    if (I.secili === kimlik) I.secili = null;
    I.sonuc = null;
    iCiz();
  });

  async function imzaliKaydet() {
    if (I.calisiyor || !I.pdf || !I.yerlesimler.length) return;
    I.calisiyor = true;
    uyar(el.iUyari, '');
    eylemGuncelle();
    await bekle();
    try {
      const veri = await BD.imzaBas(I.pdfBayt, I.yerlesimler.map(y => ({ sayfa: y.sayfa - 1, x: y.x, y: y.y, en: y.en, png: y.imza.png })));
      I.sonuc = { ad: BD.adDegistir(I.ad, '') + '-imzali.pdf', veri, tip: BD.MIME.pdf };
      I.secili = null;
    } catch (e) { uyar(el.iUyari, hataMetni(e)); }
    I.calisiyor = false;
    iCiz();
    if (I.sonuc && el.iSonuc.scrollIntoView) el.iSonuc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  el.iSonuc.addEventListener('click', e => {
    const dugme = e.target.closest('button[data-is]');
    if (!dugme || !I.sonuc) return;
    if (dugme.dataset.is === 'indir') indir(I.sonuc.veri, I.sonuc.ad, I.sonuc.tip);
    else if (dugme.dataset.is === 'paylas') paylas(I.sonuc.veri, I.sonuc.ad, I.sonuc.tip);
  });

  let boyutSuresi = 0;
  window.addEventListener('resize', () => { clearTimeout(boyutSuresi); boyutSuresi = setTimeout(() => { if (I.pdf && el.uyg.dataset.sekme === 'imzala') sayfaCiz(); }, 250); });

  /* ---------- İmza çizme penceresi ---------- */

  const C = { cizgiler: [], etkin: null, olcek: 1, en: 0, boy: 0 };
  const KALINLIK = 2.6;

  const pencereAc = p => { if (typeof p.showModal === 'function') { if (!p.open) p.showModal(); } else p.setAttribute('open', ''); };
  const pencereKapat = p => { if (typeof p.close === 'function') { if (p.open) p.close(); } else p.removeAttribute('open'); };
  [el.imzaPencere, el.bilgiPencere].forEach(p => p.addEventListener('click', e => { if (e.target === p) pencereKapat(p); }));

  function cizgiCiz(c, cizgi, olcek, kayX, kayY) {
    const n = cizgi.noktalar, X = q => (q.x - kayX) * olcek, Y = q => (q.y - kayY) * olcek;
    c.strokeStyle = c.fillStyle = cizgi.renk;
    c.lineWidth = KALINLIK * olcek; c.lineCap = 'round'; c.lineJoin = 'round';
    if (n.length === 1) { c.beginPath(); c.arc(X(n[0]), Y(n[0]), KALINLIK * olcek * 0.6, 0, Math.PI * 2); c.fill(); return; }
    c.beginPath();
    c.moveTo(X(n[0]), Y(n[0]));
    for (let i = 1; i < n.length - 1; i++) c.quadraticCurveTo(X(n[i]), Y(n[i]), (X(n[i]) + X(n[i + 1])) / 2, (Y(n[i]) + Y(n[i + 1])) / 2);
    c.lineTo(X(n[n.length - 1]), Y(n[n.length - 1]));
    c.stroke();
  }

  function padCiz() {
    const c = el.imzaTuval.getContext('2d');
    c.clearRect(0, 0, el.imzaTuval.width, el.imzaTuval.height);
    for (const cz of C.cizgiler) cizgiCiz(c, cz, C.olcek, 0, 0);
    el.imzaYer.hidden = C.cizgiler.length > 0;
    el.imzaKullan.disabled = !C.cizgiler.length;
  }

  function padHazirla() {
    const r = el.imzaTuval.getBoundingClientRect();
    C.olcek = Math.min(3, window.devicePixelRatio || 1);
    C.en = r.width; C.boy = r.height;
    el.imzaTuval.width = Math.max(1, Math.round(r.width * C.olcek));
    el.imzaTuval.height = Math.max(1, Math.round(r.height * C.olcek));
    padCiz();
  }

  function imzaPenceresiAc() {
    C.cizgiler = []; C.etkin = null;
    pencereAc(el.imzaPencere);
    requestAnimationFrame(padHazirla);
  }
  el.imzaKapat.addEventListener('click', () => pencereKapat(el.imzaPencere));
  el.imzaTemizle.addEventListener('click', () => { C.cizgiler = []; C.etkin = null; padCiz(); });

  const padNokta = e => { const r = el.imzaTuval.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  el.imzaTuval.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const renk = (document.querySelector('input[name="murekkep"]:checked') || {}).value || '#1b2a6b';
    C.etkin = { renk, noktalar: [padNokta(e)], id: e.pointerId };
    C.cizgiler.push(C.etkin);
    try { el.imzaTuval.setPointerCapture(e.pointerId); } catch (h) { /* gerekmez */ }
    padCiz();
  });
  el.imzaTuval.addEventListener('pointermove', e => {
    if (!C.etkin || e.pointerId !== C.etkin.id) return;
    e.preventDefault();
    const olaylar = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const o of (olaylar.length ? olaylar : [e])) {
      const q = padNokta(o), son = C.etkin.noktalar[C.etkin.noktalar.length - 1];
      if (Math.hypot(q.x - son.x, q.y - son.y) >= 0.8) C.etkin.noktalar.push(q);
    }
    padCiz();
  });
  const padBitir = e => { if (C.etkin && (!e || e.pointerId === C.etkin.id)) C.etkin = null; };
  el.imzaTuval.addEventListener('pointerup', padBitir);
  el.imzaTuval.addEventListener('pointercancel', padBitir);

  // Çizgiler, çevresindeki boşluk atılarak saydam zeminli PNG'ye dökülür.
  function imzaUret() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const cz of C.cizgiler) for (const q of cz.noktalar) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    if (!isFinite(x0)) return null;
    const pay = KALINLIK * 1.5;
    x0 -= pay; y0 -= pay; x1 += pay; y1 += pay;
    const en = Math.max(8, x1 - x0), boy = Math.max(8, y1 - y0);
    const olcek = Math.min(4, 1400 / Math.max(en, boy));
    const tuval = document.createElement('canvas');
    tuval.width = Math.round(en * olcek); tuval.height = Math.round(boy * olcek);
    const c = tuval.getContext('2d');
    for (const cz of C.cizgiler) cizgiCiz(c, cz, olcek, x0, y0);
    const url = tuval.toDataURL('image/png');
    return { url, oran: en / boy, png: BD.b64Coz(url.split(',')[1]) };
  }

  el.imzaKullan.addEventListener('click', () => {
    const imza = imzaUret();
    if (!imza) return;
    I.imza = imza;
    if (el.imzaSakla.checked) {
      try { localStorage.setItem(IMZA_ANAHTAR, JSON.stringify({ url: imza.url, oran: imza.oran })); }
      catch (e) { bildir('İmza bu cihazda saklanamadı; yine de bu belgede kullanılabilir.'); }
    }
    pencereKapat(el.imzaPencere);
    if (I.pdf) imzaYerlestir(); else iCiz();
  });

  /* ---------- Bilgi penceresi ---------- */

  const kurulu = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function cihaz() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return { ios, android: /Android/.test(ua), edge: /Edg\//.test(ua), windows: /Windows/.test(ua) };
  }
  function bilgiAc() {
    const sakli = sakliImzaOku();
    el.sakliImzaBolum.hidden = !sakli;
    if (sakli) el.sakliImzaResim.src = sakli.url;
    const c = cihaz();
    let yazi = '';
    if (!kurulu()) {
      if (c.ios) yazi = 'Safari’de Paylaş düğmesine, ardından “Ana Ekrana Ekle”ye dokunun. Uygulama ana ekranda kendi simgesiyle açılır.';
      else if (c.android) yazi = 'Tarayıcı menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle” seçeneğine dokunun.';
      else if (c.edge) yazi = 'Edge menüsünde Uygulamalar bölümünden “Bu siteyi uygulama olarak yükle”yi seçin. Uygulama başlat menüsüne ve görev çubuğuna eklenebilir.';
      else if (c.windows) yazi = 'Tarayıcının adres çubuğundaki yükleme simgesine tıklayın ya da menüden “Uygulama olarak yükle”yi seçin.';
    }
    el.kurulumYazi.textContent = yazi;
    el.kurulum.hidden = !yazi;
    pencereAc(el.bilgiPencere);
  }
  el.bilgiAc.addEventListener('click', bilgiAc);
  el.bilgiKapat.addEventListener('click', () => pencereKapat(el.bilgiPencere));
  el.sakliImzaSil.addEventListener('click', () => {
    try { localStorage.removeItem(IMZA_ANAHTAR); } catch (e) { /* önemsiz */ }
    I.imza = null;
    el.sakliImzaBolum.hidden = true;
    iCiz();
    bildir('Saklanan imza silindi.');
  });

  /* ---------- Başlangıç ---------- */

  // Telefonlarda tür süzgeci kaldırılır: iOS ve Android, tanımadığı .udf
  // uzantısını seçilemez gösterebiliyor. Süzgeç olmayınca fotoğraf çekme ve
  // galeriden seçme de aynı pencerede sunulur. Dosyanın türü içeriğinden anlaşılır.
  if (cihaz().ios || cihaz().android) document.querySelectorAll('input[type="file"]').forEach(g => g.removeAttribute('accept'));

  // Sayfanın dışına bırakılan dosya tarayıcıda açılmasın.
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  dCiz(); bCiz(); iCiz();
  sekmeAc('donustur');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
