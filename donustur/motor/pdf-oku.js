/* Belge Dönüştür: PDF okuyucusu.

   PDF'de paragraf yoktur; yalnızca sayfaya yerleştirilmiş metin parçaları
   vardır. Burada parçalar önce satırlara, satırlar da paragraflara
   toplanır: bir satırın sonuna sonraki satırın ilk kelimesi sığmıyorsa o
   satır aynı paragrafın devamı sayılır. Hiza (ortalı, sağa yaslı, iki yana
   yaslı), girinti, kalın ve italik yazı ile satır başındaki sütun boşlukları
   (sekme) geri kazanılır.

   Metin katmanı olmayan (taranmış) sayfalar görüntü olarak aktarılır. */

(function (K) {
  'use strict';
  const BD = K.BD;

  BD.pdfAc = async function (bayt) {
    const pdfjs = await BD.pdfjs();
    try {
      return await pdfjs.getDocument({ data: bayt.slice(0), isEvalSupported: false, useSystemFonts: true }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new BD.Hata('Bu PDF şifreli; şifresi kaldırılmadan işlenemez.');
      throw new BD.Hata('PDF açılamadı; dosya bozuk olabilir.');
    }
  };

  // Sayfayı tuvale çizer. "sinir": uzun kenarın piksel sınırı.
  BD.pdfSayfaCiz = async function (sayfa, sinir) {
    const g1 = sayfa.getViewport({ scale: 1 });
    const olcek = Math.min(4, sinir / Math.max(g1.width, g1.height));
    const g = sayfa.getViewport({ scale: olcek });
    const tuval = document.createElement('canvas');
    tuval.width = Math.max(1, Math.round(g.width)); tuval.height = Math.max(1, Math.round(g.height));
    const c = tuval.getContext('2d', { alpha: false });
    c.fillStyle = '#fff'; c.fillRect(0, 0, tuval.width, tuval.height);
    await sayfa.render({ canvasContext: c, viewport: g }).promise;
    return tuval;
  };

  BD.pdfSayfaResmi = async function (sayfa, sinir, kalite) {
    const tuval = await BD.pdfSayfaCiz(sayfa, sinir);
    const veri = await BD.tuvalBayt(tuval, 'image/jpeg', kalite || 0.85);
    const r = { veri, tip: 'jpeg', pxEn: tuval.width, pxBoy: tuval.height };
    tuval.width = tuval.height = 0;
    return r;
  };

  const LISTE_BASI = /^(\(?\d{1,3}[.)\-]|\(?[a-zçğıöşü][.)]|[IVXLC]{1,5}[.)\-]|[-–—•▪■●○*])\s/;
  const SAYFA_NO = /^\s*(sayfa\s*)?[-–]?\s*\d{1,4}\s*([/|\-–]\s*\d{1,4})?\s*[-–]?\s*$/i;

  /* ---------- Sayfadaki metin parçalarından satırlar ---------- */

  async function sayfaSatirlari(pdfjs, sayfa) {
    const g = sayfa.getViewport({ scale: 1 });
    const ic = await sayfa.getTextContent();
    if (!ic.items.some(o => o.str && o.str.trim())) return { g, satirlar: [] };
    // Yazı tipi adları (kalın, italik ayrımı için) işlem listesi hazırlanınca erişilir olur.
    try { await sayfa.getOperatorList(); } catch (e) { /* adlar olmadan sürer */ }
    const ytBilgi = {};
    const yt = ad => {
      if (ytBilgi[ad]) return ytBilgi[ad];
      let adi = '', k = false, i = false;
      try {
        if (sayfa.commonObjs.has(ad)) { const f = sayfa.commonObjs.get(ad); adi = (f && f.name) || ''; k = !!(f && (f.bold || f.black)); i = !!(f && f.italic); }
      } catch (e) { /* bilgi yok */ }
      const stil = (ic.styles && ic.styles[ad]) || {};
      const b = {
        k: k || /bold|black|heavy|semibold|demi(?!r)/i.test(adi), i: i || /italic|oblique/i.test(adi),
        // Aile, yazı tipinin adından anlaşılır; adı tanınmayan yazı tipi Times sayılır.
        yt: /calibri|carlito|aptos/i.test(adi) ? 'Calibri'
          : /sans|arial|helvet|verdana|tahoma|segoe|roboto|lato|gothic|grotesk|trebuchet/i.test(adi) ? 'Arial'
          : (/courier|mono|consol/i.test(adi) || (!adi && stil.fontFamily === 'monospace')) ? 'Courier New' : BD.YT,
      };
      return (ytBilgi[ad] = b);
    };

    const parcalar = [];
    for (const o of ic.items) {
      if (!o.str) continue;
      const t = pdfjs.Util.transform(g.transform, o.transform);
      const boyut = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
      if (!(boyut > 1) || Math.abs(t[1]) > Math.abs(t[0]) * 0.2) continue;   // döndürülmüş yazı alınmaz
      const b = yt(o.fontName);
      // Simge yazı tiplerindeki madde işaretleri özel kod alanında durur; noktaya çevrilir.
      parcalar.push({ m: o.str.replace(/[\uE000-\uF8FF]/g, '•'), x: t[4], y: t[5], w: o.width, boyut: Math.round(boyut * 2) / 2, k: b.k, i: b.i, yt: b.yt });
    }
    parcalar.sort((a, b) => a.y - b.y || a.x - b.x);

    // Aynı taban çizgisindeki parçalar bir satırdır.
    const ham = [];
    for (const q of parcalar) {
      if (!q.m.trim() && !q.w) continue;
      const son = ham[ham.length - 1];
      if (son && Math.abs(son.y - q.y) < 0.35 * Math.min(son.boyut, q.boyut)) son.og.push(q);
      else ham.push({ y: q.y, boyut: q.boyut, og: [q] });
    }

    const satirlar = [];
    for (const h of ham) {
      h.og.sort((a, b) => a.x - b.x);
      const st = { y: h.y, parcalar: [], sekmeler: [], x0: 0, x1: 0, boyut: 0, sayfaBoy: g.height };
      let onceki = null;
      const ekle = (m, q) => {
        const son = st.parcalar[st.parcalar.length - 1];
        if (son && son.k === q.k && son.i === q.i && son.boyut === q.boyut && son.yt === q.yt) son.m += m;
        else st.parcalar.push({ m, k: q.k, i: q.i, boyut: q.boyut, yt: q.yt });
      };
      for (const q of h.og) {
        if (!q.m.trim()) continue;
        if (onceki) {
          const aralik = q.x - (onceki.x + onceki.w);
          const olcu = Math.max(onceki.boyut, q.boyut);
          if (aralik > Math.max(2 * olcu, 20)) { ekle('\t', onceki); st.sekmeler.push(q.x); }
          else if (aralik > 0.18 * olcu && !/\s$/.test(onceki.m) && !/^\s/.test(q.m)) ekle(' ', onceki);
        } else st.x0 = q.x;
        ekle(q.m, q);
        st.x1 = Math.max(st.x1, q.x + q.w);
        onceki = q;
      }
      if (!st.parcalar.length) continue;
      st.parcalar[0].m = st.parcalar[0].m.replace(/^\s+/, '');
      const sp = st.parcalar[st.parcalar.length - 1];
      sp.m = sp.m.replace(/\s+$/, '');
      st.parcalar = st.parcalar.filter(p => p.m);
      if (!st.parcalar.length) continue;
      st.metin = st.parcalar.map(p => p.m).join('');
      // En çok harf taşıyan boyut satırın boyutudur.
      const agirlik = {};
      for (const p of st.parcalar) agirlik[p.boyut] = (agirlik[p.boyut] || 0) + p.m.length;
      st.boyut = +Object.keys(agirlik).sort((a, b) => agirlik[b] - agirlik[a])[0];
      const ilkKelime = (/^\S+/.exec(st.metin.replace(/\t.*$/, '')) || [''])[0];
      st.ilkKelime = ilkKelime.length * (st.x1 - st.x0) / Math.max(1, st.metin.length);
      satirlar.push(st);
    }
    // Sayfa numarası gibi kenar yazıları atılır.
    const temiz = satirlar.filter(st => !((st.y < g.height * 0.07 || st.y > g.height * 0.92) && SAYFA_NO.test(st.metin)));
    return { g, satirlar: temiz };
  }

  /* ---------- Satırlardan paragraflar ---------- */

  function paragraflar(sayfalar, sol, sag) {
    const genislik = sag - sol;
    const bloklar = [];
    let p = null;   // { satirlar: [...] }
    const ortali = st => { const a = st.x0 - sol, b = sag - st.x1; return a > 10 && Math.abs(a - b) < Math.max(4, genislik * 0.012); };

    const kapat = () => {
      if (!p) return;
      const ls = p.satirlar, ilk = ls[0], son = ls[ls.length - 1];
      const par = BD.paragraf([]);
      const digerSol = ls.length > 1 ? Math.min(...ls.slice(1).map(s => s.x0)) : ilk.x0;
      if (ls.length === 1) {
        const a = ilk.x0 - sol, b = sag - ilk.x1;
        if (ortali(ilk)) par.hiza = 'orta';
        else if (b < 3 && a > genislik * 0.25 && !ilk.sekmeler.length) par.hiza = 'sag';
        else if (a > 3) { if (a <= 60 && !ilk.sekmeler.length) par.ilk = a; else par.sol = a; }
      } else {
        const dolu = ls.slice(0, -1).every(s => sag - s.x1 < 2.5);
        par.hiza = dolu ? 'iki' : 'sol';
        par.sol = Math.max(0, digerSol - sol);
        if (par.sol < 2) par.sol = 0;
        par.ilk = ilk.x0 - (sol + par.sol);
        if (Math.abs(par.ilk) < 2) par.ilk = 0;
        // Satırlar arası açıklık tek satır aralığından belirgin büyükse korunur.
        const kat = (son.y - ilk.y) / (ls.length - 1) / (1.15 * ilk.boyut);
        if (kat > 1.25 && kat < 3.2) par.aralik = Math.round(kat * 20) / 20;
      }
      // Sütun boşlukları sekme durağı olur.
      // Tek satırda son sütun sağ kenara dayanıyorsa durağı sağa yaslıdır; böylece
      // yazı tipi değişse de satır taşmaz.
      const duraklar = [];
      for (const s of ls) s.sekmeler.forEach((x, j) => {
        const sagda = ls.length === 1 && j === s.sekmeler.length - 1 && sag - s.x1 < 3;
        const yer = sagda ? Math.round(genislik * 10) / 10 : Math.round((x - sol) * 10) / 10;
        if (yer > 1 && !duraklar.some(d => Math.abs(d.yer - yer) < 1.5) && Math.abs(yer - par.sol) > 1.5) duraklar.push({ yer, tip: sagda ? 'sag' : 'sol' });
      });
      if (duraklar.length) par.sekmeler = duraklar.sort((a, b) => a.yer - b.yer);
      // Satırlar tek metin olarak birleştirilir.
      ls.forEach((s, i) => {
        s.parcalar.forEach((q, j) => {
          let m = q.m;
          if (i > 0 && j === 0) {
            const onceki = par.parcalar[par.parcalar.length - 1];
            // Kelime ortasından tireyle bölünmüş satır boşluksuz, diğerleri boşlukla birleşir.
            if (onceki && (!/-$/.test(onceki.m) || /\s-$/.test(onceki.m)) && !/\s$/.test(onceki.m)) m = ' ' + m;
          }
          const x = par.parcalar[par.parcalar.length - 1];
          if (x && !!x.k === q.k && !!x.i === q.i && x.boyut === q.boyut && x.yt === q.yt) x.m += m;
          else { const y = { m, boyut: q.boyut, yt: q.yt }; if (q.k) y.k = true; if (q.i) y.i = true; par.parcalar.push(y); }
        });
      });
      par.bos = { boyut: ilk.boyut, yt: ilk.parcalar[0].yt };
      par._ilk = ilk; par._son = son;
      bloklar.push(par);
      p = null;
    };

    const devam = (a, b, ayniSayfa) => {
      if (Math.abs(a.boyut - b.boyut) > 0.6) return false;
      if (LISTE_BASI.test(b.metin)) return false;
      if (ortali(a) && sag - a.x1 > 6) return false;
      if (b.ilkKelime + 0.2 * a.boyut <= sag - a.x1) return false;     // ilk kelime önceki satıra sığardı
      if (ayniSayfa) {
        const dy = b.y - a.y;
        if (dy <= 0 || dy > 2.1 * Math.max(a.boyut, b.boyut)) return false;
        if (p.satirlar.length > 1) {
          const adim = p.satirlar[1].y - p.satirlar[0].y;
          if (dy > adim * 1.25 + 0.5) return false;
          if (b.x0 > p.satirlar[1].x0 + 3) return false;
        } else if (b.x0 > a.x0 + 3) {
          // Asılı girinti: yalnızca etiketli ya da listeli satırın devamında kabul edilir.
          const asili = a.sekmeler.some(x => Math.abs(x - b.x0) < 2.5) || LISTE_BASI.test(a.metin);
          if (!asili) return false;
        }
      } else if (p.satirlar.length > 1 ? b.x0 > p.satirlar[1].x0 + 3 : b.x0 > a.x0 + 3) return false;
      return true;
    };

    let oncekiSatir = null;
    sayfalar.forEach((sayfa, sayfaNo) => {
      if (sayfa.resim) {
        kapat();
        if (bloklar.length) bloklar.push({ tur: 'kirma' });
        bloklar.push(BD.paragraf([{ resim: sayfa.resim, en: 0, boy: 0, _tamSayfa: true }], { hiza: 'orta' }));
        bloklar.push({ tur: 'kirma' });
        oncekiSatir = null;
        return;
      }
      sayfa.satirlar.forEach((st, i) => {
        const ayniSayfa = i > 0;
        if (p && oncekiSatir && devam(oncekiSatir, st, ayniSayfa)) p.satirlar.push(st);
        else {
          kapat();
          // Paragraflar arasındaki boşluk boş satır ya da aralık olarak korunur.
          if (ayniSayfa && oncekiSatir) {
            const adim = 1.15 * Math.max(oncekiSatir.boyut, st.boyut);
            const fazla = (st.y - oncekiSatir.y) - adim;
            const adet = Math.min(3, Math.round(fazla / adim));
            if (adet >= 1) for (let n = 0; n < adet; n++) bloklar.push(BD.paragraf([], { bos: { boyut: st.boyut } }));
            else if (fazla > 2) st._once = Math.min(24, fazla);
          }
          p = { satirlar: [st] };
        }
        oncekiSatir = st;
      });
    });
    kapat();
    while (bloklar.length && bloklar[bloklar.length - 1].tur === 'kirma') bloklar.pop();
    for (const b of bloklar) {
      if (b.tur !== 'p') continue;
      if (b._ilk && b._ilk._once) b.once = b._ilk._once;
      delete b._ilk; delete b._son;
    }
    return bloklar;
  }

  /* ---------- PDF'den model ---------- */

  // secenek.mod: 'metin' (düzenlenebilir metin; taranmış sayfalar görüntü olur)
  //              'goruntu' (her sayfa görüntü olarak aktarılır)
  // secenek.sinir: sayfa görüntülerinin uzun kenar piksel sınırı
  BD.pdfOku = async function (bayt, secenek, ilerleme) {
    const s = Object.assign({ mod: 'metin', sinir: 1700 }, secenek || {});
    const pdfjs = await BD.pdfjs();
    const pdf = await BD.pdfAc(bayt);
    try {
      const belge = BD.yeniBelge();
      const sayfalar = [];
      let metinli = 0;
      for (let no = 1; no <= pdf.numPages; no++) {
        if (ilerleme) ilerleme(no, pdf.numPages);
        const sayfa = await pdf.getPage(no);
        let kayit = null;
        if (s.mod !== 'goruntu') {
          const { g, satirlar } = await sayfaSatirlari(pdfjs, sayfa);
          if (satirlar.length) { kayit = { g, satirlar }; metinli++; }
        }
        if (!kayit) kayit = { g: sayfa.getViewport({ scale: 1 }), satirlar: [], resim: await BD.pdfSayfaResmi(sayfa, s.sinir) };
        sayfalar.push(kayit);
        sayfa.cleanup();
      }
      const ilkG = sayfalar[0].g;
      belge.sayfa.en = ilkG.width; belge.sayfa.boy = ilkG.height;
      belge.taranmis = metinli === 0;
      belge.goruntuSayfa = sayfalar.filter(x => x.resim).length;

      // Birden çok sayfada aynı yerde yinelenen kenar yazıları (antet, alt bilgi)
      // gövdeden ayrılır; belgenin üst ve alt bilgisi olur.
      const kenar = { u: null, a: null };
      const yazili = sayfalar.filter(x => x.satirlar.length);
      if (yazili.length >= 2) {
        const gruplar = {};
        for (const x of yazili) for (const st of x.satirlar) {
          const bolge = st.y < x.g.height * 0.12 ? 'u' : st.y > x.g.height * 0.9 ? 'a' : '';
          if (!bolge) continue;
          const ad = bolge + '|' + Math.round(st.y / 5) + '|' + st.metin.replace(/\d+/g, '#');
          (gruplar[ad] = gruplar[ad] || []).push({ st, sayfa: x });
        }
        const esik = Math.max(2, Math.ceil(yazili.length / 2));
        for (const ad in gruplar) {
          if (gruplar[ad].length < esik) continue;
          for (const { st } of gruplar[ad]) st._kenar = ad[0];
          (kenar[ad[0]] = kenar[ad[0]] || []).push(gruplar[ad][0].st);
          if (!gruplar[ad].some(k => k.sayfa === sayfalar[0])) kenar.ilkYok = true;
        }
        for (const x of yazili) x.satirlar = x.satirlar.filter(st => !st._kenar);
        metinli = sayfalar.filter(x => x.satirlar.length).length;
      }

      if (metinli) {
        // Yazı alanının sol ve sağ sınırı bütün sayfalardan çıkarılır.
        const dolu = sayfalar.filter(x => x.satirlar.length >= 4);
        const kaynak = dolu.length ? dolu : sayfalar.filter(x => x.satirlar.length);
        const sol = Math.min(...kaynak.map(x => Math.min(...x.satirlar.map(st => st.x0))));
        const sag = Math.max(...kaynak.map(x => Math.max(...x.satirlar.map(st => st.x1))));
        const ust = Math.min(...kaynak.map(x => Math.min(...x.satirlar.map(st => st.y - st.boyut))));
        const alt = Math.min(...kaynak.map(x => x.g.height - Math.max(...x.satirlar.map(st => st.y))));
        const sinirla = (v, vars) => (v > 14 && v < ilkG.width * 0.4 ? v : vars);
        belge.sayfa.sol = sinirla(sol, 56.7); belge.sayfa.sag = sinirla(ilkG.width - sag, 56.7);
        belge.sayfa.ust = sinirla(ust, 56.7); belge.sayfa.alt = sinirla(Math.max(28, alt - 6), 56.7);
        belge.bloklar = paragraflar(sayfalar, sol, sag);
        const kenarBlok = ls => (ls && ls.length ? paragraflar([{ satirlar: ls.sort((a, b) => a.y - b.y) }], sol, sag).filter(b => b.tur === 'p') : null);
        belge.ustbilgi = kenarBlok(kenar.u);
        belge.altbilgi = kenarBlok(kenar.a);
        if (belge.ustbilgi) belge.sayfa.ustbilgi = Math.max(14, Math.min(belge.sayfa.ust - 10, Math.min(...kenar.u.map(st => st.y - st.boyut))));
        if (belge.altbilgi) belge.sayfa.altbilgi = Math.max(14, Math.min(belge.sayfa.alt - 10, ilkG.height - Math.max(...kenar.a.map(st => st.y)) - 4));
        // İlk sayfada yer almayan kenar yazısı ilk sayfaya konmaz.
        if (kenar.ilkYok && (belge.ustbilgi || belge.altbilgi)) { belge.ilkFarkli = true; belge.ilkUstbilgi = null; belge.ilkAltbilgi = null; }
      } else {
        belge.sayfa.sol = belge.sayfa.sag = belge.sayfa.ust = belge.sayfa.alt = 14.2;
        belge.bloklar = paragraflar(sayfalar, 0, ilkG.width);
      }
      // Sayfa görüntüleri yazı alanını dolduracak boyutta yerleşir.
      const icEn = belge.sayfa.en - belge.sayfa.sol - belge.sayfa.sag, icBoy = belge.sayfa.boy - belge.sayfa.ust - belge.sayfa.alt - 24;
      BD.gez(belge.bloklar, p => {
        for (const x of p.parcalar) if (x._tamSayfa) {
          const oran = Math.min(icEn / x.resim.pxEn, icBoy / x.resim.pxBoy);
          x.en = x.resim.pxEn * oran; x.boy = x.resim.pxBoy * oran;
          delete x._tamSayfa;
        }
      });
      if (!belge.bloklar.length) belge.bloklar.push(BD.paragraf([]));
      return belge;
    } finally {
      try { await pdf.destroy(); } catch (e) { /* önemsiz */ }
    }
  };

  BD.pdfSayfaSayisi = async function (bayt) {
    const pdf = await BD.pdfAc(bayt);
    try { return pdf.numPages; } finally { try { await pdf.destroy(); } catch (e) { /* önemsiz */ } }
  };
})(typeof self !== 'undefined' ? self : this);
