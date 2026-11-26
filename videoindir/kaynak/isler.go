package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Is, tek bir indirme isteğidir.
type Is struct {
	ID       string  `json:"id"`
	VideoNo  string  `json:"videoNo"`
	Adres    string  `json:"adres"`
	Tur      string  `json:"tur"`    // video, ses
	Kalite   string  `json:"kalite"` // eniyi, 1080, 720
	Baslik   string  `json:"baslik"`
	Kanal    string  `json:"kanal"`
	Sure     int     `json:"sure"`
	Kapak    string  `json:"kapak"`
	Durum    string  `json:"durum"` // sirada, hazirlaniyor, indiriliyor, isleniyor, bitti, hata
	Inen     int64   `json:"inen"`
	Toplam   int64   `json:"toplam"`
	Hiz      float64 `json:"hiz"`
	Kalan    int     `json:"kalan"`
	Dosya    string  `json:"dosya"`
	Boyut    int64   `json:"boyut"`
	Hata     string  `json:"hata,omitempty"`
	Ayrinti  string  `json:"ayrinti,omitempty"`
	Zaman    int64   `json:"zaman"`
	iptal    bool
	komut    *exec.Cmd
	parcalar map[string][2]int64 // biçim no -> inen, toplam
	beklenen int64
}

// isGorunumu, sayfaya gönderilen hâlidir; dosya yolu ve adres dışarı verilmez.
type isGorunumu struct {
	ID       string  `json:"id"`
	Tur      string  `json:"tur"`
	Kalite   string  `json:"kalite"`
	Baslik   string  `json:"baslik"`
	Kanal    string  `json:"kanal"`
	Sure     int     `json:"sure"`
	Kapak    string  `json:"kapak"`
	Durum    string  `json:"durum"`
	Inen     int64   `json:"inen"`
	Toplam   int64   `json:"toplam"`
	Hiz      float64 `json:"hiz"`
	Kalan    int     `json:"kalan"`
	DosyaAdi string  `json:"dosyaAdi,omitempty"`
	Boyut    int64   `json:"boyut"`
	Hata     string  `json:"hata,omitempty"`
	Ayrinti  string  `json:"ayrinti,omitempty"`
	Zaman    int64   `json:"zaman"`
}

// VideoBilgisi, bağlantı yapıştırılınca gösterilen önizlemedir.
type VideoBilgisi struct {
	VideoNo string `json:"videoNo"`
	Baslik  string `json:"baslik"`
	Kanal   string `json:"kanal"`
	Sure    int    `json:"sure"`
	Kapak   string `json:"kapak"`
	Canli   bool   `json:"canli"`
}

type Isler struct {
	mu      sync.Mutex
	liste   []*Is
	kuyruk  chan *Is
	araclar *Araclar
	bilgi   map[string]VideoBilgisi
}

const gecmisSiniri = 60

func yeniIsler(a *Araclar) *Isler {
	s := &Isler{kuyruk: make(chan *Is, 100), araclar: a, bilgi: map[string]VideoBilgisi{}}
	s.gecmisYukle()
	go s.isci()
	return s
}

func gecmisYolu() string { return filepath.Join(veriDizini(), "gecmis.json") }

func (s *Isler) gecmisYukle() {
	veri, err := os.ReadFile(gecmisYolu())
	if err != nil {
		return
	}
	var kayitlar []*Is
	if json.Unmarshal(veri, &kayitlar) != nil {
		return
	}
	for _, k := range kayitlar {
		if k.Durum == "bitti" {
			s.liste = append(s.liste, k)
		}
	}
}

func (s *Isler) gecmisYazKilitli() {
	var biten []*Is
	for _, i := range s.liste {
		if i.Durum == "bitti" {
			biten = append(biten, i)
		}
	}
	if len(biten) > gecmisSiniri {
		biten = biten[len(biten)-gecmisSiniri:]
	}
	veri, _ := json.MarshalIndent(biten, "", "  ")
	if err := dosyaYaz(gecmisYolu(), veri); err != nil {
		log.Printf("geçmiş yazılamadı: %v", err)
	}
}

