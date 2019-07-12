package server_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	gocmp "github.com/google/go-cmp/cmp"
	cmp "github.com/snetsystems/cmp/backend"
	"github.com/snetsystems/cmp/backend/mocks"
	"github.com/snetsystems/cmp/backend/server"
)

func Test_Layouts(t *testing.T) {
	layoutTests := []struct {
		name       string
		expected   cmp.Layout
		allLayouts []cmp.Layout
		focusedApp string // should filter all layouts to this app only
		shouldErr  bool
	}{
		{
			"empty layout",
			cmp.Layout{},
			[]cmp.Layout{},
			"",
			false,
		},
		{
			"several layouts",
			cmp.Layout{
				ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
				Application: "influxdb",
				Measurement: "influxdb",
			},
			[]cmp.Layout{
				cmp.Layout{
					ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
					Application: "influxdb",
					Measurement: "influxdb",
				},
			},
			"",
			false,
		},
		{
			"filtered app",
			cmp.Layout{
				ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
				Application: "influxdb",
				Measurement: "influxdb",
			},
			[]cmp.Layout{
				cmp.Layout{
					ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
					Application: "influxdb",
					Measurement: "influxdb",
				},
				cmp.Layout{
					ID:          "b020101b-ea6b-4c8c-9f0e-db0ba501f4ef",
					Application: "cmp",
					Measurement: "cmp",
				},
			},
			"influxdb",
			false,
		},
		{
			"axis zero values",
			cmp.Layout{
				ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
				Application: "influxdb",
				Measurement: "influxdb",
				Cells: []cmp.Cell{
					{
						X:          0,
						Y:          0,
						W:          4,
						H:          4,
						I:          "3b0e646b-2ca3-4df2-95a5-fd80915459dd",
						Name:       "A Graph",
						CellColors: []cmp.CellColor{},
						Axes: map[string]cmp.Axis{
							"x": cmp.Axis{
								Bounds: []string{},
							},
							"y": cmp.Axis{
								Bounds: []string{},
							},
							"y2": cmp.Axis{
								Bounds: []string{},
							},
						},
					},
				},
			},
			[]cmp.Layout{
				cmp.Layout{
					ID:          "d20a21c8-69f1-4780-90fe-e69f5e4d138c",
					Application: "influxdb",
					Measurement: "influxdb",
					Cells: []cmp.Cell{
						{
							X:          0,
							Y:          0,
							W:          4,
							H:          4,
							I:          "3b0e646b-2ca3-4df2-95a5-fd80915459dd",
							CellColors: []cmp.CellColor{},
							Name:       "A Graph",
						},
					},
				},
			},
			"",
			false,
		},
	}

	for _, test := range layoutTests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			// setup mock cmp.Service and mock logger
			lg := &mocks.TestLogger{}
			svc := server.Service{
				Store: &mocks.Store{LayoutsStore: &mocks.LayoutsStore{
					AllF: func(ctx context.Context) ([]cmp.Layout, error) {
						if len(test.allLayouts) == 0 {
							return []cmp.Layout{
								test.expected,
							}, nil
						} else {
							return test.allLayouts, nil
						}
					},
				},
				},
				Logger: lg,
			}

			// setup mock request and response
			rr := httptest.NewRecorder()
			reqURL := url.URL{
				Path: "/cmp/v1/layouts",
			}
			params := reqURL.Query()

			// add query params required by test
			if test.focusedApp != "" {
				params.Add("app", test.focusedApp)
			}

			// re-inject query params
			reqURL.RawQuery = params.Encode()

			req := httptest.NewRequest("GET", reqURL.RequestURI(), strings.NewReader(""))

			// invoke handler for layouts endpoint
			svc.Layouts(rr, req)

			// create a throwaway frame to unwrap Layouts
			respFrame := struct {
				Layouts []struct {
					cmp.Layout
					Link interface{} `json:"-"`
				} `json:"layouts"`
			}{}

			// decode resp into respFrame
			resp := rr.Result()
			if err := json.NewDecoder(resp.Body).Decode(&respFrame); err != nil {
				t.Fatalf("%q - Error unmarshaling JSON: err: %s", test.name, err.Error())
			}

			// compare actual and expected
			if !gocmp.Equal(test.expected, respFrame.Layouts[0].Layout) {
				t.Fatalf("%q - Expected layouts to be equal: diff:\n\t%s", test.name, gocmp.Diff(test.expected, respFrame.Layouts[0].Layout))
			}
		})
	}
}