/* Belge Dönüştür: UDF (UYAP Doküman Editörü) okuma ve yazma.

   UDF, içinde content.xml bulunan bir zip dosyasıdır. Metnin tamamı tek bir
   CDATA bölümünde durur; paragraflar ve biçimler bu metne başlangıç konumu ve
   uzunlukla bağlanır. Her paragraf kendi satırını ve sonundaki satır sonunu
   kapsar. Konumların toplamı metnin uzunluğuna birebir eşit olmalıdır; yoksa
   UYAP Editör dosyayı açmaz. Yazarken bu sonda denetlenir.

   Resimler metinde tek karakterlik bir yer tutucuyla (U+FFFC) durur ve
   görünen boyutu punto olarak taşır. Kenarlıksız tablolarda hücreler
   "borderNone" ile işaretlenir; yatay birleşen hücreler "colspan" taşır. */

(function (K) {
  'use strict';
  const BD = K.BD;

  const HIZA_YAZ = { orta: '1', sag: '2', iki: '3' };
  const HIZA_OKU = { '0': 'sol', '1': 'orta', '2': 'sag', '3': 'iki' };
  const ond = v => (Math.round(v * 100) / 100).toFixed(2).replace(/0$/, '');
  const sayi = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const metinTemizle = s => BD.xmlTemiz(String(s || '')).replace(/[\r\uFFFC\u200B\uFEFF]/g, '').replace(/\u00AD/g, '');

  const MADDELER = { BULLET_TYPE_ELLIPSE: '•', BULLET_TYPE_RECTANGLE: '■', BULLET_TYPE_ARROW: '›', BULLET_TYPE_DIAMOND: '◊', BULLET_TYPE_DIAMOND_2: '◊', BULLET_TYPE_TRIANGLE: '›', BULLET_TYPE_RECTANGLE_D: '□' };
  function numaraYaz(n, tur) {
    const son = /PARENTHESIS/.test(tur) ? ')' : '.';
    const harf = k => { let s = ''; for (; k > 0; k = Math.floor((k - 1) / 26)) s = 'abcdefghijklmnopqrstuvwxyz'[(k - 1) % 26] + s; return s; };
    const roma = k => { let s = ''; for (const [d, h] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (k >= d) { s += h; k -= d; } return s; };
    let g = String(n);
    if (/CHAR_SMALL/.test(tur)) g = harf(n);
    else if (/CHAR_BIG/.test(tur)) g = harf(n).toUpperCase();
    else if (/ROMAN_SMALL/.test(tur)) g = roma(n);
    else if (/ROMAN_BIG/.test(tur)) g = roma(n).toUpperCase();
    return g + son;
  }

  /* ---------- Yazma ---------- */

  BD.udfYaz = async function (belge) {
    const fflate = await BD.zip();
    await BD.resimleriHazirla(belge);
    const s = belge.sayfa;
    const icEn = s.en - s.sol - s.sag;
    let metin = '';
    const xml = [];
    const ekle = m => { const bas = metin.length; metin += m; return bas; };

    function bicimNit(x) {
      let n = '';
      if (x.k) n += ' bold="true"';
      if (x.i) n += ' italic="true"';
      if (x.a) n += ' underline="true"';
      if (x.u) n += ' strikethrough="true"';
      if (x.ust) n += ' superscript="true"';
      if (x.alt) n += ' subscript="true"';
      if (x.yt && !/^times/i.test(x.yt)) n += ` family="${BD.xmlKacis(x.yt)}"`;
      if (x.boyut && Math.abs(x.boyut - 12) > 0.01) n += ` size="${ond(x.boyut).replace(/\.0$/, '')}"`;
      if (x.renk && x.renk !== '#000000') n += ` foreground="${(parseInt(x.renk.slice(1), 16) | 0xFF000000) | 0}"`;
      return n;
    }

    function paragrafYaz(p, genislik) {
      genislik = genislik || icEn;
      // Satır içi satır sonu UDF'de yoktur; her biri ayrı paragraf olur.
      const dilimler = [[]];
      for (const x of p.parcalar) {
        if (x.resim) { dilimler[dilimler.length - 1].push(x); continue; }
        if (x.alan) continue;
        metinTemizle(x.m).split('\n').forEach((m, i) => {
          if (i > 0) dilimler.push([]);
          if (m) dilimler[dilimler.length - 1].push(Object.assign({}, x, { m }));
        });
      }
      dilimler.forEach((dilim, sira) => {
        let nit = '';
        if (HIZA_YAZ[p.hiza]) nit += ` Alignment="${HIZA_YAZ[p.hiza]}"`;
        if (p.sol > 0.5) nit += ` LeftIndent="${ond(p.sol)}"`;
        if (p.sag > 0.5) nit += ` RightIndent="${ond(p.sag)}"`;
        if (sira === 0 && Math.abs(p.ilk || 0) > 0.5) nit += ` FirstLineIndent="${ond(p.ilk)}"`;
        if (sira === 0 && p.once > 0.5) nit += ` SpaceAbove="${ond(p.once)}"`;
        if (sira === dilimler.length - 1 && p.sonra > 0.5) nit += ` SpaceBelow="${ond(p.sonra)}"`;
        if (p.aralik >= 1.25) nit += ` LineSpacing="${ond(p.aralik - 1)}"`;
        if (p.sekmeler && p.sekmeler.length) nit += ` TabSet="${p.sekmeler.map(d => ond(d.yer) + ':' + (d.tip === 'orta' ? 1 : d.tip === 'sag' ? 2 : 0) + ':0').join(',')}"`;
        const ic = [];
        for (const x of dilim) {
          if (x.resim) {
            const r = udfResmi(x, genislik);
            if (r) ic.push({ resim: r, bas: ekle('\uFFFC'), uz: 1 });
            continue;
          }
          const b = bicimNit(x), son = ic[ic.length - 1];
          const bas = ekle(x.m);
          if (son && !son.resim && son.bicim === b) son.uz += x.m.length;
          else ic.push({ bicim: b, bas, uz: x.m.length });
        }
        const sonKonum = ekle('\n'), son = ic[ic.length - 1];
        if (son && !son.resim) son.uz += 1;
        else ic.push({ bicim: '', bas: sonKonum, uz: 1 });
        xml.push(`<paragraph${nit}>` + ic.map(o => o.resim
          ? `<image imageData="${o.resim.veri}" startOffset="${o.bas}" length="1" width="${ond(o.resim.en)}" height="${ond(o.resim.boy)}" />`
          : `<content${o.bicim} startOffset="${o.bas}" length="${o.uz}" />`).join('') + '</paragraph>');
      });
    }

    const bosParagraf = () => { const bas = ekle('\n'); xml.push(`<paragraph><content startOffset="${bas}" length="1" /></paragraph>`); };

    function hucreBloklari(bloklar, genislik) {
      let yazilan = 0;
      for (const b of bloklar || []) {
        if (b.tur === 'p') { paragrafYaz(b, genislik); yazilan++; }
        else if (b.tur === 'tablo') for (const st of b.satirlar) for (const h of st.hucreler) yazilan += hucreBloklari(h.bloklar, genislik);
      }
      return yazilan;
    }

    function tabloYaz(t) {
      const n = Math.max(1, (t.sutunlar || []).length, ...t.satirlar.map(st => st.hucreler.reduce((a, h) => a + (h.yatay || 1), 0)));
      let gen = (t.sutunlar || []).slice(0, n);
      while (gen.length < n) gen.push(gen.length ? gen.reduce((a, b) => a + b, 0) / gen.length : icEn / n);
      const top = gen.reduce((a, b) => a + b, 0) || 1;
      gen = gen.map(g => Math.max(10, Math.round(g * Math.min(1, icEn / top))));
      const kenar = t.kenarlik === false ? ' border="borderNone"' : '';
      xml.push(`<table tableName="Sabit" columnCount="${n}" columnSpans="${gen.map(g => g + '.0').join(',')}" border="borderCell">`);
      t.satirlar.forEach((st, i) => {
        xml.push(`<row rowName="row${i + 1}" rowType="dataRow">`);
        let dolu = 0;
        for (const h of st.hucreler) {
          if (dolu >= n) break;
          const yatay = Math.min(n - dolu, h.yatay || 1);
          let w = 0;
          for (let k = dolu; k < dolu + yatay; k++) w += gen[k];
          xml.push('<cell' + (yatay > 1 ? ` colspan="${yatay}"` : '') + kenar + '>');
          if (!hucreBloklari(h.bloklar, Math.max(20, w - 10.8))) bosParagraf();
          xml.push('</cell>');
          dolu += yatay;
        }
        for (; dolu < n; dolu++) { xml.push('<cell' + kenar + '>'); bosParagraf(); xml.push('</cell>'); }
        xml.push('</row>');
      });
      xml.push('</table>');
    }

    function bloklariYaz(bloklar) {
      for (const b of bloklar || []) {
        if (b.tur === 'p') paragrafYaz(b);
        else if (b.tur === 'tablo') tabloYaz(b);
      }
    }

    // Her sayfada yinelenen üst bilgi <header> içine, yalnızca ilk sayfaya ait
    // olan ise gövdenin başına yazılır. Üst bilginin metni havuzda en başta durur.
    const doluMu = bl => !!bl && bl.some(b => b.tur !== 'p' || b.parcalar.some(x => x.resim || (x.m && x.m.trim())));
    if (!belge.ilkFarkli && doluMu(belge.ustbilgi)) {
      xml.push('<header>');
      for (const b of belge.ustbilgi) if (b.tur === 'p') paragrafYaz(b);
      xml.push('</header>');
    }
    if (belge.ilkFarkli && doluMu(belge.ilkUstbilgi)) bloklariYaz(belge.ilkUstbilgi);
    const govdeBasi = xml.length;
    bloklariYaz(belge.bloklar);
    if (xml.length === govdeBasi) bosParagraf();
    if (!xml.length) bosParagraf();

    // Konumların metni eksiksiz ve sırayla kapladığı denetlenir.
    let beklenen = 0;
    const govde = xml.join('');
    govde.replace(/startOffset="(\d+)" length="(\d+)"/g, (_, a, b) => {
      if (+a !== beklenen) throw new Error('UDF konum hatası');
      beklenen += +b;
      return _;
    });
    if (beklenen !== metin.length) throw new Error('UDF uzunluk hatası');

    const kenar = v => ond(Math.max(0, Math.min(250, v)));
    const cikti = '<?xml version="1.0" encoding="UTF-8" ?> \n\n<template format_id="1.8" >\n' +
      '<content><![CDATA[' + metin.replace(/]]>/g, ']]]]><![CDATA[>') + ']]></content>' +
      `<properties><pageFormat mediaSizeName="1" leftMargin="${kenar(s.sol)}" rightMargin="${kenar(s.sag)}" topMargin="${kenar(s.ust)}" bottomMargin="${kenar(s.alt)}" paperOrientation="1" headerFOffset="20.0" footerFOffset="20.0" /></properties>\n` +
      '<elements resolver="hvl-default" >\n' + govde + '\n</elements>\n' +
      '<styles><style name="default" description="Geçerli" family="Dialog" size="12" bold="false" italic="false" foreground="-13421773" ' +
      'FONT_ATTRIBUTE_KEY="javax.swing.plaf.FontUIResource[family=Dialog,name=Dialog,style=plain,size=12]" />' +
      '<style name="hvl-default" family="Times New Roman" size="12" description="Gövde" /></styles>\n</template>\n';
    return fflate.zipSync({ 'content.xml': [BD.utf8(cikti), { level: 6 }] });
  };

  // Resmin UDF'de görünen boyutu (punto): yazı alanına sığacak biçimde.
  function udfResmi(x, genislik) {
    const r = x.resim;
    if (!r || !r.veri || !r.pxEn || !r.pxBoy) return null;
    let en = x.en > 0 ? x.en : r.pxEn * 0.75, boy = x.boy > 0 ? x.boy : en * r.pxBoy / r.pxEn;
    const oran = Math.min(1, genislik / en, 700 / boy);
    return { veri: BD.b64(r.udfVeri || r.veri), en: en * oran, boy: boy * oran };
  }

  // UDF içindeki resimler en çok 1500 piksel olur; daha büyükleri küçültülür.
  BD.udfResimleriKucult = async function (belge) {
    const isler = [];
    for (const grup of BD.tumBloklar(belge)) BD.gez(grup, p => { for (const x of p.parcalar) if (x.resim) isler.push(x.resim); });
    for (const r of isler) {
      if (r.udfVeri || Math.max(r.pxEn || 0, r.pxBoy || 0) <= 1500) continue;
      try { r.udfVeri = (await BD.resimHazirla(r.veri, { sinir: 1500, tip: r.tip === 'png' ? 'png' : 'jpeg', kalite: 0.9 })).veri; }
      catch (e) { /* özgün hali kalır */ }
    }
  };

  /* ---------- Okuma ---------- */

  BD.udfOku = async function (bayt) {
    const fflate = await BD.zip();
    let dosyalar;
    try { dosyalar = fflate.unzipSync(bayt, { filter: f => /(^|\/)content\.xml$/i.test(f.name) }); }
    catch (e) { throw new BD.Hata('UDF dosyası açılamadı; dosya bozuk olabilir.'); }
    const ad = Object.keys(dosyalar)[0];
    if (!ad) throw new BD.Hata('Bu dosyada UDF içeriği bulunamadı.');
    const kok = BD.xmlOku(BD.utf8Coz(dosyalar[ad])).documentElement;
    const icerik = BD.cocuk(kok, 'content');
    const metin = icerik ? icerik.textContent : '';

    const belge = BD.yeniBelge();
    const s = belge.sayfa;
    const ozellik = BD.cocuk(kok, 'properties');
    const pf = BD.cocuk(ozellik, 'pageFormat');
    if (pf) {
      const al = (ad2, vars) => { const v = parseFloat(pf.getAttribute(ad2)); return isFinite(v) && v >= 0 && v < 300 ? v : vars; };
      s.sol = al('leftMargin', s.sol); s.sag = al('rightMargin', s.sag);
      s.ust = al('topMargin', s.ust); s.alt = al('bottomMargin', s.alt);
      const yon = pf.getAttribute('paperOrientation');
      if (yon === '0' || yon === '2') { const e = s.en; s.en = s.boy; s.boy = e; }
    }
    const icEn = s.en - s.sol - s.sag;

    const dogru = v => v === 'true';
    function bicimOku(el, taban) {
      const b = Object.assign({}, taban);
      const al = n => el.getAttribute(n);
      if (al('bold') != null) b.k = dogru(al('bold'));
      if (al('italic') != null) b.i = dogru(al('italic'));
      if (al('underline') != null) b.a = dogru(al('underline'));
      if (al('strikethrough') != null) b.u = dogru(al('strikethrough'));
      if (al('superscript') != null) b.ust = dogru(al('superscript'));
      if (al('subscript') != null) b.alt = dogru(al('subscript'));
      if (al('family')) b.yt = al('family');
      const boyut = parseFloat(al('size'));
      if (boyut > 0 && boyut < 400) b.boyut = boyut;
      if (al('foreground') != null) {
        const n = parseInt(al('foreground'), 10);
        if (isFinite(n)) b.renk = BD.renkOnalti(n);
      }
      if (al('background') != null) {
        const n = parseInt(al('background'), 10);
        if (isFinite(n) && (n & 0xFFFFFF) !== 0xFFFFFF) b.zemin = BD.renkOnalti(n);
      }
      return b;
    }

    const stiller = {};
    for (const st of BD.cocuklar(BD.cocuk(kok, 'styles'), 'style')) stiller[st.getAttribute('name')] = bicimOku(st, {});
    const elemanlar = BD.cocuk(kok, 'elements');
    const govdeStili = (elemanlar && elemanlar.getAttribute('resolver')) || 'hvl-default';
    const temel = Object.assign({ yt: BD.YT, boyut: 12 }, stiller[govdeStili] || {});
    if (/^dialog/i.test(temel.yt || '')) temel.yt = BD.YT;
    delete temel.renk;

    const sayaclar = {};
    async function paragrafOku(el) {
      const p = BD.paragraf([]);
      p.hiza = HIZA_OKU[el.getAttribute('Alignment')] || 'sol';
      p.sol = Math.max(0, sayi(el.getAttribute('LeftIndent')));
      p.sag = Math.max(0, sayi(el.getAttribute('RightIndent')));
      p.ilk = sayi(el.getAttribute('FirstLineIndent'));
      p.once = Math.max(0, sayi(el.getAttribute('SpaceAbove')));
      p.sonra = Math.max(0, sayi(el.getAttribute('SpaceBelow')));
      const ara = parseFloat(el.getAttribute('LineSpacing'));
      if (ara > 0 && ara < 4) p.aralik = 1 + ara;
      const sekme = el.getAttribute('TabSet');
      if (sekme) {
        // Her durak "konum:hiza:öncü" biçimindedir; hiza 1 ortalı, 2 sağa yaslıdır.
        p.sekmeler = sekme.split(/[,;]/).map(x => { const b = x.split(':'); return { yer: parseFloat(b[0]), tip: b[1] === '1' ? 'orta' : b[1] === '2' ? 'sag' : 'sol' }; })
          .filter(d => d.yer > 0).sort((a, b) => a.yer - b.yer);
        if (!p.sekmeler.length) delete p.sekmeler;
      }
      const paraStili = stiller[el.getAttribute('resolver')] || null;
      const paraTemel = paraStili ? Object.assign({}, temel, paraStili) : temel;

      for (const c of BD.cocuklar(el)) {
        const veri = c.getAttribute('imageData');
        if (c.localName === 'image' || veri) {
          if (!veri) continue;
          try {
            const r = { veri: BD.b64Coz(veri) };
            await BD.resimUygun(r);
            let en = sayi(c.getAttribute('width')), boy = sayi(c.getAttribute('height'));
            if (!(en > 0)) en = boy > 0 ? boy * r.pxEn / r.pxBoy : r.pxEn * 0.75;
            if (!(boy > 0)) boy = en * r.pxBoy / r.pxEn;
            p.parcalar.push({ resim: r, en, boy });
          } catch (e) { /* açılamayan resim atlanır */ }
          continue;
        }
        const bas = parseInt(c.getAttribute('startOffset'), 10), uz = parseInt(c.getAttribute('length'), 10);
        if (!isFinite(bas) || !isFinite(uz) || uz <= 0 || bas < 0) continue;
        let m = metin.substr(bas, uz).replace(/[\uFFFC\u200B\r]/g, '');
        if (c.localName === 'tab' && !/\t/.test(m)) m = '\t';
        if (!m) continue;
        const stilAdi = c.getAttribute('style') || c.getAttribute('resolver');
        const b = bicimOku(c, stilAdi && stiller[stilAdi] ? Object.assign({}, paraTemel, stiller[stilAdi]) : paraTemel);
        if (b.renk === '#000000') delete b.renk;
        p.parcalar.push(Object.assign(b, { m }));
      }
      // Paragrafı kapatan satır sonu metne dahil değildir.
      for (let i = p.parcalar.length - 1; i >= 0; i--) {
        const x = p.parcalar[i];
        if (x.resim) break;
        x.m = x.m.replace(/\n+$/, '');
        if (x.m) break;
        p.parcalar.splice(i, 1);
      }

      // Liste işareti UDF'de paragrafın niteliğidir; burada metne çevrilir.
      const madde = dogru(el.getAttribute('Bulleted')), numarali = dogru(el.getAttribute('Numbered'));
      if (madde || numarali) {
        let isaret;
        if (madde) isaret = MADDELER[el.getAttribute('BulletType')] || '•';
        else {
          const kimlik = (el.getAttribute('ListId') || '0') + '/' + (el.getAttribute('ListLevel') || '0');
          sayaclar[kimlik] = (sayaclar[kimlik] || 0) + 1;
          isaret = numaraYaz(sayaclar[kimlik], el.getAttribute('NumberType') || '');
        }
        p.parcalar.unshift(Object.assign({}, paraTemel, { m: isaret + '\t' }));
        if (!(p.ilk < 0)) { if (p.sol < 18) p.sol = 18 * ((parseInt(el.getAttribute('ListLevel'), 10) || 0) + 1); p.ilk = -18; }
      }
      return p;
    }

    async function tabloOku(el) {
      const satirlar = [];
      let hucreSayisi = 0, kenarsiz = 0;
      for (const r of BD.cocuklar(el, 'row')) {
        const hucreler = [];
        for (const c of BD.cocuklar(r, 'cell')) {
          const h = { bloklar: await bloklariOku(c), yatay: Math.max(1, parseInt(c.getAttribute('colspan') || c.getAttribute('colSpan') || '1', 10) || 1) };
          if (!h.bloklar.length) h.bloklar.push(BD.paragraf([]));
          const dolgu = parseInt(c.getAttribute('fillColor'), 10);
          if (isFinite(dolgu) && (dolgu & 0xFFFFFF) !== 0xFFFFFF) h.zemin = BD.renkOnalti(dolgu);
          hucreSayisi++;
          if (/none/i.test(c.getAttribute('border') || '') || c.getAttribute('borderSpec') === '0') kenarsiz++;
          hucreler.push(h);
        }
        if (hucreler.length) satirlar.push({ hucreler });
      }
      if (!satirlar.length) return null;
      const n = Math.max(parseInt(el.getAttribute('columnCount'), 10) || 0, ...satirlar.map(st => st.hucreler.reduce((a, h) => a + h.yatay, 0)));
      let gen = String(el.getAttribute('columnSpans') || '').split(',').map(parseFloat).filter(x => x > 0).slice(0, n);
      while (gen.length < n) gen.push(gen.length ? gen.reduce((a, b) => a + b, 0) / gen.length : 100);
      const top = gen.reduce((a, b) => a + b, 0);
      return { tur: 'tablo', sutunlar: gen.map(g => g * icEn / top), kenarlik: !/none/i.test(el.getAttribute('border') || '') && !(hucreSayisi && kenarsiz === hucreSayisi), satirlar };
    }

    async function bloklariOku(el) {
      const bloklar = [];
      for (const c of BD.cocuklar(el)) {
        const ad2 = c.localName;
        if (ad2 === 'paragraph') bloklar.push(await paragrafOku(c));
        else if (ad2 === 'table') { const t = await tabloOku(c); if (t) bloklar.push(t); }
        else if (ad2 === 'header') { const b = await bloklariOku(c); if (b.length) belge.ustbilgi = (belge.ustbilgi || []).concat(b); }
        else if (ad2 === 'footer') {
          const b = (await bloklariOku(c)).filter(x => x.tur !== 'p' || x.parcalar.length);
          // Sayfa numarası alt bilginin niteliğidir.
          if (c.getAttribute('pageNumber-spec')) {
            const boyut = parseFloat(c.getAttribute('pageNumber-fontSize'));
            b.push(BD.paragraf([{ alan: 'sayfa', m: '', boyut: boyut > 0 ? boyut : 11, yt: c.getAttribute('pageNumber-fontFace') || BD.YT }], { hiza: 'orta' }));
          }
          if (b.length) belge.altbilgi = (belge.altbilgi || []).concat(b);
        }
        else if (/page.?break/i.test(ad2)) bloklar.push({ tur: 'kirma' });
        else if (c.firstElementChild) bloklar.push(...await bloklariOku(c));
      }
      return bloklar;
    }

    belge.bloklar = elemanlar ? await bloklariOku(elemanlar) : [];
    // Eleman tanımı olmayan dosyada metin satır satır alınır.
    if (!belge.bloklar.length && metin.trim()) {
      belge.bloklar = metin.replace(/\n$/, '').split('\n').map(m => BD.paragraf(m ? [Object.assign({}, temel, { m })] : []));
    }
    return belge;
  };
})(typeof self !== 'undefined' ? self : this);
