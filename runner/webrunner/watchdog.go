package webrunner

import (
	"context"
	"log"
	"time"
)

// A veces Playwright se queda colgado para siempre al cerrar el navegador
// (scrapemate bloquea en jsFetch.Close → closeBrowser): la búsqueda nunca se
// marca como terminada y la cola deja de avanzar hasta reiniciar el programa.
// Los resultados ya están escritos en ese punto, así que tras un margen se
// cierra el navegador a la fuerza y la búsqueda se da por terminada.

// closeGrace es lo que se espera a que el navegador cierre cuando la búsqueda ya acabó.
var closeGrace = 90 * time.Second

// killGrace es lo que se espera a que Start vuelva tras cerrar el navegador a la fuerza.
var killGrace = 10 * time.Second

// killBrowsers cierra a la fuerza los procesos hijos del programa (navegador y driver).
var killBrowsers = killDescendants

// waitMate espera el resultado de Start. Si la búsqueda ya terminó (mateCtx
// cancelado) y Start sigue sin volver pasado closeGrace, cierra el navegador a
// la fuerza y devuelve nil: el bloqueo está en el cierre, no en el scraping.
func waitMate(mateCtx context.Context, done <-chan error, jobID string) error {
	select {
	case err := <-done:
		return err
	case <-mateCtx.Done():
	}

	select {
	case err := <-done:
		return err
	case <-time.After(closeGrace):
	}

	log.Printf("job %s: el navegador no se cerró en %s; se cierra a la fuerza", jobID, closeGrace)

	killBrowsers()

	select {
	case <-done:
	case <-time.After(killGrace):
		log.Printf("job %s: sigue sin cerrar tras forzarlo; se continúa con la cola", jobID)
	}

	return nil
}
