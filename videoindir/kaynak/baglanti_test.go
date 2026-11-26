package main

import (
	"errors"
	"testing"
)

func TestBaglantiCoz(t *testing.T) {
	const no = "abcDEF12_-x"
	temiz := "https://www.youtube.com/watch?v=" + no
	gecerli := []string{
		"https://www.youtube.com/watch?v=" + no,
		"https://youtube.com/watch?v=" + no + "&list=PLxyz&index=3",
		"https://m.youtube.com/watch?v=" + no + "&t=42s",
		"https://music.youtube.com/watch?v=" + no,
		"https://youtu.be/" + no,
		"https://youtu.be/" + no + "?si=paylasim",
		"youtu.be/" + no,
		"https://www.youtube.com/shorts/" + no,
		"https://www.youtube.com/live/" + no + "?feature=share",
		"https://www.youtube.com/embed/" + no,
		"  https://youtu.be/" + no + "  ",
		"Şu videoya bak: https://youtu.be/" + no + " çok iyi",
	}
	for _, g := range gecerli {
		videoNo, adres, err := baglantiCoz(g)
		if err != nil || videoNo != no || adres != temiz {
			t.Errorf("%q: beklenen %q, gelen no=%q adres=%q hata=%v", g, temiz, videoNo, adres, err)
		}
	}

	gecersiz := map[string]error{
		"":                                  errBaglantiYok,
		"merhaba":                           errBaglantiYok,
		"https://example.com/watch?v=" + no: errYouTubeDegil,
		"https://youtube.com.example.com/watch?v=" + no: errYouTubeDegil,
		"https://www.youtube.com/playlist?list=PLxyz":   errTekVideoDegil,
		"https://www.youtube.com/@kanal":                errTekVideoDegil,
		"https://www.youtube.com/watch?v=kisa":          errTekVideoDegil,
		"https://youtu.be/" + no + "fazla":              errTekVideoDegil,
		// Seçenek gibi görünen bir metin motora ulaşmamalı.
		"https://youtu.be/--exec=calc": errTekVideoDegil,
		"http://127.0.0.1:8080/x.mpd":  errYouTubeDegil,
	}
	for g, beklenen := range gecersiz {
		if _, adres, err := baglantiCoz(g); !errors.Is(err, beklenen) {
			t.Errorf("%q: beklenen hata %v, gelen %v (adres %q)", g, beklenen, err, adres)
		}
	}
}

func TestAraDosyaMi(t *testing.T) {
	for kuyruk, beklenen := range map[string]bool{
		".f137.mp4":   true,
		".f251.webm":  true,
		".f140.m4a":   true,
		".f399-1.mp4": true,
		".mp4":        false,
		".mp3":        false,
		".final.mp4":  false,
		".f.mp4":      false,
	} {
		if araDosyaMi(kuyruk) != beklenen {
			t.Errorf("%q: beklenen %v", kuyruk, beklenen)
		}
	}
}

func TestHatayiCevir(t *testing.T) {
	for ham, beklenen := range map[string]string{
		"ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video": "Bu video özel; indirilemiyor.",
		"ERROR: [youtube] abc: This video is unavailable":                                          "Video bulunamadı; kaldırılmış ya da erişime kapatılmış olabilir.",
		"ERROR: [youtube] abc: Video unavailable":                                                  "Video bulunamadı; kaldırılmış ya da erişime kapatılmış olabilir.",
		"ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate":       "Video yaş sınırlı; YouTube oturum açılmadan indirilmesine izin vermiyor.",
		"ERROR: [youtube] abc: Sign in to confirm you're not a bot":                                "YouTube şu an bu bilgisayardan indirmeye izin vermedi. Bir süre sonra yeniden deneyin.",
		"ERROR: unable to download video data: <urlopen error [Errno 11001] getaddrinfo failed>":   "İnternet bağlantısı kurulamadı. Bağlantınızı denetleyip yeniden deneyin.",
		"ERROR: bilinmeyen bir şey":                                                                "İndirme tamamlanamadı.",
	} {
		if baslik, _ := hatayiCevir(ham); baslik != beklenen {
			t.Errorf("%q: beklenen %q, gelen %q", ham, beklenen, baslik)
		}
	}
}

func TestAgIci(t *testing.T) {
	for adres, beklenen := range map[string]bool{
		"192.168.1.20:5000": true,
		"10.0.0.7:5000":     true,
		"172.20.3.4:5000":   true,
		"100.72.1.1:5000":   true,
		"127.0.0.1:5000":    true,
		"8.8.8.8:5000":      false,
		"85.105.20.30:5000": false,
		"172.32.0.1:5000":   false,
	} {
		if yerelAgdan(adres) != beklenen {
			t.Errorf("%s: beklenen %v", adres, beklenen)
		}
	}
}
