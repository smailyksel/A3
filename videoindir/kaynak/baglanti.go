package main

import (
	"errors"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
)

var (
	adresBul   = regexp.MustCompile(`https?://[^\s<>"']+`)
	videoNoBul = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
)

var (
	errBaglantiYok   = errors.New("Bir YouTube bağlantısı yapıştırın.")
	errYouTubeDegil  = errors.New("Bu bir YouTube bağlantısı değil.")
	errTekVideoDegil = errors.New("Oynatma listesi ya da kanal değil, tek bir videonun bağlantısını verin.")
)

func denemeKipi() bool { return os.Getenv("VIDEOINDIR_DENEME") == "1" }

// baglantiCoz, yapıştırılan metinden video numarasını çıkarır ve indirme
// motoruna verilecek temiz adresi kurar. Motor yalnızca burada kurulan
// adresi görür; kullanıcının yazdığı metin komuta hiç girmez.
func baglantiCoz(metin string) (videoNo, adres string, err error) {
	metin = strings.TrimSpace(metin)
	if metin == "" {
		return "", "", errBaglantiYok
	}
	ham := adresBul.FindString(metin)
	if ham == "" {
		// "youtu.be/..." gibi başında https olmayan yazımlar
		if strings.Contains(metin, "youtu") && !strings.ContainsAny(metin, " \t\n") {
			ham = "https://" + metin
		} else {
			return "", "", errBaglantiYok
		}
	}
	u, perr := url.Parse(ham)
	if perr != nil || u.Host == "" {
		return "", "", errBaglantiYok
	}
	host := strings.ToLower(u.Hostname())

	if denemeKipi() && (host == "127.0.0.1" || host == "localhost") {
		// Deneme kipinde yerel bir örnek dosya verilebilir; motor böyle bir
		// adresin numarası olarak dosya adını kullanır.
		ad := path.Base(u.Path)
		return strings.TrimSuffix(ad, path.Ext(ad)), ham, nil
	}

	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "m.")
	host = strings.TrimPrefix(host, "music.")

	var no string
	switch host {
	case "youtu.be":
		no = ilkParca(u.Path)
	case "youtube.com", "youtube-nocookie.com":
		parcalar := strings.Split(strings.Trim(u.Path, "/"), "/")
		switch {
		case parcalar[0] == "watch":
			no = u.Query().Get("v")
		case len(parcalar) >= 2 && (parcalar[0] == "shorts" || parcalar[0] == "live" || parcalar[0] == "embed" || parcalar[0] == "v"):
			no = parcalar[1]
		default:
			return "", "", errTekVideoDegil
		}
	default:
		return "", "", errYouTubeDegil
	}
	if !videoNoBul.MatchString(no) {
		return "", "", errTekVideoDegil
	}
	return no, "https://www.youtube.com/watch?v=" + no, nil
}

func ilkParca(yol string) string {
	yol = strings.Trim(yol, "/")
	if i := strings.IndexByte(yol, '/'); i >= 0 {
		yol = yol[:i]
	}
	return yol
}
