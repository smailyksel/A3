/* Belge Dönüştür: dönüştürme, birleştirme ve imza basma işlemleri.

   Bütün işlemler tarayıcının içinde yapılır; dosyalar cihazdan çıkmaz.
   "dosya" her yerde { ad, veri (Uint8Array), tur } biçimindedir. */

(function (K) {
  'use strict';
  const BD = K.BD;

  // Hangi türden hangi biçimlere geçilebildiği.
  BD.HEDEFLER = {
    docx: ['pdf', 'udf'],
    udf: ['docx', 'pdf'],
    pdf: ['docx', 'udf'],
    resim: ['pdf', 'docx', 'udf', 'jpg', 'png'],
  };
  BD.HEDEF_ADI = { pdf: 'PDF', docx: 'Word', udf: 'UDF', jpg: 'JPEG', png: 'PNG' };

  BD.dosyaHazirla = async function (dosya) {
    const veri = await BD.oku(dosya);
    const tur = await BD.turBul(veri, dosya.name);
    return { ad: dosya.name || 'belge', veri, tur, boyut: veri.length };
  };

  // Tek resimden, resmi sayfaya sığdıran bir belge modeli kurar.
  async function resimModeli(bayt, hedef) {
    const r = await BD.resimHazirla(bayt, { sinir: 2400, tip: 'jpeg', kalite: 0.88 });
    const belge = BD.yeniBelge(), s = belge.sayfa;
    if (hedef !== 'udf' && r.pxEn > r.pxBoy * 1.15) { s.en = BD.A4.boy; s.boy = BD.A4.en; }
    s.sol = s.sag = s.ust = s.alt = 28.35;
    const icEn = s.en - s.sol - s.sag, icBoy = s.boy - s.ust - s.alt - 24;
    const oran = Math.min(icEn / r.pxEn, icBoy / r.pxBoy);
    belge.bloklar = [BD.paragraf([{ resim: r, en: r.pxEn * oran, boy: r.pxBoy * oran }], { hiza: 'orta' })];
    return belge;
  }

  // Her türü PDF'e getirir (birleştirme ve imzalama bunu kullanır).
  BD.pdfeCevir = async function (dosya) {
    if (dosya.tur === 'pdf') return dosya.veri;
    if (dosya.tur === 'resim') return BD.resimlerdenPdf([await BD.resimHazirla(dosya.veri, { sinir: 2400, tip: 'jpeg', kalite: 0.88 })]);
    if (dosya.tur === 'docx') return BD.pdfYaz(await BD.docxOku(dosya.veri), { baslik: BD.adDegistir(dosya.ad, '') });
    if (dosya.tur === 'udf') return BD.pdfYaz(await BD.udfOku(dosya.veri), { baslik: BD.adDegistir(dosya.ad, '') });
    throw new BD.Hata('Bu dosya türü desteklenmiyor.');
  };

  // secenek.pdfMod: PDF'den Word ya da UDF'ye geçerken 'metin' ya da 'goruntu'.
  BD.cevir = async function (dosya, hedef, secenek, ilerleme) {
    const sec = secenek || {};
    if (!BD.HEDEFLER[dosya.tur] || !BD.HEDEFLER[dosya.tur].includes(hedef)) throw new BD.Hata('Bu dönüştürme yapılamıyor.');
    let veri, bilgi = '';
    if (hedef === 'jpg' || hedef === 'png') {
      veri = (await BD.resimHazirla(dosya.veri, { sinir: 4000, tip: hedef === 'png' ? 'png' : 'jpeg', kalite: 0.92 })).veri;
    } else if (hedef === 'pdf') {
      veri = await BD.pdfeCevir(dosya);
    } else {
      let belge;
      if (dosya.tur === 'resim') belge = await resimModeli(dosya.veri, hedef);
      else if (dosya.tur === 'pdf') {
        belge = await BD.pdfOku(dosya.veri, { mod: sec.pdfMod === 'goruntu' ? 'goruntu' : 'metin', sinir: hedef === 'udf' ? 1100 : 1700 }, ilerleme);
        if (sec.pdfMod !== 'goruntu') {
          if (belge.taranmis) bilgi = 'Bu PDF taranmış görüntüden oluşuyor; sayfalar resim olarak aktarıldı, metin düzenlenemez.';
          else if (belge.goruntuSayfa) bilgi = belge.goruntuSayfa + ' sayfa taranmış olduğu için resim olarak aktarıldı.';
        }
      } else belge = dosya.tur === 'docx' ? await BD.docxOku(dosya.veri) : await BD.udfOku(dosya.veri);
      if (hedef === 'udf') { await BD.resimleriHazirla(belge); await BD.udfResimleriKucult(belge); veri = await BD.udfYaz(belge); }
      else veri = await BD.docxYaz(belge);
    }
    return { ad: BD.adDegistir(dosya.ad, BD.UZANTI[hedef]), veri, tip: BD.MIME[hedef], bilgi };
  };

  // Dosyaları verilen sırayla tek PDF'te toplar.
  BD.birlestir = async function (dosyalar, ilerleme) {
    const PDFLib = await BD.pdfLib();
    const hedef = await PDFLib.PDFDocument.create();
    hedef.setProducer('Belge Dönüştür');
    for (let i = 0; i < dosyalar.length; i++) {
      const d = dosyalar[i];
      if (ilerleme) ilerleme(i + 1, dosyalar.length, d.ad);
      if (d.tur === 'resim') {
        await BD.resimSayfasiEkle(hedef, await BD.resimHazirla(d.veri, { sinir: 2400, tip: 'jpeg', kalite: 0.88 }));
        continue;
      }
      const bayt = await BD.pdfeCevir(d);
      let kaynak;
      try { kaynak = await PDFLib.PDFDocument.load(bayt, { ignoreEncryption: true }); }
      catch (e) { throw new BD.Hata('“' + d.ad + '” açılamadı; dosya bozuk olabilir.'); }
      if (kaynak.isEncrypted) throw new BD.Hata('“' + d.ad + '” şifreli olduğu için birleştirilemedi.');
      const sayfalar = await hedef.copyPages(kaynak, kaynak.getPageIndices());
      sayfalar.forEach(s => hedef.addPage(s));
    }
    return { veri: await hedef.save(), sayfa: hedef.getPageCount() };
  };

  // İmza görüntülerini sayfalara basar.
  // yerlesim: { sayfa (0'dan), x, y, en (sayfanın görünen halinin oranları; sol üstten), png }
  BD.imzaBas = async function (pdfBayt, yerlesimler) {
    const PDFLib = await BD.pdfLib();
    let doc;
    try { doc = await PDFLib.PDFDocument.load(pdfBayt, { ignoreEncryption: true }); }
    catch (e) { throw new BD.Hata('PDF açılamadı; dosya bozuk olabilir.'); }
    if (doc.isEncrypted) throw new BD.Hata('Bu PDF şifreli; şifresi kaldırılmadan imza eklenemez.');
    const gomulu = new Map();
    for (const y of yerlesimler) {
      if (y.sayfa < 0 || y.sayfa >= doc.getPageCount()) continue;
      const sayfa = doc.getPage(y.sayfa);
      let g = gomulu.get(y.png);
      if (!g) { g = await doc.embedPng(y.png); gomulu.set(y.png, g); }
      const kutu = sayfa.getCropBox();
      const aci = ((sayfa.getRotation().angle % 360) + 360) % 360;
      const W = kutu.width, H = kutu.height;
      const yan = aci === 90 || aci === 270;
      const gEn = yan ? H : W, gBoy = yan ? W : H;
      // İmzanın yüksekliği kendi oranından hesaplanır; sayfa biçimi ne olursa olsun bozulmaz.
      // (u, v): imzanın sol alt köşesi, sayfanın ekranda görünen halinde.
      const w = y.en * gEn, h = w * g.height / g.width;
      const u = y.x * gEn, v = Math.min(gBoy, y.y * gBoy + h);
      let px, py;
      if (aci === 90) { px = v; py = u; }
      else if (aci === 180) { px = W - u; py = v; }
      else if (aci === 270) { px = W - v; py = H - u; }
      else { px = u; py = H - v; }
      sayfa.drawImage(g, { x: kutu.x + px, y: kutu.y + py, width: w, height: h, rotate: PDFLib.degrees(aci) });
    }
    return await doc.save();
  };
})(typeof self !== 'undefined' ? self : this);
