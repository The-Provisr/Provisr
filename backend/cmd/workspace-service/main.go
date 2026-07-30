package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

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

type invitationResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Email       string  `json:"email"`
	Role        string  `json:"role"`
	Code        string  `json:"code"`
	ExpiresAt   string  `json:"expires_at"`
	CreatedAt   string  `json:"created_at"`
	RevokedAt   *string `json:"revoked_at,omitempty"`
}

type addMemberRequest struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

type updateRoleRequest struct {
	Role string `json:"role"`
}

type inviteRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type acceptInviteRequest struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
}

type checkPermissionRequest struct {
	UserID       string `json:"user_id"`
	WorkspaceID  string `json:"workspace_id"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id,omitempty"`
}

type checkPermissionResponse struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"`
}

type checkBatchRequest struct {
	Checks []checkPermissionRequest `json:"checks"`
}

type checkBatchResponse struct {
	Results []checkPermissionResponse `json:"results"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

var validRoles = map[string]bool{
	"admin":    true,
	"engineer": true,
	"approver": true,
	"auditor":  true,
	"viewer":   true,
}

var terminalRunStates = []interface{}{"completed", "failed", "cancelled"}

var rolePermissions = map[string]map[string]bool{
	"engineer": {
		"cloud_account.create":      true,
		"cloud_account.view":        true,
		"cloud_account.update":      true,
		"cloud_account.delete":      true,
		"chat_session.create":       true,
		"chat_session.view":         true,
		"chat_session.update":       true,
		"chat_session.delete":       true,
		"provisioning_run.create":   true,
		"provisioning_run.view":     true,
		"manifest.view":             true,
		"artifact.view":             true,
	},
	"approver": {
		"approval_ticket.decide":    true,
		"provisioning_run.view":     true,
	},
	"auditor": {
		"audit_event.view":          true,
		"provisioning_run.view":     true,
		"manifest.view":             true,
		"artifact.view":             true,
	},
	"viewer": {
		"chat_session.view":         true,
		"provisioning_run.view":     true,
	},
}

func isActionAllowed(role, resourceType, action string) bool {
	if role == "admin" {
		return true
	}
	perms, ok := rolePermissions[role]
	if !ok {
		return false
	}
	return perms[resourceType+"."+action]
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

	mux.HandleFunc("POST /workspaces/{workspace_id}/members", s.handleAddMember)
	mux.HandleFunc("GET /workspaces/{workspace_id}/members", s.handleListMembers)
	mux.HandleFunc("PATCH /workspaces/{workspace_id}/members/{user_id}", s.handleUpdateRole)
	mux.HandleFunc("DELETE /workspaces/{workspace_id}/members/{user_id}", s.handleRemoveMember)

	mux.HandleFunc("POST /workspaces/{workspace_id}/invitations", s.handleCreateInvitation)
	mux.HandleFunc("GET /workspaces/{workspace_id}/invitations", s.handleListInvitations)
	mux.HandleFunc("GET /workspaces/{workspace_id}/invitations/{invitation_id}", s.handleGetInvitation)
	mux.HandleFunc("POST /workspaces/{workspace_id}/invitations/{invitation_id}/revoke", s.handleRevokeInvitation)
	mux.HandleFunc("GET /invitations", s.handleGetInvitationByCode)
	mux.HandleFunc("POST /invitations/accept", s.handleAcceptInvitation)

	mux.HandleFunc("POST /permissions/check", s.handleCheckPermission)
	mux.HandleFunc("POST /permissions/check-batch", s.handleCheckBatch)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      recoveryMiddleware(logger, mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("workspace-service starting")
	log.Fatal(srv.ListenAndServe())
}

type server struct {
	db  *sql.DB
	log zerolog.Logger
}

func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
		`INSERT INTO provisr_identity.workspaces (name, slug, environment, description, settings)
		 VALUES ($1, $2, $3, $4, '{}')
		 RETURNING id, name, slug, environment, description, created_at, updated_at`,
		req.Name, slug, req.Environment, req.Description,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt)
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
		`SELECT w.id, w.name, w.slug, w.environment, w.description, w.created_at, w.updated_at, m.role, m.joined_at
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
			&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.Description,
			&ws.CreatedAt, &ws.UpdatedAt, &ws.Role, &ws.JoinedAt,
		); err != nil {
			s.log.Error().Err(err).Msg("failed to scan workspace row")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to list workspaces")
			return
		}
		workspaces = append(workspaces, ws)
	}
	if err := rows.Err(); err != nil {
		s.log.Error().Err(err).Msg("failed to iterate workspace rows")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list workspaces")
		return
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
		`SELECT id, name, slug, environment, description, created_at, updated_at
		 FROM provisr_identity.workspaces
		 WHERE id = $1 AND deleted_at IS NULL`,
		id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Str("workspace_id", id).Msg("failed to get workspace")
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
	if err := mrows.Err(); err != nil {
		s.log.Error().Err(err).Msg("failed to iterate member rows")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get workspace")
		return
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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	var ws workspace
	err := s.db.QueryRow(
		`SELECT id, name, slug, environment, description, created_at, updated_at
		 FROM provisr_identity.workspaces
		 WHERE id = $1 AND deleted_at IS NULL`,
		id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt)
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
	if req.Description != nil {
		ws.Description = req.Description
	}

	err = s.db.QueryRow(
		`UPDATE provisr_identity.workspaces
		 SET name = $1, slug = $2, environment = $3, description = $4, updated_at = now()
		 WHERE id = $5 AND deleted_at IS NULL
		 RETURNING id, name, slug, environment, description, created_at, updated_at`,
		ws.Name, ws.Slug, ws.Environment, ws.Description, id,
	).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Environment, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt)
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

func (s *server) handleAddMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")

	var req addMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "user_id is required")
		return
	}
	if !validRoles[req.Role] {
		writeError(w, http.StatusBadRequest, "validation_error", "role must be admin, engineer, approver, auditor, or viewer")
		return
	}

	var exists bool
	err := s.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM provisr_identity.workspaces WHERE id = $1 AND deleted_at IS NULL)",
		workspaceID,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check workspace existence")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to add member")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}

	var userExists bool
	err = s.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM provisr_identity.users WHERE id = $1)",
		req.UserID,
	).Scan(&userExists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check user existence")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to add member")
		return
	}
	if !userExists {
		writeError(w, http.StatusNotFound, "user_not_found", "user does not exist")
		return
	}

	var mr member
	err = s.db.QueryRow(
		`WITH ins AS (
			INSERT INTO provisr_identity.memberships (user_id, workspace_id, role, invited_by)
			VALUES ($1, $2, $3, NULL)
			ON CONFLICT (user_id, workspace_id) DO NOTHING
			RETURNING user_id, workspace_id, role, joined_at
		)
		SELECT u.id, u.name, u.email, ins.role, ins.joined_at
		FROM ins
		JOIN provisr_identity.users u ON u.id = ins.user_id`,
		req.UserID, workspaceID, req.Role,
	).Scan(&mr.ID, &mr.Name, &mr.Email, &mr.Role, &mr.JoinedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusConflict, "already_member", "user is already a member of this workspace")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to add member")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to add member")
		return
	}

	writeJSON(w, http.StatusCreated, mr)
}

