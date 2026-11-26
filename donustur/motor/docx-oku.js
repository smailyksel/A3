/* Belge Dönüştür: Word (.docx) okuyucusu.

   Belgedeki paragrafları, biçimleri (stil zinciri dahil), numaralı ve
   madde işaretli listeleri, tabloları, resimleri, üst ve alt bilgiyi,
   dipnotları ve sayfa düzenini ortak modele aktarır. Metin kutularının
   içeriği bulunduğu paragrafın ardına düz akışla eklenir. */

(function (K) {
  'use strict';
  const BD = K.BD;
  const cocuklar = BD.cocuklar, cocuk = BD.cocuk, nit = BD.nit;

  const VURGU = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0' };
  const MADDE = { '\uF0B7': '•', '·': '•', '\uF0A7': '▪', '\uF0D8': '›', '\uF0FC': '√', '\uF0A8': '◊', '\uF076': '◊', 'o': 'o', '\uF06F': 'o', '-': '-', '–': '–', '—': '–', '*': '*', '•': '•', '▪': '▪', '■': '■', '●': '●', '○': '○' };

  const acik = el => { const v = nit(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };
  const sayi = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const ilk = (...d) => { for (const x of d) if (x != null) return x; return null; };

  function roma(n) {
    const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [d, h] of t) while (n >= d) { s += h; n -= d; }
    return s;
  }
  function harf(n) {
    const a = 'abcdefghijklmnopqrstuvwxyz';
    const tekrar = Math.floor((n - 1) / 26) + 1;
    return a[(n - 1) % 26].repeat(tekrar);
  }
  function numaraBicim(n, fmt) {
    switch (fmt) {
      case 'lowerLetter': return harf(n);
      case 'upperLetter': return harf(n).toUpperCase();
      case 'lowerRoman': return roma(n).toLowerCase();
      case 'upperRoman': return roma(n);
      case 'decimalZero': return n < 10 ? '0' + n : String(n);
      case 'none': return '';
      default: return String(n);
    }
  }

  // "12pt", "1.5in", "3cm" gibi VML ölçülerini puntoya çevirir.
  function uzunluk(v) {
    const e = /^\s*(-?[\d.]+)\s*(pt|in|cm|mm|px|pc)?/i.exec(v || '');
    if (!e) return null;
    const n = parseFloat(e[1]);
    switch ((e[2] || 'px').toLowerCase()) {
      case 'pt': return n;
      case 'in': return n * 72;
      case 'cm': return n * 28.3465;
      case 'mm': return n * 2.83465;
      case 'pc': return n * 12;
      default: return n * 0.75;
    }
  }

  BD.docxOku = async function (bayt) {
    const fflate = await BD.zip();
    let zip;
    try { zip = fflate.unzipSync(bayt); }
    catch (e) { throw new BD.Hata('Word dosyası açılamadı; dosya bozuk ya da şifreli olabilir.'); }
    const xmlAl = yol => (zip[yol] ? BD.xmlOku(BD.utf8Coz(zip[yol])).documentElement : null);
    const ana = xmlAl('word/document.xml');
    if (!ana) throw new BD.Hata('Bu dosya bir Word (.docx) belgesi değil.');

    /* ----- Tema yazı tipleri ----- */
    const tema = { minor: 'Calibri', major: 'Calibri Light' };
    const temaYol = Object.keys(zip).find(y => /^word\/theme\/theme\d*\.xml$/.test(y));
    if (temaYol) {
      const t = xmlAl(temaYol);
      for (const [anahtar, etiket] of [['minor', 'minorFont'], ['major', 'majorFont']]) {
        const el = t.getElementsByTagNameNS('*', etiket)[0];
        const latin = el && cocuk(el, 'latin');
        if (latin && latin.getAttribute('typeface')) tema[anahtar] = latin.getAttribute('typeface');
      }
    }
    const temaYt = ad => (/^major/.test(ad) ? tema.major : tema.minor);

    /* ----- Biçim okuma ----- */
    function rPrOku(el) {
      const b = {};
      for (const c of cocuklar(el)) {
        switch (c.localName) {
          case 'b': b.k = acik(c); break;
          case 'i': b.i = acik(c); break;
          case 'u': b.a = acik(c) && nit(c, 'val') !== 'none'; break;
          case 'strike': case 'dstrike': b.u = acik(c); break;
          case 'caps': b.buyuk = acik(c); break;
          case 'vanish': b.gizli = acik(c); break;
          case 'rStyle': b.stil = nit(c, 'val'); break;
          case 'vertAlign': { const v = nit(c, 'val'); b.ust = v === 'superscript'; b.alt = v === 'subscript'; break; }
          case 'sz': { const v = sayi(nit(c, 'val')); if (v > 0) b.boyut = v / 2; break; }
          case 'rFonts': {
            const f = nit(c, 'ascii') || nit(c, 'hAnsi');
            const t = nit(c, 'asciiTheme') || nit(c, 'hAnsiTheme');
            if (f) b.yt = f; else if (t) b.yt = temaYt(t); else if (nit(c, 'cs')) b.yt = b.yt || nit(c, 'cs');
            break;
          }
          case 'color': { const v = nit(c, 'val'); b.renk = v && /^[0-9a-f]{6}$/i.test(v) && !/^0{6}$/.test(v) ? '#' + v.toLowerCase() : null; break; }
          case 'highlight': b.zemin = VURGU[nit(c, 'val')] || null; break;
          case 'shd': { const v = nit(c, 'fill'); if (v && /^[0-9a-f]{6}$/i.test(v) && !/^f{6}$/i.test(v)) b.zemin = '#' + v.toLowerCase(); break; }
        }
      }
      return b;
    }

    const cizgiVar = el => { if (!el) return false; const v = nit(el, 'val'); return !!v && v !== 'nil' && v !== 'none'; };
    function pPrOku(el) {
      const p = {};
      for (const c of cocuklar(el)) {
        switch (c.localName) {
          case 'pStyle': p.stil = nit(c, 'val'); break;
          case 'jc': { const v = nit(c, 'val'); p.hiza = v === 'center' ? 'orta' : (v === 'right' || v === 'end') ? 'sag' : (v === 'both' || v === 'distribute') ? 'iki' : 'sol'; break; }
          case 'ind': {
            const l = sayi(ilk(nit(c, 'left'), nit(c, 'start'))), r = sayi(ilk(nit(c, 'right'), nit(c, 'end')));
            const f = sayi(nit(c, 'firstLine')), h = sayi(nit(c, 'hanging'));
            if (l != null) p.sol = l / 20;
            if (r != null) p.sag = r / 20;
            if (h != null) p.ilk = -h / 20; else if (f != null) p.ilk = f / 20;
            break;
          }
          case 'spacing': {
            const o = sayi(nit(c, 'before')), s = sayi(nit(c, 'after')), l = sayi(nit(c, 'line'));
            if (o != null) p.once = o / 20;
            if (s != null) p.sonra = s / 20;
            if (l != null && l > 0) {
              const kural = nit(c, 'lineRule') || 'auto';
              p.satir = kural === 'auto' ? { kat: l / 240 } : { deger: l / 20, enAz: kural === 'atLeast' };
            }
            break;
          }
          case 'tabs': {
            p.sekmeler = [];
            for (const t of cocuklar(c, 'tab')) {
              const v = nit(t, 'val'), yer = sayi(nit(t, 'pos'));
              if (yer == null || v === 'clear' || v === 'bar') continue;
              p.sekmeler.push({ yer: yer / 20, tip: (v === 'right' || v === 'end') ? 'sag' : v === 'center' ? 'orta' : 'sol' });
            }
            p.sekmeler.sort((a, b) => a.yer - b.yer);
            break;
          }
          case 'pageBreakBefore': p.sayfaOnce = acik(c); break;
          case 'contextualSpacing': p.bitisik = acik(c); break;
          case 'numPr': {
            const id = cocuk(c, 'numId'), sv = cocuk(c, 'ilvl');
            if (id) p.numId = nit(id, 'val');
            if (sv) p.ilvl = parseInt(nit(sv, 'val'), 10) || 0;
            break;
          }
          case 'pBdr': p.cizgiAlt = cizgiVar(cocuk(c, 'bottom')); p.cizgiUst = cizgiVar(cocuk(c, 'top')); break;
          case 'rPr': p.isaret = rPrOku(c); break;
          case 'sectPr': p.bolum = c; break;
        }
      }
      return p;
    }

    /* ----- Stiller ----- */
    const stiller = {};
    let varsP = {}, varsR = {}, varsParaStili = null;
    const stilKok = xmlAl('word/styles.xml');
    if (stilKok) {
      const dd = cocuk(stilKok, 'docDefaults');
      if (dd) {
        const r = cocuk(cocuk(dd, 'rPrDefault'), 'rPr'), p = cocuk(cocuk(dd, 'pPrDefault'), 'pPr');
        if (r) varsR = rPrOku(r);
        if (p) varsP = pPrOku(p);
      }
      for (const st of cocuklar(stilKok, 'style')) {
        const id = nit(st, 'styleId');
        if (!id) continue;
        const tblPr = cocuk(st, 'tblPr');
        stiller[id] = {
          tur: nit(st, 'type'), taban: nit(cocuk(st, 'basedOn'), 'val'),
          p: pPrOku(cocuk(st, 'pPr')), r: rPrOku(cocuk(st, 'rPr')),
          kenar: tblPr ? cocuk(tblPr, 'tblBorders') : null,
        };
        if (nit(st, 'type') === 'paragraph' && nit(st, 'default') === '1') varsParaStili = id;
      }
    }
    if (!varsR.boyut) varsR.boyut = 10;
    if (!varsR.yt) varsR.yt = BD.YT;
    const cozulen = {};
    function stilCoz(id) {
      if (!id || !stiller[id]) return { p: {}, r: {}, kenar: null };
      if (cozulen[id]) return cozulen[id];
      const zincir = [];
      for (let s = id, n = 0; s && stiller[s] && n < 20; s = stiller[s].taban, n++) zincir.unshift(stiller[s]);
      const sonuc = { p: {}, r: {}, kenar: null };
      for (const s of zincir) { Object.assign(sonuc.p, s.p); Object.assign(sonuc.r, s.r); if (s.kenar) sonuc.kenar = s.kenar; }
      delete sonuc.p.stil; delete sonuc.r.stil;
      return (cozulen[id] = sonuc);
    }

    /* ----- Numaralandırma ----- */
    const soyutlar = {}, numlar = {}, sayaclar = {};
    const numKok = xmlAl('word/numbering.xml');
    const seviyeOku = lvl => ({
      bas: parseInt(nit(cocuk(lvl, 'start'), 'val'), 10) || 1,
      fmt: nit(cocuk(lvl, 'numFmt'), 'val') || 'decimal',
      metin: nit(cocuk(lvl, 'lvlText'), 'val') || '',
      son: nit(cocuk(lvl, 'suff'), 'val') || 'tab',
      p: pPrOku(cocuk(lvl, 'pPr')), r: rPrOku(cocuk(lvl, 'rPr')),
    });
    if (numKok) {
      for (const a of cocuklar(numKok, 'abstractNum')) {
        const sv = {};
        for (const l of cocuklar(a, 'lvl')) sv[parseInt(nit(l, 'ilvl'), 10) || 0] = seviyeOku(l);
        soyutlar[nit(a, 'abstractNumId')] = sv;
      }
      for (const n of cocuklar(numKok, 'num')) {
        const kayit = { soyut: nit(cocuk(n, 'abstractNumId'), 'val'), ozel: {}, bas: {}, kullanildi: {} };
        for (const o of cocuklar(n, 'lvlOverride')) {
          const sv = parseInt(nit(o, 'ilvl'), 10) || 0;
          const b = cocuk(o, 'startOverride'), l = cocuk(o, 'lvl');
          if (b) kayit.bas[sv] = parseInt(nit(b, 'val'), 10) || 1;
          if (l) kayit.ozel[sv] = seviyeOku(l);
        }
        numlar[nit(n, 'numId')] = kayit;
      }
    }
    function numara(numId, sv) {
      const kayit = numlar[numId];
      if (!kayit || !soyutlar[kayit.soyut]) return null;
      const seviye = d => kayit.ozel[d] || soyutlar[kayit.soyut][d];
      const lvl = seviye(sv);
      if (!lvl) return null;
      const s = sayaclar[kayit.soyut] || (sayaclar[kayit.soyut] = []);
      if (kayit.bas[sv] != null && !kayit.kullanildi[sv]) { s[sv] = kayit.bas[sv] - 1; kayit.kullanildi[sv] = true; }
      if (s[sv] == null) s[sv] = lvl.bas - 1;
      s[sv]++;
      for (let d = sv + 1; d < 9; d++) s[d] = null;
      for (let d = 0; d < sv; d++) if (s[d] == null) s[d] = (seviye(d) || { bas: 1 }).bas;
      let metin;
      if (lvl.fmt === 'bullet') metin = !lvl.metin ? '' : MADDE[lvl.metin] || (lvl.metin && lvl.metin.length === 1 && lvl.metin.charCodeAt(0) < 0x2000 && lvl.metin.charCodeAt(0) > 0x20 ? lvl.metin : '•');
      else metin = lvl.metin.replace(/%(\d)/g, (_, n) => numaraBicim(s[n - 1] || 1, (seviye(n - 1) || lvl).fmt));
      return { metin, lvl };
    }

    /* ----- İlişkiler ve resimler ----- */
    function iliskiler(parcaYolu) {
      const dizin = parcaYolu.replace(/[^/]+$/, ''), dosya = parcaYolu.replace(/^.*\//, '');
      const kok = xmlAl(dizin + '_rels/' + dosya + '.rels');
      const harita = {};
      for (const r of cocuklar(kok, 'Relationship')) {
        let hedef = r.getAttribute('Target') || '';
        if (r.getAttribute('TargetMode') === 'External') continue;
        hedef = hedef[0] === '/' ? hedef.slice(1) : dizin + hedef;
        const parca = [];
        for (const b of hedef.split('/')) { if (b === '..') parca.pop(); else if (b !== '.') parca.push(b); }
        harita[r.getAttribute('Id')] = { yol: parca.join('/'), tur: (r.getAttribute('Type') || '').replace(/^.*\//, '') };
      }
      return harita;
    }
    const resimOnbellek = {};
    function resimAl(iliski, kimlik) {
      const kayit = iliski[kimlik];
      if (!kayit || !zip[kayit.yol]) return null;
      return resimOnbellek[kayit.yol] || (resimOnbellek[kayit.yol] = { veri: zip[kayit.yol] });
    }

    /* ----- Dipnotlar ----- */
    const dipnotKok = xmlAl('word/footnotes.xml');
    const dipnotIliski = dipnotKok ? iliskiler('word/footnotes.xml') : {};
    const dipnotlar = [];

    /* ----- Gövde ----- */
    function govdeOku(kok, ortam) {
      const bloklar = [];
      for (const c of cocuklar(kok)) {
        // Bölüm sonundan sonraki içerik yeni sayfadan başlar.
        if (ortam.ust && ortam.pay.sonrakiSayfa && (c.localName === 'p' || c.localName === 'tbl')) { bloklar.push({ tur: 'kirma' }); ortam.pay.sonrakiSayfa = false; }
        if (c.localName === 'p') bloklar.push(...paragrafOku(c, ortam));
        else if (c.localName === 'tbl') { const t = tabloOku(c, ortam); if (t) bloklar.push(t); }
        else if (c.localName === 'sdt') { const ic = cocuk(c, 'sdtContent'); if (ic) bloklar.push(...govdeOku(ic, ortam)); }
        else if (c.localName === 'customXml' || c.localName === 'smartTag') bloklar.push(...govdeOku(c, ortam));
      }
      return bloklar;
    }

    function paragrafOku(el, ortam) {
      const dogrudan = pPrOku(cocuk(el, 'pPr'));
      const stilId = dogrudan.stil || varsParaStili;
      const stil = stilCoz(stilId);
      const pp = Object.assign({}, varsP, ortam.tabloP, stil.p);
      const numId = ilk(dogrudan.numId, pp.numId), sv = ilk(dogrudan.ilvl, pp.ilvl, 0);
      let etiket = null;
      if (numId != null && numId !== '0') {
        etiket = numara(numId, sv);
        if (etiket) { if (etiket.lvl.p.sol != null) pp.sol = etiket.lvl.p.sol; if (etiket.lvl.p.ilk != null) pp.ilk = etiket.lvl.p.ilk; }
      }
      Object.assign(pp, dogrudan);
      const paraR = Object.assign({}, varsR, ortam.tabloR, stil.r);
      delete paraR.stil;

      const yeni = () => {
        const p = BD.paragraf([], { hiza: pp.hiza || 'sol', sol: pp.sol || 0, sag: pp.sag || 0, ilk: pp.ilk || 0, once: pp.once || 0, sonra: pp.sonra || 0 });
        if (pp.satir) { if (pp.satir.kat) p.aralik = pp.satir.kat; else p.sabit = { deger: pp.satir.deger, enAz: pp.satir.enAz }; }
        if (pp.sekmeler && pp.sekmeler.length) p.sekmeler = pp.sekmeler;
        if (pp.cizgiAlt) p.cizgiAlt = true;
        if (pp.cizgiUst) p.cizgiUst = true;
        const isaret = Object.assign({}, paraR, pp.isaret);
        p.bos = { boyut: isaret.boyut, yt: isaret.yt };
        p._stil = stilId; p._bitisik = !!pp.bitisik;
        return p;
      };
      const durum = { p: yeni(), bloklar: [], ek: [], alan: null, paraR, ortam };
      if (pp.sayfaOnce) durum.p.sayfaOnce = true;
      durum.bol = () => {
        const onceki = durum.p;
        if (onceki.parcalar.length) { onceki.sonra = 0; durum.bloklar.push(onceki); }
        durum.p = yeni();
        if (onceki.parcalar.length) { durum.p.once = 0; durum.p.ilk = Math.min(0, durum.p.ilk); }
        durum.p.sayfaOnce = true;
      };

      if (etiket && etiket.metin !== '') {
        const er = Object.assign({}, paraR, etiket.lvl.r);
        if (/symbol|wingdings|courier/i.test(etiket.lvl.r.yt || '')) er.yt = paraR.yt;
        durum.p.parcalar.push(bicimli(er, etiket.metin + (etiket.lvl.son === 'space' ? ' ' : etiket.lvl.son === 'nothing' ? '' : '\t')));
      }
      icerikOku(el, durum);
      durum.bloklar.push(durum.p);
      durum.bloklar.push(...durum.ek);
      if (pp.bolum) {
        ortam.pay.bolumler.push(pp.bolum);
        if (nit(cocuk(pp.bolum, 'type'), 'val') !== 'continuous') ortam.pay.sonrakiSayfa = true;
      }
      return durum.bloklar;
    }

    function bicimli(stil, m) {
      const x = { m: stil.buyuk ? m.toLocaleUpperCase('tr') : m, boyut: stil.boyut || 10, yt: stil.yt || BD.YT };
      if (stil.k) x.k = true;
      if (stil.i) x.i = true;
      if (stil.a) x.a = true;
      if (stil.u) x.u = true;
      if (stil.ust) x.ust = true;
      if (stil.alt) x.alt = true;
      if (stil.renk) x.renk = stil.renk;
      if (stil.zemin) x.zemin = stil.zemin;
      return x;
    }
    function metinEkle(durum, stil, m) {
      if (!m) return;
      const p = durum.p.parcalar, son = p[p.length - 1], x = bicimli(stil, m);
      if (son && son.m != null && !son.alan && ['k', 'i', 'a', 'u', 'ust', 'alt', 'renk', 'zemin', 'boyut', 'yt'].every(a => son[a] === x[a])) son.m += x.m;
      else p.push(x);
    }

    function icerikOku(el, durum) {
      for (const c of cocuklar(el)) {
        switch (c.localName) {
          case 'r': kosuOku(c, durum); break;
          case 'hyperlink': case 'smartTag': case 'ins': case 'moveTo': case 'customXml': case 'dir': case 'bdo': icerikOku(c, durum); break;
          case 'sdt': { const ic = cocuk(c, 'sdtContent'); if (ic) icerikOku(ic, durum); break; }
          case 'fldSimple': {
            const komut = nit(c, 'instr') || '';
            const tur = alanTuru(komut);
            if (tur) {
              const r = cocuk(c, 'r');
              durum.p.parcalar.push(Object.assign(bicimli(kosuStili(r, durum), ''), { alan: tur }));
            } else icerikOku(c, durum);
            break;
          }
          case 'oMath': case 'oMathPara': metinEkle(durum, durum.paraR, c.textContent); break;
        }
      }
    }
    const alanTuru = komut => (/^\s*PAGE\b/i.test(komut) ? 'sayfa' : /^\s*(NUMPAGES|SECTIONPAGES)\b/i.test(komut) ? 'toplam' : null);

    function kosuStili(r, durum) {
      const rp = r && cocuk(r, 'rPr');
      if (!rp) return durum.paraR;
      const d = rPrOku(rp);
      const s = Object.assign({}, durum.paraR, d.stil ? stilCoz(d.stil).r : null, d);
      delete s.stil;
      return s;
    }

    function kosuOku(r, durum) {
      const stil = kosuStili(r, durum);
      for (const c of cocuklar(r)) {
        const ad = c.localName;
        if (ad === 'fldChar') {
          const tur = nit(c, 'fldCharType');
          if (tur === 'begin') durum.alan = { asama: 'komut', komut: '', ic: (durum.alan ? 1 : 0) };
          else if (tur === 'separate' && durum.alan) {
            durum.alan.asama = 'sonuc';
            const a = alanTuru(durum.alan.komut);
            if (a) { durum.p.parcalar.push(Object.assign(bicimli(stil, ''), { alan: a })); durum.alan.atla = true; }
          } else if (tur === 'end' && durum.alan) {
            if (durum.alan.asama === 'komut') {
              const a = alanTuru(durum.alan.komut);
              if (a) durum.p.parcalar.push(Object.assign(bicimli(stil, ''), { alan: a }));
            }
            durum.alan = null;
          }
          continue;
        }
        if (ad === 'instrText') { if (durum.alan) durum.alan.komut += c.textContent; continue; }
        if (durum.alan && (durum.alan.asama === 'komut' || durum.alan.atla)) continue;
        if (stil.gizli) continue;
        switch (ad) {
          case 't': metinEkle(durum, stil, c.textContent); break;
          case 'tab': case 'ptab': metinEkle(durum, stil, '\t'); break;
          case 'cr': metinEkle(durum, stil, '\n'); break;
          case 'br': {
            const tur = nit(c, 'type');
            if (tur === 'page') durum.bol(); else metinEkle(durum, stil, '\n');
            break;
          }
          case 'noBreakHyphen': metinEkle(durum, stil, '-'); break;
          case 'sym': {
            const kod = parseInt(nit(c, 'char'), 16);
            metinEkle(durum, Object.assign({}, stil, { yt: durum.paraR.yt }), MADDE[String.fromCharCode(kod)] || '•');
            break;
          }
          case 'drawing': cizimOku(c, durum); break;
          case 'pict': case 'object': pictOku(c, durum); break;
          case 'AlternateContent': {
            const sec = cocuk(c, 'Choice'), yedek = cocuk(c, 'Fallback');
            const cizim = sec && cocuk(sec, 'drawing');
            if (cizim && (cizim.getElementsByTagNameNS('*', 'blip').length || cizim.getElementsByTagNameNS('*', 'txbxContent').length)) cizimOku(cizim, durum);
            else for (const y of cocuklar(yedek)) { if (y.localName === 'pict') pictOku(y, durum); else if (y.localName === 'drawing') cizimOku(y, durum); }
            break;
          }
          case 'footnoteReference': {
            const id = nit(c, 'id');
            const not = dipnotKok && cocuklar(dipnotKok, 'footnote').find(f => nit(f, 'id') === id);
            if (not) {
              dipnotlar.push(not);
              durum.p.parcalar.push(bicimli(Object.assign({}, stil, { ust: true, alt: false }), String(dipnotlar.length)));
            }
            break;
          }
          case 'footnoteRef':
            if (durum.ortam.dipnotNo) durum.p.parcalar.push(bicimli(Object.assign({}, stil, { ust: true, alt: false }), String(durum.ortam.dipnotNo)));
            break;
        }
      }
    }

    function resimEkle(durum, r, en, boy) {
      if (!r) return;
      durum.p.parcalar.push({ resim: r, en: en > 0 ? en : 0, boy: boy > 0 ? boy : 0 });
    }

    function cizimOku(cizim, durum) {
      const kutular = cizim.getElementsByTagNameNS('*', 'txbxContent');
      if (kutular.length) {
        for (let i = 0; i < kutular.length; i++) durum.ek.push(...govdeOku(kutular[i], durum.ortam));
        return;
      }
      const dis = cocuk(cizim, 'inline') || cocuk(cizim, 'anchor');
      const olcu = dis && cocuk(dis, 'extent');
      const en = olcu ? (parseFloat(olcu.getAttribute('cx')) || 0) / 12700 : 0, boy = olcu ? (parseFloat(olcu.getAttribute('cy')) || 0) / 12700 : 0;
      const blipler = cizim.getElementsByTagNameNS('*', 'blip');
      for (let i = 0; i < blipler.length; i++) {
        const r = resimAl(durum.ortam.iliski, nit(blipler[i], 'embed') || nit(blipler[i], 'link'));
        if (blipler.length === 1) resimEkle(durum, r, en, boy);
        else resimEkle(durum, r, 0, 0);
      }
    }

    function pictOku(pict, durum) {
      const kutular = pict.getElementsByTagNameNS('*', 'txbxContent');
      if (kutular.length) {
        for (let i = 0; i < kutular.length; i++) durum.ek.push(...govdeOku(kutular[i], durum.ortam));
        return;
      }
      const veriler = pict.getElementsByTagNameNS('*', 'imagedata');
      for (let i = 0; i < veriler.length; i++) {
        const r = resimAl(durum.ortam.iliski, nit(veriler[i], 'id'));
        const sekil = veriler[i].parentNode, stil = (sekil && sekil.getAttribute && sekil.getAttribute('style')) || '';
        const en = uzunluk((/(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(stil) || [])[1]);
        const boy = uzunluk((/(?:^|;)\s*height\s*:\s*([^;]+)/i.exec(stil) || [])[1]);
        resimEkle(durum, r, en || 0, boy || 0);
      }
    }

    function tabloOku(el, ortam) {
      const tblPr = cocuk(el, 'tblPr');
      const stilId = nit(cocuk(tblPr, 'tblStyle'), 'val');
      const stil = stilCoz(stilId);
      const kenarDurumu = k => {
        if (!k) return null;
        let v = null;
        for (const c of cocuklar(k)) { if (cizgiVar(c)) return true; v = false; }
        return v;
      };
      let kenarlik = kenarDurumu(tblPr && cocuk(tblPr, 'tblBorders'));
      if (kenarlik == null) kenarlik = kenarDurumu(stil.kenar) || false;
      const sutunlar = cocuklar(cocuk(el, 'tblGrid'), 'gridCol').map(g => (sayi(nit(g, 'w')) || 0) / 20);
      const altOrtam = Object.assign({}, ortam, { ust: false, tabloP: Object.assign({}, ortam.tabloP, stil.p), tabloR: Object.assign({}, ortam.tabloR, stil.r) });
      const satirlar = [];
      let cizgili = 0, cizgisiz = 0;
      const satirEkle = tr => {
        const hucreler = [];
        for (const tc of cocuklar(tr)) {
          if (tc.localName === 'sdt') { const ic = cocuk(tc, 'sdtContent'); for (const t of cocuklar(ic, 'tc')) hucreler.push(hucreOku(t)); }
          else if (tc.localName === 'tc') hucreler.push(hucreOku(tc));
        }
        if (hucreler.length) satirlar.push({ hucreler });
      };
      const hucreOku = tc => {
        const pr = cocuk(tc, 'tcPr');
        const h = { yatay: Math.max(1, parseInt(nit(cocuk(pr, 'gridSpan'), 'val'), 10) || 1) };
        const dikey = cocuk(pr, 'vMerge');
        if (dikey && nit(dikey, 'val') !== 'restart') h.devam = true;
        const zemin = nit(cocuk(pr, 'shd'), 'fill');
        if (zemin && /^[0-9a-f]{6}$/i.test(zemin) && !/^f{6}$/i.test(zemin)) h.zemin = '#' + zemin.toLowerCase();
        const k = kenarDurumu(cocuk(pr, 'tcBorders'));
        if (k === true) cizgili++; else if (k === false) cizgisiz++;
        const gen = sayi(nit(cocuk(pr, 'tcW'), 'w'));
        if (gen && nit(cocuk(pr, 'tcW'), 'type') !== 'pct') h._gen = gen / 20;
        h.bloklar = govdeOku(tc, altOrtam);
        if (!h.bloklar.length) h.bloklar.push(BD.paragraf([]));
        return h;
      };
      for (const c of cocuklar(el)) {
        if (c.localName === 'tr') satirEkle(c);
        else if (c.localName === 'sdt') { const ic = cocuk(c, 'sdtContent'); for (const tr of cocuklar(ic, 'tr')) satirEkle(tr); }
      }
      if (!satirlar.length) return null;
      const hucreSayisi = satirlar.reduce((a, s) => a + s.hucreler.length, 0);
      if (!kenarlik && cizgili * 2 >= hucreSayisi) kenarlik = true;
      if (kenarlik && cizgisiz === hucreSayisi) kenarlik = false;
      const n = Math.max(sutunlar.length, ...satirlar.map(s => s.hucreler.reduce((a, h) => a + h.yatay, 0)));
      // Izgara tanımı yoksa genişlikler hücrelerden çıkarılır.
      if (sutunlar.length < n || sutunlar.some(g => !(g > 0))) {
        const tahmin = new Array(n).fill(0);
        for (const s of satirlar) { let k = 0; for (const h of s.hucreler) { if (h.yatay === 1 && h._gen) tahmin[k] = Math.max(tahmin[k], h._gen); k += h.yatay; } }
        for (let i = 0; i < n; i++) if (!(sutunlar[i] > 0)) sutunlar[i] = tahmin[i] || 0;
      }
      for (const s of satirlar) for (const h of s.hucreler) delete h._gen;
      const t = { tur: 'tablo', sutunlar, kenarlik, satirlar };
      if (nit(cocuk(tblPr, 'jc'), 'val') === 'center') t.hiza = 'orta';
      return t;
    }

    /* ----- Bitişik aralık ve geçici alanlar ----- */
    function toparla(bloklar) {
      for (let i = 0; i < bloklar.length; i++) {
        const b = bloklar[i];
        if (b.tur === 'tablo') { for (const s of b.satirlar) for (const h of s.hucreler) toparla(h.bloklar); continue; }
        if (b.tur !== 'p') continue;
        const sonraki = bloklar[i + 1];
        if (b._bitisik && sonraki && sonraki.tur === 'p' && sonraki._bitisik && sonraki._stil === b._stil) { b.sonra = 0; sonraki.once = 0; }
      }
      for (const b of bloklar) if (b.tur === 'p') { delete b._stil; delete b._bitisik; }
      return bloklar;
    }

    /* ----- Belgeyi kur ----- */
    const belge = BD.yeniBelge();
    const ayar = xmlAl('word/settings.xml');
    const sekme = ayar && sayi(nit(cocuk(ayar, 'defaultTabStop'), 'val'));
    belge.sekme = sekme > 0 ? sekme / 20 : 35.4;

    const anaIliski = iliskiler('word/document.xml');
    const govde = cocuk(ana, 'body');
    const yeniOrtam = (iliski, ek) => Object.assign({ iliski, ust: false, pay: { bolumler: [], sonrakiSayfa: false }, tabloP: null, tabloR: null }, ek);
    const ortam = yeniOrtam(anaIliski, { ust: true });
    belge.bloklar = toparla(govdeOku(govde, ortam));
    const bolumler = ortam.pay.bolumler;
    const sonBolum = cocuk(govde, 'sectPr');
    if (sonBolum) bolumler.push(sonBolum);

    // Sayfa düzeni ilk bölümden alınır; üst ve alt bilgi tanımı olan ilk bölüm esas alınır.
    const bolum = bolumler[0];
    if (bolum) {
      const s = belge.sayfa, boyut = cocuk(bolum, 'pgSz'), kenar = cocuk(bolum, 'pgMar');
      const al = (el, ad, vars) => { const v = sayi(nit(el, ad)); return v != null ? Math.abs(v) / 20 : vars; };
      if (boyut) { s.en = al(boyut, 'w', s.en); s.boy = al(boyut, 'h', s.boy); }
      if (kenar) {
        s.ust = al(kenar, 'top', s.ust); s.alt = al(kenar, 'bottom', s.alt);
        s.sol = al(kenar, 'left', s.sol); s.sag = al(kenar, 'right', s.sag);
        s.ustbilgi = al(kenar, 'header', s.ustbilgi); s.altbilgi = al(kenar, 'footer', s.altbilgi);
      }
      if (s.en < 100 || s.boy < 100 || s.sol + s.sag > s.en - 72 || s.ust + s.alt > s.boy - 72) belge.sayfa = BD.yeniSayfa();
    }
    const parcaOku = kimlik => {
      const kayit = anaIliski[kimlik];
      if (!kayit) return null;
      const kok = xmlAl(kayit.yol);
      if (!kok) return null;
      const b = toparla(govdeOku(kok, yeniOrtam(iliskiler(kayit.yol))));
      const dolu = b.some(x => x.tur === 'tablo' || (x.tur === 'p' && x.parcalar.some(y => y.resim || y.alan || (y.m && y.m.trim()))));
      return dolu ? b : null;
    };
    const basvurular = { header: {}, footer: {} };
    let ilkFarkli = false;
    for (const b of bolumler) {
      if (!ilkFarkli && cocuk(b, 'titlePg') && acik(cocuk(b, 'titlePg')) && b === bolumler[0]) ilkFarkli = true;
      for (const c of cocuklar(b)) {
        const e = /^(header|footer)Reference$/.exec(c.localName);
        if (!e) continue;
        const tur = nit(c, 'type') || 'default';
        if (basvurular[e[1]][tur] == null) basvurular[e[1]][tur] = nit(c, 'id');
      }
    }
    if (basvurular.header.default) belge.ustbilgi = parcaOku(basvurular.header.default);
    if (basvurular.footer.default) belge.altbilgi = parcaOku(basvurular.footer.default);
    if (ilkFarkli) {
      belge.ilkFarkli = true;
      belge.ilkUstbilgi = basvurular.header.first ? parcaOku(basvurular.header.first) : null;
      belge.ilkAltbilgi = basvurular.footer.first ? parcaOku(basvurular.footer.first) : null;
    }

    // Dipnotlar belgenin sonuna, ince bir çizginin altına yazılır.
    if (dipnotlar.length) {
      belge.bloklar.push(BD.paragraf([], { cizgiAlt: true, sag: (belge.sayfa.en - belge.sayfa.sol - belge.sayfa.sag) * 0.6, bos: { boyut: 6 } }));
      dipnotlar.forEach((not, i) => {
        const b = toparla(govdeOku(not, yeniOrtam(dipnotIliski, { dipnotNo: i + 1 })));
        belge.bloklar.push(...b);
      });
    }
    if (!belge.bloklar.length) belge.bloklar.push(BD.paragraf([]));
    return belge;
  };
})(typeof self !== 'undefined' ? self : this);
