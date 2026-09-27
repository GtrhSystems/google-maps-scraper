package runner_test

import (
	"strings"
	"testing"

	"github.com/gosom/google-maps-scraper/gmaps"
	"github.com/gosom/google-maps-scraper/grid"
	"github.com/gosom/google-maps-scraper/runner"
)

func TestCreateGridSeedJobsRejectsInvalidZoom(t *testing.T) {
	t.Parallel()

	bbox := grid.BoundingBox{
		MinLat: 40.30,
		MinLon: -3.80,
		MaxLat: 40.50,
		MaxLon: -3.60,
	}

	_, err := runner.CreateGridSeedJobs(
		"en",
		strings.NewReader("coffee"),
		10,
		false,
		bbox,
		1.0,
		0,
		nil,
		nil,
		false,
	)
	if err == nil || !strings.Contains(err.Error(), "invalid zoom level") {
		t.Fatalf("expected invalid zoom level error, got %v", err)
	}
}

func TestCreateSeedJobsRejectsEmptyQueryBeforeCustomID(t *testing.T) {
	t.Parallel()

	_, err := runner.CreateSeedJobs(
		false,
		"en",
		strings.NewReader("  #!#my-id\n"),
		10,
		false,
		"",
		15,
		10000,
		nil,
		nil,
		false,
	)
	if err == nil || !strings.Contains(err.Error(), "empty query text") {
		t.Fatalf("expected empty query text error, got %v", err)
	}
}

func TestCreateGridSeedJobsRejectsEmptyQueryBeforeCustomID(t *testing.T) {
	t.Parallel()

	bbox := grid.BoundingBox{
		MinLat: 40.30,
		MinLon: -3.80,
		MaxLat: 40.50,
		MaxLon: -3.60,
	}

	_, err := runner.CreateGridSeedJobs(
		"en",
		strings.NewReader(" #!#my-id\n"),
		10,
		false,
		bbox,
		1.0,
		15,
		nil,
		nil,
		false,
	)
	if err == nil || !strings.Contains(err.Error(), "empty query text") {
		t.Fatalf("expected empty query text error, got %v", err)
	}
}

func TestCreateSeedJobsSkipsCompletedInputs(t *testing.T) {
	t.Parallel()

	jobs, err := runner.CreateSeedJobs(
		false,
		"en",
		strings.NewReader("coffee\ntea\n"),
		10,
		false,
		"",
		15,
		10000,
		nil,
		nil,
		false,
		runner.WithDeterministicSeedIDs(),
		runner.WithCompletedInputSkipper(func(inputID string) bool {
			return strings.HasPrefix(inputID, "resume:")
		}),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(jobs) != 0 {
		t.Fatalf("expected completed deterministic inputs to be skipped, got %d jobs", len(jobs))
	}
}

func TestCreateSeedJobsAddsCompletionTracker(t *testing.T) {
	t.Parallel()

	tracker := &recordingSeedTracker{}

	jobs, err := runner.CreateSeedJobs(
		false,
		"en",
		strings.NewReader("coffee\n"),
		10,
		false,
		"",
		15,
		10000,
		nil,
		nil,
		false,
		runner.WithCompletionTracker(tracker),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	job, ok := jobs[0].(*gmaps.GmapJob)
	if !ok {
		t.Fatalf("expected *gmaps.GmapJob, got %T", jobs[0])
	}

	if job.CompletionTracker != tracker {
		t.Fatalf("completion tracker was not attached")
	}
}

type recordingSeedTracker struct{}

func (t *recordingSeedTracker) SeedDiscovered(string, int) error {
	return nil
}

// Cada consulta puede centrarse en su propio punto: «texto #@lat,lon,zoom».
func TestCreateSeedJobsGeoPorConsulta(t *testing.T) {
	t.Parallel()

	jobs, err := runner.CreateSeedJobs(false, "es",
		strings.NewReader("dentistas en 28010 Madrid, España #@40.4329,-3.6968,15\ncafés en Logroño, La Rioja, España"),
		1, false, "", 0, 0, nil, nil, false)
	if err != nil || len(jobs) != 2 {
		t.Fatalf("jobs=%d err=%v", len(jobs), err)
	}

	u0 := jobs[0].(*gmaps.GmapJob).URL
	if !strings.Contains(u0, "/@40.4329,-3.6968,15z") || strings.Contains(u0, "%23%40") || !strings.Contains(u0, "28010") {
		t.Errorf("URL con coordenadas = %s", u0)
	}

	if u1 := jobs[1].(*gmaps.GmapJob).URL; strings.Contains(u1, "/@") {
		t.Errorf("sin coordenadas no debe centrar el mapa: %s", u1)
	}

	for _, mal := range []string{"x #@95,0,15", "x #@40,-3,0", "x #@40,200,12"} {
		if _, err := runner.CreateSeedJobs(false, "es", strings.NewReader(mal), 1, false, "", 0, 0, nil, nil, false); err == nil {
			t.Errorf("%q: quiero error por coordenadas o zoom fuera de rango", mal)
		}
	}
}
