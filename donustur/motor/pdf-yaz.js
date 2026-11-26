/* Belge Dönüştür: ortak modelden PDF üretir.

   Küçük bir dizgi motorudur: paragrafları satırlara böler (iki yana yaslama,
   girinti, sekme durakları), tabloları ve resimleri yerleştirir, sayfalara
   dağıtır, üst ve alt bilgiyi her sayfaya basar. Metin PDF'e gerçek metin
   olarak yazılır; aranabilir ve kopyalanabilir.

   Yazı tipleri uygulamayla birlikte gelir: Times New Roman yerine ölçüleri
   aynı olan serif, Arial yerine sans, Calibri yerine yalın aile kullanılır.
   Böylece satır sonları Word'dekiyle büyük ölçüde örtüşür. */

(function (K) {
  'use strict';
  const BD = K.BD;

  const YERINE = { '\u20BA': 'TL', '\u2011': '-', '\u00AD': '', '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u2212': '-', '→': '>', '\u2713': '√', '\u2714': '√', '\u27A2': '›', '\u2023': '›', '\u25B6': '›', '\u2043': '-', '\u2219': '·', '\u25E6': 'o', '\u25AB': '▪', '\uFFFC': '' };

  function aile(ad) {
    const a = String(ad || '').toLowerCase();
    if (/calibri|carlito|aptos|candara|corbel|segoe|lato|trebuchet|gill|optima/.test(a)) return 'yalin';
    if (/arial|helvet|verdana|tahoma|sans|courier|consol|mono|franklin|gothic|futura|roboto|inter\b|dialog/.test(a)) return 'sans';
    return 'serif';
  }
  const anahtar = x => aile(x.yt) + '-' + (x.k ? (x.i ? 'kalinitalik' : 'kalin') : (x.i ? 'italik' : 'normal'));

  const ytBaytlar = {};
  async function ytBayt(ad) {
    if (!ytBaytlar[ad]) {
      let yanit;
      try { yanit = await fetch(BD.kok + 'yazitipi/' + ad + '.ttf'); } catch (e) { yanit = null; }
      if (!yanit || !yanit.ok) throw new BD.Hata('Belge yazı tipi yüklenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.');
      ytBaytlar[ad] = new Uint8Array(await yanit.arrayBuffer());
    }
    return ytBaytlar[ad];
  }

  // PDF yazı tipini ölçü bilgileriyle sarar. Harf genişlikleri önbelleğe alınır.
  function sar(pdf) {
    const f = pdf.embedder.font, upm = f.unitsPerEm;
    const genislik = new Map();
    const gen = kod => {
      let g = genislik.get(kod);
      if (g === undefined) { g = f.hasGlyphForCodePoint(kod) ? f.glyphForCodePoint(kod).advanceWidth / upm : -1; genislik.set(kod, g); }
      return g;
    };
    return {
      pdf, gen,
      cik: f.ascent / upm, in: -f.descent / upm, ara: (f.lineGap || 0) / upm,
      olcu(m, boyut) { let w = 0; for (let i = 0; i < m.length; i++) { const g = gen(m.charCodeAt(i)); if (g > 0) w += g; } return w * boyut; },
      // Yazı tipinde bulunmayan karakterleri karşılığıyla değiştirir.
      uygun(m) {
        let tamam = true;
        for (let i = 0; i < m.length; i++) if (gen(m.charCodeAt(i)) < 0) { tamam = false; break; }
        if (tamam) return m;
        let s = '';
        for (const h of m) {
          if (h.length === 1 && gen(h.charCodeAt(0)) >= 0) { s += h; continue; }
          let y = YERINE[h];
          if (y == null) { const ayrik = h.normalize('NFKD').replace(/[\u0300-\u036F]/g, ''); y = ayrik && ayrik !== h && Array.from(ayrik).every(c => c.length === 1 && gen(c.charCodeAt(0)) >= 0) ? ayrik : '?'; }
          s += y;
        }
        return s;
      },
    };
  }

  const renkCoz = r => { const n = parseInt(String(r || '#000000').slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const s2 = n => (Math.round(n * 100) / 100).toString();

  BD.pdfYaz = async function (belge, secenek) {
    const PDFLib = await BD.pdfLib();
    const { PDFDocument, PDFOperator, rgb } = PDFLib;
    await BD.resimleriHazirla(belge);
    const doc = await PDFDocument.create();
    doc.registerFontkit(K.fontkit);
    if (secenek && secenek.baslik) doc.setTitle(secenek.baslik);
    doc.setProducer('Belge Dönüştür');
    doc.setCreator('Belge Dönüştür');

    /* ----- Yazı tipleri ve resimler ----- */
    const gerekli = new Set(['serif-normal']);
    const resimParcalari = [];
    for (const grup of BD.tumBloklar(belge)) BD.gez(grup, p => {
      for (const x of p.parcalar) { if (x.resim) resimParcalari.push([p, x]); else gerekli.add(anahtar(x)); }
      if (p.bos && p.bos.yt) gerekli.add(aile(p.bos.yt) + '-normal');
    });
    const yt = {};
    await Promise.all([...gerekli].map(async a => { yt[a] = sar(await doc.embedFont(await ytBayt(a), { subset: false })); }));
    const yedekYt = yt['serif-normal'];

    const gomulu = new Map();
    for (const [p, x] of resimParcalari) {
      const r = x.resim;
      try {
        let g = gomulu.get(r.veri);
        if (!g) { g = r.tip === 'png' ? await doc.embedPng(r.veri) : await doc.embedJpg(r.veri); gomulu.set(r.veri, g); }
        r.pdf = g;
        if (!r.pxEn) { r.pxEn = g.width; r.pxBoy = g.height; }
      } catch (e) {
        try {
          const h = await BD.resimHazirla(r.veri, { sinir: 3000, tip: 'jpeg' });
          r.pdf = await doc.embedJpg(h.veri); r.pxEn = h.pxEn; r.pxBoy = h.pxBoy;
        } catch (e2) { p.parcalar.splice(p.parcalar.indexOf(x), 1); }
      }
    }

    const s = belge.sayfa;
    const icEn = s.en - s.sol - s.sag;
    const sekmeAdimi = belge.sekme > 4 ? belge.sekme : 36;

    /* ----- Paragraf: parçalara ayırma ----- */
    function ogeler(p, genislik, enYuksek, alanlar) {
      const liste = [];
      for (const x of p.parcalar) {
        if (x.resim) {
          const r = x.resim;
          if (!r.pdf) continue;
          let en = x.en > 0 ? x.en : r.pxEn * 0.75, boy = x.boy > 0 ? x.boy : en * r.pxBoy / r.pxEn;
          const oran = Math.min(1, genislik / en, enYuksek / boy);
          liste.push({ t: 'r', r, w: en * oran, h: boy * oran });
          continue;
        }
        const m = x.alan ? String(alanlar && alanlar[x.alan] != null ? alanlar[x.alan] : '') : x.m;
        if (!m) continue;
        const f = yt[anahtar(x)] || yedekYt, tam = x.boyut > 0 ? x.boyut : 12;
        const kucuk = x.ust || x.alt;
        const st = { f, boyut: kucuk ? tam * 0.62 : tam, tam, renk: x.renk || '#000000', a: !!x.a, u: !!x.u, zemin: x.zemin || null, kay: x.ust ? tam * 0.36 : x.alt ? -tam * 0.12 : 0 };
        const re = /\t|\n| +|[^\t\n ]+/g;
        let e;
        while ((e = re.exec(m))) {
          const d = e[0];
          if (d === '\t') liste.push({ t: 's', w: 0, st });
          else if (d === '\n') liste.push({ t: 'y', w: 0, st });
          else if (d[0] === ' ') liste.push({ t: 'b', m: d, w: f.olcu(d, st.boyut), st });
          else {
            // Kısa çizgiden sonra satır bölünebilir.
            const temiz = f.uygun(d);
            let bas = 0;
            for (let i = 1; i < temiz.length - 1; i++) {
              if (temiz[i] === '-' && temiz[i - 1] !== '-' && /[^\s\-.,;:)]/.test(temiz[i + 1])) {
                const dilim = temiz.slice(bas, i + 1);
                liste.push({ t: 'k', m: dilim, w: f.olcu(dilim, st.boyut), st, sonraBol: true });
                bas = i + 1;
              }
            }
            const kalan = temiz.slice(bas);
            if (kalan) liste.push({ t: 'k', m: kalan, w: f.olcu(kalan, st.boyut), st });
          }
        }
      }
      return liste;
    }

    function sekmeBul(p, x, solKenar, sagSinir) {
      let en = null;
      for (const d of p.sekmeler || []) if (d.yer > x + 0.1) { en = d; break; }
      if ((p.ilk || 0) < 0 && x < solKenar - 0.1 && (!en || en.yer > solKenar)) en = { yer: solKenar, tip: 'sol' };
      if (en) return en;
      const yer = (Math.floor((x + 0.1) / sekmeAdimi) + 1) * sekmeAdimi;
      return { yer: Math.min(yer, Math.max(sagSinir, x)), tip: 'sol' };
    }

    /* ----- Paragraf: satırlara bölme ----- */
    function satirlar(p, liste, genislik) {
      const solKenar = Math.max(0, p.sol || 0), sagSinir = Math.max(solKenar + 20, genislik - Math.max(0, p.sag || 0));
      const cikti = [];
      let satir = null, x = 0;
      const ac = ilkSatir => { x = Math.max(0, solKenar + (ilkSatir ? (p.ilk || 0) : 0)); satir = { bas: x, og: [], zorla: false }; };
      const kapat = zorla => { satir.zorla = zorla; cikti.push(satir); };
      const dolu = () => satir.og.some(q => q.t === 'k' || q.t === 'r');
      ac(true);
      let i = 0;
      while (i < liste.length) {
        const o = liste[i];
        if (o.t === 'y') { satir.og.push({ t: 'y', x, w: 0, st: o.st }); kapat(true); ac(false); i++; continue; }
        if (o.t === 's') {
          const d = sekmeBul(p, x, solKenar, sagSinir);
          let w = d.yer - x;
          if (d.tip !== 'sol') {
            let W = 0;
            for (let j = i + 1; j < liste.length && liste[j].t !== 's' && liste[j].t !== 'y'; j++) W += liste[j].w;
            w = Math.max(0, d.yer - (d.tip === 'sag' ? W : W / 2) - x);
          }
          if (x + w > sagSinir + 0.01 && dolu()) { kapat(false); ac(false); continue; }
          satir.og.push({ t: 's', x, w, st: o.st }); x += w; i++; continue;
        }
        if (o.t === 'b') { satir.og.push({ t: 'b', m: o.m, x, w: o.w, dogal: o.w, st: o.st }); x += o.w; i++; continue; }
        // Kelime birimi: aralarında boşluk olmayan parçalar birlikte taşınır.
        let j = i, W = 0;
        while (j < liste.length) {
          const q = liste[j];
          if (q.t !== 'k' && q.t !== 'r') break;
          if (q.t === 'r' && j > i) break;
          W += q.w; j++;
          if (q.t === 'r' || q.sonraBol) break;
        }
        if (x + W > sagSinir + 0.01) {
          if (dolu()) { kapat(false); ac(false); continue; }
          // Satıra sığmayan uzun kelime harf harf bölünür.
          if (o.t === 'k' && x + o.w > sagSinir + 0.01) {
            const harfler = Array.from(o.m);
            let n = 0, w = 0;
            while (n < harfler.length) {
              const hw = o.st.f.olcu(harfler[n], o.st.boyut);
              if (n > 0 && x + w + hw > sagSinir) break;
              w += hw; n++;
            }
            if (n < harfler.length) {
              satir.og.push({ t: 'k', m: harfler.slice(0, n).join(''), x, w, st: o.st });
              liste[i] = Object.assign({}, o, { m: harfler.slice(n).join(''), w: o.w - w });
              kapat(false); ac(false); continue;
            }
          }
          satir.og.push(Object.assign({}, o, { x })); x += o.w; i++; continue;
        }
        for (; i < j; i++) { satir.og.push(Object.assign({}, liste[i], { x })); x += liste[i].w; }
      }
      kapat(true);

      // Hizalama
      cikti.forEach(st => {
        let son = st.og.length;
        while (son > 0 && (st.og[son - 1].t === 'b' || st.og[son - 1].t === 'y')) son--;
        st.son = son;
        const bitis = son ? st.og[son - 1].x + st.og[son - 1].w : st.bas;
        const bosluk = sagSinir - bitis;
        let kay = 0;
        if (p.hiza === 'orta') kay = bosluk / 2;
        else if (p.hiza === 'sag') kay = bosluk;
        else if (p.hiza === 'iki' && !st.zorla && bosluk > 0) {
          let basla = 0;
          for (let k = son - 1; k >= 0; k--) if (st.og[k].t === 's') { basla = k + 1; break; }
          let adet = 0;
          for (let k = basla; k < son; k++) if (st.og[k].t === 'b') adet++;
          if (adet) {
            const ek = bosluk / adet;
            let kayma = 0;
            for (let k = basla; k < son; k++) { const q = st.og[k]; q.x += kayma; if (q.t === 'b') { q.w += ek; q.esnek = true; kayma += ek; } }
          }
        }
        if (kay) for (const q of st.og) q.x += kay;
        st.solKenar = solKenar; st.sagSinir = sagSinir;
      });
      return cikti;
    }

    /* ----- Paragraf: satır kutuları ----- */
    function paragrafDiz(p, genislik, enYuksek, alanlar) {
      const liste = ogeler(p, Math.max(20, genislik - Math.max(0, p.sol || 0) - Math.max(0, p.sag || 0)), enYuksek, alanlar);
      const st = satirlar(p, liste, genislik);
      const bosF = (p.bos && yt[aile(p.bos.yt) + '-normal']) || yedekYt, bosBoyut = (p.bos && p.bos.boyut > 0) ? p.bos.boyut : 12;
      const kutular = [];
      st.forEach((satir, sira) => {
        let cik = 0, inis = 0, ara = 0, resimBoy = 0, yazi = false;
        for (const q of satir.og) {
          if (q.t === 'r') { resimBoy = Math.max(resimBoy, q.h); continue; }
          if (q.t === 'y' && satir.og.length > 1) continue;
          const b = q.st;
          yazi = true;
          cik = Math.max(cik, b.f.cik * b.tam); inis = Math.max(inis, b.f.in * b.tam); ara = Math.max(ara, b.f.ara * b.tam);
        }
        if (!yazi && !resimBoy) { cik = bosF.cik * bosBoyut; inis = bosF.in * bosBoyut; ara = bosF.ara * bosBoyut; }
        const dogal = cik + inis + ara;
        let h;
        if (p.sabit && p.sabit.deger > 0) h = p.sabit.enAz ? Math.max(dogal, p.sabit.deger) : p.sabit.deger;
        else h = dogal * (p.aralik > 0 ? p.aralik : 1);
        if (resimBoy) h = Math.max(h, resimBoy + inis + 1);
        const ust = sira === 0 ? Math.max(0, p.once || 0) : 0, alt = sira === st.length - 1 ? Math.max(0, p.sonra || 0) : 0;
        const taban = ust + h - inis;
        kutular.push({
          h: ust + h + alt,
          ciz(c, x0, y) {
            satirCiz(c, x0, y + taban, satir);
            if (p.cizgiUst && sira === 0) c.cizgi(x0 + satir.solKenar, y + ust, x0 + satir.sagSinir, y + ust, 0.6);
            if (p.cizgiAlt && sira === st.length - 1) c.cizgi(x0 + satir.solKenar, y + ust + h + 1, x0 + satir.sagSinir, y + ust + h + 1, 0.6);
          },
        });
      });
      return kutular;
    }

    function satirCiz(c, x0, yTaban, satir) {
      const og = satir.og, son = satir.son;
      // Vurgu zemini
      for (let k = 0; k < son; k++) {
        const q = og[k];
        if (q.t !== 'r' && q.st.zemin && q.w > 0) c.dolgu(x0 + q.x, yTaban - q.st.f.cik * q.st.tam, q.w, (q.st.f.cik + q.st.f.in) * q.st.tam, q.st.zemin);
      }
      // Resimler
      for (let k = 0; k < son; k++) { const q = og[k]; if (q.t === 'r') c.resim(q.r.pdf, x0 + q.x, yTaban - q.h, q.w, q.h); }
      // Metin: aynı biçimli ve bitişik parçalar tek seferde yazılır.
      const dilimler = [];
      let d = null;
      for (let k = 0; k < son; k++) {
        const q = og[k];
        const yazilir = q.t === 'k' || (q.t === 'b' && !q.esnek && d);
        if (yazilir && d && d.st === q.st && Math.abs(d.bitis - q.x) < 0.02) { d.m += q.m; d.bitis = q.x + q.w; }
        else if (q.t === 'k') { d = { st: q.st, x: q.x, m: q.m, bitis: q.x + q.w }; dilimler.push(d); }
        else d = null;
      }
      if (dilimler.length) c.yazi(x0, yTaban, dilimler);
      // Altı çizili ve üstü çizili bölümler
      for (const [ozellik, konum] of [['a', -0.11], ['u', 0.27]]) {
        let bas = null, bit = 0, st = null;
        const bitir = () => { if (bas != null) c.cizgi(x0 + bas, yTaban - konum * st.tam - st.kay, x0 + bit, yTaban - konum * st.tam - st.kay, Math.max(0.4, st.tam * 0.05), st.renk); bas = null; };
        for (let k = 0; k < son; k++) {
          const q = og[k];
          if (q.t !== 'r' && q.st[ozellik] && q.w > 0) {
            if (bas != null && (st.renk !== q.st.renk || st.tam !== q.st.tam || Math.abs(bit - q.x) > 0.05)) bitir();
            if (bas == null) { bas = q.x; st = q.st; }
            bit = q.x + q.w;
          } else bitir();
        }
        bitir();
      }
    }

    /* ----- Tablo ----- */
    const DOLGU_YAN = 5.4, DOLGU_UST = 1.5, DOLGU_ALT = 1.5, CIZGI = 0.5;

    function satirKutu(hucreler, kenarlik, sabitH) {
      let h = 0;
      for (const hc of hucreler) h = Math.max(h, hc.kutular.reduce((a, k) => a + k.h, 0) + DOLGU_UST + DOLGU_ALT);
      if (sabitH) h = Math.max(h, sabitH);
      return {
        h,
        ciz(c, x0, y) {
          for (const hc of hucreler) {
            if (hc.zemin) c.dolgu(x0 + hc.x, y, hc.w, h, hc.zemin);
            let yy = y + DOLGU_UST;
            for (const k of hc.kutular) { if (k.ciz) k.ciz(c, x0 + hc.x + DOLGU_YAN, yy); yy += k.h; }
          }
          if (!kenarlik) return;
          for (const hc of hucreler) {
            const sol = x0 + hc.x, sag = sol + hc.w;
            c.cizgi(sol, y, sol, y + h, CIZGI); c.cizgi(sag, y, sag, y + h, CIZGI);
            if (!hc.ustYok) c.cizgi(sol, y, sag, y, CIZGI);
            if (!hc.altYok) c.cizgi(sol, y + h, sag, y + h, CIZGI);
          }
        },
        // Sayfaya sığmayan satırı, hücrelerdeki satır aralarından ikiye ayırır.
        bol(enCok) {
          const ic = enCok - DOLGU_UST - DOLGU_ALT;
          const ust = [], alt = [];
          let alinan = false, kalan = false;
          for (const hc of hucreler) {
            let y = 0, n = 0;
            while (n < hc.kutular.length && y + hc.kutular[n].h <= ic + 0.01) { y += hc.kutular[n].h; n++; }
            if (n > 0) alinan = true;
            if (n < hc.kutular.length) kalan = true;
            ust.push(Object.assign({}, hc, { kutular: hc.kutular.slice(0, n), altYok: true }));
            alt.push(Object.assign({}, hc, { kutular: hc.kutular.slice(n), ustYok: true }));
          }
          if (!alinan || !kalan) return null;
          return [satirKutu(ust, kenarlik, enCok), satirKutu(alt, kenarlik)];
        },
      };
    }

    function tabloDiz(t, genislik, enYuksek, alanlar) {
      const n = Math.max(1, (t.sutunlar || []).length, ...t.satirlar.map(st => st.hucreler.reduce((a, h) => a + (h.yatay || 1), 0)));
      let gen = (t.sutunlar || []).slice(0, n).map(g => (g > 0 ? g : 0));
      const bilinen = gen.filter(g => g > 0);
      const ort = bilinen.length ? bilinen.reduce((a, b) => a + b, 0) / bilinen.length : genislik / n;
      while (gen.length < n) gen.push(0);
      gen = gen.map(g => g || ort);
      const top = gen.reduce((a, b) => a + b, 0);
      if (top > genislik) gen = gen.map(g => g * genislik / top);
      const xler = [0];
      for (const g of gen) xler.push(xler[xler.length - 1] + g);
      const kay = t.hiza === 'orta' ? Math.max(0, (genislik - xler[n]) / 2) : 0;

      // Dikey birleşmeler için hangi sütunda devam hücresi başladığı tutulur.
      const devamBas = t.satirlar.map(st => { const set = new Set(); let k = 0; for (const h of st.hucreler) { if (h.devam) set.add(k); k += h.yatay || 1; } return set; });
      const kutular = [];
      t.satirlar.forEach((st, r) => {
        const hucreler = [];
        let k = 0;
        for (const h of st.hucreler) {
          if (k >= n) break;
          const bit = Math.min(n, k + (h.yatay || 1));
          const w = xler[bit] - xler[k];
          hucreler.push({
            x: kay + xler[k], w, zemin: h.zemin || null,
            kutular: h.devam ? [] : blokDiz(h.bloklar, Math.max(10, w - 2 * DOLGU_YAN), enYuksek - DOLGU_UST - DOLGU_ALT, alanlar).filter(q => !q.kirma),
            ustYok: !!h.devam, altYok: !!(devamBas[r + 1] && devamBas[r + 1].has(k)),
          });
          k = bit;
        }
        if (hucreler.length) kutular.push(satirKutu(hucreler, t.kenarlik !== false));
      });
      return kutular;
    }

    function blokDiz(bloklar, genislik, enYuksek, alanlar) {
      const kutular = [];
      for (const b of bloklar || []) {
        if (b.tur === 'p') {
          if (b.sayfaOnce) kutular.push({ kirma: true, h: 0 });
          kutular.push(...paragrafDiz(b, genislik, enYuksek, alanlar));
        } else if (b.tur === 'tablo') kutular.push(...tabloDiz(b, genislik, enYuksek, alanlar));
        else if (b.tur === 'kirma') kutular.push({ kirma: true, h: 0 });
      }
      return kutular;
    }

    /* ----- Çizim bağlamı ----- */
    function baglam(sayfa) {
      const adlar = new Map();
      const Y = y => s.boy - y;
      return {
        sayfa,
        yazi(x0, yTaban, dilimler) {
          const is = [PDFOperator.of('BT')];
          let sonF = null, sonBoyut = 0, sonRenk = null;
          for (const d of dilimler) {
            const b = d.st;
            if (b.f !== sonF || b.boyut !== sonBoyut) {
              let ad = adlar.get(b.f);
              if (!ad) { ad = sayfa.node.newFontDictionary(b.f.pdf.name, b.f.pdf.ref); adlar.set(b.f, ad); }
              is.push(PDFOperator.of('Tf', [ad, s2(b.boyut)]));
              sonF = b.f; sonBoyut = b.boyut;
            }
            if (b.renk !== sonRenk) { const [r, g, m] = renkCoz(b.renk); is.push(PDFOperator.of('rg', [s2(r), s2(g), s2(m)])); sonRenk = b.renk; }
            is.push(PDFOperator.of('Tm', ['1', '0', '0', '1', s2(x0 + d.x), s2(Y(yTaban) + b.kay)]));
            is.push(PDFOperator.of('Tj', [b.f.pdf.encodeText(d.m)]));
          }
          is.push(PDFOperator.of('ET'));
          sayfa.pushOperators(...is);
        },
        cizgi(x1, y1, x2, y2, kalinlik, renk) {
          const [r, g, m] = renkCoz(renk);
          sayfa.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: kalinlik, color: rgb(r, g, m) });
        },
        dolgu(x, y, w, h, renk) {
          const [r, g, m] = renkCoz(renk);
          sayfa.drawRectangle({ x, y: Y(y + h), width: w, height: h, color: rgb(r, g, m) });
        },
        resim(g, x, y, w, h) { sayfa.drawImage(g, { x, y: Y(y + h), width: w, height: h }); },
      };
    }

    /* ----- Üst ve alt bilgi ----- */
    const ustAlt = i => {
      const ilk = i === 0 && belge.ilkFarkli;
      return { ust: ilk ? belge.ilkUstbilgi : belge.ustbilgi, alt: ilk ? belge.ilkAltbilgi : belge.altbilgi };
    };
    const toplamH = k => k.reduce((a, q) => a + q.h, 0);
    const ornekAlan = { sayfa: '88', toplam: '88' };
    const sinirOnbellek = {};
    function sinir(i) {
      const tur = i === 0 && belge.ilkFarkli ? 'ilk' : 'diger';
      if (sinirOnbellek[tur]) return sinirOnbellek[tur];
      const { ust, alt } = ustAlt(i);
      const ustH = ust ? toplamH(blokDiz(ust, icEn, s.boy / 3, ornekAlan).filter(q => !q.kirma)) : 0;
      const altH = alt ? toplamH(blokDiz(alt, icEn, s.boy / 3, ornekAlan).filter(q => !q.kirma)) : 0;
      let ustY = Math.max(s.ust, ust ? (s.ustbilgi || 0) + ustH + 4 : 0);
      let altY = s.boy - Math.max(s.alt, alt ? (s.altbilgi || 0) + altH + 4 : 0);
      if (altY - ustY < s.boy * 0.3) { ustY = s.ust; altY = s.boy - s.alt; }
      return (sinirOnbellek[tur] = { ust: ustY, alt: altY, altH });
    }

    /* ----- Sayfalara dağıtma ----- */
    const sayfalar = [];
    let c = null, y = 0, alan = null, bos = true;
    const yeniSayfa = () => {
      const sayfa = doc.addPage([s.en, s.boy]);
      alan = sinir(sayfalar.length);
      c = baglam(sayfa);
      sayfalar.push(c);
      y = alan.ust; bos = true;
    };
    yeniSayfa();
    const govdeBoy = () => alan.alt - alan.ust;
    const govde = blokDiz(belge.bloklar, icEn, Math.max(100, (s.boy - s.ust - s.alt) - 40), null);
    for (let k of govde) {
      if (k.kirma) { if (!(bos && sayfalar.length === 1)) yeniSayfa(); continue; }
      while (k) {
        const kalan = alan.alt - y;
        if (k.h <= kalan + 0.01) { k.ciz(c, s.sol, y); y += k.h; bos = false; break; }
        if (k.h <= govdeBoy() + 0.01) { yeniSayfa(); continue; }
        // Sayfadan uzun kutu (çok uzun tablo satırı): bölünür.
        let parca = k.bol ? k.bol(kalan) : null;
        if (!parca && !bos) { yeniSayfa(); continue; }
        if (!parca) { k.ciz(c, s.sol, y); y = alan.alt; bos = false; break; }
        parca[0].ciz(c, s.sol, y); bos = false;
        k = parca[1];
        yeniSayfa();
      }
    }

    sayfalar.forEach((cs, i) => {
      const { ust, alt } = ustAlt(i);
      const alanlar = { sayfa: i + 1, toplam: sayfalar.length };
      if (ust) {
        let yy = s.ustbilgi || 0;
        for (const q of blokDiz(ust, icEn, s.boy / 3, alanlar)) { if (q.ciz) q.ciz(cs, s.sol, yy); yy += q.h; }
      }
      if (alt) {
        const kutular = blokDiz(alt, icEn, s.boy / 3, alanlar).filter(q => !q.kirma);
        let yy = s.boy - (s.altbilgi || 0) - toplamH(kutular);
        for (const q of kutular) { q.ciz(cs, s.sol, yy); yy += q.h; }
      }
    });

    return await doc.save();
  };

  /* ---------- Resimden PDF ---------- */

  // Her resim bir sayfa olur; sayfa A4'tür, resim sayfaya sığdırılıp ortalanır.
  BD.resimlerdenPdf = async function (resimler, secenek) {
    const PDFLib = await BD.pdfLib();
    const doc = await PDFLib.PDFDocument.create();
    doc.setProducer('Belge Dönüştür');
    for (const r of resimler) await BD.resimSayfasiEkle(doc, r);
    return await doc.save();
  };

  BD.resimSayfasiEkle = async function (doc, r) {
    const g = r.tip === 'png' ? await doc.embedPng(r.veri) : await doc.embedJpg(r.veri);
    const yatay = g.width > g.height * 1.15;
    const en = yatay ? BD.A4.boy : BD.A4.en, boy = yatay ? BD.A4.en : BD.A4.boy;
    const oran = Math.min(en / g.width, boy / g.height);
    const w = g.width * oran, h = g.height * oran;
    const sayfa = doc.addPage([en, boy]);
    sayfa.drawImage(g, { x: (en - w) / 2, y: (boy - h) / 2, width: w, height: h });
  };
})(typeof self !== 'undefined' ? self : this);