func (s *server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	roleFilter := r.URL.Query().Get("role")

	if roleFilter != "" && !validRoles[roleFilter] {
		writeError(w, http.StatusBadRequest, "validation_error", "invalid role filter")
		return
	}

	var rows *sql.Rows
	var err error
	if roleFilter != "" {
		rows, err = s.db.Query(
			`SELECT u.id, u.name, u.email, m.role, m.joined_at
			 FROM provisr_identity.memberships m
			 JOIN provisr_identity.users u ON u.id = m.user_id
			 WHERE m.workspace_id = $1 AND m.role = $2
			 ORDER BY m.joined_at ASC`,
			workspaceID, roleFilter,
		)
	} else {
		rows, err = s.db.Query(
			`SELECT u.id, u.name, u.email, m.role, m.joined_at
			 FROM provisr_identity.memberships m
			 JOIN provisr_identity.users u ON u.id = m.user_id
			 WHERE m.workspace_id = $1
			 ORDER BY m.joined_at ASC`,
			workspaceID,
		)
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to list members")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list members")
		return
	}
	defer rows.Close()

	var members []member
	for rows.Next() {
		var m member
		if err := rows.Scan(&m.ID, &m.Name, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			s.log.Error().Err(err).Msg("failed to scan member row")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to list members")
			return
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		s.log.Error().Err(err).Msg("failed to iterate member rows")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list members")
		return
	}

	if members == nil {
		members = []member{}
	}

	writeJSON(w, http.StatusOK, members)
}

