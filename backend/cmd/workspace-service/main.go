package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

type workspace struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Environment string  `json:"environment"`
	Description *string `json:"description,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type member struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	JoinedAt string `json:"joined_at"`
}

type createRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Environment string  `json:"environment"`
	CreatorID   string  `json:"creator_id"`
}

type updateRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Environment *string `json:"environment,omitempty"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8088"
	}

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		dbDSN = "postgres://localhost:5432/provisr?sslmode=disable"
	}

	logger := zerolog.New(os.Stdout).With().Timestamp().Str("service", "workspace-service").Logger()

	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open database connection")
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		logger.Fatal().Err(err).Msg("failed to ping database")
	}

	s := &server{db: db, log: logger}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	mux.HandleFunc("POST /workspaces", s.handleCreate)
	mux.HandleFunc("GET /workspaces", s.handleList)
	mux.HandleFunc("GET /workspaces/{id}", s.handleGet)
	mux.HandleFunc("PATCH /workspaces/{id}", s.handleUpdate)
	mux.HandleFunc("DELETE /workspaces/{id}", s.handleDelete)

	logger.Info().Str("port", port).Msg("workspace-service starting")
	log.Fatal(http.ListenAndServe(":"+port, recoveryMiddleware(logger, mux)))
}

type server struct {
	db  *sql.DB
	log zerolog.Logger
}

func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if len(req.Name) < 3 || len(req.Name) > 64 {
		writeError(w, http.StatusBadRequest, "validation_error", "name must be between 3 and 64 characters")
		return
	}
	if req.Environment != "dev" && req.Environment != "staging" && req.Environment != "prod" {
		writeError(w, http.StatusBadRequest, "validation_error", "environment must be dev, staging, or prod")
		return
	}
	if req.CreatorID == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "creator_id is required")
		return
	}

	slug := generateSlug(req.Name)

	tx, err := s.db.Begin()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to begin transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create workspace")
		return
	}
	defer tx.Rollback()

	var exists bool
	err = tx.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM provisr_identity.workspaces WHERE slug = $1 AND deleted_at IS NULL)",
		slug,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check slug uniqueness")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create workspace")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "slug_taken", fmt.Sprintf("slug %q is already taken", slug))
		return
	}

	var ws workspace
	err = tx.QueryRow(
		`INSERT INTO provisr_identity.workspaces (name, slug, environment, settings)
		 VALUES ($1, $2, $3, '{}')
		 RETURNING id, name, slug, environment, created_at, updated_at`,
		req.Name, slug, req.Environment,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.CreatedAt, &ws.UpdatedAt)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to insert workspace")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create workspace")
		return
	}

	_, err = tx.Exec(
		`INSERT INTO provisr_identity.memberships (user_id, workspace_id, role, invited_by)
		 VALUES ($1, $2, 'admin', $1)`,
		req.CreatorID, ws.ID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create owner membership")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create workspace")
		return
	}

	if err := tx.Commit(); err != nil {
		s.log.Error().Err(err).Msg("failed to commit transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create workspace")
		return
	}

	writeJSON(w, http.StatusCreated, ws)
}

func (s *server) handleList(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "user_id query parameter is required")
		return
	}

	rows, err := s.db.Query(
		`SELECT w.id, w.name, w.slug, w.environment, w.created_at, w.updated_at, m.role, m.joined_at
		 FROM provisr_identity.workspaces w
		 JOIN provisr_identity.memberships m ON m.workspace_id = w.id
		 WHERE m.user_id = $1 AND w.deleted_at IS NULL
		 ORDER BY w.created_at DESC`,
		userID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to list workspaces")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list workspaces")
		return
	}
	defer rows.Close()

	type workspaceWithRole struct {
		workspace
		Role     string `json:"role"`
		JoinedAt string `json:"joined_at"`
	}

	var workspaces []workspaceWithRole
	for rows.Next() {
		var ws workspaceWithRole
		if err := rows.Scan(
			&ws.ID, &ws.Name, &ws.Slug, &ws.Environment,
			&ws.CreatedAt, &ws.UpdatedAt, &ws.Role, &ws.JoinedAt,
		); err != nil {
			s.log.Error().Err(err).Msg("failed to scan workspace row")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to list workspaces")
			return
		}
		workspaces = append(workspaces, ws)
	}

	if workspaces == nil {
		workspaces = []workspaceWithRole{}
	}

	writeJSON(w, http.StatusOK, workspaces)
}

