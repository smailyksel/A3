package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

const (
	uygulamaKimligi = "videoindir"
	surum           = "1.0.0"
	varsayilanKapi  = 47800
)

// Ayar, programın kalıcı ayarlarıdır; veri klasöründeki ayar.json dosyasında durur.
type Ayar struct {
	// Anahtar, adresin içinde taşınan gizli parçadır. Karekodu okutmayan
	// biri aynı ağda olsa bile sayfaya giremez.
	Anahtar       string `json:"anahtar"`
	Kapi          int    `json:"kapi"`
	Telefon       bool   `json:"telefon"`
	SonGuncelleme string `json:"sonGuncelleme,omitempty"`
}

var (
	ayarKilit sync.Mutex
	ayar      Ayar
)

func veriDizini() string {
	if d := os.Getenv("VIDEOINDIR_VERI"); d != "" {
		return d
	}
	return sistemVeriDizini()
}

func indirmeDizini() string {
	if d := os.Getenv("VIDEOINDIR_KLASOR"); d != "" {
		return d
	}
	return filepath.Join(sistemVideoDizini(), "YouTube")
}

func araclarDizini() string { return filepath.Join(veriDizini(), "araclar") }

func ayarYolu() string { return filepath.Join(veriDizini(), "ayar.json") }

func yeniAnahtar() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("anahtar üretilemedi: %v", err)
	}
	return hex.EncodeToString(b)
}

func ayarYukle() {
	ayarKilit.Lock()
	defer ayarKilit.Unlock()
	if veri, err := os.ReadFile(ayarYolu()); err == nil {
		_ = json.Unmarshal(veri, &ayar)
	}
	degisti := false
	if len(ayar.Anahtar) < 16 {
		ayar.Anahtar = yeniAnahtar()
		degisti = true
	}
	if ayar.Kapi < 1024 || ayar.Kapi > 65000 {
		ayar.Kapi = varsayilanKapi
		degisti = true
	}
	if degisti {
		ayarYazKilitli()
	}
}

func ayarYazKilitli() {
	veri, _ := json.MarshalIndent(ayar, "", "  ")
	if err := dosyaYaz(ayarYolu(), veri); err != nil {
		log.Printf("ayar yazılamadı: %v", err)
	}
}

// ayarDegistir, ayarı kilit altında değiştirip diske yazar.
func ayarDegistir(f func(a *Ayar)) {
	ayarKilit.Lock()
	defer ayarKilit.Unlock()
	f(&ayar)
	ayarYazKilitli()
}

func ayarOku() Ayar {
	ayarKilit.Lock()
	defer ayarKilit.Unlock()
	return ayar
}

// dosyaYaz, yarım yazılmış dosya bırakmamak için önce geçici dosyaya yazar.
func dosyaYaz(yol string, veri []byte) error {
	if err := os.MkdirAll(filepath.Dir(yol), 0o755); err != nil {
		return err
	}
	gecici := yol + ".yeni"
	if err := os.WriteFile(gecici, veri, 0o600); err != nil {
		return err
	}
	return os.Rename(gecici, yol)
}
