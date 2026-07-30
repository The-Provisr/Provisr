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
	"time"

	_ "github.com/lib/pq"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

type memberResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	JoinedAt string `json:"joined_at"`
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

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Status  int    `json:"status"`
}

var validRoles = map[string]bool{
	"admin":     true,
	"engineer":  true,
	"approver":  true,
	"auditor":   true,
	"viewer":    true,
}

var terminalRunStates = []interface{}{"completed", "failed", "cancelled"}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8089"
	}

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		dbDSN = "postgres://localhost:5432/provisr?sslmode=disable"
	}

	logger := zerolog.New(os.Stdout).With().Timestamp().Str("service", "membership-service").Logger()

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

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      recoveryMiddleware(logger, mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("membership-service starting")
	log.Fatal(srv.ListenAndServe())
}

type server struct {
	db  *sql.DB
	log zerolog.Logger
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

	var mr memberResponse
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

	var members []memberResponse
	for rows.Next() {
		var m memberResponse
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
		members = []memberResponse{}
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

	var exists bool
	err := s.db.QueryRow(
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

	tx, err := s.db.Begin()
	if err != nil {
		s.log.Error().Err(err).Msg("failed to begin transaction")
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to remove member")
		return
	}
	defer tx.Rollback()

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
		ExpiresAt   time.Time
		RevokedAt   *time.Time
	}
	err = tx.QueryRow(
		`SELECT id, workspace_id, role, expires_at, revoked_at
		 FROM provisr_identity.invitations
		 WHERE code = $1 FOR UPDATE`,
		code,
	).Scan(&inv.ID, &inv.WorkspaceID, &inv.Role, &inv.ExpiresAt, &inv.RevokedAt)
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

	var mr memberResponse
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
