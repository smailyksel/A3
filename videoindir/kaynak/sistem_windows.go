//go:build windows

package main

import (
	_ "embed"
	"errors"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	ole "github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	pencereYok      = 0x08000000 // CREATE_NO_WINDOW
	calistirAnahtar = `Software\Microsoft\Windows\CurrentVersion\Run`
	calistirAdi     = "VideoIndir"
	kisayolAdi      = "Video İndir.lnk"
)

//go:embed simge.ico
var simgeDosyasi []byte

// gizliKomut, yardımcı programların siyah komut penceresi açmasını önler.
func gizliKomut(k *exec.Cmd) {
	k.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: pencereYok}
}

// agaciOldur, işlemi alt işlemleriyle birlikte sonlandırır. İndirme motoru
// kendi içinde ikinci bir işlem başlattığı için yalnızca üsttekini kapatmak yetmez.
func agaciOldur(pid int) {
	k := exec.Command(filepath.Join(os.Getenv("SystemRoot"), "System32", "taskkill.exe"), "/T", "/F", "/PID", strconv.Itoa(pid))
	gizliKomut(k)
	k.Run()
}

func sistemVeriDizini() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "VideoIndir")
	}
	d, _ := os.UserConfigDir()
	return filepath.Join(d, "VideoIndir")
}

func sistemVideoDizini() string {
	if d, err := windows.KnownFolderPath(windows.FOLDERID_Videos, 0); err == nil && d != "" {
		return d
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "Videos")
}

func videoKlasoruBilinen() bool { return true }

func tarayiciAdaylari() []string {
	var hepsi []string
	for _, kok := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if kok == "" {
			continue
		}
		hepsi = append(hepsi, filepath.Join(kok, "Microsoft", "Edge", "Application", "msedge.exe"))
	}
	for _, kok := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if kok == "" {
			continue
		}
		hepsi = append(hepsi, filepath.Join(kok, "Google", "Chrome", "Application", "chrome.exe"))
	}
	return hepsi
}

// pencereAc, arayüzü adres çubuğu olmayan sade bir pencerede açar. Windows 11
// ile gelen Edge bunu destekler; bulunamazsa varsayılan tarayıcıda açılır.
func pencereAc(adres string) {
	if os.Getenv("VIDEOINDIR_PENCERE") == "0" {
		return
	}
	for _, yol := range tarayiciAdaylari() {
		if _, err := os.Stat(yol); err != nil {
			continue
		}
		k := exec.Command(yol, "--app="+adres, "--window-size=820,960")
		if err := k.Start(); err == nil {
			go k.Wait()
			return
		}
	}
	if err := yolAc(adres); err != nil {
		log.Printf("pencere açılamadı: %v", err)
	}
}

// yolAc, dosyayı, klasörü ya da adresi Windows'un varsayılan programıyla açar.
func yolAc(yol string) error {
	fiil, _ := windows.UTF16PtrFromString("open")
	hedef, err := windows.UTF16PtrFromString(yol)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, fiil, hedef, nil, nil, windows.SW_SHOWNORMAL)
}

func otomatikDurumu() (acik, destek bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, calistirAnahtar, registry.QUERY_VALUE)
	if err != nil {
		return false, true
	}
	defer k.Close()
	v, _, err := k.GetStringValue(calistirAdi)
	return err == nil && v != "", true
}

