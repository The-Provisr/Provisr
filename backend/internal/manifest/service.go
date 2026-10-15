package manifest

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/provisr/backend/pkg/health"
	"github.com/provisr/backend/pkg/middleware"
)

const maxBody = 1 << 20

// server exposes the manifest schema validator (BE-D01) and the versioned
// manifest store (BE-D02) over HTTP so MCP tools (MCP-012/MCP-013) and
// orchestration can call them. BE-D01/BE-D02 shipped as an internal package
// with no service surface; this is the equivalent of BE-M02 for the policy
// engine.
type server struct {
	store Store
	log   zerolog.Logger
	// readyCheck, when set, gates the readiness probe on backing services.
	// Nil for the in-memory store used by tests.
	readyCheck func(context.Context) error
}

// New wires the routes and middleware backed by a PostgreSQL manifest store.
func New(db *sql.DB, log zerolog.Logger) http.Handler {
	s := &server{
		store:      NewStore(db),
		log:        log,
		readyCheck: func(ctx context.Context) error { return db.PingContext(ctx) },
	}
	return s.handler()
}

// NewWithStore wires the routes with an explicit Store implementation. Pass a
// MemoryStore in tests to avoid a database dependency.
func NewWithStore(log zerolog.Logger, store Store) http.Handler {
	return (&server{store: store, log: log}).handler()
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	// More specific than "/health/", so it wins: readiness reflects the store.
	mux.HandleFunc("GET /health/ready", s.handleReady)

	mux.HandleFunc("POST /v1/manifests/validate", s.handleValidate)
	mux.HandleFunc("POST /v1/runs/{run_id}/manifests", s.handleStoreVersion)
	mux.HandleFunc("GET /v1/runs/{run_id}/manifests", s.handleListVersions)
	mux.HandleFunc("GET /v1/runs/{run_id}/manifests/latest", s.handleGetLatest)
	mux.HandleFunc("GET /v1/runs/{run_id}/manifests/{version}", s.handleGetVersion)

	// RequestLogger wraps Recover so panic handling runs inside the
	// request-scoped logger and panic logs carry request_id/correlation_id.
	return middleware.RequestLogger(s.log, middleware.Recover(s.log, mux))
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

type storeManifestRequest struct {
	Content        json.RawMessage `json:"content"`
	SourceMetadata map[string]any  `json:"source_metadata,omitempty"`
}

// validateResponse is the wire shape MCP-013 expects: `errors` is always
// present, empty when the manifest is valid.
type validateResponse struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors"`
}

// --- Handlers ---

