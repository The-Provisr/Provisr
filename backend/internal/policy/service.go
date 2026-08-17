package policy

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const maxBody = 1 << 20

// error strings
var (
	errIdempotencyKeyMissing = errors.New("idempotency key missing")
	errIdempotencyKeyUsed    = errors.New("idempotency key already used")
	errIdempotencyKeyInvalid = errors.New("idempotency key invalid")
)

type contextKey string

const (
	correlationIDKey contextKey = "correlation_id"
	principalKey     contextKey = "principal"
)

type Principal struct {
	ID          string `json:"id"`
	Role        string `json:"role"`
	WorkspaceID string `json:"workspace_id,omitempty"`
}

func ContextWithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey).(Principal)
	return p, ok
}

func isAdmin(ctx context.Context) bool {
	p, ok := PrincipalFromContext(ctx)
	return ok && p.Role == "admin"
}

// --- Models ---

type policyPack struct {
	ID           string  `json:"id"`
	WorkspaceID  *string `json:"workspace_id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Category     string  `json:"category"`
	IsSystemPack bool    `json:"is_system_pack"`
	IsEnabled    bool    `json:"is_enabled"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type policySettings struct {
	WorkspaceID    string   `json:"workspace_id"`
	EnabledPackIDs []string `json:"enabled_pack_ids"`
	Mode           string   `json:"mode"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
}

type updateSettingsRequest struct {
	EnabledPackIDs *[]string `json:"enabled_pack_ids"`
	Mode           *string   `json:"mode"`
}

type createPackRequest struct {
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

type policyRule struct {
	ID               string `json:"id"`
	PackID           string `json:"pack_id"`
	RuleKey          string `json:"rule_key"`
	RegoRule         string `json:"rego_rule,omitempty"` // Omitted for non-admins
	Severity         string `json:"severity"`
	Description      string `json:"description"`
	RemediationHint  string `json:"remediation_hint"`
	IsEnabled        bool   `json:"is_enabled"`
	ParametersSchema string `json:"parameters_schema"`
	CreatedAt        string `json:"created_at"`
}

type policyPackWithRules struct {
	policyPack
	Rules []policyRule `json:"rules"`
}

type updateRuleParametersRequest struct {
	ParametersSchema string `json:"parameters_schema"`
}

// --- Server ---

type server struct {
	db  *sql.DB
	log zerolog.Logger
}

func New(db *sql.DB, log zerolog.Logger) http.Handler {
	s := &server{db: db, log: log}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())

	mux.HandleFunc("GET /v1/policy-packs", s.handleListPacks)
	mux.HandleFunc("POST /v1/policy-packs", s.handleCreatePack)
	mux.HandleFunc("GET /v1/workspaces/{workspace_id}/policy-settings", s.handleGetSettings)
	mux.HandleFunc("PUT /v1/workspaces/{workspace_id}/policy-settings", s.handleUpdateSettings)
	mux.HandleFunc("GET /v1/policy-packs/{pack_id}", s.handleGetPack)
	mux.HandleFunc("PATCH /v1/policy-rules/{rule_id}/parameters", s.handleUpdateRuleParameters)

	return loggingMiddleware(log, s.recoveryMiddleware(authMiddleware(mux)))
}

// --- Handlers ---

func (s *server) handleListPacks(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id query parameter is required")
		return
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	rows, err := s.db.Query(
		`SELECT id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at
		 FROM provisr_policy.policy_packs
		 WHERE workspace_id IS NULL OR workspace_id = $1
		 ORDER BY is_system_pack DESC, name`,
		workspaceID,
	)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to list policy packs")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
		return
	}
	defer rows.Close()

	packs := []policyPack{}
	for rows.Next() {
		var p policyPack
		var wsID sql.NullString
		if err := rows.Scan(&p.ID, &wsID, &p.Name, &p.Description, &p.Category, &p.IsSystemPack, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to scan policy pack")
			s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
			return
		}
		if wsID.Valid {
			p.WorkspaceID = &wsID.String
		}
		packs = append(packs, p)
	}
	if err := rows.Err(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to iterate policy packs")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy packs")
		return
	}

	s.writeJSON(w, http.StatusOK, packs)
}

func (s *server) handleCreatePack(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req createPackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	if req.WorkspaceID == "" || req.Name == "" || req.Category == "" {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id, name, and category are required")
		return
	}
	if _, err := uuid.Parse(req.WorkspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}
	switch req.Category {
	case "security", "cost", "compliance", "environment":
		// valid
	default:
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "category must be one of: security, cost, compliance, environment")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to begin tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, req.WorkspaceID, "create_policy_pack"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	var p policyPack
	var wsID sql.NullString
	err = tx.QueryRow(
		`INSERT INTO provisr_policy.policy_packs (workspace_id, name, description, category, is_system_pack, is_enabled)
		 SELECT id, $2, $3, $4::provisr_policy.pack_category, false, true
		 FROM provisr_identity.workspaces WHERE id = $1
		 RETURNING id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at`,
		req.WorkspaceID, req.Name, req.Description, req.Category,
	).Scan(&p.ID, &wsID, &p.Name, &p.Description, &p.Category, &p.IsSystemPack, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt)
	
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to create policy pack")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}
	if wsID.Valid {
		p.WorkspaceID = &wsID.String
	}

	auditPayload := map[string]any{
		"pack_id": p.ID,
		"name": p.Name,
		"category": p.Category,
	}
	if err := s.emitAudit(r.Context(), tx, req.WorkspaceID, "state_transition", p.ID, auditPayload); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}

	if err := tx.Commit(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to commit tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to create policy pack")
		return
	}

	s.writeJSON(w, http.StatusCreated, p)
}

func (s *server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	var settings policySettings
	var packIDs pq.StringArray
	err := s.db.QueryRow(
		`SELECT workspace_id, enabled_pack_ids, mode, created_at, updated_at
		 FROM provisr_policy.workspace_policy_settings
		 WHERE workspace_id = $1`,
		workspaceID,
	).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
	if err == sql.ErrNoRows {
		err = s.db.QueryRow(
			`INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids, mode)
			 SELECT id, ARRAY['a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003']::uuid[], 'enforced'::provisr_policy.policy_mode
			 FROM provisr_identity.workspaces
			 WHERE id = $1
			 ON CONFLICT (workspace_id) DO UPDATE SET updated_at = provisr_policy.workspace_policy_settings.updated_at
			 RETURNING workspace_id, enabled_pack_ids, mode, created_at, updated_at`,
			workspaceID,
		).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
		if err == sql.ErrNoRows {
			s.writeError(r, w, http.StatusNotFound, "workspace_not_found", "workspace does not exist")
			return
		}
		if err != nil {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to initialize policy settings")
			s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to initialize policy settings")
			return
		}
		settings.EnabledPackIDs = []string(packIDs)
		s.writeJSON(w, http.StatusOK, settings)
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to get policy settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy settings")
		return
	}
	settings.EnabledPackIDs = []string(packIDs)
	if settings.EnabledPackIDs == nil {
		settings.EnabledPackIDs = []string{}
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req updateSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if req.Mode != nil {
		if *req.Mode != "enforced" && *req.Mode != "audit_only" {
			s.writeError(r, w, http.StatusBadRequest, "validation_error", "mode must be enforced or audit_only")
			return
		}
	}

	if req.EnabledPackIDs != nil {
		for _, id := range *req.EnabledPackIDs {
			if _, err := uuid.Parse(id); err != nil {
				s.writeError(r, w, http.StatusBadRequest, "validation_error", fmt.Sprintf("invalid pack id: %s", id))
				return
			}
		}

		for _, packID := range *req.EnabledPackIDs {
			var exists bool
			err := s.db.QueryRow(
				`SELECT EXISTS(SELECT 1 FROM provisr_policy.policy_packs WHERE id = $1 AND (workspace_id IS NULL OR workspace_id = $2))`,
				packID, workspaceID,
			).Scan(&exists)
			if err != nil {
				zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to verify pack")
				s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
				return
			}
			if !exists {
				s.writeError(r, w, http.StatusBadRequest, "pack_not_found", fmt.Sprintf("policy pack %s not found", packID))
				return
			}
		}
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to begin tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}
	defer func() { _ = tx.Rollback() }()

	if err := s.claimIdempotencyKey(r.Context(), tx, r, workspaceID, "update_policy_settings"); err != nil {
		s.writeIdempotencyError(w, r, err)
		return
	}

	var existingPackIDs pq.StringArray
	var existingMode string
	err = tx.QueryRow(
		`SELECT enabled_pack_ids, mode
		 FROM provisr_policy.workspace_policy_settings
		 WHERE workspace_id = $1 FOR UPDATE`,
		workspaceID,
	).Scan(&existingPackIDs, &existingMode)

	finalMode := "enforced"
	finalPacks := []string{"a0000000-0000-0000-0000-000000000001", "a0000000-0000-0000-0000-000000000002", "a0000000-0000-0000-0000-000000000003"}
	if err == nil {
		finalMode = existingMode
		finalPacks = []string(existingPackIDs)
	} else if err != sql.ErrNoRows {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to read existing settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	if req.Mode != nil {
		finalMode = *req.Mode
	}
	if req.EnabledPackIDs != nil {
		finalPacks = *req.EnabledPackIDs
	}

	var settings policySettings
	var packIDs pq.StringArray
	err = tx.QueryRow(
		`INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids, mode)
		 SELECT id, $2, $3::provisr_policy.policy_mode
		 FROM provisr_identity.workspaces WHERE id = $1
		 ON CONFLICT (workspace_id) DO UPDATE SET
		   enabled_pack_ids = EXCLUDED.enabled_pack_ids,
		   mode = EXCLUDED.mode,
		   updated_at = now()
		 RETURNING workspace_id, enabled_pack_ids, mode, created_at, updated_at`,
		workspaceID, pq.Array(finalPacks), finalMode,
	).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to update policy settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}
	settings.EnabledPackIDs = []string(packIDs)
	if settings.EnabledPackIDs == nil {
		settings.EnabledPackIDs = []string{}
	}

	auditPayload := map[string]any{
		"enabled_pack_ids": settings.EnabledPackIDs,
		"mode":             settings.Mode,
	}
	if err := s.emitAudit(r.Context(), tx, workspaceID, "state_transition", workspaceID, auditPayload); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to emit audit event")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	if err := tx.Commit(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to commit tx")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) handleGetPack(w http.ResponseWriter, r *http.Request) {
	packID := r.PathValue("pack_id")
	if _, err := uuid.Parse(packID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "pack_id must be a valid UUID")
		return
	}

	admin := isAdmin(r.Context())

	// Fetch pack
	var pack policyPackWithRules
	var wsID sql.NullString
	err := s.db.QueryRow(
		`SELECT id, workspace_id, name, description, category, is_system_pack, is_enabled, created_at, updated_at
		 FROM provisr_policy.policy_packs
		 WHERE id = $1`,
		packID,
	).Scan(&pack.ID, &wsID, &pack.Name, &pack.Description, &pack.Category, &pack.IsSystemPack, &pack.IsEnabled, &pack.CreatedAt, &pack.UpdatedAt)
	
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusNotFound, "not_found", "policy pack not found")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to get policy pack")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy pack")
		return
	}
	if wsID.Valid {
		pack.WorkspaceID = &wsID.String
	}

	// Fetch rules
	rows, err := s.db.Query(
		`SELECT id, pack_id, rule_key, rego_rule, severity, description, remediation_hint, is_enabled, parameters_schema, created_at
		 FROM provisr_policy.policy_rules
		 WHERE pack_id = $1
		 ORDER BY rule_key`,
		packID,
	)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to list policy rules")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to list policy rules")
		return
	}
	defer rows.Close()

	pack.Rules = []policyRule{}
	for rows.Next() {
		var rule policyRule
		var paramsSchema []byte
		var regoRule string
		if err := rows.Scan(&rule.ID, &rule.PackID, &rule.RuleKey, &regoRule, &rule.Severity, &rule.Description, &rule.RemediationHint, &rule.IsEnabled, &paramsSchema, &rule.CreatedAt); err != nil {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to scan policy rule")
			s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy pack rules")
			return
		}
		
		rule.ParametersSchema = string(paramsSchema)
		
		// PRD §15: access control for raw Rego
		if admin {
			rule.RegoRule = regoRule
		}
		
		pack.Rules = append(pack.Rules, rule)
	}
	if err := rows.Err(); err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to iterate policy rules")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to get policy pack rules")
		return
	}

	s.writeJSON(w, http.StatusOK, pack)
}

func (s *server) handleUpdateRuleParameters(w http.ResponseWriter, r *http.Request) {
	ruleID := r.PathValue("rule_id")
	if _, err := uuid.Parse(ruleID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "rule_id must be a valid UUID")
		return
	}

	if !isAdmin(r.Context()) {
		s.writeError(r, w, http.StatusForbidden, "forbidden", "only admins can update policy rule parameters")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req updateRuleParametersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}

	if req.ParametersSchema == "" {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "parameters_schema is required")
		return
	}

	// Validate JSON object
	var schemaObj map[string]any
	if err := json.Unmarshal([]byte(req.ParametersSchema), &schemaObj); err != nil || schemaObj == nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "parameters_schema must be a valid JSON object")
		return
	}

	var rule policyRule
	var paramsSchema []byte
	var regoRule string
	err := s.db.QueryRow(
		`UPDATE provisr_policy.policy_rules
		 SET parameters_schema = $1::jsonb
		 WHERE id = $2
		 RETURNING id, pack_id, rule_key, rego_rule, severity, description, remediation_hint, is_enabled, parameters_schema, created_at`,
		req.ParametersSchema, ruleID,
	).Scan(&rule.ID, &rule.PackID, &rule.RuleKey, &regoRule, &rule.Severity, &rule.Description, &rule.RemediationHint, &rule.IsEnabled, &paramsSchema, &rule.CreatedAt)
	
	if err == sql.ErrNoRows {
		s.writeError(r, w, http.StatusNotFound, "not_found", "policy rule not found")
		return
	}
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to update policy rule")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update policy rule parameters")
		return
	}
	
	rule.ParametersSchema = string(paramsSchema)
	rule.RegoRule = regoRule // Returning updated rule back to admin
	
	s.writeJSON(w, http.StatusOK, rule)
}

// --- Helpers ---

func (s *server) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		s.log.Error().Err(err).Msg("failed to encode response")
	}
}

func (s *server) writeError(r *http.Request, w http.ResponseWriter, status int, code, message string) {
	s.writeJSON(w, status, map[string]any{
		"error":   code,
		"message": message,
		"status":  status,
	})
}

func (s *server) claimIdempotencyKey(ctx context.Context, tx *sql.Tx, r *http.Request, workspaceID, mutation string) error {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return errIdempotencyKeyMissing
	}
	if len(key) > 128 {
		return errIdempotencyKeyInvalid
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO provisr_idempotency.keys (workspace_id, key, mutation)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (workspace_id, key) DO NOTHING`,
		workspaceID, key, mutation,
	)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errIdempotencyKeyUsed
	}
	return nil
}

