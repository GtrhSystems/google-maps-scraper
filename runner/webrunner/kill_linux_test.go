//go:build linux

//nolint:testpackage // Prueba una función interna.
package webrunner

import (
	"os/exec"
	"testing"
	"time"
)

func TestKillDescendantsTerminaLosHijos(t *testing.T) {
	cmd := exec.Command("sh", "-c", "sleep 30 & wait") // hijo y nieto, como driver y navegador
	if err := cmd.Start(); err != nil {
		t.Skipf("no se pudo lanzar sh: %v", err)
	}

	time.Sleep(200 * time.Millisecond)
	killDescendants()

	fin := make(chan error, 1)
	go func() { fin <- cmd.Wait() }()

	select {
	case err := <-fin:
		if err == nil {
			t.Fatal("el hijo terminó sin ser matado")
		}
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("el hijo sigue vivo tras killDescendants")
	}
}