func (s *server) handleReady(w http.ResponseWriter, r *http.Request) {
	if s.readyCheck == nil {
		s.writeJSON(r.Context(), w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.readyCheck(ctx); err != nil {
		zerolog.Ctx(r.Context()).Warn().Err(err).Msg("readiness check failed")
		s.writeJSON(r.Context(), w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	s.writeJSON(r.Context(), w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleValidate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)

	var m Manifest
	if !s.decodeSingleJSON(w, r, &m) {
		return
	}

	result, err := NewValidator().Validate(&m)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to validate manifest")
		s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "failed to validate manifest")
		return
	}

	// A validation failure is a successful evaluation, not a transport error:
	// callers read Valid/Errors to decide what to do.
	validationErrors := result.Errors
	if validationErrors == nil {
		validationErrors = []ValidationError{}
	}
	s.writeJSON(r.Context(), w, http.StatusOK, validateResponse{Valid: result.Valid, Errors: validationErrors})
}

func (s *server) handleStoreVersion(w http.ResponseWriter, r *http.Request) {
	runID, ok := s.requireRunID(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req storeManifestRequest
	if !s.decodeSingleJSON(w, r, &req) {
		return
	}
	if len(req.Content) == 0 {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "content is required")
		return
	}

	var record *ManifestRecord
	key := r.Header.Get("Idempotency-Key")
	if key != "" {
		idempotent, ok := s.store.(IdempotentStore)
		if !ok {
			s.writeError(r.Context(), w, http.StatusInternalServerError, "internal_error", "idempotent manifest storage unavailable")
			return
		}
		record, err = idempotent.StoreManifestVersionWithKey(r.Context(), runID, key, req.Content, req.SourceMetadata)
	} else {
		record, err = s.store.StoreManifestVersion(r.Context(), runID, req.Content, req.SourceMetadata)
	}
	if err != nil {
		if errors.Is(err, ErrIdempotencyConflict) {
			s.writeError(r.Context(), w, http.StatusConflict, "idempotency_conflict", "idempotency key was already used for different manifest content")
			return
		}
		s.writeStoreError(r.Context(), w, err)
		return
	}
	statusCode := http.StatusCreated
	if key != "" {
		statusCode = http.StatusOK
	}
	s.writeJSON(r.Context(), w, statusCode, record)
}

func (s *server) handleListVersions(w http.ResponseWriter, r *http.Request) {
	runID, ok := s.requireRunID(w, r)
	if !ok {
		return
	}

	metas, err := s.store.ListManifestVersions(r.Context(), runID)
	if err != nil {
		s.writeStoreError(r.Context(), w, err)
		return
	}
	if metas == nil {
		metas = []ManifestRecordMeta{}
	}
	s.writeJSON(r.Context(), w, http.StatusOK, metas)
}

func (s *server) handleGetLatest(w http.ResponseWriter, r *http.Request) {
	runID, ok := s.requireRunID(w, r)
	if !ok {
		return
	}

	record, err := s.store.GetLatestManifestVersion(r.Context(), runID)
	if err != nil {
		s.writeStoreError(r.Context(), w, err)
		return
	}
	s.writeJSON(r.Context(), w, http.StatusOK, record)
}

func (s *server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	runID, ok := s.requireRunID(w, r)
	if !ok {
		return
	}

	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil || version < 1 {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "version must be a positive integer")
		return
	}

	record, err := s.store.GetManifestVersion(r.Context(), runID, version)
	if err != nil {
		s.writeStoreError(r.Context(), w, err)
		return
	}
	s.writeJSON(r.Context(), w, http.StatusOK, record)
}

// --- Helpers ---

// decodeSingleJSON decodes exactly one JSON value into dst and rejects trailing
// data (e.g. a second object or junk after the value). It writes a 400 response
// and returns false on failure.
func (s *server) decodeSingleJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "request body must contain a single JSON value")
		return false
	}
	return true
}

func (s *server) requireRunID(w http.ResponseWriter, r *http.Request) (string, bool) {
	runID := r.PathValue("run_id")
	if _, err := uuid.Parse(runID); err != nil {
		s.writeError(r.Context(), w, http.StatusBadRequest, "validation_error", "run_id must be a valid UUID")
		return "", false
	}
	return runID, true
}

func (s *server) writeStoreError(ctx context.Context, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrManifestNotFound):
		s.writeError(ctx, w, http.StatusNotFound, "not_found", "manifest version not found")
	case errors.Is(err, ErrEmptyContent):
		s.writeError(ctx, w, http.StatusBadRequest, "validation_error", "manifest content must not be empty")
	case errors.Is(err, ErrInvalidRunID):
		s.writeError(ctx, w, http.StatusBadRequest, "validation_error", "run_id must be a valid UUID")
	default:
		zerolog.Ctx(ctx).Error().Err(err).Msg("manifest store operation failed")
		s.writeError(ctx, w, http.StatusInternalServerError, "internal_error", "manifest store operation failed")
	}
}

func (s *server) writeJSON(ctx context.Context, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		zerolog.Ctx(ctx).Error().Err(err).Msg("failed to encode response")
	}
}

func (s *server) writeError(ctx context.Context, w http.ResponseWriter, status int, code, message string) {
	s.writeJSON(ctx, w, status, errorResponse{Error: code, Message: message, Status: status})
}