func (s *server) writeIdempotencyError(w http.ResponseWriter, r *http.Request, err error) {
	log := zerolog.Ctx(r.Context())
	switch {
	case errors.Is(err, errIdempotencyKeyMissing):
		s.writeError(r, w, http.StatusBadRequest, "idempotency_key_required", "Idempotency-Key header is required for mutations")
	case errors.Is(err, errIdempotencyKeyInvalid):
		s.writeError(r, w, http.StatusBadRequest, "idempotency_key_invalid", "Idempotency-Key header must not exceed 128 characters")
	case errors.Is(err, errIdempotencyKeyUsed):
		s.writeError(r, w, http.StatusConflict, "duplicate_idempotency_key", "Idempotency-Key was already used for a mutation")
	default:
		log.Error().Err(err).Msg("failed to claim idempotency key")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to process mutation")
	}
}

func (s *server) emitAudit(ctx context.Context, tx *sql.Tx, workspaceID, eventType, resourceID string, payload map[string]any) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	var previousHash sql.NullString
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'), 0)`); err != nil {
		return fmt.Errorf("acquire audit chain lock: %w", err)
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1`,
	).Scan(&previousHash); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read previous audit hash: %w", err)
	}

	correlationID := correlationID(ctx)
	actorID := "policy-service"
	actorType := "system"
	resourceType := "policy"

	sum := sha256.New()
	sum.Write([]byte(previousHash.String + "\x00"))
	sum.Write([]byte(workspaceID + "\x00"))
	sum.Write([]byte(actorID + "\x00"))
	sum.Write([]byte(actorType + "\x00"))
	sum.Write([]byte(resourceType + "\x00"))
	sum.Write([]byte(resourceID + "\x00"))
	sum.Write([]byte(eventType + "\x00"))
	sum.Write(payloadJSON)
	sum.Write([]byte("\x00" + correlationID))
	eventHash := hex.EncodeToString(sum.Sum(nil))

	var prev any
	if previousHash.Valid {
		prev = previousHash.String
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO provisr_audit.audit_events
		   (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id,
		    payload, hash, previous_hash, correlation_id)
		 VALUES ($1, $2::provisr_audit.event_type, $3, $4::provisr_audit.actor_type, $5, $6, $7, $8, $9, $10)`,
		workspaceID, eventType, actorID, actorType, resourceType, resourceID, payloadJSON, eventHash, prev, correlationID,
	)
	if err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