// otomatikAyarla, programın Windows açılınca kendiliğinden (pencere açmadan)
// başlamasını açar ya da kapatır. Yalnızca oturum açan kullanıcıyı etkiler.
func otomatikAyarla(acik bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, calistirAnahtar, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !acik {
		err := k.DeleteValue(calistirAdi)
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	kendi, err := os.Executable()
	if err != nil {
		return err
	}
	return k.SetStringValue(calistirAdi, `"`+kendi+`" --arkaplan`)
}

// kendiniYerlestir, program İndirilenler gibi geçici bir yerden çalıştırıldıysa
// kendini kalıcı klasörüne kopyalar, masaüstüne kısayol koyar ve oradan
// yeniden başlar. Böylece indirilen dosya silinse de program yerinde kalır.
// Yeniden başlattıysa true döner; çağıran çıkmalıdır.
func kendiniYerlestir(secenekler []string) bool {
	if os.Getenv("VIDEOINDIR_YERLESME") == "0" {
		return false
	}
	kendi, err := os.Executable()
	if err != nil {
		return false
	}
	if gercek, err := filepath.EvalSymlinks(kendi); err == nil {
		kendi = gercek
	}
	hedef := filepath.Join(veriDizini(), "VideoIndir.exe")
	if strings.EqualFold(filepath.Clean(kendi), filepath.Clean(hedef)) {
		return false
	}
	var kopyaHatasi error
	for deneme := 0; deneme < 10; deneme++ {
		if kopyaHatasi = dosyaKopyala(kendi, hedef); kopyaHatasi == nil {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if kopyaHatasi != nil {
		log.Printf("yerleşilemedi, bulunduğu yerden çalışacak: %v", kopyaHatasi)
		return false
	}
	if err := kisayolKoy(hedef); err != nil {
		log.Printf("kısayol konamadı: %v", err)
	}
	k := exec.Command(hedef, secenekler...)
	k.Dir = filepath.Dir(hedef)
	if err := k.Start(); err != nil {
		log.Printf("yerleşen kopya başlatılamadı: %v", err)
		return false
	}
	return true
}

func dosyaKopyala(kaynak, hedef string) error {
	r, err := os.Open(kaynak)
	if err != nil {
		return err
	}
	defer r.Close()
	gecici := hedef + ".yeni"
	w, err := os.Create(gecici)
	if err != nil {
		return err
	}
	if _, err := io.Copy(w, r); err != nil {
		w.Close()
		os.Remove(gecici)
		return err
	}
	if err := w.Close(); err != nil {
		os.Remove(gecici)
		return err
	}
	os.Remove(hedef)
	if err := os.Rename(gecici, hedef); err != nil {
		os.Remove(gecici)
		return err
	}
	return nil
}

// kisayolKoy, masaüstüne "Video İndir" kısayolunu koyar.
func kisayolKoy(hedef string) error {
	masaustu, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
	if err != nil {
		return err
	}
	kisayol := filepath.Join(masaustu, kisayolAdi)

	// Kısayolun simgesi programın yanına yazılan dosyadan gelir.
	simge := filepath.Join(filepath.Dir(hedef), "simge.ico")
	simgeYeri := hedef + ",0"
	if err := os.WriteFile(simge, simgeDosyasi, 0o644); err == nil {
		simgeYeri = simge + ",0"
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED); err != nil {
		// 1 (S_FALSE): bu iş parçacığında zaten başlatılmış; sorun değil.
		var oe *ole.OleError
		if !errors.As(err, &oe) || oe.Code() != 1 {
			return err
		}
	}
	defer ole.CoUninitialize()

	nesne, err := oleutil.CreateObject("WScript.Shell")
	if err != nil {
		return err
	}
	defer nesne.Release()
	kabuk, err := nesne.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return err
	}
	defer kabuk.Release()
	sonuc, err := oleutil.CallMethod(kabuk, "CreateShortcut", kisayol)
	if err != nil {
		return err
	}
	k := sonuc.ToIDispatch()
	defer k.Release()
	for ad, deger := range map[string]string{
		"TargetPath":       hedef,
		"WorkingDirectory": filepath.Dir(hedef),
		"Description":      "YouTube videosu indir",
		"IconLocation":     simgeYeri,
	} {
		if _, err := oleutil.PutProperty(k, ad, deger); err != nil {
			return err
		}
	}
	_, err = oleutil.CallMethod(k, "Save")
	return err
}