func (s *server) handleUpdateRole(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	userID := r.PathValue("user_id")

	var req updateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if !validRoles[req.Role] {
		writeError(w, http.StatusBadRequest, "validation_error", "role must be admin, engineer, approver, auditor, or viewer")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to begin transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update role")
		return
	}
	defer tx.Rollback()

	if err := s.requireLastAdminNotTarget(tx, workspaceID, userID); err != nil {
		if err == errLastAdmin {
			writeError(w, http.StatusConflict, "last_admin", "cannot change role of the last admin")
			return
		}
		s.log.Error().Err(err).Msg("failed to check last admin")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update role")
		return
	}

	result, err := tx.Exec(
		`UPDATE provisr_identity.memberships SET role = $1
		 WHERE user_id = $2 AND workspace_id = $3`,
		req.Role, userID, workspaceID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to update role")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update role")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "not_found", "membership not found")
		return
	}

	if err := tx.Commit(); err != nil {
		s.log.Error().Err(err).Msg("failed to commit transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to update role")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	userID := r.PathValue("user_id")

	tx, err := s.db.Begin()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to begin transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}
	defer tx.Rollback()

	var exists bool
	err = tx.QueryRow(
		`SELECT EXISTS(
			SELECT 1 FROM provisr_state.provisioning_runs
			WHERE requester_id = $1 AND workspace_id = $2
			AND state NOT IN ('completed', 'failed', 'cancelled')
		)`,
		userID, workspaceID,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check active runs")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "active_runs_exist", "cannot remove member with active provisioning runs")
		return
	}

	if err := s.requireLastAdminNotTarget(tx, workspaceID, userID); err != nil {
		if err == errLastAdmin {
			writeError(w, http.StatusConflict, "last_admin", "cannot remove the last admin")
			return
		}
		s.log.Error().Err(err).Msg("failed to check last admin")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}

	result, err := tx.Exec(
		`DELETE FROM provisr_identity.memberships WHERE user_id = $1 AND workspace_id = $2`,
		userID, workspaceID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to remove member")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "not_found", "membership not found")
		return
	}

	if err := tx.Commit(); err != nil {
		s.log.Error().Err(err).Msg("failed to commit transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

var errLastAdmin = fmt.Errorf("last admin")

func (s *server) requireLastAdminNotTarget(tx *sql.Tx, workspaceID, userID string) error {
	var adminCount int
	err := tx.QueryRow(
		`SELECT COUNT(*) FROM provisr_identity.memberships
		 WHERE workspace_id = $1 AND role = 'admin'
		 FOR UPDATE`,
		workspaceID,
	).Scan(&adminCount)
	if err != nil {
		return err
	}
	if adminCount <= 1 {
		var isAdmin bool
		err := tx.QueryRow(
			`SELECT EXISTS(
				SELECT 1 FROM provisr_identity.memberships
				WHERE workspace_id = $1 AND user_id = $2 AND role = 'admin'
			)`,
			workspaceID, userID,
		).Scan(&isAdmin)
		if err != nil {
			return err
		}
		if isAdmin {
			return errLastAdmin
		}
	}
	return nil
}

func (s *server) handleCreateInvitation(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")

	var req inviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "email is required")
		return
	}
	if !validRoles[req.Role] {
		writeError(w, http.StatusBadRequest, "validation_error", "role must be admin, engineer, approver, auditor, or viewer")
		return
	}

	var exists bool
	err := s.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM provisr_identity.workspaces WHERE id = $1 AND deleted_at IS NULL)",
		workspaceID,
	).Scan(&exists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check workspace existence")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create invitation")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "not_found", "workspace not found")
		return
	}

	code, err := generateInviteCode()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to generate invitation code")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create invitation")
		return
	}

	var inv invitationResponse
	err = s.db.QueryRow(
		`INSERT INTO provisr_identity.invitations (workspace_id, email, role, code, expires_at)
		 VALUES ($1, $2, $3, $4, now() + interval '7 days')
		 RETURNING id, workspace_id, email, role, code, expires_at, created_at`,
		workspaceID, req.Email, req.Role, code,
	).Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.Code, &inv.ExpiresAt, &inv.CreatedAt)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to insert invitation")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to create invitation")
		return
	}

	writeJSON(w, http.StatusCreated, inv)
}

