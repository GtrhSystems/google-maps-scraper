package web

import (
	"reflect"
	"testing"
)

func TestMetaIDs(t *testing.T) {
	cases := map[string][]string{
		`fbq('init', '4515394182122207');`:                                       {"4515394182122207"},
		`<img src="https://www.facebook.com/tr?id=888111803078776&ev=PageView">`: {"888111803078776"},
		`{\"pixel_id\":\"446411510513069\",\"pixel_type\":\"facebook_pixel\"}`:   {"446411510513069"},
		`{"pixel_id":"123456789012","pixel_type":"facebook_pixel"}`:              {"123456789012"},
		`{"pixel_id":"123456789012","pixel_type":"tiktok_pixel"}`:                {},
		`<a href="https://facebook.com/mipagina">Facebook</a>`:                   {},
	}

	for in, want := range cases {
		if got := metaIDs(in); !reflect.DeepEqual(got, want) {
			t.Errorf("metaIDs(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestValidEmail(t *testing.T) {
	cases := map[string]bool{
		"info@eltallerdelpelo.com":                        true,
		"reservas@nueve.in":                               true,
		"colorfulvirtual-exercise-icon-6-colorful@2x.png": false,
		"logo@3x.jpg":                                     false,
		"8b1c2d@sentry.wixpress.com":                      false,
		"user@example.com":                                false,
		"sin-arroba.com":                                  false,
	}

	for in, want := range cases {
		if got := validEmail(in); got != want {
			t.Errorf("validEmail(%q) = %v, want %v", in, got, want)
		}
	}
}
