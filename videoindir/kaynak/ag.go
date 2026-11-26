package main

import (
	"net"
	"os"
	"regexp"
	"strings"
)

// agIci, adresin ev ya da büro ağına ait olup olmadığını söyler: özel ağ
// aralıkları, bağlantıya özgü adresler ve operatör içi 100.64.0.0/10 aralığı.
// İnternetteki genel adresler bunun dışında kalır.
func agIci(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil || ip4.IsLoopback() || ip4.IsUnspecified() {
		return false
	}
	if ip4.IsPrivate() || ip4.IsLinkLocalUnicast() {
		return true
	}
	if ip4[0] == 100 && ip4[1]&0xC0 == 64 {
		return true
	}
	return denemeKipi()
}

// yerelIP, bilgisayarın ev ya da büro ağındaki adresini bulur.
func yerelIP() string {
	// Bağlantı kurulmaz, paket gitmez; yalnızca çıkış arayüzü öğrenilir.
	if c, err := net.Dial("udp4", "192.0.2.1:9"); err == nil {
		ip := c.LocalAddr().(*net.UDPAddr).IP
		c.Close()
		if agIci(ip) {
			return ip.To4().String()
		}
	}
	adresler, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range adresler {
		if n, ok := a.(*net.IPNet); ok && agIci(n.IP) {
			return n.IP.To4().String()
		}
	}
	return ""
}

func istekIP(uzakAdres string) net.IP {
	h, _, err := net.SplitHostPort(uzakAdres)
	if err != nil {
		h = uzakAdres
	}
	return net.ParseIP(h)
}

func geriDongu(uzakAdres string) bool {
	ip := istekIP(uzakAdres)
	return ip != nil && ip.IsLoopback()
}

// yerelAgdan, isteğin ev ya da büro ağından geldiğini doğrular; internetten
// gelen bir istek, kapı yönlendirilmiş olsa bile kabul edilmez.
func yerelAgdan(uzakAdres string) bool {
	ip := istekIP(uzakAdres)
	return ip != nil && (ip.IsLoopback() || agIci(ip))
}

var sadeAd = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,62}$`)

// yerelAd, telefonun adres değişse de bilgisayarı bulabilmesi için
// "BILGISAYAR.local" biçimindeki adı verir. Ad buna uygun değilse boş döner.
func yerelAd() string {
	ad, err := os.Hostname()
	if err != nil {
		return ""
	}
	ad = strings.TrimSuffix(strings.ToLower(ad), ".local")
	if i := strings.IndexByte(ad, '.'); i > 0 {
		ad = ad[:i]
	}
	if !sadeAd.MatchString(ad) {
		return ""
	}
	return ad + ".local"
}