func (s *server) handleListInvitations(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")

	rows, err := s.db.Query(
		`SELECT id, workspace_id, email, role, code, expires_at, created_at, revoked_at
		 FROM provisr_identity.invitations
		 WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()
		 ORDER BY created_at DESC`,
		workspaceID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to list invitations")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list invitations")
		return
	}
	defer rows.Close()

	var invitations []invitationResponse
	for rows.Next() {
		var inv invitationResponse
		if err := rows.Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.Code, &inv.ExpiresAt, &inv.CreatedAt, &inv.RevokedAt); err != nil {
			s.log.Error().Err(err).Msg("failed to scan invitation row")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to list invitations")
			return
		}
		invitations = append(invitations, inv)
	}
	if err := rows.Err(); err != nil {
		s.log.Error().Err(err).Msg("failed to iterate invitation rows")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to list invitations")
		return
	}
	if invitations == nil {
		invitations = []invitationResponse{}
	}

	writeJSON(w, http.StatusOK, invitations)
}

func (s *server) handleGetInvitation(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	invitationID := r.PathValue("invitation_id")

	var inv invitationResponse
	err := s.db.QueryRow(
		`SELECT id, workspace_id, email, role, code, expires_at, created_at, revoked_at
		 FROM provisr_identity.invitations
		 WHERE id = $1 AND workspace_id = $2`,
		invitationID, workspaceID,
	).Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.Code, &inv.ExpiresAt, &inv.CreatedAt, &inv.RevokedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "invitation not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to get invitation")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get invitation")
		return
	}

	writeJSON(w, http.StatusOK, inv)
}

