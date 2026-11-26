package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

//go:embed web
var gomulu embed.FS

type Sunucu struct {
	mu       sync.Mutex
	dinleyen net.Listener
	http     *http.Server
	isler    *Isler
	araclar  *Araclar
	web      fs.FS
	kapat    func()
}

func yeniSunucu(isler *Isler, araclar *Araclar, kapat func()) *Sunucu {
	web, _ := fs.Sub(gomulu, "web")
	s := &Sunucu{isler: isler, araclar: araclar, web: web, kapat: kapat}
	s.http = &http.Server{Handler: s, ReadHeaderTimeout: 15 * time.Second}
	return s
}

// Dinle, sunucuyu açar. herkes false ise yalnızca bu bilgisayardan, true ise
// aynı ağdaki telefondan da ulaşılır. Çağrıldığında önceki dinleme kapanır.
func (s *Sunucu) Dinle(herkes bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	kapi := ayarOku().Kapi
	adres := func(h bool) string {
		if h {
			return fmt.Sprintf("0.0.0.0:%d", kapi)
		}
		return fmt.Sprintf("127.0.0.1:%d", kapi)
	}
	if s.dinleyen != nil {
		s.dinleyen.Close()
		s.dinleyen = nil
	}
	l, err := net.Listen("tcp4", adres(herkes))
	if err != nil {
		// Yeni adres açılamadıysa en azından bu bilgisayardan kullanılabilsin.
		l2, err2 := net.Listen("tcp4", adres(false))
		if err2 != nil {
			return err
		}
		s.dinleyen = l2
		go s.http.Serve(l2)
		return err
	}
	s.dinleyen = l
	go s.http.Serve(l)
	log.Printf("dinleme adresi: %s", l.Addr())
	return nil
}

func jsonYaz(w http.ResponseWriter, kod int, veri any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(kod)
	json.NewEncoder(w).Encode(veri)
}

func hataYaz(w http.ResponseWriter, kod int, ileti string) {
	jsonYaz(w, kod, map[string]string{"hata": ileti})
}

func govdeOku(r *http.Request, hedef any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return false
	}
	veri, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		return false
	}
	return json.Unmarshal(veri, hedef) == nil
}

func (s *Sunucu) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	yerel := geriDongu(r.RemoteAddr)
	a := ayarOku()
	if !yerel && (!a.Telefon || !yerelAgdan(r.RemoteAddr)) {
		http.Error(w, "Erişim yok", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	// Yoklama: programın çalıştığını öğrenmek için; gizli bir şey vermez.
	if r.URL.Path == "/api/ping" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		jsonYaz(w, 200, map[string]string{"uygulama": uygulamaKimligi, "surum": surum})
		return
	}

	// Geri kalan her şey adresteki anahtarın altındadır.
	yol := strings.TrimPrefix(r.URL.Path, "/")
	bas, kalan, bolundu := strings.Cut(yol, "/")
	if subtle.ConstantTimeCompare([]byte(bas), []byte(a.Anahtar)) != 1 {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, "Video İndir: bu sayfaya bilgisayardaki pencereden ya da telefonla karekod okutarak girilir.\n")
		return
	}
	if !bolundu {
		http.Redirect(w, r, "/"+a.Anahtar+"/", http.StatusFound)
		return
	}

	switch {
	case strings.HasPrefix(kalan, "api/"):
		s.api(w, r, strings.TrimPrefix(kalan, "api/"), yerel)
	case strings.HasPrefix(kalan, "dosya/"):
		s.dosyaVer(w, r, strings.TrimPrefix(kalan, "dosya/"))
	case kalan == "qr.png":
		s.karekod(w, yerel)
	default:
		s.webVer(w, r, kalan)
	}
}

