/* Belge Dönüştür: ortak modelden Word (.docx) üretir.

   Yalnızca gereken parçalar yazılır: belge gövdesi, sade bir stil ve ayar
   dosyası, varsa üst ve alt bilgi ile resimler. Biçimler paragrafların ve
   metin parçalarının üzerine doğrudan işlenir. */

(function (K) {
  'use strict';
  const BD = K.BD;
  const k = BD.xmlKacis;
  const tw = pt => Math.round(pt * 20);
  const emu = pt => Math.round(pt * 12700);
  const AD_ALANI = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const BAS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ILISKI = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

  BD.docxYaz = async function (belge) {
    const fflate = await BD.zip();
    await BD.resimleriHazirla(belge);
    const s = belge.sayfa;
    const icEn = s.en - s.sol - s.sag, icBoy = s.boy - s.ust - s.alt;
    const dosyalar = {};
    const medya = new Map();
    let resimNo = 0, sekilNo = 0;

    function rPr(q) {
      const yt = k(q.yt || BD.YT), boyut = Math.round((q.boyut > 0 ? q.boyut : 12) * 2);
      let o = `<w:rFonts w:ascii="${yt}" w:hAnsi="${yt}" w:cs="${yt}"/>`;
      if (q.k) o += '<w:b/><w:bCs/>';
      if (q.i) o += '<w:i/><w:iCs/>';
      if (q.u) o += '<w:strike/>';
      if (q.renk && q.renk !== '#000000') o += `<w:color w:val="${q.renk.slice(1).toUpperCase()}"/>`;
      o += `<w:sz w:val="${boyut}"/><w:szCs w:val="${boyut}"/>`;
      if (q.a) o += '<w:u w:val="single"/>';
      if (q.zemin) o += `<w:shd w:val="clear" w:color="auto" w:fill="${q.zemin.slice(1).toUpperCase()}"/>`;
      if (q.ust) o += '<w:vertAlign w:val="superscript"/>';
      else if (q.alt) o += '<w:vertAlign w:val="subscript"/>';
      return '<w:rPr>' + o + '</w:rPr>';
    }

    function metinXml(q) {
      const pr = rPr(q);
      if (q.alan) {
        const komut = q.alan === 'toplam' ? 'NUMPAGES' : 'PAGE';
        return `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${pr}<w:instrText xml:space="preserve"> ${komut} </w:instrText></w:r>` +
          `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${pr}<w:t>1</w:t></w:r><w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
      }
      let ic = '';
      for (const d of BD.xmlTemiz(String(q.m || '')).replace(/\r/g, '').split(/(\t|\n)/)) {
        if (d === '\t') ic += '<w:tab/>';
        else if (d === '\n') ic += '<w:br/>';
        else if (d) ic += `<w:t xml:space="preserve">${k(d)}</w:t>`;
      }
      return ic ? `<w:r>${pr}${ic}</w:r>` : '';
    }

    function pPr(p, sayfaOnce) {
      let o = '';
      if (p.sayfaOnce || sayfaOnce) o += '<w:pageBreakBefore/>';
      if (p.cizgiUst || p.cizgiAlt) {
        const c = ad => `<w:${ad} w:val="single" w:sz="6" w:space="1" w:color="auto"/>`;
        o += '<w:pBdr>' + (p.cizgiUst ? c('top') : '') + (p.cizgiAlt ? c('bottom') : '') + '</w:pBdr>';
      }
      if (p.sekmeler && p.sekmeler.length) {
        o += '<w:tabs>' + p.sekmeler.map(d => `<w:tab w:val="${d.tip === 'sag' ? 'right' : d.tip === 'orta' ? 'center' : 'left'}" w:pos="${tw(d.yer)}"/>`).join('') + '</w:tabs>';
      }
      let ara = ` w:before="${tw(Math.max(0, p.once || 0))}" w:after="${tw(Math.max(0, p.sonra || 0))}"`;
      if (p.sabit && p.sabit.deger > 0) ara += ` w:line="${tw(p.sabit.deger)}" w:lineRule="${p.sabit.enAz ? 'atLeast' : 'exact'}"`;
      else ara += ` w:line="${Math.round((p.aralik > 0 ? p.aralik : 1) * 240)}" w:lineRule="auto"`;
      o += `<w:spacing${ara}/>`;
      if (p.sol || p.sag || p.ilk) {
        o += `<w:ind w:left="${tw(Math.max(0, p.sol || 0))}" w:right="${tw(Math.max(0, p.sag || 0))}"` +
          (p.ilk < 0 ? ` w:hanging="${tw(-p.ilk)}"` : p.ilk > 0 ? ` w:firstLine="${tw(p.ilk)}"` : '') + '/>';
      }
      const hiza = { orta: 'center', sag: 'right', iki: 'both' }[p.hiza];
      if (hiza) o += `<w:jc w:val="${hiza}"/>`;
      if (!p.parcalar.length && p.bos && p.bos.boyut > 0) {
        const b = Math.round(p.bos.boyut * 2);
        o += `<w:rPr><w:sz w:val="${b}"/><w:szCs w:val="${b}"/></w:rPr>`;
      }
      return '<w:pPr>' + o + '</w:pPr>';
    }

    // Belgenin bir parçası (gövde, üst bilgi, alt bilgi) kendi ilişki listesini tutar.
    function parca() {
      const iliskiler = [];
      const resimKimlik = new Map();
      function resimId(r) {
        let id = resimKimlik.get(r.veri);
        if (id) return id;
        let ad = medya.get(r.veri);
        if (!ad) {
          ad = 'resim' + (++resimNo) + (r.tip === 'png' ? '.png' : '.jpeg');
          medya.set(r.veri, ad);
          dosyalar['word/media/' + ad] = [r.veri, { level: 0 }];
        }
        id = 'rIdResim' + (iliskiler.length + 1);
        iliskiler.push({ id, tur: ILISKI + 'image', hedef: 'media/' + ad });
        resimKimlik.set(r.veri, id);
        return id;
      }
      function resimXml(q, genislik) {
        const r = q.resim;
        let en = q.en > 0 ? q.en : r.pxEn * 0.75, boy = q.boy > 0 ? q.boy : en * r.pxBoy / r.pxEn;
        const oran = Math.min(1, genislik / en, (icBoy - 24) / boy);
        en *= oran; boy *= oran;
        const id = resimId(r), no = ++sekilNo;
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(en)}" cy="${emu(boy)}"/>` +
          `<wp:docPr id="${no}" name="Resim ${no}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:pic><pic:nvPicPr><pic:cNvPr id="${no}" name="Resim ${no}"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(en)}" cy="${emu(boy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
          '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
      }
      function paragrafXml(p, genislik, sayfaOnce) {
        let ic = '';
        for (const q of p.parcalar) ic += q.resim ? resimXml(q, Math.max(20, genislik - (p.sol || 0) - (p.sag || 0))) : metinXml(q);
        return '<w:p>' + pPr(p, sayfaOnce) + ic + '</w:p>';
      }
      function tabloXml(t, genislik) {
        const n = Math.max(1, (t.sutunlar || []).length, ...t.satirlar.map(st => st.hucreler.reduce((a, h) => a + (h.yatay || 1), 0)));
        let gen = (t.sutunlar || []).slice(0, n).map(g => (g > 0 ? g : 0));
        const bilinen = gen.filter(g => g > 0);
        const ort = bilinen.length ? bilinen.reduce((a, b) => a + b, 0) / bilinen.length : genislik / n;
        while (gen.length < n) gen.push(0);
        gen = gen.map(g => g || ort);
        const top = gen.reduce((a, b) => a + b, 0);
        if (top > genislik) gen = gen.map(g => g * genislik / top);
        const kenar = t.kenarlik !== false ? 'w:val="single" w:sz="4" w:space="0" w:color="000000"' : 'w:val="none" w:sz="0" w:space="0" w:color="auto"';
        let o = `<w:tbl><w:tblPr><w:tblW w:w="${tw(gen.reduce((a, b) => a + b, 0))}" w:type="dxa"/>` + (t.hiza === 'orta' ? '<w:jc w:val="center"/>' : '') +
          '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(ad => `<w:${ad} ${kenar}/>`).join('') + '</w:tblBorders>' +
          '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
          '<w:tblGrid>' + gen.map(g => `<w:gridCol w:w="${tw(g)}"/>`).join('') + '</w:tblGrid>';
        const devamBas = t.satirlar.map(st => { const set = new Set(); let c = 0; for (const h of st.hucreler) { if (h.devam) set.add(c); c += h.yatay || 1; } return set; });
        t.satirlar.forEach((st, r) => {
          o += '<w:tr>';
          let c = 0;
          for (const h of st.hucreler) {
            if (c >= n) break;
            const bit = Math.min(n, c + (h.yatay || 1));
            let w = 0;
            for (let i = c; i < bit; i++) w += gen[i];
            let pr = `<w:tcW w:w="${tw(w)}" w:type="dxa"/>`;
            if (bit - c > 1) pr += `<w:gridSpan w:val="${bit - c}"/>`;
            if (h.devam) pr += '<w:vMerge/>';
            else if (devamBas[r + 1] && devamBas[r + 1].has(c)) pr += '<w:vMerge w:val="restart"/>';
            if (h.zemin) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${h.zemin.slice(1).toUpperCase()}"/>`;
            const ic = h.devam ? '' : bloklarXml(h.bloklar, Math.max(20, w - 10.8), true);
            o += '<w:tc><w:tcPr>' + pr + '</w:tcPr>' + (ic || '<w:p/>') + '</w:tc>';
            c = bit;
          }
          for (; c < n; c++) o += `<w:tc><w:tcPr><w:tcW w:w="${tw(gen[c])}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
          o += '</w:tr>';
        });
        return o + '</w:tbl>';
      }
      // Hücre ve gövde, tablonun ardından en az bir paragrafla bitmelidir.
      function bloklarXml(bloklar, genislik, hucre) {
        let o = '', kir = false, sonTablo = false;
        for (const b of bloklar || []) {
          if (b.tur === 'kirma') { if (!hucre) kir = true; continue; }
          if (b.tur === 'p') { o += paragrafXml(b, genislik, kir); kir = false; sonTablo = false; }
          else if (b.tur === 'tablo') {
            if (kir) { o += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; kir = false; }
            o += tabloXml(b, genislik); sonTablo = true;
          }
        }
        if (kir) o += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        if (sonTablo) o += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>';
        return o;
      }
      return { bloklarXml, iliskiler };
    }

    const iliskiXml = liste => BAS + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      liste.map(i => `<Relationship Id="${i.id}" Type="${i.tur}" Target="${k(i.hedef)}"/>`).join('') + '</Relationships>';
    const yaz = (yol, metin) => { dosyalar[yol] = [BD.utf8(metin), { level: 6 }]; };

    const govde = parca();
    const tipler = [];
    let basvuru = '';
    let ekNo = 0;
    const ekParca = (bloklar, tur, cesit) => {
      if (!bloklar || !bloklar.length) return;
      const p = parca(), ad = tur + (++ekNo) + '.xml', etiket = tur === 'header' ? 'hdr' : 'ftr';
      yaz('word/' + ad, BAS + `<w:${etiket} ${AD_ALANI}>` + (p.bloklarXml(bloklar, icEn, true) || '<w:p/>') + `</w:${etiket}>`);
      if (p.iliskiler.length) yaz('word/_rels/' + ad + '.rels', iliskiXml(p.iliskiler));
      const id = 'rIdEk' + ekNo;
      govde.iliskiler.push({ id, tur: ILISKI + tur, hedef: ad });
      tipler.push(`<Override PartName="/word/${ad}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tur}+xml"/>`);
      basvuru += `<w:${tur}Reference w:type="${cesit}" r:id="${id}"/>`;
    };
    ekParca(belge.ustbilgi, 'header', 'default');
    if (belge.ilkFarkli) ekParca(belge.ilkUstbilgi, 'header', 'first');
    ekParca(belge.altbilgi, 'footer', 'default');
    if (belge.ilkFarkli) ekParca(belge.ilkAltbilgi, 'footer', 'first');

    const govdeXml = govde.bloklarXml(belge.bloklar, icEn, false) || '<w:p/>';
    const bolum = '<w:sectPr>' + basvuru +
      `<w:pgSz w:w="${tw(s.en)}" w:h="${tw(s.boy)}"${s.en > s.boy ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${tw(s.ust)}" w:right="${tw(s.sag)}" w:bottom="${tw(s.alt)}" w:left="${tw(s.sol)}" w:header="${tw(s.ustbilgi || 35.4)}" w:footer="${tw(s.altbilgi || 35.4)}" w:gutter="0"/>` +
      (belge.ilkFarkli ? '<w:titlePg/>' : '') + '</w:sectPr>';
    yaz('word/document.xml', BAS + `<w:document ${AD_ALANI}><w:body>` + govdeXml + bolum + '</w:body></w:document>');

    yaz('word/styles.xml', BAS + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="tr-TR" w:eastAsia="tr-TR" w:bidi="ar-SA"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>');
    yaz('word/settings.xml', BAS + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:defaultTabStop w:val="${tw(belge.sekme > 4 ? belge.sekme : 36)}"/>` +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>');

    govde.iliskiler.push({ id: 'rIdStil', tur: ILISKI + 'styles', hedef: 'styles.xml' }, { id: 'rIdAyar', tur: ILISKI + 'settings', hedef: 'settings.xml' });
    yaz('word/_rels/document.xml.rels', iliskiXml(govde.iliskiler));
    yaz('_rels/.rels', iliskiXml([{ id: 'rId1', tur: ILISKI + 'officeDocument', hedef: 'word/document.xml' }]));
    yaz('[Content_Types].xml', BAS + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      tipler.join('') + '</Types>');

    // Word, içerik türleri dosyasını arşivin başında bekler.
    const sirali = {};
    for (const ad of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) sirali[ad] = dosyalar[ad];
    for (const ad of Object.keys(dosyalar)) if (!sirali[ad]) sirali[ad] = dosyalar[ad];
    return fflate.zipSync(sirali);
  };
})(typeof self !== 'undefined' ? self : this);
