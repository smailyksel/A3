package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestWindowsKurulumu, Windows'ta ilk açılışta yapılan indirmeyi gerçek
// adreslerden dener: dosyalar iniyor mu, arşivler açılıyor mu, beklenen
// program dosyaları yerinde mi. Yaklaşık 160 MB indirdiği için yalnızca
// VIDEOINDIR_KURULUM_DENE=1 verilince çalışır.
func TestWindowsKurulumu(t *testing.T) {
	if os.Getenv("VIDEOINDIR_KURULUM_DENE") != "1" {
		t.Skip("VIDEOINDIR_KURULUM_DENE=1 verilmedi")
	}
	kok := t.TempDir()
	var son kurulumDurumu
	yollar, err := kur(kok, windowsParcalari(), func(f func(d *kurulumDurumu)) { f(&son) })
	if err != nil {
		t.Fatalf("kurulum: %v", err)
	}
	for _, yol := range []string{
		yollar.ytdlp,
		filepath.Join(yollar.ffmpeg, "ffmpeg.exe"),
		filepath.Join(yollar.ffmpeg, "ffprobe.exe"),
		filepath.Join(kok, "deno", "deno.exe"),
	} {
		veri, err := os.ReadFile(yol)
		if err != nil {
			t.Errorf("%s yok: %v", yol, err)
			continue
		}
		// Paylaşımlı kurulumda ffmpeg.exe küçüktür; asıl kod kitaplıklardadır.
		if len(veri) < 100<<10 || string(veri[:2]) != "MZ" {
			t.Errorf("%s bir Windows programı gibi görünmüyor (%d bayt)", yol, len(veri))
		}
		t.Logf("%s: %d KB", filepath.Base(yol), len(veri)>>10)
	}
	kitaplik, _ := filepath.Glob(filepath.Join(yollar.ffmpeg, "*.dll"))
	if len(kitaplik) == 0 {
		t.Errorf("ffmpeg kitaplıkları çıkmadı")
	}
	if _, err := os.Stat(filepath.Join(yollar.ffmpeg, "ffplay.exe")); err == nil {
		t.Errorf("gereksiz dosya da çıkarılmış: ffplay.exe")
	}
	var toplam int64
	for _, k := range kitaplik {
		if b, err := os.Stat(k); err == nil {
			toplam += b.Size()
		}
	}
	t.Logf("ffmpeg klasöründe %d kitaplık, %d MB; son adım %q (%d / %d)", len(kitaplik), toplam>>20, son.Adim, son.Sira, son.Adet)

	// İkinci çağrı bir şey indirmemeli.
	son = kurulumDurumu{}
	if _, err := kur(kok, windowsParcalari(), func(f func(d *kurulumDurumu)) { f(&son) }); err != nil || son.Adet != 0 {
		t.Errorf("kurulu araçlar yeniden indirildi: %v %+v", err, son)
	}
}