func (s *server) handleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	userID := r.URL.Query().Get("user_id")

	var ws workspace
	err := s.db.QueryRow(
		`SELECT id, name, slug, environment, created_at, updated_at
		 FROM provisr_identity.workspaces
		 WHERE id = $1 AND deleted_at IS NULL`,
		id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.CreatedAt, &ws.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to get workspace")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get workspace")
		return
	}

	if userID != "" {
		var role string
		err = s.db.QueryRow(
			`SELECT role FROM provisr_identity.memberships WHERE user_id = $1 AND workspace_id = $2`,
			userID, id,
		).Scan(&role)
		if err == sql.ErrNoRows {
			writeError(w, http.StatusForbidden, "not_member", "user is not a member of this workspace")
			return
		}
		if err != nil {
			s.log.Error().Err(err).Msg("failed to check membership")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to get workspace")
			return
		}
	}

	mrows, err := s.db.Query(
		`SELECT u.id, u.name, u.email, m.role, m.joined_at
		 FROM provisr_identity.memberships m
		 JOIN provisr_identity.users u ON u.id = m.user_id
		 WHERE m.workspace_id = $1
		 ORDER BY m.joined_at ASC`,
		id,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to query members")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get workspace")
		return
	}
	defer mrows.Close()

	var members []member
	for mrows.Next() {
		var m member
		if err := mrows.Scan(&m.ID, &m.Name, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			s.log.Error().Err(err).Msg("failed to scan member row")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to get workspace")
			return
		}
		members = append(members, m)
	}
	if members == nil {
		members = []member{}
	}

	type workspaceDetail struct {
		workspace
		Members []member `json:"members"`
	}

	writeJSON(w, http.StatusOK, workspaceDetail{workspace: ws, Members: members})
}

func (s *server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	var ws workspace
	err := s.db.QueryRow(
		`SELECT id, name, slug, environment, created_at, updated_at
		 FROM provisr_identity.workspaces
		 WHERE id = $1 AND deleted_at IS NULL`,
		id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.CreatedAt, &ws.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to get workspace for update")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update workspace")
		return
	}

	if req.Name != nil {
		if len(*req.Name) < 3 || len(*req.Name) > 64 {
			writeError(w, http.StatusBadRequest, "validation_error", "name must be between 3 and 64 characters")
			return
		}
		ws.Name = *req.Name
		newSlug := generateSlug(*req.Name)
		if newSlug != ws.Slug {
			var exists bool
			err := s.db.QueryRow(
				"SELECT EXISTS(SELECT 1 FROM provisr_identity.workspaces WHERE slug = $1 AND id != $2 AND deleted_at IS NULL)",
				newSlug, id,
			).Scan(&exists)
			if err != nil {
				s.log.Error().Err(err).Msg("failed to check slug uniqueness")
				writeError(w, http.StatusInternalServerError, "internal_error", "failed to update workspace")
				return
			}
			if exists {
				writeError(w, http.StatusConflict, "slug_taken", fmt.Sprintf("slug %q is already taken", newSlug))
				return
			}
			ws.Slug = newSlug
		}
	}
	if req.Environment != nil {
		if *req.Environment != "dev" && *req.Environment != "staging" && *req.Environment != "prod" {
			writeError(w, http.StatusBadRequest, "validation_error", "environment must be dev, staging, or prod")
			return
		}
		ws.Environment = *req.Environment
	}

	err = s.db.QueryRow(
		`UPDATE provisr_identity.workspaces
		 SET name = $1, slug = $2, environment = $3, updated_at = now()
		 WHERE id = $4 AND deleted_at IS NULL
		 RETURNING id, name, slug, environment, created_at, updated_at`,
		ws.Name, ws.Slug, ws.Environment, id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.CreatedAt, &ws.UpdatedAt)
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to update workspace")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update workspace")
		return
	}

	writeJSON(w, http.StatusOK, ws)
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var exists bool
	err := s.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM provisr_identity.workspaces WHERE id = $1 AND deleted_at IS NULL)`,
		id,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to check workspace existence")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete workspace")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}

	err = s.db.QueryRow(
		`SELECT EXISTS(
			SELECT 1 FROM provisr_state.provisioning_runs
			WHERE workspace_id = $1 AND state NOT IN ('completed', 'failed', 'cancelled')
			LIMIT 1
		)`,
		id,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to check active runs")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete workspace")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "active_runs_exist", "cannot delete workspace with active provisioning runs")
		return
	}

	_, err = s.db.Exec(
		`UPDATE provisr_identity.workspaces SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
		id,
	)
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to soft-delete workspace")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to delete workspace")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

var slugPattern = regexp.MustCompile(`[^a-z0-9-]`)

func generateSlug(name string) string {
	s := strings.ToLower(name)
	s = strings.ReplaceAll(s, " ", "-")
	s = slugPattern.ReplaceAllString(s, "")
	if len(s) > 64 {
		s = s[:64]
	}
	s = strings.Trim(s, "-")
	if s == "" {
		s = "workspace"
	}
	suffix := uuid.New().String()[:8]
	return fmt.Sprintf("%s-%s", s, suffix)
}

func recoveryMiddleware(log zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				writeError(w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{Error: code, Message: message, Status: status})
}
