//go:build !windows

package main

// Program Windows içindir. Bu dosya, çekirdeğin Linux ya da macOS üzerinde
// derlenip denenebilmesi için gereken karşılıkları içerir.

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
)

func gizliKomut(k *exec.Cmd) {
	k.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func agaciOldur(pid int) {
	syscall.Kill(-pid, syscall.SIGKILL)
}

func sistemVeriDizini() string {
	ev, _ := os.UserHomeDir()
	return filepath.Join(ev, ".videoindir")
}

func sistemVideoDizini() string {
	ev, _ := os.UserHomeDir()
	return filepath.Join(ev, "Videos")
}

func videoKlasoruBilinen() bool { return false }

func pencereAc(adres string) { log.Printf("pencere: %s", adres) }

func yolAc(yol string) error {
	log.Printf("aç: %s", yol)
	return nil
}

var (
	otomatikKilit sync.Mutex
	otomatikAcik  bool
)

func otomatikDurumu() (acik, destek bool) {
	otomatikKilit.Lock()
	defer otomatikKilit.Unlock()
	return otomatikAcik, denemeKipi()
}

func otomatikAyarla(acik bool) error {
	otomatikKilit.Lock()
	defer otomatikKilit.Unlock()
	otomatikAcik = acik
	return nil
}

func kendiniYerlestir(secenekler []string) bool { return false }