func yeniNo() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Gorunum, önce sürenleri (eskiden yeniye), sonra bitenleri (yeniden eskiye) verir.
func (s *Isler) Gorunum() []isGorunumu {
	s.mu.Lock()
	defer s.mu.Unlock()
	var suren, biten []isGorunumu
	for _, i := range s.liste {
		g := isGorunumu{
			ID: i.ID, Tur: i.Tur, Kalite: i.Kalite, Baslik: i.Baslik, Kanal: i.Kanal,
			Sure: i.Sure, Kapak: i.Kapak, Durum: i.Durum, Inen: i.Inen, Toplam: i.Toplam,
			Hiz: i.Hiz, Kalan: i.Kalan, Boyut: i.Boyut, Hata: i.Hata, Ayrinti: i.Ayrinti, Zaman: i.Zaman,
		}
		if i.Durum == "bitti" {
			// Dosya sonradan silinmiş ya da taşınmışsa listede gösterilmez.
			if _, err := os.Stat(i.Dosya); err != nil {
				continue
			}
			g.DosyaAdi = filepath.Base(i.Dosya)
			biten = append(biten, g)
		} else {
			suren = append(suren, g)
		}
	}
	sort.SliceStable(biten, func(a, b int) bool { return biten[a].Zaman > biten[b].Zaman })
	if len(biten) > 20 {
		biten = biten[:20]
	}
	return append(suren, biten...)
}

func (s *Isler) Bul(id string) *Is {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, i := range s.liste {
		if i.ID == id {
			kopya := *i
			return &kopya
		}
	}
	return nil
}

func (s *Isler) Ekle(metin, tur, kalite string) (string, error) {
	videoNo, adres, err := baglantiCoz(metin)
	if err != nil {
		return "", err
	}
	if tur != "ses" {
		tur = "video"
	}
	if kalite != "eniyi" && kalite != "720" {
		kalite = "1080"
	}
	is := &Is{
		ID: yeniNo(), VideoNo: videoNo, Adres: adres, Tur: tur, Kalite: kalite,
		Baslik: "YouTube videosu", Durum: "sirada", Zaman: time.Now().Unix(),
	}
	s.mu.Lock()
	for _, i := range s.liste {
		if i.VideoNo == videoNo && i.Tur == tur && i.Kalite == kalite && i.Durum != "bitti" && i.Durum != "hata" {
			s.mu.Unlock()
			return "", errors.New("Bu video zaten indiriliyor.")
		}
	}
	if b, ok := s.bilgi[videoNo]; ok {
		is.Baslik, is.Kanal, is.Sure, is.Kapak = b.Baslik, b.Kanal, b.Sure, b.Kapak
	}
	s.liste = append(s.liste, is)
	s.mu.Unlock()

	select {
	case s.kuyruk <- is:
	default:
		s.Kaldir(is.ID)
		return "", errors.New("Sırada çok fazla indirme var.")
	}
	return is.ID, nil
}

// Kaldir, işi listeden çıkarır; sürüyorsa durdurur. İnen dosyaya dokunmaz.
func (s *Isler) Kaldir(id string) {
	s.mu.Lock()
	var komut *exec.Cmd
	kalan := s.liste[:0]
	for _, i := range s.liste {
		if i.ID == id {
			i.iptal = true
			komut = i.komut
			continue
		}
		kalan = append(kalan, i)
	}
	s.liste = kalan
	s.gecmisYazKilitli()
	s.mu.Unlock()
	if komut != nil && komut.Process != nil {
		agaciOldur(komut.Process.Pid)
	}
}

// HepsiniDurdur, program kapanırken süren indirmeyi keser.
func (s *Isler) HepsiniDurdur() {
	s.mu.Lock()
	var komutlar []*exec.Cmd
	for _, i := range s.liste {
		i.iptal = true
		if i.komut != nil {
			komutlar = append(komutlar, i.komut)
		}
	}
	s.mu.Unlock()
	for _, k := range komutlar {
		if k.Process != nil {
			agaciOldur(k.Process.Pid)
		}
	}
}

func (s *Isler) guncelle(is *Is, f func()) {
	s.mu.Lock()
	f()
	s.mu.Unlock()
}

func (s *Isler) isci() {
	for is := range s.kuyruk {
		s.mu.Lock()
		atla := is.iptal
		s.mu.Unlock()
		if atla {
			continue
		}
		s.yurut(is)
	}
}

