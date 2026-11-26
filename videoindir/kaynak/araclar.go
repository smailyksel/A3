package main

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// İndirme işini yapan üç yardımcı program vardır: yt-dlp (indirme motoru),
// ffmpeg (görüntü ile sesi birleştirir, MP3'e çevirir) ve deno (YouTube'un
// sayfa betiklerini çözmek için motorun kullandığı çalıştırıcı). Windows'ta
// bunlar ilk açılışta kendi resmi adreslerinden indirilir.

type kurulumDurumu struct {
	Durum  string `json:"durum"` // bekliyor, indiriliyor, hazir, hata
	Adim   string `json:"adim,omitempty"`
	Sira   int    `json:"sira,omitempty"`
	Adet   int    `json:"adet,omitempty"`
	Inen   int64  `json:"inen"`
	Toplam int64  `json:"toplam"`
	Hata   string `json:"hata,omitempty"`
}

type aracYollari struct {
	ytdlp  string
	ffmpeg string // ffmpeg'in bulunduğu klasör; boşsa PATH'ten bulunur
	js     string // "deno:C:\...\deno.exe" gibi; boşsa motorun varsayılanı
}

type Araclar struct {
	mu     sync.Mutex
	durum  kurulumDurumu
	yollar aracYollari
	hazir  chan struct{} // kurulum bitince kapanır
	// motorKilit, güncelleme ile indirmenin aynı anda çalışmasını önler.
	motorKilit sync.Mutex
}

func yeniAraclar() *Araclar {
	return &Araclar{durum: kurulumDurumu{Durum: "bekliyor"}, hazir: make(chan struct{})}
}

func (a *Araclar) Durum() kurulumDurumu {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.durum
}

func (a *Araclar) Yollar() aracYollari {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.yollar
}

func (a *Araclar) ayarla(f func(d *kurulumDurumu)) {
	a.mu.Lock()
	f(&a.durum)
	a.mu.Unlock()
}

