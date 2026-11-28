/* Hukuk Cebi: arayüz. Hesaplar hesap.js içindedir.
   Pano ve rehber kayıtları yalnızca bu cihazda, tarayıcının deposunda tutulur. */

(function () {
  'use strict';
  const H = window.Hesap;
  const $ = (s, k = document) => k.querySelector(s);
  const $$ = (s, k = document) => [...k.querySelectorAll(s)];
  const icerik = $('#icerik');

  // ---------- Yardımcılar ----------

  function kac(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function ikon(ad, sinif = 'ikon') { return `<svg class="${sinif}" aria-hidden="true"><use href="#i-${ad}"/></svg>`; }
  function uyariKutusu(metin) { return `<div class="uyari">${ikon('uyari')}<div>${kac(metin)}</div></div>`; }

  const depo = {
    oku(ad, varsayilan) {
      try { const v = localStorage.getItem('hukukcebi.' + ad); return v ? JSON.parse(v) : varsayilan; } catch (e) { return varsayilan; }
    },
    yaz(ad, deger) {
      try { localStorage.setItem('hukukcebi.' + ad, JSON.stringify(deger)); return true; } catch (e) { bildir('Kayıt yapılamadı: tarayıcı depoya izin vermiyor.'); return false; }
    },
  };

  let bildirimZaman;
  function bildir(metin) {
    const b = $('#bildirim');
    b.textContent = metin; b.hidden = false;
    clearTimeout(bildirimZaman);
    bildirimZaman = setTimeout(() => { b.hidden = true; }, 2600);
  }

  function kimlik() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function kalanYazi(n) {
    if (n === 0) return 'Bugün son gün';
    if (n === 1) return 'Yarın son gün';
    if (n > 0) return `${n} gün kaldı`;
    return `${-n} gün geçti`;
  }

  // Görünümler arası geçişte girilen değerler korunur.
  const durum = {
    sure: { kol: 'CMK', islemId: 'cmk-istinaf', tarih: H.bugun(), uets: false, tatilIstisna: false, miktar: '', birim: 'gün' },
    infaz: { tur: 'sureli', yil: '', ay: '', gun: '', oran: '1/2', rejim: 'genel', baslangic: '', mahsup: '', sucTarihi: '', istisna: false },
    ucret: { sekme: 'vekalet', tarih: H.bugun(), deger: '', mahkeme: 'asliye', odemeSuresinde: false, hDeger: '', hMahkeme: 'asliye', olum: false },
    faiz: { tur: 'yasal', oran: '', mod: 'tek', anapara: '', bas: '', bit: H.bugun(), taksit: '', ilk: '' },
  };

  function bagla(kok, alan, yeniden) {
    $$('[data-alan]', kok).forEach(el => {
      const ad = el.dataset.alan;
      const olay = el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(olay, () => {
        if (el.type === 'checkbox') alan[ad] = el.checked;
        else if (el.type === 'radio') { if (el.checked) alan[ad] = el.value; }
        else alan[ad] = el.value;
        yeniden(ad);
      });
    });
  }

  function secim(ad, secenekler, deger) {
    return `<div class="secim" role="radiogroup">${secenekler.map(([v, e]) =>
      `<label><input type="radio" name="${ad}" value="${kac(v)}" data-alan="${ad}" ${v === deger ? 'checked' : ''}><span>${kac(e)}</span></label>`).join('')}</div>`;
  }

  // ---------- Yönlendirme ----------

  const GORUNUMLER = {
    '': { baslik: 'Hukuk Cebi', etiket: 'Av. İsmail Savaş Yüksel', ciz: anaSayfa },
    sure: { baslik: 'Süre Hesabı', etiket: 'Kanun yolu ve usul süreleri', ciz: sureSayfa },
    infaz: { baslik: 'İnfaz Hesabı', etiket: 'Koşullu salıverilme', ciz: infazSayfa },
    ucret: { baslik: 'Ücret ve Harç', etiket: 'AAÜT ve yargı harçları', ciz: ucretSayfa },
    faiz: { baslik: 'Faiz Hesabı', etiket: 'Yasal ve ticari faiz', ciz: faizSayfa },
    pano: { baslik: 'Duruşma ve Süreler', etiket: 'Pano', ciz: panoSayfa },
    rehber: { baslik: 'Adliye Rehberi', etiket: 'Telefon ve bağlantılar', ciz: rehberSayfa },
  };

  function yonlen() {
    const ad = location.hash.replace('#', '');
    const g = GORUNUMLER[ad] || GORUNUMLER[''];
    $('[data-baslik]').textContent = g.baslik;
    $('[data-ust-etiket]').textContent = g.etiket;
    $('[data-geri]').hidden = !GORUNUMLER[ad] || ad === '';
    document.title = ad && GORUNUMLER[ad] ? `${g.baslik} · Hukuk Cebi` : 'Hukuk Cebi';
    icerik.innerHTML = '';
    g.ciz(icerik);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', yonlen);

  // ---------- Ana sayfa ----------

  function anaSayfa(kok) {
    const yakin = panoKayitlari().filter(k => k.tarih >= H.bugun()).sort(siralama)[0];
    const ozet = yakin
      ? `<a class="ozet" href="#pano">${ikon(yakin.tur === 'sure' ? 'sure' : 'pano')}<div><b>${kac(yakin.baslik || turAdi(yakin.tur))}</b><span>${kac(H.yazUzun(yakin.tarih))}${yakin.saat ? ' · ' + kac(yakin.saat) : ''} · ${kac(kalanPano(yakin.tarih))}</span></div></a>`
      : '';
    const kutular = [
      ['sure', 'sure', 'Süre Hesabı', 'İstinaf, temyiz, itiraz, cevap; adli tatil ve bayramlar dahil'],
      ['infaz', 'infaz', 'İnfaz Hesabı', 'Koşullu salıverilme ve denetimli serbestlik tarihleri'],
      ['ucret', 'ucret', 'Ücret ve Harç', 'Asgari vekalet ücreti, peşin harç, tarife tutarları'],
      ['faiz', 'faiz', 'Faiz Hesabı', 'Yasal ve ticari faiz; birikmiş nafaka taksitleri'],
      ['pano', 'pano', 'Duruşma ve Süreler', 'Yaklaşan duruşmalar ve kaçmaması gereken son günler'],
      ['rehber', 'rehber', 'Adliye Rehberi', 'Kalem telefonları, sık kullanılan bağlantılar, notlar'],
    ];
    kok.innerHTML = `
      <div class="karsilama"><p class="tarih">${kac(H.yazUzun(H.bugun()))}</p><h2>Hoş geldiniz</h2></div>
      ${ozet}
      <nav class="izgara" aria-label="Araçlar">${kutular.map(([h, i, b, a]) =>
        `<a class="kutu" href="#${h}">${ikon(i)}<b>${b}</b><span>${a}</span></a>`).join('')}</nav>
      <p class="alt-not">Hesaplar yardımcı niteliktedir. Kayıtlar yalnızca bu telefonda tutulur.</p>`;
  }

  // ---------- Süre hesabı ----------

  function sureSayfa(kok) {
    const d = durum.sure;
    kok.innerHTML = `
      <div class="kart">
        <div class="alan"><span>Yargı kolu</span>${secim('kol', [['CMK', 'Ceza'], ['HMK', 'Hukuk'], ['İİK', 'İcra']], d.kol)}</div>
        <label class="alan"><span>İşlem</span><select data-alan="islemId" id="s-islem"></select></label>
        <div class="satir" id="s-ozel" hidden>
          <label class="alan"><span>Süre</span><input type="text" inputmode="numeric" data-alan="miktar" value="${kac(d.miktar)}" placeholder="Örneğin 7"></label>
          <label class="alan"><span>Birim</span><select data-alan="birim">${['gün', 'hafta', 'ay'].map(b => `<option ${b === d.birim ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        </div>
        <div class="alan"><span>Tarih türü</span>${secim('uets', [['0', 'Tebliğ / öğrenme'], ['1', 'e-Tebligat ulaşma']], d.uets ? '1' : '0')}</div>
        <label class="alan"><span id="s-tarih-etiket">Tebliğ tarihi</span><input type="date" data-alan="tarih" value="${kac(d.tarih)}"></label>
        <label class="onay" id="s-istisna" style="margin-top:14px"><input type="checkbox" data-alan="tatilIstisna" ${d.tatilIstisna ? 'checked' : ''}><span id="s-istisna-yazi"></span></label>
      </div>
      <div id="s-sonuc"></div>`;

    const islemSec = $('#s-islem', kok);
    function islemleriDoldur() {
      const liste = H.ISLEMLER.filter(i => i.kol === d.kol);
      if (d.islemId !== 'ozel' && !liste.some(i => i.id === d.islemId)) d.islemId = liste[0].id;
      islemSec.innerHTML = liste.map(i => `<option value="${i.id}" ${i.id === d.islemId ? 'selected' : ''}>${kac(i.ad)} · ${i.miktar} ${i.birim}</option>`).join('')
        + `<option value="ozel" ${d.islemId === 'ozel' ? 'selected' : ''}>Özel süre (kararda verilen)</option>`;
      $('#s-ozel', kok).hidden = d.islemId !== 'ozel';
      const ist = $('#s-istisna', kok);
      ist.hidden = d.kol === 'İİK';
      $('#s-istisna-yazi', kok).innerHTML = d.kol === 'HMK'
        ? 'Adli tatilde görülen iş<small>Nafaka, soybağı, velayet, vesayet, ihtiyati tedbir, işçi davası, çekişmesiz yargı vb. (HMK 103). İşaretlenirse adli tatil uzatması uygulanmaz.</small>'
        : 'Tutuklu iş<small>Bilgi amaçlıdır; tutuklu işlerde de kanun yolu sürelerinde adli tatil koruması kabul edilmektedir.</small>';
      $('#s-tarih-etiket', kok).textContent = d.uets ? 'e-Tebligatın adrese ulaştığı gün' : (d.kol === 'CMK' && d.islemId === 'cmk-itiraz' ? 'Kararın öğrenildiği / tefhim tarihi' : 'Tebliğ tarihi');
    }

    function hesapla() {
      const girdi = { tarih: d.tarih, uets: d.uets, tatilIstisna: d.tatilIstisna };
      if (d.islemId === 'ozel') Object.assign(girdi, { kol: d.kol, miktar: H.sayiOku(d.miktar), birim: d.birim, ad: 'Özel süre' });
      else girdi.islemId = d.islemId;
      const r = H.sure(girdi);
      const yer = $('#s-sonuc', kok);
      if (r.hata) { yer.innerHTML = `<p class="hata">${kac(r.hata)}</p>`; return; }
      yer.innerHTML = `
        <section class="sonuc" aria-live="polite">
          <div class="sonuc-bas">
            <p class="etiket">Son gün · ${kac(r.islem.ad)}</p>
            <p class="buyuk">${kac(H.yazUzun(r.son))}</p>
            <span class="kalan ${r.kalan < 0 ? 'gecti' : ''}">${kac(kalanYazi(r.kalan))}</span>
          </div>
          <div class="sonuc-govde">
            <dl class="liste-dl">
              <div><dt>Dayanak</dt><dd>${kac(r.islem.dayanak)}</dd></div>
              <div><dt>Tebliğ sayılan gün</dt><dd>${kac(H.yaz(r.teblig))}</dd></div>
              <div><dt>Adli tatil</dt><dd>${kac(r.adliTatil)}<small>${kac(r.adliTatilDayanak)}</small></dd></div>
              ${r.ihtiyat ? `<div><dt>İhtiyatlı hedef</dt><dd>${kac(H.yaz(r.ihtiyat))}</dd></div>` : ''}
            </dl>
            ${r.uyarilar.map(uyariKutusu).join('')}
            ${r.islem.not ? `<div class="bilgi">${kac(r.islem.not)}</div>` : ''}
            <details class="aciklama"><summary>Hesabın adımları</summary><ol class="adimlar">${r.adimlar.map(a => `<li>${kac(a)}</li>`).join('')}</ol></details>
            <div class="dugmeler"><button type="button" class="dugme dugme-ana" data-panoya>${ikon('arti', 'ikon ikon-k')} Panoya ekle</button></div>
          </div>
        </section>`;
      $('[data-panoya]', yer).addEventListener('click', () => panoPenceresi({
        tur: 'sure', tarih: r.ihtiyat || r.son,
        baslik: `${r.islem.ad} son günü`,
        not: `${r.islem.dayanak}. Tebliğ: ${H.yaz(r.teblig)}. Yasal son gün: ${H.yaz(r.son)}.${r.ihtiyat ? ' İhtiyatlı hedef: ' + H.yaz(r.ihtiyat) + '.' : ''}`,
      }));
    }

    islemleriDoldur();
    bagla(kok, d, ad => {
      if (ad === 'uets') d.uets = d.uets === '1' || d.uets === true;
      if (ad === 'kol' || ad === 'islemId' || ad === 'uets') islemleriDoldur();
      hesapla();
    });
    hesapla();
  }

  // ---------- İnfaz ----------

  function infazSayfa(kok) {
    const d = durum.infaz;
    kok.innerHTML = `
      <div class="kart">
        <div class="alan"><span>Ceza türü</span>${secim('tur', [['sureli', 'Süreli'], ['muebbet', 'Müebbet'], ['agir', 'Ağırlaştırılmış']], d.tur)}</div>
        <div id="i-sureli">
          <div class="satir uc" style="margin-top:14px">
            <label class="alan"><span>Yıl</span><input type="text" inputmode="numeric" data-alan="yil" value="${kac(d.yil)}" placeholder="0"></label>
            <label class="alan"><span>Ay</span><input type="text" inputmode="numeric" data-alan="ay" value="${kac(d.ay)}" placeholder="0"></label>
            <label class="alan"><span>Gün</span><input type="text" inputmode="numeric" data-alan="gun" value="${kac(d.gun)}" placeholder="0"></label>
          </div>
          <label class="alan" style="margin-top:14px"><span>Koşullu salıverilme oranı</span>
            <select data-alan="oran">${H.KS_ORANLARI.map(o => `<option value="${o.id}" ${o.id === d.oran ? 'selected' : ''}>${o.id} · ${kac(o.ad)}</option>`).join('')}</select></label>
          <p class="ipucu" id="i-oran-aciklama" style="margin-top:6px"></p>
        </div>
        <label class="alan" id="i-rejim" style="margin-top:14px"><span>Rejim</span>
          <select data-alan="rejim">
            <option value="genel" ${d.rejim === 'genel' ? 'selected' : ''}>Genel (107/2)</option>
            <option value="orgut" ${d.rejim === 'orgut' ? 'selected' : ''}>Örgüt faaliyeti (107/4)</option>
            <option value="tekerrur" ${d.rejim === 'tekerrur' ? 'selected' : ''}>Tekerrür (108/1)</option>
          </select></label>
        <div class="satir" style="margin-top:14px">
          <label class="alan"><span>Cezaevine giriş</span><input type="date" data-alan="baslangic" value="${kac(d.baslangic)}"></label>
          <label class="alan"><span>Ayrıca mahsup (gün)</span><input type="text" inputmode="numeric" data-alan="mahsup" value="${kac(d.mahsup)}" placeholder="0"></label>
        </div>
        <p class="ipucu" style="margin-top:6px">Giriş tarihi, kesintisiz tutulduğu ilk yakalama günüdür. Daha önce ayrı dönemlerde geçen gözaltı ve tutukluluk günlerini mahsup alanına yazın.</p>
        <label class="alan" style="margin-top:14px"><span>Suç tarihi</span><input type="date" data-alan="sucTarihi" value="${kac(d.sucTarihi)}"></label>
        <label class="onay" style="margin-top:14px"><input type="checkbox" data-alan="istisna" ${d.istisna ? 'checked' : ''}><span>Suç, geçici maddelerin istisnaları arasında<small>Kasten öldürme, cinsel dokunulmazlığa karşı suçlar, özel hayata karşı suçlar, uyuşturucu ticareti, devletin güvenliğine karşı suçlar, terör ve örgüt suçları vb. İşaretlenirse 3 yıllık denetimli serbestlik ve geçici 10/6 uygulanmaz.</small></span></label>
      </div>
      <div id="i-sonuc"></div>`;

    function gorunum() {
      $('#i-sureli', kok).hidden = d.tur !== 'sureli';
      $('#i-rejim', kok).hidden = d.tur === 'sureli';
      const o = H.KS_ORANLARI.find(x => x.id === d.oran);
      $('#i-oran-aciklama', kok).textContent = o ? `${o.dayanak}. ${o.aciklama}` : '';
    }
    function hesapla() {
      const r = H.infaz({ ...d, yil: H.sayiOku(d.yil), ay: H.sayiOku(d.ay), gun: H.sayiOku(d.gun), mahsup: H.sayiOku(d.mahsup) });
      const yer = $('#i-sonuc', kok);
      if (r.hata) { yer.innerHTML = `<p class="hata">${kac(r.hata)}</p>`; return; }
      const b = H.bugun();
      yer.innerHTML = `
        <section class="sonuc" aria-live="polite">
          <div class="sonuc-bas">
            <p class="etiket">Koşullu salıverilme</p>
            <p class="buyuk">${kac(H.yazUzun(r.ks))}</p>
            <p class="alt-satir">Kurumda ${r.ksGun} gün · ${kac(r.oranAd)}</p>
          </div>
          <div class="sonuc-govde">
            <dl class="liste-dl">
              <div><dt>Denetimli serbestliğe ayrılış</dt><dd>${kac(H.yaz(r.ds))}<small>${r.dsYil} yıl kala · ${kac(r.dsDayanak)}</small></dd></div>
              ${r.ds2023 ? `<div><dt>Geçici 10/6 şartları oluşursa</dt><dd>${kac(H.yaz(r.ds2023))}<small>3 yıl erken; açık kurumda en az 3 ay şartı</small></dd></div>` : ''}
              ${r.tahliye ? `<div><dt>Hak ederek tahliye</dt><dd>${kac(H.yaz(r.tahliye))}</dd></div>` : ''}
              ${r.ds > b ? `<div><dt>Denetimli serbestliğe kalan</dt><dd>${H.fark(b, r.ds)} gün</dd></div>` : ''}
            </dl>
            ${r.uyarilar.map(uyariKutusu).join('')}
            <details class="aciklama"><summary>Hesabın adımları</summary><ol class="adimlar">${r.notlar.map(a => `<li>${kac(a)}</li>`).join('')}</ol></details>
            <p class="kaynak">5275 sayılı Kanun m.105/A, 107, 108, geçici m.6 ve geçici m.10 (güncel metin). Yıl ve ay hesabı TCK 61/6'ya göredir.</p>
          </div>
        </section>`;
    }
    gorunum();
    bagla(kok, d, () => { gorunum(); hesapla(); });
    hesapla();
  }

  // ---------- Ücret ve harç ----------

  function kendiKalemler() { return depo.oku('kalemler', []); }

  function ucretSayfa(kok) {
    const d = durum.ucret;
    kok.innerHTML = `
      ${secim('sekme', [['vekalet', 'Vekalet ücreti'], ['harc', 'Harç'], ['tablo', 'Tarife']], d.sekme)}
      <div id="u-govde" style="margin-top:14px"></div>`;
    const govde = $('#u-govde', kok);
    $$('[data-alan="sekme"]', kok).forEach(r => r.addEventListener('change', () => { d.sekme = r.value; ciz(); }));

    function ciz() {
      if (d.sekme === 'vekalet') vekaletCiz();
      else if (d.sekme === 'harc') harcCiz();
      else tabloCiz();
    }

    function vekaletCiz() {
      govde.innerHTML = `
        <div class="kart">
          <label class="alan"><span>Mahkeme / iş</span><select data-alan="mahkeme">
            <option value="">Seçilmedi (yalnızca nispi)</option>
            ${H.MAKTU_KALEMLER.map(([k, a]) => `<option value="${k}" ${k === d.mahkeme ? 'selected' : ''}>${kac(a)}</option>`).join('')}
          </select></label>
          <label class="alan"><span>Dava / takip değeri (TL)</span><input type="text" inputmode="decimal" data-alan="deger" value="${kac(d.deger)}" placeholder="Konusu para değilse boş bırakın"></label>
          <label class="alan"><span>Hüküm / işin bittiği tarih</span><input type="date" data-alan="tarih" value="${kac(d.tarih)}"></label>
          <label class="onay" id="u-odeme" style="margin-top:14px"><input type="checkbox" data-alan="odemeSuresinde" ${d.odemeSuresinde ? 'checked' : ''}><span>Borçlu ödeme süresi içinde ödedi<small>Ücretin dörtte üçü (AAÜT m.11/4)</small></span></label>
        </div>
        <div id="u-sonuc"></div>`;
      const hesapla = () => {
        $('#u-odeme', govde).hidden = !(d.mahkeme === 'icra_daire' || d.mahkeme === 'tahliye_icra');
        const r = H.vekalet({ tarih: d.tarih, deger: H.sayiOku(d.deger), mahkeme: d.mahkeme, odemeSuresinde: d.odemeSuresinde });
        const yer = $('#u-sonuc', govde);
        if (r.hata) { yer.innerHTML = `<p class="hata">${kac(r.hata)}</p>`; return; }
        yer.innerHTML = `
          <section class="sonuc">
            <div class="sonuc-bas"><p class="etiket">Asgari vekalet ücreti</p><p class="buyuk">${kac(H.para(r.sonuc))}</p>
              <p class="alt-satir">${kac(r.tarife.ad)} · ${kac(r.tarife.kunye)}</p></div>
            <div class="sonuc-govde">
              <dl class="liste-dl">
                ${r.nispi ? `<div><dt>Nispi hesap (Üçüncü Kısım)</dt><dd>${kac(H.para(r.nispi.toplam))}</dd></div>` : ''}
                ${r.maktu != null ? `<div><dt>Maktu alt sınır</dt><dd>${kac(H.para(r.maktu))}</dd></div>` : ''}
                <div><dt>Karşı tarafa yükletilebilecek üst sınır</dt><dd>${kac(H.para(r.sonuc * 3))}<small>Üç katı (m.3/1)</small></dd></div>
              </dl>
              ${r.notlar.map(n => `<div class="bilgi">${kac(n)}</div>`).join('')}
              ${r.nispi ? `<details class="aciklama"><summary>Dilim dilim hesap</summary><div class="tablo-kap"><table class="tablo"><thead><tr><th>Dilim</th><th>Oran</th><th>Tutar</th></tr></thead><tbody>
                ${r.nispi.satirlar.map(s => `<tr><td>${kac(H.para(s.alt).replace(' TL', ''))} - ${kac(H.para(s.ust))}</td><td>%${s.oran}</td><td>${kac(H.para(s.tutar))}</td></tr>`).join('')}
              </tbody></table></div></details>` : ''}
              <p class="kaynak">Hukuki yardımın tamamlandığı veya hükmün verildiği tarihteki tarife uygulanır (m.21). Ceza, istinaf ve Yargıtay duruşma ücretleri için Tarife sekmesine kendi doğruladığınız tutarı ekleyebilirsiniz.</p>
            </div>
          </section>`;
      };
      bagla(govde, d, hesapla);
      hesapla();
    }

    function harcCiz() {
      govde.innerHTML = `
        <div class="kart">
          <div class="alan"><span>Mahkeme</span>${secim('hMahkeme', [['asliye', 'Asliye'], ['sulh', 'Sulh']], d.hMahkeme)}</div>
          <label class="alan"><span>Dava değeri (TL)</span><input type="text" inputmode="decimal" data-alan="hDeger" value="${kac(d.hDeger)}" placeholder="Maktu harçlı davada boş bırakın"></label>
          <label class="onay" style="margin-top:14px"><input type="checkbox" data-alan="olum" ${d.olum ? 'checked' : ''}><span>Ölüm veya cismani zarar nedeniyle tazminat davası<small>Peşin harç yirmide bir oranında (492 s. K. m.28/a)</small></span></label>
        </div>
        <div id="h-sonuc"></div>`;
      const hesapla = () => {
        const r = H.harc({ tarih: H.bugun(), deger: H.sayiOku(d.hDeger), mahkeme: d.hMahkeme, olumCismani: d.olum });
        $('#h-sonuc', govde).innerHTML = `
          <section class="sonuc">
            <div class="sonuc-bas"><p class="etiket">Dava açılışında ödenecek harç</p><p class="buyuk">${kac(H.para(r.toplam))}</p>
              <p class="alt-satir">Gider avansı ve vekalet harcı hariç</p></div>
            <div class="sonuc-govde">
              ${r.uyarilar.map(uyariKutusu).join('')}
              <dl class="liste-dl">
                ${r.kalemler.map(k => `<div><dt>${kac(k.ad)}</dt><dd>${kac(H.para(k.tutar))}<small>${kac(k.dayanak)}</small></dd></div>`).join('')}
                ${r.nispi != null ? `<div><dt>Nispi karar ve ilam harcının tamamı</dt><dd>${kac(H.para(r.nispi))}<small>Binde 68,31; alt sınır ${kac(H.para(r.harc.nispiAlt))}</small></dd></div>` : ''}
              </dl>
              <p class="ara-baslik" style="margin-top:18px">Diğer maktu harçlar</p>
              <dl class="liste-dl">${r.digerleri.map(k => `<div><dt>${kac(k.ad)}</dt><dd>${kac(H.para(k.tutar))}<small>${kac(k.dayanak)}</small></dd></div>`).join('')}</dl>
              <p class="kaynak">492 sayılı Harçlar Kanunu (1) sayılı tarife; ${kac(r.harc.kunye)}. Tutarlar her yıl 1 Ocak'ta değişir.</p>
            </div>
          </section>`;
      };
      bagla(govde, d, hesapla);
      hesapla();
    }

    function tabloCiz() {
      const t = H.tarifeBul(H.bugun()) || H.AAUT[0];
      const kendi = kendiKalemler();
      govde.innerHTML = `
        <section class="sonuc" style="margin-top:0">
          <div class="sonuc-bas"><p class="etiket">Yürürlükteki tarife</p><p class="buyuk" style="font-size:1.375rem">${kac(t.ad)}</p><p class="alt-satir">${kac(t.kunye)}</p></div>
          <div class="sonuc-govde">
            <p class="ara-baslik">İkinci Kısım İkinci Bölüm, maktu ücretler</p>
            <dl class="liste-dl">${H.MAKTU_KALEMLER.map(([k, a, s]) => `<div><dt>${kac(a)}</dt><dd>${kac(H.para(t.maktu[k]))}<small>${kac(s)}</small></dd></div>`).join('')}</dl>
            <p class="ara-baslik" style="margin-top:18px">Nispi ücret dilimleri (Üçüncü Kısım)</p>
            <div class="tablo-kap"><table class="tablo"><thead><tr><th>Dilim</th><th>Oran</th></tr></thead><tbody>
              ${(() => { let a = 0; return t.dilimler.map(([dl, o]) => { const s = dl == null ? `${H.para(a)} üzeri` : `Sonraki ${H.para(dl)}`; a += dl || 0; return `<tr><td>${kac(s)}</td><td>%${o}</td></tr>`; }).join(''); })()}
            </tbody></table></div>
            <p class="kaynak">İcra takiplerinde ${kac(H.para(t.icraEsik))} tutarına kadar maktu ücret uygulanır (m.11/1).</p>
          </div>
        </section>
        <p class="grup-baslik">Kendi eklediğim kalemler <small>Ceza mahkemeleri, istinaf, Yargıtay vb.</small></p>
        <div class="kayitlar" id="k-liste">${kendi.length ? kendi.map(k => `
          <div class="kayit"><div class="kayit-govde"><b>${kac(k.ad)}</b><p>${kac(H.para(H.sayiOku(k.tutar)))}${k.not ? ' · ' + kac(k.not) : ''}</p></div>
          <div class="kayit-islem"><button type="button" class="simge" data-sil="${kac(k.id)}" aria-label="Sil">${ikon('cop')}</button></div></div>`).join('')
          : '<p class="bos">Tarife cetvelinden doğruladığınız tutarları buraya ekleyin. Örneğin ağır ceza mahkemesinde takip edilen davalar.</p>'}</div>
        <div class="kart" style="margin-top:12px">
          <label class="alan"><span>Kalem</span><input type="text" id="k-ad" placeholder="Örneğin Ağır ceza mahkemesi"></label>
          <div class="satir">
            <label class="alan"><span>Tutar (TL)</span><input type="text" inputmode="decimal" id="k-tutar" placeholder="0"></label>
            <label class="alan"><span>Not</span><input type="text" id="k-not" placeholder="Sıra no, yıl"></label>
          </div>
          <button type="button" class="dugme dugme-tam" id="k-ekle">${ikon('arti', 'ikon ikon-k')} Kalemi ekle</button>
        </div>`;
      $('#k-ekle', govde).addEventListener('click', () => {
        const ad = $('#k-ad', govde).value.trim();
        const tutar = $('#k-tutar', govde).value.trim();
        if (!ad || !(H.sayiOku(tutar) > 0)) { bildir('Kalem adını ve tutarı girin.'); return; }
        const l = kendiKalemler(); l.push({ id: kimlik(), ad, tutar, not: $('#k-not', govde).value.trim() });
        if (depo.yaz('kalemler', l)) tabloCiz();
      });
      $$('[data-sil]', govde).forEach(b => b.addEventListener('click', () => {
        depo.yaz('kalemler', kendiKalemler().filter(k => k.id !== b.dataset.sil)); tabloCiz();
      }));
    }
    ciz();
  }

  // ---------- Faiz ----------

  function faizSayfa(kok) {
    const d = durum.faiz;
    kok.innerHTML = `
      <div class="kart">
        <div class="alan"><span>Faiz türü</span>${secim('tur', [['yasal', 'Yasal'], ['ticari', 'Ticari'], ['sabit', 'Sabit oran']], d.tur)}</div>
        <label class="alan" id="f-oran"><span>Yıllık oran (%)</span><input type="text" inputmode="decimal" data-alan="oran" value="${kac(d.oran)}" placeholder="Örneğin 31"></label>
        <div class="alan" style="margin-top:14px"><span>Alacak</span>${secim('mod', [['tek', 'Tek tutar'], ['taksit', 'Aylık taksitler']], d.mod)}</div>
        <div id="f-tek">
          <label class="alan" style="margin-top:14px"><span>Anapara (TL)</span><input type="text" inputmode="decimal" data-alan="anapara" value="${kac(d.anapara)}" placeholder="0"></label>
          <label class="alan" style="margin-top:14px"><span>Faiz başlangıcı (temerrüt / dava tarihi)</span><input type="date" data-alan="bas" value="${kac(d.bas)}"></label>
        </div>
        <div id="f-taksit">
          <div class="satir" style="margin-top:14px">
            <label class="alan"><span>Aylık tutar (TL)</span><input type="text" inputmode="decimal" data-alan="taksit" value="${kac(d.taksit)}" placeholder="0"></label>
            <label class="alan"><span>İlk vade</span><input type="date" data-alan="ilk" value="${kac(d.ilk)}"></label>
          </div>
          <p class="ipucu" style="margin-top:6px">Birikmiş nafaka gibi her ay muaccel olan alacaklar için: her taksite kendi vadesinden itibaren faiz yürütülür.</p>
        </div>
        <label class="alan" style="margin-top:14px"><span>Hesap tarihi</span><input type="date" data-alan="bit" value="${kac(d.bit)}"></label>
      </div>
      <div id="f-sonuc"></div>`;

    function gorunum() {
      $('#f-oran', kok).hidden = d.tur !== 'sabit';
      $('#f-tek', kok).hidden = d.mod !== 'tek';
      $('#f-taksit', kok).hidden = d.mod !== 'taksit';
    }
    function hesapla() {
      const girdi = { tur: d.tur, ozelOran: H.sayiOku(d.oran), bit: d.bit };
      if (d.mod === 'taksit') Object.assign(girdi, { bas: d.ilk, taksit: { tutar: H.sayiOku(d.taksit), ilk: d.ilk } });
      else Object.assign(girdi, { bas: d.bas, anapara: H.sayiOku(d.anapara) });
      const r = H.faiz(girdi);
      const yer = $('#f-sonuc', kok);
      if (r.hata) { yer.innerHTML = `<p class="hata">${kac(r.hata)}</p>`; return; }
      yer.innerHTML = `
        <section class="sonuc">
          <div class="sonuc-bas"><p class="etiket">İşlemiş faiz</p><p class="buyuk">${kac(H.para(r.toplamFaiz))}</p>
            <p class="alt-satir">Anapara ile birlikte ${kac(H.para(r.toplam))}</p></div>
          <div class="sonuc-govde">
            ${r.uyarilar.map(uyariKutusu).join('')}
            <p class="ara-baslik" style="margin-top:12px">Oran dönemleri</p>
            <div class="tablo-kap"><table class="tablo"><thead><tr><th>Dönem</th><th>Oran</th><th>Faiz</th></tr></thead><tbody>
              ${r.donemler.map(p => `<tr><td>${kac(H.yaz(p.bas))} - ${kac(H.yaz(p.bit))}<br><small style="color:var(--silik)">${kac(p.kaynak)}</small></td><td>%${String(p.oran).replace('.', ',')}</td><td>${kac(H.para(p.faiz))}</td></tr>`).join('')}
            </tbody></table></div>
            ${r.kalemler.length > 1 ? `<details class="aciklama"><summary>Taksit taksit (${r.kalemler.length} taksit)</summary><div class="tablo-kap"><table class="tablo"><thead><tr><th>Vade</th><th>Gün</th><th>Faiz</th></tr></thead><tbody>
              ${r.kalemler.map(k => `<tr><td>${kac(H.yaz(k.bas))}</td><td>${k.gun}</td><td>${kac(H.para(k.faiz))}</td></tr>`).join('')}
            </tbody></table></div></details>` : ''}
            <p class="kaynak">Basit faiz, gün sayısı × oran / 365. Mürekkep faiz yürütülmez (3095 m.3). Yasal faiz 31.7.2026'dan itibaren TCMB'nin önceki yılın 31 Aralık reeskont oranının yüzde sekseni üzerinden işler (3095 m.1, 7589 s. K.).</p>
          </div>
        </section>`;
    }
    gorunum();
    bagla(kok, d, () => { gorunum(); hesapla(); });
    hesapla();
  }

  // ---------- Pano ----------

  function panoKayitlari() { return depo.oku('pano', []); }
  function siralama(a, b) { return (a.tarih + (a.saat || '99')).localeCompare(b.tarih + (b.saat || '99')); }
  function turAdi(t) { return { durusma: 'Duruşma', sure: 'Kesin süre', not: 'Hatırlatma' }[t] || 'Kayıt'; }
  function kalanPano(t) { const n = H.fark(H.bugun(), t); return n === 0 ? 'bugün' : n === 1 ? 'yarın' : n > 0 ? `${n} gün sonra` : `${-n} gün önce`; }

  function panoSayfa(kok) {
    const liste = panoKayitlari().sort(siralama);
    const b = H.bugun();
    const haftaSonu = H.gunEkle(b, 7);
    const gruplar = [
      ['Bugün', liste.filter(k => k.tarih === b)],
      ['Önümüzdeki 7 gün', liste.filter(k => k.tarih > b && k.tarih <= haftaSonu)],
      ['Daha sonra', liste.filter(k => k.tarih > haftaSonu)],
      ['Geçmiş', liste.filter(k => k.tarih < b).reverse().slice(0, 20)],
    ];
    const ay = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const kart = k => `
      <div class="kayit ${k.tur === 'sure' ? 'kesin' : ''} ${k.tarih < b ? 'gecmis' : ''}">
        <div class="kayit-tarih"><b>${Number(k.tarih.slice(8))}</b><span>${ay[Number(k.tarih.slice(5, 7)) - 1]} ${k.tarih.slice(2, 4)}</span></div>
        <div class="kayit-govde"><p class="tur" style="color:var(--vurgu);margin:0">${kac(turAdi(k.tur))}${k.saat ? ' · ' + kac(k.saat) : ''} · ${kac(kalanPano(k.tarih))}</p>
          <b>${kac(k.baslik || turAdi(k.tur))}</b>${k.not ? `<p>${kac(k.not)}</p>` : ''}</div>
        <div class="kayit-islem">
          <button type="button" class="simge" data-duzen="${kac(k.id)}" aria-label="Düzenle">${ikon('kalem')}</button>
          <button type="button" class="simge" data-takvim="${kac(k.id)}" aria-label="Takvime ekle">${ikon('takvim')}</button>
        </div>
      </div>`;
    kok.innerHTML = (liste.length ? gruplar.filter(g => g[1].length).map(([a, l]) =>
      `<p class="grup-baslik">${a} <small>${l.length} kayıt</small></p><div class="kayitlar">${l.map(kart).join('')}</div>`).join('')
      : `<p class="bos">Henüz kayıt yok. Duruşmalarınızı ve kesin süreleri ekleyin; Süre Hesabı ekranındaki "Panoya ekle" düğmesi de buraya kaydeder.</p>`)
      + `<div class="dugmeler" style="margin-top:26px"><button type="button" class="dugme dugme-sade" data-yedek-al>Yedek al</button><label class="dugme dugme-sade">Yedekten yükle<input type="file" accept="application/json,.json" hidden data-yedek-yukle></label></div>
      <p class="alt-not" style="text-align:left">Kayıtlar yalnızca bu telefonda durur. Telefon değişikliğinde yedek dosyasını kullanın.</p>
      <button type="button" class="ekle-dugme" data-ekle aria-label="Kayıt ekle">${ikon('arti')}</button>`;

    $('[data-ekle]', kok).addEventListener('click', () => panoPenceresi({ tur: 'durusma', tarih: b }));
    $$('[data-duzen]', kok).forEach(x => x.addEventListener('click', () => panoPenceresi(liste.find(k => k.id === x.dataset.duzen))));
    $$('[data-takvim]', kok).forEach(x => x.addEventListener('click', () => takvimeAktar(liste.find(k => k.id === x.dataset.takvim))));
    $('[data-yedek-al]', kok).addEventListener('click', yedekAl);
    $('[data-yedek-yukle]', kok).addEventListener('change', e => yedekYukle(e.target.files[0]));
  }

  function panoPenceresi(k) {
    const yeni = !k.id;
    pencereAc(yeni ? 'Kayıt ekle' : 'Kaydı düzenle', `
      <form id="p-form">
        <div class="alan"><span>Tür</span>${secim('ptur', [['durusma', 'Duruşma'], ['sure', 'Kesin süre'], ['not', 'Hatırlatma']], k.tur || 'durusma')}</div>
        <div class="satir" style="margin-top:14px">
          <label class="alan"><span>Tarih</span><input type="date" name="tarih" required value="${kac(k.tarih || '')}"></label>
          <label class="alan"><span>Saat</span><input type="time" name="saat" value="${kac(k.saat || '')}"></label>
        </div>
        <label class="alan" style="margin-top:14px"><span>Mahkeme ve esas no</span><input type="text" name="baslik" value="${kac(k.baslik || '')}" placeholder="Örneğin Ankara 5. Asliye Ceza, 2026/123 E."></label>
        <label class="alan" style="margin-top:14px"><span>Not</span><textarea name="not" placeholder="Yapılacak iş, tanık, belge">${kac(k.not || '')}</textarea></label>
        <p class="ipucu" style="margin-top:8px">Müvekkil adı yerine dosya numarası yazmanız önerilir.</p>
        <button type="submit" class="dugme dugme-ana dugme-tam">Kaydet</button>
        ${yeni ? '' : '<button type="button" class="dugme dugme-tehlike dugme-tam" data-sil style="margin-top:8px">Kaydı sil</button>'}
      </form>`);
    const f = $('#p-form');
    f.addEventListener('submit', e => {
      e.preventDefault();
      const v = new FormData(f);
      if (!H.gecerliTarih(v.get('tarih'))) { bildir('Tarih girin.'); return; }
      const kayit = { id: k.id || kimlik(), tur: v.get('ptur'), tarih: v.get('tarih'), saat: v.get('saat') || '', baslik: v.get('baslik').trim(), not: v.get('not').trim() };
      const l = panoKayitlari().filter(x => x.id !== kayit.id); l.push(kayit);
      if (depo.yaz('pano', l)) {
        pencereKapat(); bildir('Panoya kaydedildi.');
        if (location.hash === '#pano') yonlen();
      }
    });
    const sil = $('[data-sil]', f);
    if (sil) sil.addEventListener('click', () => {
      if (!confirm('Bu kayıt silinsin mi?')) return;
      depo.yaz('pano', panoKayitlari().filter(x => x.id !== k.id));
      pencereKapat(); yonlen();
    });
  }

  function indir(ad, icerikMetni, tur) {
    const blob = new Blob([icerikMetni], { type: tur });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = ad; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function takvimeAktar(k) {
    const t = k.tarih.replace(/-/g, '');
    const ics = s => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
    let bas, bit;
    if (k.saat) {
      const s = k.saat.replace(':', '') + '00';
      const [sa, dk] = k.saat.split(':').map(Number);
      const son = `${String(Math.min(23, sa + 1)).padStart(2, '0')}${String(dk).padStart(2, '0')}00`;
      bas = `DTSTART:${t}T${s}`; bit = `DTEND:${t}T${son}`;
    } else {
      bas = `DTSTART;VALUE=DATE:${t}`; bit = `DTEND;VALUE=DATE:${H.gunEkle(k.tarih, 1).replace(/-/g, '')}`;
    }
    const metin = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hukuk Cebi//TR', 'BEGIN:VEVENT', `UID:${k.id}@hukukcebi`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, bas, bit,
      `SUMMARY:${ics(turAdi(k.tur) + ': ' + (k.baslik || ''))}`, `DESCRIPTION:${ics(k.not)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Hatırlatma', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    indir(`${k.tarih}.ics`, metin, 'text/calendar');
  }

  function yedekAl() {
    const veri = { surum: 1, tarih: new Date().toISOString(), pano: panoKayitlari(), rehber: rehberKayitlari(), kalemler: kendiKalemler() };
    indir(`hukuk-cebi-yedek-${H.bugun()}.json`, JSON.stringify(veri, null, 2), 'application/json');
  }
  function yedekYukle(dosya) {
    if (!dosya) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const v = JSON.parse(r.result);
        if (!v || v.surum !== 1) throw new Error();
        if (!confirm('Yedekteki kayıtlar mevcut kayıtların yerine geçecek. Devam edilsin mi?')) return;
        depo.yaz('pano', Array.isArray(v.pano) ? v.pano : []);
        depo.yaz('rehber', Array.isArray(v.rehber) ? v.rehber : []);
        depo.yaz('kalemler', Array.isArray(v.kalemler) ? v.kalemler : []);
        bildir('Yedek yüklendi.'); yonlen();
      } catch (e) { bildir('Dosya okunamadı.'); }
    };
    r.readAsText(dosya);
  }

  // ---------- Rehber ----------

  const SABIT_BAGLANTILAR = [
    ['UYAP Avukat Portal', 'https://avukat.uyap.gov.tr'],
    ['Mevzuat Bilgi Sistemi', 'https://www.mevzuat.gov.tr'],
    ['Resmi Gazete', 'https://www.resmigazete.gov.tr'],
    ['Yargıtay Karar Arama', 'https://karararama.yargitay.gov.tr'],
    ['Ankara Barosu', 'https://www.ankarabarosu.org.tr'],
  ];
  function rehberKayitlari() { return depo.oku('rehber', []); }

  function rehberSayfa(kok) {
    const l = rehberKayitlari().sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    const temizTel = t => String(t || '').replace(/[^\d+]/g, '');
    kok.innerHTML = `
      <p class="grup-baslik">Kendi kayıtlarım <small>${l.length} kayıt</small></p>
      <div class="kayitlar">${l.length ? l.map(k => `
        <div class="kayit"><div class="kayit-govde"><b>${kac(k.ad)}</b>${k.tel ? `<p>${kac(k.tel)}</p>` : ''}${k.not ? `<p>${kac(k.not)}</p>` : ''}</div>
          <div class="kayit-islem">
            ${k.tel ? `<a class="simge" href="tel:${kac(temizTel(k.tel))}" aria-label="Ara">${ikon('tel')}</a>` : ''}
            ${k.bag ? `<a class="simge" href="${kac(k.bag)}" target="_blank" rel="noopener" aria-label="Bağlantıyı aç">${ikon('bag')}</a>` : ''}
            <button type="button" class="simge" data-duzen="${kac(k.id)}" aria-label="Düzenle">${ikon('kalem')}</button>
          </div></div>`).join('')
        : '<p class="bos">Kalem telefonlarını, savcılık bürolarını, bilirkişi ve tercüman bilgilerini, adliyedeki birimlerin kat ve oda numaralarını buraya ekleyin.</p>'}</div>
      <p class="grup-baslik">Bağlantılar</p>
      <div class="kayitlar">${SABIT_BAGLANTILAR.map(([a, u]) => `
        <a class="kayit" href="${u}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;align-items:center">
          <div class="kayit-govde"><b>${kac(a)}</b><p>${kac(u.replace('https://', ''))}</p></div>${ikon('bag')}</a>`).join('')}</div>
      <button type="button" class="ekle-dugme" data-ekle aria-label="Kayıt ekle">${ikon('arti')}</button>`;
    $('[data-ekle]', kok).addEventListener('click', () => rehberPenceresi({}));
    $$('[data-duzen]', kok).forEach(x => x.addEventListener('click', () => rehberPenceresi(l.find(k => k.id === x.dataset.duzen))));
  }

  function rehberPenceresi(k) {
    const yeni = !k.id;
    pencereAc(yeni ? 'Rehbere ekle' : 'Kaydı düzenle', `
      <form id="r-form">
        <label class="alan"><span>Ad</span><input type="text" name="ad" required value="${kac(k.ad || '')}" placeholder="Örneğin 5. Asliye Ceza kalemi"></label>
        <label class="alan"><span>Telefon</span><input type="tel" name="tel" value="${kac(k.tel || '')}" placeholder="0 312 ..."></label>
        <label class="alan"><span>Bağlantı</span><input type="url" name="bag" value="${kac(k.bag || '')}" placeholder="https://"></label>
        <label class="alan"><span>Not</span><textarea name="not" placeholder="Kat, oda, çalışma saatleri">${kac(k.not || '')}</textarea></label>
        <button type="submit" class="dugme dugme-ana dugme-tam">Kaydet</button>
        ${yeni ? '' : '<button type="button" class="dugme dugme-tehlike dugme-tam" data-sil style="margin-top:8px">Kaydı sil</button>'}
      </form>`);
    const f = $('#r-form');
    f.addEventListener('submit', e => {
      e.preventDefault();
      const v = new FormData(f);
      const ad = v.get('ad').trim();
      if (!ad) return;
      let bag = v.get('bag').trim();
      if (bag && !/^https?:\/\//i.test(bag)) bag = 'https://' + bag;
      const kayit = { id: k.id || kimlik(), ad, tel: v.get('tel').trim(), bag, not: v.get('not').trim() };
      const l = rehberKayitlari().filter(x => x.id !== kayit.id); l.push(kayit);
      if (depo.yaz('rehber', l)) { pencereKapat(); yonlen(); }
    });
    const sil = $('[data-sil]', f);
    if (sil) sil.addEventListener('click', () => {
      if (!confirm('Bu kayıt silinsin mi?')) return;
      depo.yaz('rehber', rehberKayitlari().filter(x => x.id !== k.id));
      pencereKapat(); yonlen();
    });
  }

  // ---------- Pencere ----------

  const pencere = $('#pencere');
  function pencereAc(baslik, html) {
    $('#pencere-baslik').textContent = baslik;
    $('#pencere-govde').innerHTML = html;
    if (typeof pencere.showModal === 'function') pencere.showModal(); else pencere.setAttribute('open', '');
  }
  function pencereKapat() { if (pencere.open) pencere.close(); }
  $('[data-kapat]', pencere).addEventListener('click', pencereKapat);
  pencere.addEventListener('click', e => { if (e.target === pencere) pencereKapat(); });

  // ---------- Başlat ----------

  yonlen();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
