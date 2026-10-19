// Package iacartifact persists template-derived Terraform. It never executes IaC.
package iacartifact

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/internal/terraform"
)

type Request struct {
	Context    manifest.Context `json:"context"`
	ManifestID string           `json:"manifest_id"`
}

type Summary struct {
	ResourceCount int `json:"resource_count"`
	FileCount     int `json:"file_count"`
}

// Artifact stores individual files together so persistence and audit are atomic.
type Artifact struct {
	ID              string           `json:"iac_artifact_id"`
	ManifestID      string           `json:"manifest_id"`
	ManifestVersion int              `json:"manifest_version"`
	RunID           string           `json:"run_id"`
	WorkspaceID     string           `json:"workspace_id"`
	SessionID       string           `json:"session_id"`
	Files           []terraform.File `json:"terraform_files"`
	FileList        []string         `json:"file_list"`
	FileCount       int              `json:"file_count"`
	TotalSize       int              `json:"total_size"`
	Hash            string           `json:"hash"`
	TemplateSource  string           `json:"template_source"`
	Summary         Summary          `json:"summary"`
}

type Failure struct {
	Status      int                     `json:"-"`
	Code        string                  `json:"error"`
	Message     string                  `json:"message"`
	Unsupported []terraform.Unsupported `json:"unsupported,omitempty"`
}

func (e *Failure) Error() string { return e.Message }

type Generator interface {
	Generate(context.Context, Request) (*Artifact, error)
}

// New mounts only the private artifact route; missing service token fails closed.
func New(db *sql.DB, token string) http.Handler { return NewHandler(&DBGenerator{db: db}, token) }

func NewHandler(generator Generator, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/iac/generate", func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			write(w, 401, &Failure{Code: "unauthorized", Message: "Service authorization required"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var input Request
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || !validRequest(input) {
			write(w, 400, &Failure{Code: "invalid_request", Message: "Valid manifest ID and complete idempotent context required"})
			return
		}
		artifact, err := generator.Generate(r.Context(), input)
		if err != nil {
			var failure *Failure
			if errors.As(err, &failure) {
				write(w, failure.Status, failure)
			} else {
				write(w, 503, &Failure{Code: "unavailable", Message: "Terraform artifact generation unavailable"})
			}
			return
		}
		write(w, 200, artifact)
	})
	return mux
}

func validRequest(r Request) bool {
	c := r.Context
	for _, id := range []string{r.ManifestID, c.WorkspaceID, c.UserID, c.RequestID, c.SessionID, c.CorrelationID} {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed == uuid.Nil {
			return false
		}
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

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