// Bekle, kurulum bitene kadar bekler; kurulum hata ile bittiyse hatayı döner.
func (a *Araclar) Bekle(ctx context.Context) error {
	for {
		a.mu.Lock()
		d, kanal := a.durum, a.hazir
		a.mu.Unlock()
		switch d.Durum {
		case "hazir":
			return nil
		case "hata":
			return errors.New("Kurulum tamamlanamadı: " + d.Hata)
		}
		select {
		case <-kanal:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

type parca struct {
	etiket string // ekranda görünen ad
	url    string
	// sec, zip içindeki bir dosyanın hedef adını verir; boş dönerse dosya atlanır.
	// nil ise indirilen dosya zip değildir, doğrudan hedef olarak yazılır.
	sec   func(ad string) string
	hedef string // araçlar klasörüne göre; zip için klasör, değilse dosya
	isret string // kurulduğunu gösteren dosya
}

func windowsParcalari() []parca {
	return []parca{
		{
			etiket: "indirme motoru",
			url:    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
			hedef:  "yt-dlp.exe",
			isret:  "yt-dlp.exe",
		},
		{
			etiket: "betik çalıştırıcı",
			url:    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip",
			sec: func(ad string) string {
				if strings.EqualFold(path.Base(ad), "deno.exe") {
					return "deno.exe"
				}
				return ""
			},
			hedef: "deno",
			isret: filepath.Join("deno", "deno.exe"),
		},
		{
			etiket: "birleştirme aracı",
			url:    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip",
			sec: func(ad string) string {
				// yalnızca bin klasöründeki ffmpeg, ffprobe ve bunların kitaplıkları
				if path.Base(path.Dir(ad)) != "bin" {
					return ""
				}
				b := strings.ToLower(path.Base(ad))
				if b == "ffmpeg.exe" || b == "ffprobe.exe" || strings.HasSuffix(b, ".dll") {
					return b
				}
				return ""
			},
			hedef: "ffmpeg",
			isret: filepath.Join("ffmpeg", "ffmpeg.exe"),
		},
	}
}

func windowsYollari(kok string) aracYollari {
	return aracYollari{
		ytdlp:  filepath.Join(kok, "yt-dlp.exe"),
		ffmpeg: filepath.Join(kok, "ffmpeg"),
		js:     "deno:" + filepath.Join(kok, "deno", "deno.exe"),
	}
}

// Hazirla, araçları bulur; Windows'ta eksik olanı indirir. Arka planda çalışır.
func (a *Araclar) Hazirla() {
	a.mu.Lock()
	if a.durum.Durum == "indiriliyor" {
		a.mu.Unlock()
		return
	}
	if a.durum.Durum == "hata" {
		a.hazir = make(chan struct{})
	}
	a.durum = kurulumDurumu{Durum: "indiriliyor"}
	a.mu.Unlock()

	var yollar aracYollari
	var err error
	if runtime.GOOS == "windows" {
		yollar, err = kur(araclarDizini(), windowsParcalari(), a.ayarla)
		if err == nil {
			err = motorCalisiyorMu(yollar.ytdlp)
		}
	} else {
		yollar, err = sistemdenBul()
	}

	a.mu.Lock()
	if err != nil {
		log.Printf("kurulum hatası: %v", err)
		a.durum = kurulumDurumu{Durum: "hata", Hata: err.Error()}
	} else {
		a.yollar = yollar
		a.durum = kurulumDurumu{Durum: "hazir"}
	}
	close(a.hazir)
	a.mu.Unlock()

	if err == nil {
		go a.GunlukGuncelle()
	}
}

// sistemdenBul, Windows dışındaki sistemlerde (geliştirme ve deneme) kurulu
// araçları kullanır.
func sistemdenBul() (aracYollari, error) {
	var y aracYollari
	y.ytdlp = os.Getenv("VIDEOINDIR_YTDLP")
	if y.ytdlp == "" {
		p, err := exec.LookPath("yt-dlp")
		if err != nil {
			return y, errors.New("yt-dlp bulunamadı")
		}
		y.ytdlp = p
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return y, errors.New("ffmpeg bulunamadı")
	}
	if _, err := exec.LookPath("deno"); err != nil {
		if _, err := exec.LookPath("node"); err == nil {
			y.js = "node"
		}
	}
	return y, nil
}

func kur(kok string, parcalar []parca, bildir func(func(d *kurulumDurumu))) (aracYollari, error) {
	if err := os.MkdirAll(kok, 0o755); err != nil {
		return aracYollari{}, fmt.Errorf("klasör açılamadı: %w", err)
	}
	var eksik []parca
	for _, p := range parcalar {
		if _, err := os.Stat(filepath.Join(kok, p.isret)); err != nil {
			eksik = append(eksik, p)
		}
	}
	for i, p := range eksik {
		bildir(func(d *kurulumDurumu) {
			d.Adim, d.Sira, d.Adet, d.Inen, d.Toplam = p.etiket, i+1, len(eksik), 0, 0
		})
		var err error
		for deneme := 1; deneme <= 3; deneme++ {
			err = parcaKur(kok, p, func(inen, toplam int64) {
				bildir(func(d *kurulumDurumu) { d.Inen, d.Toplam = inen, toplam })
			})
			if err == nil {
				break
			}
			log.Printf("%s indirilemedi (deneme %d): %v", p.etiket, deneme, err)
			time.Sleep(time.Duration(deneme) * 2 * time.Second)
		}
		if err != nil {
			return aracYollari{}, fmt.Errorf("%s indirilemedi. İnternet bağlantınızı denetleyip yeniden deneyin. (%v)", p.etiket, err)
		}
	}
	return windowsYollari(kok), nil
}

func parcaKur(kok string, p parca, ilerleme func(inen, toplam int64)) error {
	gecici := filepath.Join(kok, "indirilen.parca")
	defer os.Remove(gecici)
	if err := indir(p.url, gecici, ilerleme); err != nil {
		return err
	}
	if p.sec == nil {
		hedef := filepath.Join(kok, p.hedef)
		os.Remove(hedef)
		return os.Rename(gecici, hedef)
	}

	// Zip önce yan klasöre açılır, tamamı çıkınca yerine alınır; yarıda
	// kalan bir kurulum çalışır gibi görünmesin.
	hedef := filepath.Join(kok, p.hedef)
	yan := hedef + ".yeni"
	os.RemoveAll(yan)
	if err := os.MkdirAll(yan, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(yan)

	z, err := zip.OpenReader(gecici)
	if err != nil {
		return fmt.Errorf("arşiv açılamadı: %w", err)
	}
	adet := 0
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		ad := p.sec(f.Name)
		if ad == "" {
			continue
		}
		// sec yalnızca düz dosya adı döndürür; yine de klasör dışına çıkışı engelle
		if ad != filepath.Base(ad) {
			continue
		}
		if err := zipDosyasiCikar(f, filepath.Join(yan, ad)); err != nil {
			z.Close()
			return err
		}
		adet++
	}
	z.Close()
	if adet == 0 {
		return errors.New("arşivde beklenen dosya yok")
	}
	os.RemoveAll(hedef)
	return os.Rename(yan, hedef)
}

func zipDosyasiCikar(f *zip.File, hedef string) error {
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	w, err := os.OpenFile(hedef, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(w, r); err != nil {
		w.Close()
		return err
	}
	return w.Close()
}

// indir, dosyayı adresten alır. Veri akışı 45 saniye durursa bağlantıyı keser.
func indir(adres, hedef string, ilerleme func(inen, toplam int64)) error {
	ctx, iptal := context.WithCancel(context.Background())
	defer iptal()
	istek, err := http.NewRequestWithContext(ctx, http.MethodGet, adres, nil)
	if err != nil {
		return err
	}
	istek.Header.Set("User-Agent", "VideoIndir/"+surum)

	bekci := time.AfterFunc(45*time.Second, iptal)
	defer bekci.Stop()

	yanit, err := http.DefaultClient.Do(istek)
	if err != nil {
		return err
	}
	defer yanit.Body.Close()
	if yanit.StatusCode != http.StatusOK {
		return fmt.Errorf("sunucu yanıtı %d", yanit.StatusCode)
	}
	w, err := os.Create(hedef)
	if err != nil {
		return err
	}
	toplam := yanit.ContentLength
	var inen int64
	tampon := make([]byte, 256*1024)
	sonBildirim := time.Now()
	for {
		n, rerr := yanit.Body.Read(tampon)
		if n > 0 {
			bekci.Reset(45 * time.Second)
			if _, werr := w.Write(tampon[:n]); werr != nil {
				w.Close()
				return werr
			}
			inen += int64(n)
			if time.Since(sonBildirim) > 200*time.Millisecond {
				ilerleme(inen, toplam)
				sonBildirim = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			w.Close()
			return rerr
		}
	}
	ilerleme(inen, toplam)
	if err := w.Close(); err != nil {
		return err
	}
	if toplam > 0 && inen != toplam {
		return fmt.Errorf("dosya eksik indi (%d / %d)", inen, toplam)
	}
	return nil
}

func motorSurumu(ytdlp string) (string, error) {
	ctx, iptal := context.WithTimeout(context.Background(), 2*time.Minute)
	defer iptal()
	k := exec.CommandContext(ctx, ytdlp, "--ignore-config", "--version")
	gizliKomut(k)
	cikti, err := k.Output()
	return strings.TrimSpace(string(cikti)), err
}

func motorCalisiyorMu(ytdlp string) error {
	s, err := motorSurumu(ytdlp)
	if err != nil || s == "" {
		return fmt.Errorf("indirme motoru çalıştırılamadı. Virüsten koruma programı engelliyor olabilir. (%v)", err)
	}
	log.Printf("indirme motoru sürümü: %s", s)
	return nil
}

// Guncelle, indirme motorunu yeniler; sürüm değiştiyse true döner. YouTube
// sık değiştiği için motorun güncel kalması gerekir.
func (a *Araclar) Guncelle() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	y := a.Yollar()
	if y.ytdlp == "" {
		return false
	}
	a.motorKilit.Lock()
	defer a.motorKilit.Unlock()

	once, _ := motorSurumu(y.ytdlp)
	ctx, iptal := context.WithTimeout(context.Background(), 5*time.Minute)
	defer iptal()
	k := exec.CommandContext(ctx, y.ytdlp, "--ignore-config", "-U")
	gizliKomut(k)
	cikti, err := k.CombinedOutput()
	if err != nil {
		log.Printf("motor güncellenemedi: %v: %s", err, strings.TrimSpace(string(cikti)))
		return false
	}
	sonra, _ := motorSurumu(y.ytdlp)
	if sonra != "" && sonra != once {
		log.Printf("indirme motoru güncellendi: %s -> %s", once, sonra)
		return true
	}
	return false
}

// GunlukGuncelle, günde bir kez güncelleme denetler.
func (a *Araclar) GunlukGuncelle() {
	bugun := time.Now().Format("2006-01-02")
	if ayarOku().SonGuncelleme == bugun {
		return
	}
	a.Guncelle()
	ayarDegistir(func(x *Ayar) { x.SonGuncelleme = bugun })
}
