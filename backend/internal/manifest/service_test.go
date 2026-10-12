package manifest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

const validManifestJSON = `{
	"schema_version": "1.0.0",
	"provider": "aws",
	"region": "us-east-1",
	"environment": "production",
	"resources": [
		{"logical_name": "assets", "type": "storage.aws.s3_bucket"}
	]
}`

func newTestHandler() http.Handler {
	return NewWithStore(zerolog.Nop(), NewMemoryStore())
}

func doRequest(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHealthRoutes(t *testing.T) {
	handler := newTestHandler()
	for _, path := range []string{"/health/live", "/health/ready"} {
		rec := doRequest(t, handler, http.MethodGet, path, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, rec.Code)
		}
	}
}

func TestValidateAcceptsValidManifest(t *testing.T) {
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/manifests/validate", validManifestJSON)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var result ValidationResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !result.Valid || len(result.Errors) != 0 {
		t.Fatalf("expected valid manifest, got %+v", result)
	}
	// MCP-013 expects `errors` to always be present, even when empty.
	if !strings.Contains(rec.Body.String(), `"errors":[]`) {
		t.Fatalf("expected errors:[] in response, got %s", rec.Body.String())
	}
}

func TestValidateRejectsTrailingJSON(t *testing.T) {
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/manifests/validate", validManifestJSON+" {}\n")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for trailing JSON, got %d", rec.Code)
	}
}

func TestValidateRejectsUnknownDomain(t *testing.T) {
	body := `{
		"schema_version": "1.0.0",
		"provider": "aws",
		"region": "us-east-1",
		"environment": "production",
		"resources": [{"logical_name": "thing", "type": "foobar.aws.widget"}]
	}`
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/manifests/validate", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (validation outcome), got %d", rec.Code)
	}
	var result ValidationResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if result.Valid {
		t.Fatalf("expected invalid manifest for unknown domain")
	}
	if len(result.Errors) == 0 || result.Errors[0].Field == "" || result.Errors[0].Code == "" {
		t.Fatalf("expected field-level errors, got %+v", result.Errors)
	}
}

func TestValidateRejectsInvalidJSON(t *testing.T) {
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/manifests/validate", `{"schema_version":`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestStoreAndRetrieveVersions(t *testing.T) {
	handler := newTestHandler()
	runID := uuid.NewString()
	path := "/v1/runs/" + runID + "/manifests"

	storeBody := `{"content": ` + validManifestJSON + `, "source_metadata": {"source": "user_prompt"}}`

	first := doRequest(t, handler, http.MethodPost, path, storeBody)
	if first.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", first.Code, first.Body.String())
	}
	var v1 ManifestRecord
	if err := json.Unmarshal(first.Body.Bytes(), &v1); err != nil {
		t.Fatalf("failed to decode stored record: %v", err)
	}
	if v1.Version != 1 || v1.RunID != runID || v1.Hash == "" {
		t.Fatalf("unexpected first record: %+v", v1)
	}

	second := doRequest(t, handler, http.MethodPost, path, storeBody)
	if second.Code != http.StatusCreated {
		t.Fatalf("expected 201 on second store, got %d", second.Code)
	}
	var v2 ManifestRecord
	_ = json.Unmarshal(second.Body.Bytes(), &v2)
	if v2.Version != 2 {
		t.Fatalf("expected version 2, got %d", v2.Version)
	}

	latest := doRequest(t, handler, http.MethodGet, path+"/latest", "")
	if latest.Code != http.StatusOK {
		t.Fatalf("expected 200 for latest, got %d", latest.Code)
	}
	var latestRecord ManifestRecord
	_ = json.Unmarshal(latest.Body.Bytes(), &latestRecord)
	if latestRecord.Version != 2 {
		t.Fatalf("expected latest version 2, got %d", latestRecord.Version)
	}

	byVersion := doRequest(t, handler, http.MethodGet, path+"/1", "")
	if byVersion.Code != http.StatusOK {
		t.Fatalf("expected 200 for version 1, got %d", byVersion.Code)
	}

	list := doRequest(t, handler, http.MethodGet, path, "")
	if list.Code != http.StatusOK {
		t.Fatalf("expected 200 for list, got %d", list.Code)
	}
	var metas []ManifestRecordMeta
	if err := json.Unmarshal(list.Body.Bytes(), &metas); err != nil {
		t.Fatalf("failed to decode list: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(metas))
	}
}

func TestStoreRejectsEmptyContent(t *testing.T) {
	runID := uuid.NewString()
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/runs/"+runID+"/manifests", `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestStoreRejectsInvalidRunID(t *testing.T) {
	rec := doRequest(t, newTestHandler(), http.MethodPost, "/v1/runs/not-a-uuid/manifests", `{"content": `+validManifestJSON+`}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestGetMissingVersionReturns404(t *testing.T) {
	runID := uuid.NewString()
	rec := doRequest(t, newTestHandler(), http.MethodGet, "/v1/runs/"+runID+"/manifests/latest", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestGetVersionRejectsNonInteger(t *testing.T) {
	runID := uuid.NewString()
	rec := doRequest(t, newTestHandler(), http.MethodGet, "/v1/runs/"+runID+"/manifests/abc", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}
