// Package terraformplan creates plans from immutable, confirmed Terraform artifacts.
// Only orchestration advances the workflow; this package never applies Terraform.
package terraformplan

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/internal/statebackend"
	"github.com/provisr/backend/pkg/cloudcrypto"
)

type Request struct {
	Context    manifest.Context `json:"context"`
	ArtifactID string           `json:"iac_artifact_id"`
}

type Result struct {
	ID               string  `json:"plan_artifact_id"`
	ArtifactID       string  `json:"iac_artifact_id"`
	ManifestID       string  `json:"manifest_id"`
	ManifestVersion  int     `json:"manifest_version"`
	RunID            string  `json:"run_id"`
	WorkspaceID      string  `json:"workspace_id"`
	SessionID        string  `json:"session_id"`
	Hash             string  `json:"hash"`
	RawPlanReference string  `json:"raw_plan_json_reference"`
	Summary          Summary `json:"summary"`
}

// Failure deliberately excludes Terraform stdout/stderr and cloud credentials.
type Failure struct {
	Status  int    `json:"-"`
	Code    string `json:"error"`
	Message string `json:"message"`
	Stage   string `json:"stage,omitempty"`
}

func (f *Failure) Error() string { return f.Message }
func fail(status int, code, message string) *Failure {
	return &Failure{Status: status, Code: code, Message: message}
}

type Planner interface {
	Create(context.Context, Request) (*Result, error)
}

func New(db *sql.DB, master cloudcrypto.MasterKey, token string) http.Handler {
	return NewHandler(&Service{db: db, master: master, backend: statebackend.NewManager(db, master, nil), runner: CommandRunner{}, credentials: delegatedAWS}, token)
}

func NewHandler(planner Planner, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/iac/plans", func(w http.ResponseWriter, r *http.Request) {
		write := func(status int, body any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
		}
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			write(401, fail(401, "unauthorized", "Service authorization required"))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var input Request
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || !validRequest(&input) {
			write(400, fail(400, "invalid_request", "Stored IaC artifact ID and complete idempotent context required"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
		defer cancel()
		result, err := planner.Create(ctx, input)
		if err != nil {
			var f *Failure
			if !errors.As(err, &f) {
				f = fail(503, "plan_unavailable", "Terraform planning unavailable")
			}
			write(f.Status, f)
			return
		}
		write(200, result)
	})
	return mux
}

func validRequest(r *Request) bool {
	c := &r.Context
	for _, id := range []*string{&r.ArtifactID, &c.WorkspaceID, &c.UserID, &c.RequestID, &c.SessionID, &c.CorrelationID} {
		parsed, err := uuid.Parse(*id)
		if err != nil || parsed == uuid.Nil {
			return false
		}
		*id = parsed.String()
	}
	if strings.TrimSpace(c.IdempotencyKey) == "" || len(c.IdempotencyKey) > 255 {
		return false
	}
	for _, p := range c.Permissions {
		if p == "iac:write" {
			return true
		}
	}
	return false
}