func (s *Sunucu) webVer(w http.ResponseWriter, r *http.Request, ad string) {
	if ad == "" {
		ad = "index.html"
	}
	veri, err := fs.ReadFile(s.web, path.Clean(ad))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	tur := mime.TypeByExtension(path.Ext(ad))
	switch path.Ext(ad) {
	case ".woff2":
		tur = "font/woff2"
	case ".js":
		tur = "text/javascript; charset=utf-8"
	case ".css":
		tur = "text/css; charset=utf-8"
	case ".html":
		tur = "text/html; charset=utf-8"
	}
	if tur != "" {
		w.Header().Set("Content-Type", tur)
	}
	if strings.HasPrefix(ad, "fonts/") || strings.HasSuffix(ad, ".png") {
		w.Header().Set("Cache-Control", "public, max-age=604800")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Write(veri)
}

type telefonDurumu struct {
	Acik  bool   `json:"acik"`
	Adres string `json:"adres,omitempty"`
}

type durumYaniti struct {
	Surum    string         `json:"surum"`
	Yerel    bool           `json:"yerel"`
	Kurulum  kurulumDurumu  `json:"kurulum"`
	Isler    []isGorunumu   `json:"isler"`
	YerelAd  string         `json:"yerelAd,omitempty"`
	Klasor   string         `json:"klasor,omitempty"`
	Telefon  *telefonDurumu `json:"telefon,omitempty"`
	Otomatik *bool          `json:"otomatik,omitempty"`
}

func telefonAdresi(a Ayar) string {
	ip := yerelIP()
	if ip == "" {
		return ""
	}
	return fmt.Sprintf("http://%s:%d/%s/", ip, a.Kapi, a.Anahtar)
}

func (s *Sunucu) api(w http.ResponseWriter, r *http.Request, ad string, yerel bool) {
	a := ayarOku()

	if ad == "durum" && r.Method == http.MethodGet {
		y := durumYaniti{Surum: surum, Yerel: yerel, Kurulum: s.araclar.Durum(), Isler: s.isler.Gorunum()}
		if y.Isler == nil {
			y.Isler = []isGorunumu{}
		}
		if yerel {
			y.Klasor = klasorEtiketi()
			y.Telefon = &telefonDurumu{Acik: a.Telefon}
			if a.Telefon {
				y.Telefon.Adres = telefonAdresi(a)
			}
			if acik, destek := otomatikDurumu(); destek {
				y.Otomatik = &acik
			}
		} else {
			y.YerelAd = yerelAd()
		}
		jsonYaz(w, 200, y)
		return
	}

	if r.Method != http.MethodPost {
		hataYaz(w, http.StatusMethodNotAllowed, "Geçersiz istek.")
		return
	}

	var g struct {
		Adres  string `json:"adres"`
		Tur    string `json:"tur"`
		Kalite string `json:"kalite"`
		ID     string `json:"id"`
		Acik   bool   `json:"acik"`
	}
	if !govdeOku(r, &g) {
		hataYaz(w, http.StatusBadRequest, "Geçersiz istek.")
		return
	}

	switch ad {
	case "bilgi":
		b, err := s.isler.BilgiAl(r.Context(), g.Adres)
		if err != nil {
			hataYaz(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		jsonYaz(w, 200, b)
		return
	case "indir":
		id, err := s.isler.Ekle(g.Adres, g.Tur, g.Kalite)
		if err != nil {
			hataYaz(w, http.StatusUnprocessableEntity, err.Error())
			return
		}
		jsonYaz(w, 200, map[string]string{"id": id})
		return
	case "kaldir":
		s.isler.Kaldir(g.ID)
		jsonYaz(w, 200, map[string]bool{"tamam": true})
		return
	}

	// Buradan sonrası yalnızca bilgisayarın kendi penceresinden yapılabilir.
	if !yerel {
		hataYaz(w, http.StatusForbidden, "Bu işlem yalnızca bilgisayardan yapılır.")
		return
	}
	switch ad {
	case "ac":
		is := s.isler.Bul(g.ID)
		if is == nil || is.Durum != "bitti" {
			hataYaz(w, http.StatusNotFound, "Dosya bulunamadı.")
			return
		}
		if err := yolAc(is.Dosya); err != nil {
			hataYaz(w, 500, "Dosya açılamadı.")
			return
		}
	case "klasor":
		os.MkdirAll(indirmeDizini(), 0o755)
		if err := yolAc(indirmeDizini()); err != nil {
			hataYaz(w, 500, "Klasör açılamadı.")
			return
		}
	case "telefon":
		ayarDegistir(func(x *Ayar) { x.Telefon = g.Acik })
		// Yanıt önce gitsin; dinleme adresi ardından değişir.
		jsonYaz(w, 200, map[string]bool{"tamam": true})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		go func() {
			time.Sleep(150 * time.Millisecond)
			if err := s.Dinle(g.Acik); err != nil {
				log.Printf("dinleme değiştirilemedi: %v", err)
			}
		}()
		return
	case "otomatik":
		if err := otomatikAyarla(g.Acik); err != nil {
			hataYaz(w, 500, "Ayar değiştirilemedi.")
			return
		}
	case "kurulum":
		go s.araclar.Hazirla()
	case "pencere":
		pencereAc(fmt.Sprintf("http://127.0.0.1:%d/%s/", a.Kapi, a.Anahtar))
	case "kapat":
		jsonYaz(w, 200, map[string]bool{"tamam": true})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		go func() {
			time.Sleep(200 * time.Millisecond)
			s.kapat()
		}()
		return
	default:
		hataYaz(w, http.StatusNotFound, "Geçersiz istek.")
		return
	}
	jsonYaz(w, 200, map[string]bool{"tamam": true})
}

func klasorEtiketi() string {
	d := indirmeDizini()
	if os.Getenv("VIDEOINDIR_KLASOR") == "" && videoKlasoruBilinen() {
		return `Videolar\YouTube`
	}
	return d
}

func (s *Sunucu) karekod(w http.ResponseWriter, yerel bool) {
	a := ayarOku()
	adres := telefonAdresi(a)
	if !yerel || !a.Telefon || adres == "" {
		http.Error(w, "yok", http.StatusNotFound)
		return
	}
	png, err := qrcode.Encode(adres, qrcode.Medium, 560)
	if err != nil {
		http.Error(w, "üretilemedi", 500)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(png)
}

// dosyaVer, inen dosyayı telefona gönderir. Yalnızca listedeki işlerin
// dosyaları verilir; adresle rastgele dosya istenemez.
func (s *Sunucu) dosyaVer(w http.ResponseWriter, r *http.Request, id string) {
	is := s.isler.Bul(id)
	if is == nil || is.Durum != "bitti" {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(is.Dosya)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	bilgi, err := f.Stat()
	if err != nil || bilgi.IsDir() {
		http.NotFound(w, r)
		return
	}
	ad := filepath.Base(is.Dosya)
	tur := "video/mp4"
	if strings.EqualFold(filepath.Ext(ad), ".mp3") {
		tur = "audio/mpeg"
	}
	w.Header().Set("Content-Type", tur)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, duzAd(ad), url.PathEscape(ad)))
	http.ServeContent(w, r, "", bilgi.ModTime(), f)
}

// duzAd, eski tarayıcılar için yalnızca ASCII harflerden oluşan yedek adı verir.
func duzAd(ad string) string {
	cevir := strings.NewReplacer(
		"ç", "c", "Ç", "C", "ğ", "g", "Ğ", "G", "ı", "i", "İ", "I",
		"ö", "o", "Ö", "O", "ş", "s", "Ş", "S", "ü", "u", "Ü", "U",
	)
	var b strings.Builder
	for _, r := range cevir.Replace(ad) {
		if r >= 32 && r < 127 && r != '"' && r != '\\' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return b.String()
}

func (s *Sunucu) Dinliyor() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dinleyen != nil
}