func (s *Isler) yurut(is *Is) {
	s.guncelle(is, func() { is.Durum = "hazirlaniyor" })

	if err := s.araclar.Bekle(context.Background()); err != nil {
		s.bitir(is, "", err.Error(), "")
		return
	}

	dosya, hata := s.indir(is)
	if hata != "" && !s.iptalMi(is) {
		// Çoğu hata YouTube'daki bir değişiklikten doğar; motoru yenileyip
		// bir kez daha denemek genellikle sorunu çözer.
		if s.araclar.Guncelle() {
			s.guncelle(is, func() {
				is.Durum, is.Inen, is.Toplam, is.parcalar, is.beklenen = "hazirlaniyor", 0, 0, nil, 0
			})
			dosya, hata = s.indir(is)
		}
	}
	if s.iptalMi(is) {
		s.artiklariSil(is)
		return
	}
	if hata != "" {
		baslik, ayrinti := hatayiCevir(hata)
		s.bitir(is, "", baslik, ayrinti)
		s.artiklariSil(is)
		return
	}
	s.bitir(is, dosya, "", "")
}

func (s *Isler) iptalMi(is *Is) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return is.iptal
}

func (s *Isler) bitir(is *Is, dosya, hata, ayrinti string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	is.komut = nil
	is.Hiz, is.Kalan = 0, 0
	if hata != "" {
		is.Durum, is.Hata, is.Ayrinti = "hata", hata, ayrinti
		return
	}
	is.Durum, is.Dosya, is.Zaman = "bitti", dosya, time.Now().Unix()
	if b, err := os.Stat(dosya); err == nil {
		is.Boyut = b.Size()
	}
	// Aynı dosya daha önce indirilmişse listede iki kez görünmesin.
	kalan := s.liste[:0]
	for _, i := range s.liste {
		if i != is && i.Durum == "bitti" && i.Dosya == dosya {
			continue
		}
		kalan = append(kalan, i)
	}
	s.liste = kalan
	s.gecmisYazKilitli()
}

// motorSecenekleri, her çağrıda ortak olan seçeneklerdir.
func motorSecenekleri(y aracYollari) []string {
	sec := []string{"--ignore-config", "--no-playlist", "--encoding", "utf-8", "--color", "never"}
	if y.js != "" {
		sec = append(sec, "--js-runtimes", y.js)
	}
	if y.ffmpeg != "" {
		sec = append(sec, "--ffmpeg-location", y.ffmpeg)
	}
	return sec
}

func motorOrtami() []string {
	return append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1")
}