func (s *server) handleRevokeInvitation(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	invitationID := r.PathValue("invitation_id")

	result, err := s.db.Exec(
		`UPDATE provisr_identity.invitations SET revoked_at = now()
		 WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
		invitationID, workspaceID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to revoke invitation")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to revoke invitation")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "not_found", "invitation not found or already revoked")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleGetInvitationByCode(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "code query parameter is required")
		return
	}

	var inv invitationResponse
	err := s.db.QueryRow(
		`SELECT id, workspace_id, email, role, code, expires_at, created_at, revoked_at
		 FROM provisr_identity.invitations
		 WHERE code = $1`,
		code,
	).Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.Code, &inv.ExpiresAt, &inv.CreatedAt, &inv.RevokedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "invitation not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to get invitation by code")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to get invitation")
		return
	}

	if inv.RevokedAt != nil {
		writeError(w, http.StatusGone, "revoked", "invitation has been revoked")
		return
	}

	var expiresAt time.Time
	if err := expiresAt.UnmarshalText([]byte(inv.ExpiresAt)); err == nil && time.Now().After(expiresAt) {
		writeError(w, http.StatusGone, "expired", "invitation has expired")
		return
	}

	writeJSON(w, http.StatusOK, inv)
}

func (s *server) handleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "code query parameter is required")
		return
	}

	var req acceptInviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if req.UserID == "" || req.Email == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "user_id, name, and email are required")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to begin transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}
	defer tx.Rollback()

	var inv struct {
		ID          string
		WorkspaceID string
		Role        string
		Email       string
		ExpiresAt   time.Time
		RevokedAt   *time.Time
	}
	err = tx.QueryRow(
		`SELECT id, workspace_id, role, email, expires_at, revoked_at
		 FROM provisr_identity.invitations
		 WHERE code = $1 FOR UPDATE`,
		code,
	).Scan(&inv.ID, &inv.WorkspaceID, &inv.Role, &inv.Email, &inv.ExpiresAt, &inv.RevokedAt)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "not_found", "invitation not found")
		return
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to get invitation for accept")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}

	if inv.RevokedAt != nil {
		writeError(w, http.StatusGone, "revoked", "invitation has been revoked")
		return
	}
	if time.Now().After(inv.ExpiresAt) {
		writeError(w, http.StatusGone, "expired", "invitation has expired")
		return
	}

	if !strings.EqualFold(inv.Email, req.Email) {
		writeError(w, http.StatusForbidden, "email_mismatch", "invitation is for a different email")
		return
	}

	var userExists bool
	err = tx.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM provisr_identity.users WHERE id = $1)",
		req.UserID,
	).Scan(&userExists)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check user existence")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}
	if !userExists {
		_, err = tx.Exec(
			`INSERT INTO provisr_identity.users (id, clerk_id, name, email)
			 VALUES ($1, $1, $2, $3)`,
			req.UserID, req.Name, req.Email,
		)
		if err != nil {
			s.log.Error().Err(err).Msg("failed to create user")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
			return
		}
	}

	var alreadyMember bool
	err = tx.QueryRow(
		`SELECT EXISTS(
			SELECT 1 FROM provisr_identity.memberships
			WHERE user_id = $1 AND workspace_id = $2
		)`,
		req.UserID, inv.WorkspaceID,
	).Scan(&alreadyMember)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to check existing membership")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}
	if alreadyMember {
		writeError(w, http.StatusConflict, "already_member", "already a member of this workspace")
		return
	}

	_, err = tx.Exec(
		`INSERT INTO provisr_identity.memberships (user_id, workspace_id, role, invited_by)
		 VALUES ($1, $2, $3, NULL)`,
		req.UserID, inv.WorkspaceID, inv.Role,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create membership")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}

	_, err = tx.Exec(
		`UPDATE provisr_identity.invitations SET revoked_at = now() WHERE id = $1`,
		inv.ID,
	)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to revoke used invitation")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}

	var mr member
	err = tx.QueryRow(
		`SELECT u.id, u.name, u.email, m.role, m.joined_at
		 FROM provisr_identity.memberships m
		 JOIN provisr_identity.users u ON u.id = m.user_id
		 WHERE m.user_id = $1 AND m.workspace_id = $2`,
		req.UserID, inv.WorkspaceID,
	).Scan(&mr.ID, &mr.Name, &mr.Email, &mr.Role, &mr.JoinedAt)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to query new member")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}

	if err := tx.Commit(); err != nil {
		s.log.Error().Err(err).Msg("failed to commit transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to accept invitation")
		return
	}

	writeJSON(w, http.StatusOK, mr)
}

func (s *server) handleCheckPermission(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req checkPermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if req.UserID == "" || req.WorkspaceID == "" || req.Action == "" || req.ResourceType == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "user_id, workspace_id, action, and resource_type are required")
		return
	}

	var role string
	err := s.db.QueryRow(
		`SELECT role FROM provisr_identity.memberships
		 WHERE user_id = $1 AND workspace_id = $2`,
		req.UserID, req.WorkspaceID,
	).Scan(&role)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusOK, checkPermissionResponse{
			Allowed: false,
			Reason:  "user is not a member of this workspace",
		})
		return
	}
	if err != nil {
		s.log.Error().Err(err).Msg("failed to lookup membership for permission check")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to check permission")
		return
	}

	allowed := isActionAllowed(role, req.ResourceType, req.Action)
	reason := ""
	if !allowed {
		reason = fmt.Sprintf("role %s does not permit action %s on resource_type %s", role, req.Action, req.ResourceType)
	}

	writeJSON(w, http.StatusOK, checkPermissionResponse{Allowed: allowed, Reason: reason})
}

func (s *server) handleCheckBatch(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req checkBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	results := make([]checkPermissionResponse, len(req.Checks))
	for i, check := range req.Checks {
		var role string
		err := s.db.QueryRow(
			`SELECT role FROM provisr_identity.memberships
			 WHERE user_id = $1 AND workspace_id = $2`,
			check.UserID, check.WorkspaceID,
		).Scan(&role)
		if err == sql.ErrNoRows {
			results[i] = checkPermissionResponse{
				Allowed: false,
				Reason:  "user is not a member of this workspace",
			}
			continue
		}
		if err != nil {
			s.log.Error().Err(err).Msg("failed to lookup membership for batch permission check")
			writeError(w, http.StatusInternalServerError, "internal_error", "failed to check permissions")
			return
		}

		allowed := isActionAllowed(role, check.ResourceType, check.Action)
		reason := ""
		if !allowed {
			reason = fmt.Sprintf("role %s does not permit action %s on resource_type %s", role, check.Action, check.ResourceType)
		}
		results[i] = checkPermissionResponse{Allowed: allowed, Reason: reason}
	}

	writeJSON(w, http.StatusOK, checkBatchResponse{Results: results})
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

func generateInviteCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
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
