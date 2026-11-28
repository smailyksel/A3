/* Hukuk Cebi: hesap kuralları ve tablolar.
   Arayüzden bağımsızdır; tarayıcıda window.Hesap, Node'da module.exports olarak gelir.
   Tutar ve oranlar kaynağıyla birlikte yazılmıştır. Yürürlük aralığı dışındaki bir
   tarih için tablo değeri sessizce kullanılmaz, uyarı üretilir. */

(function (kok) {
  'use strict';

  const GUN = 86400000;

  // ---------- Tarih yardımcıları (yalnızca gün; saat dilimi etkisiz) ----------

  function ms(t) { const [y, a, g] = t.split('-').map(Number); return Date.UTC(y, a - 1, g); }
  function str(m) { return new Date(m).toISOString().slice(0, 10); }
  function gunEkle(t, n) { return str(ms(t) + n * GUN); }
  function ayEkle(t, n) {
    const [y, a, g] = t.split('-').map(Number);
    const hedef = a - 1 + n;
    const yy = y + Math.floor(hedef / 12);
    const aa = ((hedef % 12) + 12) % 12;
    const son = new Date(Date.UTC(yy, aa + 1, 0)).getUTCDate();
    return str(Date.UTC(yy, aa, Math.min(g, son)));
  }
  function yilEkle(t, n) { return ayEkle(t, 12 * n); }
  function haftaGunu(t) { return new Date(ms(t)).getUTCDay(); }
  function fark(a, b) { return Math.round((ms(b) - ms(a)) / GUN); }
  function yil(t) { return Number(t.slice(0, 4)); }
  function bugun() {
    const s = new Date();
    return str(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));
  }
  function gecerliTarih(t) { return typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) && str(ms(t)) === t; }

  const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  function yaz(t) { const [y, a, g] = t.split('-'); return `${g}.${a}.${y}`; }
  function yazUzun(t) { const [y, a, g] = t.split('-').map(Number); return `${g} ${AYLAR[a - 1]} ${y} ${GUNLER[haftaGunu(t)]}`; }

  // ---------- Resmi tatiller ----------
  // 2429 sayılı Kanun m.1-2; dini bayramlar Diyanet takvimine göre. Arife ve 28 Ekim
  // yarım gündür, tatil sayılmaz (sabah mesaisi vardır), yalnızca uyarı verilir.
  // Cumartesi ve Pazar ayrıca tatildir. 2027 dini bayramları kesin takvimden teyit edilmelidir.

  const TATIL = {
    '2025-01-01': 'Yılbaşı', '2025-03-30': 'Ramazan Bayramı', '2025-03-31': 'Ramazan Bayramı', '2025-04-01': 'Ramazan Bayramı',
    '2025-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı', '2025-05-01': 'Emek ve Dayanışma Günü', '2025-05-19': 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı',
    '2025-06-06': 'Kurban Bayramı', '2025-06-07': 'Kurban Bayramı', '2025-06-08': 'Kurban Bayramı', '2025-06-09': 'Kurban Bayramı',
    '2025-07-15': 'Demokrasi ve Milli Birlik Günü', '2025-08-30': 'Zafer Bayramı', '2025-10-29': 'Cumhuriyet Bayramı',

    '2026-01-01': 'Yılbaşı', '2026-03-20': 'Ramazan Bayramı', '2026-03-21': 'Ramazan Bayramı', '2026-03-22': 'Ramazan Bayramı',
    '2026-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı', '2026-05-01': 'Emek ve Dayanışma Günü', '2026-05-19': 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı',
    '2026-05-27': 'Kurban Bayramı', '2026-05-28': 'Kurban Bayramı', '2026-05-29': 'Kurban Bayramı', '2026-05-30': 'Kurban Bayramı',
    '2026-07-15': 'Demokrasi ve Milli Birlik Günü', '2026-08-30': 'Zafer Bayramı', '2026-10-29': 'Cumhuriyet Bayramı',

    '2027-01-01': 'Yılbaşı', '2027-03-09': 'Ramazan Bayramı', '2027-03-10': 'Ramazan Bayramı', '2027-03-11': 'Ramazan Bayramı',
    '2027-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı', '2027-05-01': 'Emek ve Dayanışma Günü',
    '2027-05-16': 'Kurban Bayramı', '2027-05-17': 'Kurban Bayramı', '2027-05-18': 'Kurban Bayramı', '2027-05-19': 'Kurban Bayramı',
    '2027-07-15': 'Demokrasi ve Milli Birlik Günü', '2027-08-30': 'Zafer Bayramı', '2027-10-29': 'Cumhuriyet Bayramı',
  };
  const YARIM_GUN = {
    '2025-03-29': 'Ramazan Bayramı arifesi', '2025-06-05': 'Kurban Bayramı arifesi', '2025-10-28': 'Cumhuriyet Bayramı arifesi',
    '2026-03-19': 'Ramazan Bayramı arifesi', '2026-05-26': 'Kurban Bayramı arifesi', '2026-10-28': 'Cumhuriyet Bayramı arifesi',
    '2027-03-08': 'Ramazan Bayramı arifesi', '2027-05-15': 'Kurban Bayramı arifesi', '2027-10-28': 'Cumhuriyet Bayramı arifesi',
  };
  const TATIL_ILK_YIL = 2025, TATIL_SON_YIL = 2027;

  function tatilMi(t) {
    const h = haftaGunu(t);
    if (h === 0 || h === 6) return h === 0 ? 'Pazar' : 'Cumartesi';
    return TATIL[t] || null;
  }

  function isGunune(t) {
    const atlanan = [];
    let x = t;
    for (let i = 0; i < 30; i++) {
      const neden = tatilMi(x);
      if (!neden) break;
      atlanan.push(`${yaz(x)} ${neden}`);
      x = gunEkle(x, 1);
    }
    return { tarih: x, atlanan };
  }

  // ---------- Süre katalogu ----------
  // Her kalem güncel kanun metninden alınmıştır.

  const ISLEMLER = [
    { id: 'cmk-istinaf', kol: 'CMK', ad: 'İstinaf', miktar: 2, birim: 'hafta', dayanak: 'CMK 273/1',
      not: 'Süre, hükmün gerekçesiyle birlikte tebliğinden başlar. 7499 sayılı Kanunla 273/2 yürürlükten kaldırılmıştır; 1.6.2024 öncesi kararlarda geçiş hükmünü ayrıca kontrol edin.' },
    { id: 'cmk-temyiz', kol: 'CMK', ad: 'Temyiz', miktar: 2, birim: 'hafta', dayanak: 'CMK 291/1',
      not: 'Süre, hükmün gerekçesiyle birlikte tebliğinden başlar.' },
    { id: 'cmk-itiraz', kol: 'CMK', ad: 'Karara itiraz', miktar: 2, birim: 'hafta', dayanak: 'CMK 268/1',
      not: 'Kanunun ayrıca hüküm koymadığı hallerde, kararın öğrenildiği günden başlar.' },
    { id: 'cmk-istinaf-cevap', kol: 'CMK', ad: 'Savcılık istinafına cevap', miktar: 2, birim: 'hafta', dayanak: 'CMK 273/5', not: '' },

    { id: 'hmk-cevap', kol: 'HMK', ad: 'Cevap dilekçesi', miktar: 2, birim: 'hafta', dayanak: 'HMK 127/1',
      not: 'Yazılı yargılama usulü. Ek süre bu süre içinde istenmelidir. Basit yargılamada da cevap süresi iki haftadır (HMK 317/2).' },
    { id: 'hmk-ikinci', kol: 'HMK', ad: 'Cevaba cevap / ikinci cevap', miktar: 2, birim: 'hafta', dayanak: 'HMK 136/1', not: '' },
    { id: 'hmk-istinaf', kol: 'HMK', ad: 'İstinaf', miktar: 2, birim: 'hafta', dayanak: 'HMK 345/1',
      not: 'İlamın usulen tebliğiyle başlar. Özel kanun hükümleri saklıdır.' },
    { id: 'hmk-temyiz', kol: 'HMK', ad: 'Temyiz', miktar: 2, birim: 'hafta', dayanak: 'HMK 361/1', not: '' },

    { id: 'iik-itiraz', kol: 'İİK', ad: 'Ödeme emrine itiraz (ilamsız takip)', miktar: 7, birim: 'gün', dayanak: 'İİK 62',
      not: 'İcra dairesine yapılır, takibi durdurur.' },
    { id: 'iik-kambiyo', kol: 'İİK', ad: 'Kambiyo takibinde borca itiraz', miktar: 5, birim: 'gün', dayanak: 'İİK 168/5',
      not: 'İcra mahkemesine yapılır, kendiliğinden takibi durdurmaz.' },
  ];

  const ADLI_TATIL_DAYANAK = { CMK: 'CMK 331/4', HMK: 'HMK 104', 'İİK': 'İİK 18/1 ve HMK 103/1-h' };

  function sureEkle(t, miktar, birim) {
    if (birim === 'gün') return gunEkle(t, miktar);
    if (birim === 'hafta') return gunEkle(t, 7 * miktar);
    return ayEkle(t, miktar);
  }

  /* girdi: { islemId | (kol, miktar, birim, ad), tarih, uets, tatilIstisna, bugun }
     tarih: tebliğ / öğrenme tarihi; uets true ise elektronik tebligatın adrese ulaştığı gün. */
  function sure(girdi) {
    const uyarilar = [];
    const adimlar = [];
    let islem = ISLEMLER.find(i => i.id === girdi.islemId);
    if (!islem) {
      islem = { id: 'ozel', kol: girdi.kol, ad: girdi.ad || 'Özel süre', miktar: Number(girdi.miktar), birim: girdi.birim,
        dayanak: 'Kararda / kanunda belirtilen süre', not: '' };
    }
    if (!gecerliTarih(girdi.tarih)) return { hata: 'Tarih girin.' };
    if (!(islem.miktar > 0)) return { hata: 'Süre miktarını girin.' };

    let teblig = girdi.tarih;
    if (girdi.uets) {
      teblig = gunEkle(girdi.tarih, 5);
      adimlar.push(`Elektronik tebligat ${yaz(girdi.tarih)} günü ulaştı; ulaşmayı izleyen beşinci günün sonunda, ${yaz(teblig)} tarihinde tebliğ edilmiş sayılır (Tebligat K. 7/a).`);
    } else {
      adimlar.push(`Başlangıç: ${yaz(teblig)}. Bu gün hesaba katılmaz, süre ertesi gün işlemeye başlar.`);
    }

    const miktarYazi = `${islem.miktar} ${islem.birim}`;
    const sifat = `${islem.miktar} ${{ 'gün': 'günlük', hafta: 'haftalık', ay: 'aylık' }[islem.birim]}`;
    let son = sureEkle(teblig, islem.miktar, islem.birim);
    adimlar.push(`${miktarYazi} eklenince ham son gün ${yaz(son)}.`);

    const y = yil(teblig);
    const tatilBas = `${y}-07-20`, tatilSon = `${y}-08-31`;
    const tatildeMi = t => t >= `${yil(t)}-07-20` && t <= `${yil(t)}-08-31`;
    let adliTatil = 'Etkisi yok';
    let ihtiyat = null;

    if (islem.kol === 'İİK') {
      if (tatildeMi(son) || tatildeMi(teblig)) {
        adliTatil = 'Uzamaz';
        adimlar.push('İcra mahkemesine arz edilen işler ivedidir; adli tatil süreyi uzatmaz (İİK 18/1, HMK 103/1-h).');
      }
    } else if (islem.kol === 'HMK') {
      if (tatildeMi(son)) {
        if (girdi.tatilIstisna) {
          adliTatil = 'Uzamaz (adli tatilde görülen iş)';
          adimlar.push('Dava, adli tatilde görülen işlerden olduğu için HMK 104 uzatması uygulanmadı (HMK 103).');
        } else {
          const yeni = `${yil(son)}-09-07`;
          adliTatil = 'Uzar, tatil bitiminden itibaren bir hafta';
          adimlar.push(`Son gün adli tatile (20 Temmuz - 31 Ağustos) rastladı; tatilin bittiği günden itibaren bir hafta uzatılarak ${yaz(yeni)} (HMK 104).`);
          son = yeni;
        }
      }
    } else if (islem.kol === 'CMK') {
      if (teblig >= tatilBas && teblig <= tatilSon) {
        const yeni = sureEkle(tatilSon, islem.miktar, islem.birim);
        ihtiyat = `${y}-09-03`;
        adliTatil = 'Tebliğ tatil içinde, süre tatilden sonra işler';
        adimlar.push(`Tebliğ adli tatil içinde. Tatile rastlayan süreler işlemediğinden ${miktarYazi}lik süre 31 Ağustos'tan sonra işletildi: ${yaz(yeni)} (CMK 331/4).`);
        son = yeni;
      } else if (teblig < tatilBas && tatildeMi(son)) {
        const yeni = `${yil(son)}-09-03`;
        adliTatil = 'Uzar, tatil bitiminden itibaren üç gün';
        adimlar.push(`Son gün adli tatile rastladı; süre tatilin bittiği günden itibaren üç gün uzatılarak ${yaz(yeni)} (CMK 331/4).`);
        son = yeni;
      }
      if (girdi.tatilIstisna && adliTatil !== 'Etkisi yok') {
        uyarilar.push('Tutuklu işlerde de Yargıtay Ceza Genel Kurulu çoğunluğu kanun yolu süresinde adli tatil korumasını kabul etmektedir (CGK 27.12.2022, E.2021/319, K.2022/846). Yine de ihtiyatlı tarihi esas alın.');
      }
    }

    const kayma = isGunune(son);
    if (kayma.atlanan.length) {
      adimlar.push(`Son gün tatile rastladı (${kayma.atlanan.join(', ')}); izleyen ilk iş günü ${yaz(kayma.tarih)}.`);
      son = kayma.tarih;
    }
    if (ihtiyat) {
      ihtiyat = isGunune(ihtiyat).tarih;
      uyarilar.push(`Tebliğin tatil içinde yapıldığı hallerde süreyi tatil bitiminden üç gün uzatan yorumla da karşılaşılabilir. Hak kaybına uğramamak için ${yaz(ihtiyat)} tarihini hedefleyin.`);
    }
    if (YARIM_GUN[son]) uyarilar.push(`Son gün ${YARIM_GUN[son]}; öğleden sonra resmi tatildir. İşlemi sabah mesaisinde yapın.`);
    if (yil(son) > TATIL_SON_YIL || yil(teblig) < TATIL_ILK_YIL) uyarilar.push(`Uygulamadaki resmi tatil listesi ${TATIL_ILK_YIL}-${TATIL_SON_YIL} yıllarını kapsar; bu tarihte bayram günlerini ayrıca kontrol edin.`);
    else if (yil(son) === 2027 && son >= '2027-03-01' && son <= '2027-06-15') uyarilar.push('2027 dini bayram tarihleri kesinleşmiş takvimden teyit edilmelidir.');
    if (islem.birim === 'ay' && islem.kol !== 'İİK' && teblig < tatilBas && son > `${y}-09-10`) uyarilar.push('Süre adli tatili baştan sona kapsıyor; tatilin etkisini dosya özelinde ayrıca değerlendirin.');

    const bg = girdi.bugun || bugun();
    return {
      islem, teblig, son, ihtiyat, adliTatil,
      adliTatilDayanak: ADLI_TATIL_DAYANAK[islem.kol],
      kalan: fark(bg, son), adimlar, uyarilar,
    };
  }

  // ---------- Avukatlık Asgari Ücret Tarifesi ----------
  // m.21: hukuki yardımın tamamlandığı veya hükmün verildiği tarihteki tarife uygulanır.

  const AAUT = [
    {
      ad: '2026 Tarifesi', kunye: 'RG 03.11.2026, sayı 33419', bas: '2026-11-03', bit: '2099-12-31',
      dilimler: [[800000, 16], [800000, 15], [1600000, 14], [1600000, 13], [2400000, 11], [3200000, 8], [4000000, 5], [4800000, 3], [5600000, 2], [null, 1]],
      icraEsik: 78125, arabuluculukEsik: 62500,
      maktu: {
        icra_daire: 12500, icra_mah_is: 15000, icra_mah_dava: 23000, tahliye_icra: 26000, icra_mah_ceza: 20000,
        sulh_hukuk: 40000, sulh_ceza: 23000, asliye: 62000, tuketici: 30000, fikri: 70000, idare_durusmasiz: 40000, idare_durusmali: 52000,
      },
    },
    {
      ad: '2025 Tarifesi', kunye: 'RG 04.11.2025, sayı 33067', bas: '2025-11-04', bit: '2026-11-02',
      dilimler: [[600000, 16], [600000, 15], [1200000, 14], [1200000, 13], [1800000, 11], [2400000, 8], [3000000, 5], [3600000, 3], [4200000, 2], [null, 1]],
      icraEsik: 56250, arabuluculukEsik: null,
      maktu: {
        icra_daire: 9000, icra_mah_is: 11000, icra_mah_dava: 18000, tahliye_icra: 20000, icra_mah_ceza: 15000,
        sulh_hukuk: 30000, sulh_ceza: 18000, asliye: 45000, tuketici: 22500, fikri: 55000, idare_durusmasiz: 30000, idare_durusmali: 40000,
      },
    },
  ];

  const MAKTU_KALEMLER = [
    ['icra_daire', 'İcra dairelerinde yapılan takipler', 'II/II-1'],
    ['icra_mah_is', 'İcra mahkemelerinde takip edilen işler', 'II/II-2'],
    ['icra_mah_dava', 'İcra mahkemelerinde dava ve duruşmalı işler', 'II/II-3'],
    ['tahliye_icra', 'Tahliyeye ilişkin icra takipleri', 'II/II-4'],
    ['icra_mah_ceza', 'İcra mahkemelerinde ceza işleri', 'II/II-5'],
    ['sulh_hukuk', 'Sulh hukuk mahkemelerinde davalar', 'II/II-8'],
    ['sulh_ceza', 'Sulh ceza hakimlikleri ve infaz hakimlikleri', 'II/II-9'],
    ['asliye', 'Asliye mahkemelerinde davalar', 'II/II-10'],
    ['tuketici', 'Tüketici mahkemelerinde davalar', 'II/II-11'],
    ['fikri', 'Fikri ve sınai haklar mahkemelerinde davalar', 'II/II-12'],
    ['idare_durusmasiz', 'İdare ve vergi mahkemeleri (duruşmasız)', 'II/II-17a'],
    ['idare_durusmali', 'İdare ve vergi mahkemeleri (duruşmalı)', 'II/II-17b'],
  ];

  function tarifeBul(t) { return AAUT.find(x => t >= x.bas && t <= x.bit) || null; }

  function nispiHesap(deger, dilimler) {
    let kalan = deger, toplam = 0, alt = 0;
    const satirlar = [];
    for (const [dilim, oran] of dilimler) {
      if (kalan <= 0) break;
      const pay = dilim == null ? kalan : Math.min(kalan, dilim);
      const tutar = pay * oran / 100;
      satirlar.push({ alt, ust: alt + pay, oran, tutar });
      toplam += tutar; kalan -= pay; alt += pay;
    }
    return { toplam, satirlar };
  }

  /* girdi: { tarih, deger, mahkeme (maktu anahtarı), icra: bool, odemeSuresinde: bool } */
  function vekalet(girdi) {
    const tarife = tarifeBul(girdi.tarih);
    if (!tarife) return { hata: 'Bu tarih için uygulamada tarife yok (04.11.2025 öncesi).' };
    const deger = Number(girdi.deger) || 0;
    const notlar = [];
    let sonuc, nispi = null;
    const maktu = girdi.mahkeme ? tarife.maktu[girdi.mahkeme] : null;

    if (girdi.mahkeme === 'icra_daire' && deger > 0 && deger <= tarife.icraEsik) {
      sonuc = Math.min(maktu, deger);
      notlar.push(`Takip miktarı ${para(tarife.icraEsik)} tutarına kadar olduğundan maktu ücret uygulanır; ücret takipte kesinleşen miktarı geçemez (m.11/1).`);
    } else if (deger > 0) {
      nispi = nispiHesap(deger, tarife.dilimler);
      sonuc = nispi.toplam;
      if (maktu != null && sonuc < maktu) {
        sonuc = maktu;
        notlar.push('Nispi ücret maktu ücretin altında kaldığından maktu ücret esas alındı (m.13/1).');
      }
      if (sonuc > deger) { sonuc = deger; notlar.push('Ücret kabul veya reddedilen miktarı geçemez (m.13/2).'); }
    } else if (maktu != null) {
      sonuc = maktu;
      notlar.push('Konusu para olmayan iş: maktu ücret.');
    } else {
      return { hata: 'Dava değeri girin ya da mahkeme seçin.' };
    }
    if (girdi.odemeSuresinde && (girdi.mahkeme === 'icra_daire' || girdi.mahkeme === 'tahliye_icra')) {
      sonuc = sonuc * 0.75;
      notlar.push('Borçlu ödeme süresi içinde ödediğinden ücretin dörtte üçü (m.11/4).');
    }
    notlar.push('Karşı tarafa yükletilecek ücret tarifedeki miktardan az, üç katından çok olamaz (m.3/1).');
    return { tarife, sonuc, nispi, maktu, notlar };
  }

  // ---------- Yargı harçları (492 sayılı Kanun, 1 sayılı tarife) ----------
  // 2026 maktu tutarları: 98 Seri No.lu Harçlar Kanunu Genel Tebliği, RG 31.12.2025, 5. mükerrer.

  const HARC = {
    ad: '2026 harç tutarları', kunye: '98 Seri No.lu Harçlar Kanunu Genel Tebliği, RG 31.12.2025 (5. mükerrer)', bas: '2026-01-01', bit: '2026-12-31',
    basvurmaSulh: 335.20, basvurmaAsliye: 732.00, maktuKarar: 732.00, nispiAlt: 427.60, nispiOran: 0.06831,
    istinaf: 2002.00, temyiz: 3608.50, kesif: 5188.00, icraBasvurma: 732.00,
  };

  /* girdi: { tarih, deger, mahkeme: 'asliye'|'sulh', olumCismani: bool } */
  function harc(girdi) {
    const uyarilar = [];
    if (girdi.tarih < HARC.bas || girdi.tarih > HARC.bit) uyarilar.push(`Tutarlar ${yaz(HARC.bas)} - ${yaz(HARC.bit)} dönemi içindir. Bu tarih için yeni yılın tebliğiyle güncellenmesi gerekir; aşağıdaki rakamları kullanmayın.`);
    const deger = Number(girdi.deger) || 0;
    const basvurma = girdi.mahkeme === 'sulh' ? HARC.basvurmaSulh : HARC.basvurmaAsliye;
    const kalemler = [];
    kalemler.push({ ad: `Başvurma harcı (${girdi.mahkeme === 'sulh' ? 'sulh' : 'asliye'})`, tutar: basvurma, dayanak: 'Tarife A/I' });
    let nispi = null, pesin = null;
    if (deger > 0) {
      nispi = Math.max(deger * HARC.nispiOran, HARC.nispiAlt);
      const pay = girdi.olumCismani ? 1 / 20 : 1 / 4;
      pesin = nispi * pay;
      kalemler.push({ ad: `Peşin karar ve ilam harcı (${girdi.olumCismani ? 'yirmide bir' : 'dörtte bir'})`, tutar: pesin, dayanak: '492 s. K. m.28/a' });
    } else {
      kalemler.push({ ad: 'Maktu karar ve ilam harcı', tutar: HARC.maktuKarar, dayanak: 'Tarife A/III-2-a' });
    }
    const toplam = kalemler.reduce((t, k) => t + k.tutar, 0);
    return { harc: HARC, kalemler, toplam, nispi, pesin, uyarilar,
      digerleri: [
        { ad: 'İstinaf başvuru harcı', tutar: HARC.istinaf, dayanak: 'Tarife A/IV-e' },
        { ad: 'Temyiz başvuru harcı', tutar: HARC.temyiz, dayanak: 'Tarife A/IV-a' },
        { ad: 'Keşif harcı', tutar: HARC.kesif, dayanak: 'Tarife A/V' },
        { ad: 'İcraya başvurma harcı', tutar: HARC.icraBasvurma, dayanak: 'Tarife B/I-1' },
      ] };
  }

  // ---------- Faiz (3095 sayılı Kanun) ----------
  // m.1 (7589 s. K. ile değişik, yürürlük 31.7.2026): TCMB'nin önceki yılın 31 Aralık
  // günkü reeskont oranının yüzde sekseni. 31.12.2025 reeskont oranı %38,75 → %31.
  // m.2/2: ticari işlerde önceki yılın 31 Aralık günkü avans faiz oranı.

  const FAIZ = {
    yasal: [
      { bas: '2006-01-01', bit: '2024-05-31', oran: 9, kaynak: 'Önceki dönem oranı (kaynak künyesi teyit edilmedi)', teyitsiz: true },
      { bas: '2024-06-01', bit: '2026-07-30', oran: 24, kaynak: '3095 m.1; 8485 s. CB Kararı, RG 21.05.2024' },
      { bas: '2026-07-31', bit: '2026-12-31', oran: 31, kaynak: '3095 m.1 (7589 s. K.); %38,75 × 0,80' },
    ],
    ticari: [
      { bas: '2026-01-01', bit: '2026-12-31', oran: 39.75, kaynak: '3095 m.2/2; TCMB avans oranı, RG 20.12.2025' },
    ],
  };

  function oranDonemleri(tur, ozelOran) {
    if (tur === 'sabit') return [{ bas: '1900-01-01', bit: '2999-12-31', oran: Number(ozelOran), kaynak: 'Girilen oran' }];
    return FAIZ[tur];
  }

  // Basit faiz: gün sayısı × oran / 365. Mürekkep faiz yürütülmez (3095 m.3).
  function faizAralik(anapara, bas, bit, donemler) {
    const parcalar = [];
    let eksik = 0;
    let imlec = bas;
    const sirali = donemler.slice().sort((a, b) => a.bas < b.bas ? -1 : 1);
    for (const d of sirali) {
      const pBas = imlec > d.bas ? imlec : d.bas;
      const pBitSon = gunEkle(d.bit, 1); // dönem sonunu kapsayan, açık uçlu sınır
      const pBit = bit < pBitSon ? bit : pBitSon;
      if (pBas >= pBit) continue;
      if (pBas > imlec) eksik += fark(imlec, pBas);
      const gun = fark(pBas, pBit);
      parcalar.push({ bas: pBas, bit: gunEkle(pBit, -1), gun, oran: d.oran, faiz: anapara * d.oran / 100 * gun / 365, kaynak: d.kaynak, teyitsiz: d.teyitsiz });
      imlec = pBit;
    }
    if (imlec < bit) eksik += fark(imlec, bit);
    return { parcalar, eksik };
  }

  /* girdi: { tur: 'yasal'|'ticari'|'sabit', ozelOran, anapara, bas, bit, taksit: { tutar, ilk, son } } */
  function faiz(girdi) {
    if (!gecerliTarih(girdi.bas) || !gecerliTarih(girdi.bit)) return { hata: 'Başlangıç ve bitiş tarihlerini girin.' };
    if (girdi.bas >= girdi.bit) return { hata: 'Bitiş tarihi başlangıçtan sonra olmalı.' };
    if (girdi.tur === 'sabit' && !(Number(girdi.ozelOran) > 0)) return { hata: 'Yıllık oranı girin.' };
    const donemler = oranDonemleri(girdi.tur, girdi.ozelOran);
    const uyarilar = [];
    const kalemler = [];
    if (girdi.taksit) {
      const { tutar, ilk } = girdi.taksit;
      if (!(tutar > 0) || !gecerliTarih(ilk)) return { hata: 'Aylık tutarı ve ilk vadeyi girin.' };
      for (let i = 0; i < 600; i++) {
        const vade = ayEkle(ilk, i);
        if (vade >= girdi.bit) break;
        kalemler.push({ ad: `${yaz(vade)} vadeli taksit`, anapara: tutar, bas: vade });
      }
      if (!kalemler.length) return { hata: 'İlk vade, hesap tarihinden önce olmalı.' };
    } else {
      const a = Number(girdi.anapara);
      if (!(a > 0)) return { hata: 'Anaparayı girin.' };
      kalemler.push({ ad: 'Anapara', anapara: a, bas: girdi.bas });
    }
    let toplamFaiz = 0, toplamAna = 0, eksikVar = false, teyitsiz = false;
    const ozet = new Map();
    for (const k of kalemler) {
      const r = faizAralik(k.anapara, k.bas, girdi.bit, donemler);
      k.faiz = r.parcalar.reduce((t, p) => t + p.faiz, 0);
      k.gun = fark(k.bas, girdi.bit);
      if (r.eksik) eksikVar = true;
      for (const p of r.parcalar) {
        if (p.teyitsiz) teyitsiz = true;
        const anahtar = p.oran + '|' + p.kaynak;
        const o = ozet.get(anahtar) || { oran: p.oran, kaynak: p.kaynak, gun: 0, faiz: 0, bas: p.bas, bit: p.bit };
        o.gun += p.gun; o.faiz += p.faiz;
        if (p.bas < o.bas) o.bas = p.bas;
        if (p.bit > o.bit) o.bit = p.bit;
        ozet.set(anahtar, o);
      }
      toplamFaiz += k.faiz; toplamAna += k.anapara;
    }
    if (eksikVar) uyarilar.push('Hesap aralığının bir kısmı için uygulamada oran yok; o günler hesaba katılmadı. Bu dönem için "Sabit oran" seçerek oranı kendiniz girin.');
    if (teyitsiz) uyarilar.push('1.6.2024 öncesi yasal faiz oranının (%9) Resmi Gazete künyesi uygulamada teyit edilmedi.');
    if (girdi.tur === 'ticari') uyarilar.push('Ticari temerrüt faizi için yalnızca 2026 yılı oranı (31.12.2025 avans oranı) yüklü. Önceki yıllar için sabit oranla ayrı hesap yapın.');
    return { kalemler, donemler: [...ozet.values()], toplamFaiz, toplamAna, toplam: toplamFaiz + toplamAna, uyarilar };
  }

  // ---------- İnfaz (5275 sayılı Kanun) ----------

  const KS_ORANLARI = [
    { id: '1/2', pay: 1 / 2, ad: 'Yarısı', dayanak: '5275 m.107/2', aciklama: 'Genel kural.' },
    { id: '2/3', pay: 2 / 3, ad: 'Üçte ikisi', dayanak: '5275 m.107/2, 107/4, 108/1',
      aciklama: 'Kasten öldürme, nitelikli yaralama (87/2-d), işkence ve eziyet, cinsel saldırı (102/2 hariç), reşit olmayanla cinsel ilişki (104/2-3 hariç), cinsel taciz, özel hayata karşı suçlar, devlet sırları; örgüt suçları; tekerrür.' },
    { id: '3/4', pay: 3 / 4, ad: 'Dörtte üçü', dayanak: '5275 m.108/9, 108/3',
      aciklama: 'TCK 102/2, 103, 104/2-3 ve 188 suçları; ikinci defa tekerrür.' },
  ];

  const MUEBBET = {
    muebbet: { genel: 24, orgut: 30, tekerrur: 33 },
    agir: { genel: 30, orgut: 36, tekerrur: 39 },
  };

  /* girdi: { tur: 'sureli'|'muebbet'|'agir', yil, ay, gun, oran, rejim, baslangic, mahsup, sucTarihi, istisna } */
  function infaz(girdi) {
    if (!gecerliTarih(girdi.baslangic)) return { hata: 'Cezaevine giriş (ilk yakalama) tarihini girin.' };
    const mahsup = Math.max(0, Number(girdi.mahsup) || 0);
    const notlar = [];
    const uyarilar = [];
    let ksGun, toplamGun = null, tahliye = null, oranAd;

    if (girdi.tur === 'sureli') {
      const Y = Number(girdi.yil) || 0, A = Number(girdi.ay) || 0, G = Number(girdi.gun) || 0;
      if (Y * 365 + A * 30 + G <= 0) return { hata: 'Ceza miktarını girin.' };
      const o = KS_ORANLARI.find(x => x.id === girdi.oran) || KS_ORANLARI[0];
      oranAd = `${o.ad} (${o.dayanak})`;
      toplamGun = Y * 365 + A * 30 + G;
      ksGun = Math.floor(toplamGun * o.pay);
      tahliye = gunEkle(gunEkle(yilEkle(girdi.baslangic, Y), A * 30 + G), -mahsup);
      notlar.push(`Ceza ${Y} yıl ${A} ay ${G} gün: yaklaşık ${toplamGun} gün (yıl 365, ay 30 gün; TCK 61/6). Koşullu salıverilme için kurumda geçirilecek süre ${ksGun} gün.`);
    } else {
      const tablo = MUEBBET[girdi.tur];
      const yilSay = tablo[girdi.rejim] || tablo.genel;
      oranAd = `${yilSay} yıl (5275 m.${girdi.rejim === 'tekerrur' ? '108/1' : girdi.rejim === 'orgut' ? '107/4' : '107/2'})`;
      ksGun = fark(girdi.baslangic, yilEkle(girdi.baslangic, yilSay));
    }

    const ks = gunEkle(girdi.baslangic, ksGun - mahsup);
    if (mahsup) notlar.push(`${mahsup} gün önceki gözaltı ve tutukluluk mahsup edildi.`);

    const sucOncesi2020 = gecerliTarih(girdi.sucTarihi) && girdi.sucTarihi <= '2020-03-30';
    const sucOncesi2023 = gecerliTarih(girdi.sucTarihi) && girdi.sucTarihi <= '2023-07-31';
    let dsYil = 1, dsDayanak = '5275 m.105/A-1';
    if (sucOncesi2020 && !girdi.istisna) { dsYil = 3; dsDayanak = '5275 geçici m.6/1 (30.3.2020 öncesi suç)'; }
    if (!gecerliTarih(girdi.sucTarihi)) uyarilar.push('Suç tarihi girilmedi; denetimli serbestlik bir yıl üzerinden hesaplandı.');

    const enErkenGun = Math.max(5, Math.ceil(ksGun / 10));
    const enErken = gunEkle(girdi.baslangic, enErkenGun - mahsup);
    const dsHam = yilEkle(ks, -dsYil);
    let ds = dsHam;
    if (ds < enErken) {
      ds = enErken;
      notlar.push(`Denetimli serbestlik için koşullu salıverilmeye kadar kurumda geçirilecek sürenin en az onda biri (en az beş gün) kurumda geçirilmelidir (105/A-1, 7550 s. K.).`);
    }
    if (ds < girdi.baslangic) ds = girdi.baslangic;

    let ds2023 = null;
    if (sucOncesi2023 && !girdi.istisna) {
      ds2023 = yilEkle(ks, -(dsYil + 3));
      if (ds2023 < enErken) ds2023 = enErken;
      if (ds2023 >= ds) ds2023 = null;
    }

    uyarilar.push('İyi hal, açık kuruma ayrılma, disiplin cezaları, birden fazla cezanın toplanması (107/3), 15 yaş öncesi geçen günler ve diğer özel durumlar hesaba katılmamıştır. Kesin tarih, infaz savcılığının düzenlediği müddetnamededir.');

    return { ks, ksGun, ds, dsYil, dsDayanak, ds2023, tahliye, toplamGun, oranAd, notlar, uyarilar };
  }

  // ---------- Biçimlendirme ----------

  const paraFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function para(n) { return paraFmt.format(Math.round(n * 100) / 100) + ' TL'; }
  function sayiOku(s) {
    if (typeof s === 'number') return s;
    const t = String(s || '').trim().replace(/\s|TL/gi, '');
    if (!t) return 0;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\.(?=\d{3}(\D|$))/g, ''));
    return isFinite(n) ? n : 0;
  }

  const Hesap = {
    gunEkle, ayEkle, yilEkle, fark, bugun, yaz, yazUzun, gecerliTarih, tatilMi, isGunune,
    ISLEMLER, sure, AAUT, MAKTU_KALEMLER, tarifeBul, vekalet, nispiHesap, HARC, harc, FAIZ, faiz,
    KS_ORANLARI, infaz, para, sayiOku, TATIL, YARIM_GUN,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Hesap;
  else kok.Hesap = Hesap;
})(typeof window !== 'undefined' ? window : globalThis);
