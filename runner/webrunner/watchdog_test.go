//nolint:testpackage // Prueba el vigilante interno sin lanzar un navegador.
package webrunner

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/gosom/google-maps-scraper/runner"
	"github.com/gosom/google-maps-scraper/web"
	"github.com/gosom/scrapemate"
)

// Estas pruebas cambian variables del paquete: no son paralelas y las restauran.
func conMargenes(t *testing.T, kill func()) {
	t.Helper()

	g, k, f := closeGrace, killGrace, killBrowsers
	closeGrace, killGrace, killBrowsers = 50*time.Millisecond, 50*time.Millisecond, kill

	t.Cleanup(func() { closeGrace, killGrace, killBrowsers = g, k, f })
}

func TestWaitMateCierreColgadoSeFuerza(t *testing.T) {
	done := make(chan error, 1)
	matado := false

	conMargenes(t, func() { matado = true; done <- errors.New("browser has been closed") })

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // la búsqueda ya terminó; solo falta que Start vuelva

	if err := waitMate(ctx, done, "j"); err != nil || !matado {
		t.Fatalf("err = %v, matado = %v; quiero nil y true", err, matado)
	}
}

func TestWaitMateNoSeQuedaBloqueadoNunca(t *testing.T) {
	conMargenes(t, func() {})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	t0 := time.Now()
	if err := waitMate(ctx, make(chan error), "j"); err != nil {
		t.Fatalf("err = %v", err)
	}

	if d := time.Since(t0); d > time.Second {
		t.Fatalf("tardó %s", d)
	}
}

func TestWaitMateNormalNoFuerza(t *testing.T) {
	conMargenes(t, func() { t.Fatal("no debe cerrar el navegador a la fuerza") })

	done := make(chan error, 1)
	done <- nil

	if err := waitMate(context.Background(), done, "j"); err != nil {
		t.Fatalf("err = %v", err)
	}
}

func TestScrapeJobErrorMarcaFallida(t *testing.T) {
	svc := web.NewService(&memoryJobRepo{}, t.TempDir())
	job := web.Job{ID: "job-err", Name: "cafés", Date: time.Now().UTC(), Status: web.StatusPending,
		Data: web.JobData{Keywords: []string{"cafés"}, Lang: "es", Depth: 1, MaxTime: time.Minute}}

	if err := svc.Create(context.Background(), &job); err != nil {
		t.Fatal(err)
	}

	w := &webrunner{
		svc: svc,
		cfg: &runner.Config{DataFolder: t.TempDir(), Concurrency: 1},
		setupMate: func(context.Context, io.Writer, *web.Job) (mateRunner, error) {
			return errMate{}, nil
		},
	}

	if err := w.scrapeJob(context.Background(), &job); err == nil {
		t.Fatal("quiero error")
	}

	got, _ := svc.Get(context.Background(), job.ID)
	if got.Status != web.StatusFailed {
		t.Fatalf("estado = %q; quiero %q", got.Status, web.StatusFailed)
	}
}

type errMate struct{}

func (errMate) Start(context.Context, ...scrapemate.IJob) error { return errors.New("fallo real") }
func (errMate) Close() error                                    { return nil }
