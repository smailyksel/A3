// Video İndir: YouTube bağlantısı verilen videoyu bilgisayara indirir; aynı
// ağdaki telefondan da kullanılabilir. Program küçük bir yerel sunucudur,
// arayüzü tarayıcı penceresinde açılır.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

func gunlukAc() {
	yol := filepath.Join(veriDizini(), "gunluk.txt")
	if b, err := os.Stat(yol); err == nil && b.Size() > 1<<20 {
		os.Remove(yol + ".eski")
		os.Rename(yol, yol+".eski")
	}
	f, err := os.OpenFile(yol, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	if denemeKipi() {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	} else {
		log.SetOutput(f)
	}
}

var yoklamaIstemcisi = &http.Client{Timeout: 2 * time.Second}

// calisanOrnek, program bu kapıda zaten çalışıyor mu diye bakar.
func calisanOrnek(kapi int) (calisanSurum string, var_ bool) {
	yanit, err := yoklamaIstemcisi.Get(fmt.Sprintf("http://127.0.0.1:%d/api/ping", kapi))
	if err != nil {
		return "", false
	}
	defer yanit.Body.Close()
	var g struct {
		Uygulama string `json:"uygulama"`
		Surum    string `json:"surum"`
	}
	if json.NewDecoder(io.LimitReader(yanit.Body, 4096)).Decode(&g) != nil || g.Uygulama != uygulamaKimligi {
		return "", false
	}
	return g.Surum, true
}

func ornegeGonder(a Ayar, islem string) {
	adres := fmt.Sprintf("http://127.0.0.1:%d/%s/api/%s", a.Kapi, a.Anahtar, islem)
	yanit, err := yoklamaIstemcisi.Post(adres, "application/json", bytes.NewBufferString("{}"))
	if err == nil {
		yanit.Body.Close()
	}
}

func main() {
	arkaplan := flag.Bool("arkaplan", false, "pencere açmadan çalış")
	surumYaz := flag.Bool("surum", false, "sürümü yaz ve çık")
	flag.Parse()
	if *surumYaz {
		fmt.Println(surum)
		return
	}

	os.MkdirAll(veriDizini(), 0o755)
	gunlukAc()
	ayarYukle()
	a := ayarOku()

	// Program zaten açıksa ikinci kez başlatmak yalnızca pencereyi getirir.
	if calisan, var_ := calisanOrnek(a.Kapi); var_ {
		if calisan == surum {
			if !*arkaplan {
				ornegeGonder(a, "pencere")
			}
			return
		}
		log.Printf("çalışan sürüm %s, yenisi %s; eskisi kapatılıyor", calisan, surum)
		ornegeGonder(a, "kapat")
		for i := 0; i < 50; i++ {
			if _, v := calisanOrnek(a.Kapi); !v {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
		time.Sleep(500 * time.Millisecond)
	}

	if kendiniYerlestir(os.Args[1:]) {
		return
	}

	log.Printf("Video İndir %s başlıyor", surum)
	araclar := yeniAraclar()
	isler := yeniIsler(araclar)

	bitti := make(chan struct{})
	var birKez sync.Once
	sunucu := yeniSunucu(isler, araclar, func() {
		birKez.Do(func() {
			isler.HepsiniDurdur()
			close(bitti)
		})
	})

	// Kapı başka bir programca tutuluyorsa sıradaki denenir.
	acildi := false
	for deneme := 0; deneme < 20; deneme++ {
		err := sunucu.Dinle(a.Telefon)
		if sunucu.Dinliyor() {
			if err != nil {
				log.Printf("ağa açılamadı, yalnızca bu bilgisayardan kullanılacak: %v", err)
			}
			acildi = true
			break
		}
		ayarDegistir(func(x *Ayar) { x.Kapi++ })
	}
	if !acildi {
		log.Fatalf("sunucu açılamadı")
	}
	a = ayarOku()
	log.Printf("dinleniyor: kapı %d, telefon %v", a.Kapi, a.Telefon)

	go araclar.Hazirla()

	if !*arkaplan {
		pencereAc(fmt.Sprintf("http://127.0.0.1:%d/%s/", a.Kapi, a.Anahtar))
	}
	<-bitti
	log.Printf("kapanıyor")
}