func (s *Isler) indir(is *Is) (dosya string, hata string) {
	y := s.araclar.Yollar()
	klasor := indirmeDizini()
	if err := os.MkdirAll(klasor, 0o755); err != nil {
		return "", "Kayıt klasörü açılamadı: " + err.Error()
	}

	sec := motorSecenekleri(y)
	sec = append(sec,
		"--newline", "--progress", "--no-quiet", "--no-mtime", "--windows-filenames",
		"--concurrent-fragments", "4", "--socket-timeout", "30",
		"-P", klasor,
		"-O", "before_dl:B1|%(filesize,filesize_approx)s|%(duration)s|%(title)s",
		"-O", "before_dl:B2|%(channel,uploader)s",
		"-O", "before_dl:B3|%(thumbnail)s",
		"-O", "after_move:F|%(filepath)s",
		"--progress-template", "download:P|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
		"--progress-template", "postprocess:PP|%(progress.status)s|%(progress.postprocessor)s",
	)
	if is.Tur == "ses" {
		sec = append(sec,
			"-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "2", "--embed-metadata",
			"-o", "%(title).100B [%(id)s].%(ext)s")
	} else {
		// Aynı çözünürlükte H.264 ve AAC öne alınır; bu ikili hem Windows'ta
		// hem iPhone'da ek program istemeden oynar.
		sirala := "res:1080,fps,vcodec:h264,acodec:aac"
		switch is.Kalite {
		case "720":
			sirala = "res:720,fps,vcodec:h264,acodec:aac"
		case "eniyi":
			sirala = "res,fps,vcodec:h264,acodec:aac"
		}
		sec = append(sec,
			"-S", sirala, "--merge-output-format", "mp4", "--remux-video", "mp4",
			"-o", "%(title).100B (%(height)sp) [%(id)s].%(ext)s")
	}
	sec = append(sec, "--", is.Adres)

	s.araclar.motorKilit.Lock()
	defer s.araclar.motorKilit.Unlock()

	k := exec.Command(y.ytdlp, sec...)
	k.Env = motorOrtami()
	k.Dir = klasor
	gizliKomut(k)
	cikti, err := k.StdoutPipe()
	if err != nil {
		return "", err.Error()
	}
	hataCikti, err := k.StderrPipe()
	if err != nil {
		return "", err.Error()
	}

	s.mu.Lock()
	if is.iptal {
		s.mu.Unlock()
		return "", "iptal"
	}
	if err := k.Start(); err != nil {
		s.mu.Unlock()
		return "", "İndirme motoru başlatılamadı: " + err.Error()
	}
	is.komut = k
	s.mu.Unlock()

	var hatalar []string
	var bekle sync.WaitGroup
	bekle.Add(1)
	go func() {
		defer bekle.Done()
		for _, satir := range satirlar(hataCikti) {
			log.Printf("motor: %s", satir)
			if strings.HasPrefix(satir, "ERROR:") {
				hatalar = append(hatalar, satir)
			}
		}
	}()

	t := bufio.NewScanner(cikti)
	t.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for t.Scan() {
		if yol := s.satirIsle(is, t.Text()); yol != "" {
			dosya = yol
		}
	}
	bekle.Wait()
	bekleHata := k.Wait()

	s.guncelle(is, func() { is.komut = nil })

	if bekleHata != nil {
		if len(hatalar) > 0 {
			return "", strings.Join(hatalar, "\n")
		}
		return "", "ERROR: " + bekleHata.Error()
	}
	if dosya == "" {
		dosya = s.dosyayiAra(is, klasor)
	}
	if _, err := os.Stat(dosya); dosya == "" || err != nil {
		return "", "ERROR: inen dosya bulunamadı"
	}
	return dosya, ""
}

func satirlar(r io.Reader) []string {
	var hepsi []string
	t := bufio.NewScanner(r)
	t.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for t.Scan() {
		if satir := strings.TrimSpace(t.Text()); satir != "" {
			hepsi = append(hepsi, satir)
			if len(hepsi) > 200 {
				hepsi = hepsi[1:]
			}
		}
	}
	return hepsi
}

func sayi(s string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || f < 0 {
		return 0
	}
	return f
}

func doluMu(s string) bool { return s != "" && s != "NA" && s != "None" }

// satirIsle, motorun yazdığı satırı yorumlar; biten dosyanın yolunu döner.
func (s *Isler) satirIsle(is *Is, satir string) string {
	switch {
	case strings.HasPrefix(satir, "P|"):
		p := strings.Split(satir, "|")
		if len(p) < 7 {
			return ""
		}
		s.guncelle(is, func() {
			if is.parcalar == nil {
				is.parcalar = map[string][2]int64{}
			}
			inen, toplam := int64(sayi(p[2])), int64(sayi(p[3]))
			if p[1] == "finished" && toplam < inen {
				toplam = inen
			}
			is.parcalar[p[6]] = [2]int64{inen, toplam}
			var topInen, topToplam int64
			for _, v := range is.parcalar {
				topInen += v[0]
				topToplam += v[1]
			}
			if is.beklenen > topToplam {
				topToplam = is.beklenen
			}
			is.Inen, is.Toplam = topInen, topToplam
			is.Hiz = sayi(p[4])
			is.Kalan = 0
			if is.Hiz > 0 && topToplam > topInen {
				is.Kalan = int(float64(topToplam-topInen) / is.Hiz)
			}
			if is.Durum != "isleniyor" {
				is.Durum = "indiriliyor"
			}
		})
	case strings.HasPrefix(satir, "PP|"):
		p := strings.Split(satir, "|")
		if len(p) >= 3 && p[1] == "started" && p[2] != "MoveFiles" {
			s.guncelle(is, func() { is.Durum, is.Hiz, is.Kalan = "isleniyor", 0, 0 })
		}
	case strings.HasPrefix(satir, "B1|"):
		p := strings.SplitN(satir, "|", 4)
		if len(p) == 4 {
			s.guncelle(is, func() {
				is.beklenen = int64(sayi(p[1]))
				if sn := int(sayi(p[2])); sn > 0 {
					is.Sure = sn
				}
				if doluMu(p[3]) {
					is.Baslik = p[3]
				}
			})
		}
	case strings.HasPrefix(satir, "B2|"):
		if v := strings.TrimPrefix(satir, "B2|"); doluMu(v) {
			s.guncelle(is, func() { is.Kanal = v })
		}
	case strings.HasPrefix(satir, "B3|"):
		if v := strings.TrimPrefix(satir, "B3|"); strings.HasPrefix(v, "https://") {
			s.guncelle(is, func() { is.Kapak = v })
		}
	case strings.HasPrefix(satir, "F|"):
		return strings.TrimPrefix(satir, "F|")
	}
	return ""
}

