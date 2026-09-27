package middleware

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

func reqLogBuffer() (zerolog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	return zerolog.New(&buf), &buf
}

func TestRequestLoggerPropagatesIDs(t *testing.T) {
	log, _ := reqLogBuffer()
	gotRequestID := ""
	gotCorrelationID := ""
	h := RequestLogger(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRequestID = RequestID(r.Context())
		gotCorrelationID = CorrelationID(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	rid := uuid.NewString()
	cid := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/v1/things", nil)
	req.Header.Set("X-Request-ID", rid)
	req.Header.Set("X-Correlation-ID", cid)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if gotRequestID != rid {
		t.Fatalf("request id = %q, want %q", gotRequestID, rid)
	}
	if gotCorrelationID != cid {
		t.Fatalf("correlation id = %q, want %q", gotCorrelationID, cid)
	}
}

func TestRequestLoggerGeneratesMissingIDs(t *testing.T) {
	log, _ := reqLogBuffer()
	h := RequestLogger(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := RequestID(r.Context())
		if _, err := uuid.Parse(rid); err != nil {
			t.Errorf("generated request id %q is not a UUID", rid)
		}
		cid := CorrelationID(r.Context())
		if _, err := uuid.Parse(cid); err != nil {
			t.Errorf("generated correlation id %q is not a UUID", cid)
		}
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestRequestLoggerFallsBackCorrelationToRequestID(t *testing.T) {
	log, _ := reqLogBuffer()
	h := RequestLogger(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := CorrelationID(r.Context()); got != RequestID(r.Context()) {
			t.Fatalf("correlation id = %q, want request id %q", got, RequestID(r.Context()))
		}
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Correlation-ID", "not-a-uuid")
	h.ServeHTTP(httptest.NewRecorder(), req)
}

func TestRequestLoggerLogsCompletion(t *testing.T) {
	log, buf := reqLogBuffer()
	h := RequestLogger(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/things", nil))

	out := buf.String()
	for _, want := range []string{`"method":"POST"`, `"path":"/v1/things"`, `"status":418`, "request completed"} {
		if !strings.Contains(out, want) {
			t.Fatalf("completion log missing %s; got: %s", want, out)
		}
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(out), &entry); err != nil {
		t.Fatalf("completion log is not valid JSON: %v", err)
	}
	if entry["request_id"] == "" || entry["correlation_id"] == "" {
		t.Fatalf("completion log missing ids: %s", out)
	}
}

func TestRecoverWritesErrorShape(t *testing.T) {
	log, _ := reqLogBuffer()
	h := Recover(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body["error"] != "internal_error" || body["status"] != float64(500) {
		t.Fatalf("unexpected error shape: %v", body)
	}
}

func TestRecoverLogsPanic(t *testing.T) {
	log, buf := reqLogBuffer()
	recoverer := Recover(log, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))
	h := RequestLogger(log, recoverer)
	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	req.Header.Set("X-Request-ID", uuid.NewString())
	h.ServeHTTP(httptest.NewRecorder(), req)

	out := buf.String()
	if !strings.Contains(out, "panic recovered") || !strings.Contains(out, `"path":"/boom"`) {
		t.Fatalf("panic log missing details; got: %s", out)
	}
}