func correlationID(ctx context.Context) string {
	if v, ok := ctx.Value(correlationIDKey).(string); ok && v != "" {
		return v
	}
	return uuid.NewString()
}

func (s *server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				zerolog.Ctx(r.Context()).Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				s.writeError(r, w, http.StatusInternalServerError, "internal_error", "unexpected server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(base zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		corrID := r.Header.Get("X-Correlation-ID")
		if _, err := uuid.Parse(corrID); err != nil {
			corrID = requestID
		}

		l := base.With().Str("request_id", requestID).Str("correlation_id", corrID).Logger()
		ctx := l.WithContext(r.Context())
		ctx = context.WithValue(ctx, correlationIDKey, corrID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// 1. Check Authorization header
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if authHeader != "" {
			if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
				token := strings.TrimSpace(authHeader[7:])
				jwtSecret := os.Getenv("JWT_SECRET")
				if jwtSecret == "" {
					jwtSecret = os.Getenv("POLICY_JWT_SECRET")
				}

				serviceSecret := os.Getenv("POLICY_SERVICE_SECRET")
				if serviceSecret != "" && token == serviceSecret {
					ctx = ContextWithPrincipal(ctx, Principal{ID: "policy-service", Role: "admin"})
				} else if jwtSecret != "" {
					if p, err := verifyAndParseJWT(token, jwtSecret); err == nil {
						ctx = ContextWithPrincipal(ctx, p)
					}
				}
			}
		}

		// 2. Dev bypass mode for local development and testing only
		if os.Getenv("AUTH_DEV_BYPASS") == "true" {
			if _, ok := PrincipalFromContext(ctx); !ok {
				authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
				if authHeader == "Bearer admin-token" {
					ctx = ContextWithPrincipal(ctx, Principal{ID: "dev-admin", Role: "admin"})
				} else {
					role := r.Header.Get("X-Dev-Role")
					if role == "" {
						role = r.Header.Get("X-User-Role")
					}
					if role == "" {
						role = os.Getenv("DEV_USER_ROLE")
					}
					if role == "" {
						role = "admin"
					}
					userID := os.Getenv("DEV_USER_ID")
					if userID == "" {
						userID = "dev-user"
					}
					ctx = ContextWithPrincipal(ctx, Principal{ID: userID, Role: role})
				}
			}
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func verifyAndParseJWT(token string, secret string) (Principal, error) {
	if secret == "" {
		return Principal{}, errors.New("jwt secret not configured")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Principal{}, errors.New("invalid jwt format")
	}

	// 1. Verify HMAC-SHA256 signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	expectedSig := mac.Sum(nil)

	actualSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		actualSig, err = base64.URLEncoding.DecodeString(parts[2])
		if err != nil {
			return Principal{}, errors.New("invalid signature encoding")
		}
	}

	if !hmac.Equal(expectedSig, actualSig) {
		return Principal{}, errors.New("jwt signature mismatch")
	}

	// 2. Parse payload
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		payloadBytes, err = base64.URLEncoding.DecodeString(parts[1])
		if err != nil {
			return Principal{}, errors.New("invalid payload encoding")
		}
	}

	var claims struct {
		Sub         string         `json:"sub"`
		Role        string         `json:"role"`
		OrgRole     string         `json:"org_role"`
		WorkspaceID string         `json:"workspace_id"`
		Exp         int64          `json:"exp"`
		Nbf         int64          `json:"nbf"`
		Metadata    map[string]any `json:"metadata"`
	}

	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return Principal{}, errors.New("invalid claims json")
	}

	// 3. Expiry and Not-Before verification
	now := time.Now().Unix()
	if claims.Exp > 0 && now > claims.Exp {
		return Principal{}, errors.New("jwt expired")
	}
	if claims.Nbf > 0 && now < claims.Nbf {
		return Principal{}, errors.New("jwt not valid yet")
	}

	role := claims.Role
	if role == "" {
		if claims.OrgRole == "org:admin" || claims.OrgRole == "admin" {
			role = "admin"
		} else if claims.OrgRole == "org:member" || claims.OrgRole == "member" {
			role = "engineer"
		} else if mRole, ok := claims.Metadata["role"].(string); ok && mRole != "" {
			role = mRole
		}
	}

	return Principal{
		ID:          claims.Sub,
		Role:        role,
		WorkspaceID: claims.WorkspaceID,
	}, nil
}