// dosyayiAra, motor dosya yolunu bildirmediyse video numarasından bulur.
func (s *Isler) dosyayiAra(is *Is, klasor string) string {
	uzanti := ".mp4"
	if is.Tur == "ses" {
		uzanti = ".mp3"
	}
	girdiler, _ := os.ReadDir(klasor)
	var bulunan string
	var enYeni time.Time
	for _, g := range girdiler {
		ad := g.Name()
		if !strings.HasSuffix(ad, "["+is.VideoNo+"]"+uzanti) {
			continue
		}
		if b, err := g.Info(); err == nil && b.ModTime().After(enYeni) {
			enYeni, bulunan = b.ModTime(), filepath.Join(klasor, ad)
		}
	}
	return bulunan
}

// artiklariSil, yarıda kalan indirmenin parça dosyalarını temizler. Bitmiş
// dosyalara dokunmaz: yalnızca ".part", ".ytdl" ve birleştirme öncesi ara
// dosyalar ("[no].f137.mp4" gibi) silinir. Durdurulan motor dosyaları hemen
// bırakmayabildiği için birkaç kez denenir.
func (s *Isler) artiklariSil(is *Is) {
	if is.VideoNo == "" {
		return
	}
	klasor := indirmeDizini()
	im := "[" + is.VideoNo + "]"
	for deneme := 0; deneme < 8; deneme++ {
		kalan := 0
		girdiler, _ := os.ReadDir(klasor)
		for _, g := range girdiler {
			ad := g.Name()
			i := strings.LastIndex(ad, im)
			if i < 0 {
				continue
			}
			kuyruk := ad[i+len(im):]
			artik := strings.HasSuffix(ad, ".part") || strings.HasSuffix(ad, ".ytdl") ||
				strings.Contains(kuyruk, ".part-") || araDosyaMi(kuyruk)
			if artik && os.Remove(filepath.Join(klasor, ad)) != nil {
				kalan++
			}
		}
		if kalan == 0 {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// araDosyaMi, ".f137.mp4" ya da ".f251.webm" gibi bir kuyruk mu diye bakar.
func araDosyaMi(kuyruk string) bool {
	if !strings.HasPrefix(kuyruk, ".f") {
		return false
	}
	kalan := kuyruk[2:]
	i := strings.IndexByte(kalan, '.')
	if i <= 0 {
		return false
	}
	for _, r := range kalan[:i] {
		if !(r >= '0' && r <= '9') && r != '-' {
			return false
		}
	}
	return true
}

// BilgiAl, indirmeden önce videonun adını, kanalını ve süresini getirir.
func (s *Isler) BilgiAl(ctx context.Context, metin string) (VideoBilgisi, error) {
	videoNo, adres, err := baglantiCoz(metin)
	if err != nil {
		return VideoBilgisi{}, err
	}
	s.mu.Lock()
	b, var_ := s.bilgi[videoNo]
	s.mu.Unlock()
	if var_ {
		return b, nil
	}
	if err := s.araclar.Bekle(ctx); err != nil {
		return VideoBilgisi{}, err
	}
	y := s.araclar.Yollar()
	ctx, iptal := context.WithTimeout(ctx, 90*time.Second)
	defer iptal()
	sec := append(motorSecenekleri(y), "--no-warnings",
		"-O", "%(.{id,title,channel,uploader,duration,thumbnail,live_status})j", "--", adres)
	k := exec.CommandContext(ctx, y.ytdlp, sec...)
	k.Env = motorOrtami()
	gizliKomut(k)
	var hataMetni strings.Builder
	k.Stderr = &hataMetni
	cikti, err := k.Output()
	if err != nil {
		if ctx.Err() != nil {
			return VideoBilgisi{}, errors.New("Video bilgisi alınamadı; bağlantı çok yavaş.")
		}
		log.Printf("bilgi alınamadı: %s", strings.TrimSpace(hataMetni.String()))
		baslik, _ := hatayiCevir(hataMetni.String())
		return VideoBilgisi{}, errors.New(baslik)
	}
	var ham struct {
		ID        string  `json:"id"`
		Title     string  `json:"title"`
		Channel   string  `json:"channel"`
		Uploader  string  `json:"uploader"`
		Duration  float64 `json:"duration"`
		Thumbnail string  `json:"thumbnail"`
		Live      string  `json:"live_status"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(cikti))), &ham); err != nil {
		return VideoBilgisi{}, errors.New("Video bilgisi okunamadı.")
	}
	b = VideoBilgisi{
		VideoNo: videoNo, Baslik: ham.Title, Kanal: ham.Channel, Sure: int(ham.Duration),
		Canli: ham.Live == "is_live" || ham.Live == "is_upcoming",
	}
	if b.Kanal == "" {
		b.Kanal = ham.Uploader
	}
	if strings.HasPrefix(ham.Thumbnail, "https://") {
		b.Kapak = ham.Thumbnail
	}
	s.mu.Lock()
	if len(s.bilgi) > 200 {
		s.bilgi = map[string]VideoBilgisi{}
	}
	s.bilgi[videoNo] = b
	s.mu.Unlock()
	return b, nil
}

// hatayiCevir, motorun İngilizce hata metnini kullanıcıya gösterilecek kısa
// Türkçe açıklamaya çevirir. İkinci değer, ayrıntı olarak gösterilen özgün satırdır.
func hatayiCevir(ham string) (baslik, ayrinti string) {
	satirlar := strings.Split(strings.TrimSpace(ham), "\n")
	son := strings.TrimSpace(satirlar[len(satirlar)-1])
	son = strings.TrimPrefix(son, "ERROR: ")
	if len(son) > 300 {
		son = son[:300]
	}
	k := strings.ToLower(ham)
	var_ := func(parcalar ...string) bool {
		for _, p := range parcalar {
			if strings.Contains(k, p) {
				return true
			}
		}
		return false
	}
	switch {
	case var_("private video"):
		return "Bu video özel; indirilemiyor.", ""
	case var_("confirm your age", "age-restricted", "age restricted"):
		return "Video yaş sınırlı; YouTube oturum açılmadan indirilmesine izin vermiyor.", ""
	case var_("not a bot"):
		return "YouTube şu an bu bilgisayardan indirmeye izin vermedi. Bir süre sonra yeniden deneyin.", son
	case var_("members-only", "join this channel", "available to this channel's members"):
		return "Video yalnızca kanal üyelerine açık.", ""
	case var_("premieres in", "live event will begin", "is_upcoming"):
		return "Yayın henüz başlamamış.", ""
	case var_("video unavailable", "this video is not available", "has been removed", "account associated with this video has been terminated", "does not exist"):
		return "Video bulunamadı; kaldırılmış ya da erişime kapatılmış olabilir.", son
	case var_("not available in your country", "geo restrict", "geo-restrict"):
		return "Video bu ülkede izlenemiyor.", ""
	case var_("no space left", "not enough space", "disk full"):
		return "Diskte yer kalmadı.", ""
	case var_("getaddrinfo", "name resolution", "timed out", "connection refused", "connection reset", "network is unreachable", "unable to connect", "failed to resolve", "ssl:", "winerror 10060", "winerror 11001"):
		return "İnternet bağlantısı kurulamadı. Bağlantınızı denetleyip yeniden deneyin.", son
	case var_("ffmpeg", "postprocessing", "merger"):
		return "Dosya indi ama birleştirilemedi.", son
	case var_("requested format is not available", "no video formats found"):
		return "Bu video için indirilebilir bir biçim bulunamadı.", son
	case var_("kurulum tamamlanamadı"):
		return ham, ""
	}
	return "İndirme tamamlanamadı.", son
}
