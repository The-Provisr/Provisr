package policy

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const maxBody = 1 << 20

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
	EnabledPackIDs []string `json:"enabled_pack_ids"`
	Mode           *string  `json:"mode"`
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
	mux.HandleFunc("GET /v1/workspaces/{workspace_id}/policy-settings", s.handleGetSettings)
	mux.HandleFunc("PUT /v1/workspaces/{workspace_id}/policy-settings", s.handleUpdateSettings)
	mux.HandleFunc("GET /v1/policy-packs/{pack_id}", s.handleGetPack)
	mux.HandleFunc("PATCH /v1/policy-rules/{rule_id}/parameters", s.handleUpdateRuleParameters)
	mux.HandleFunc("GET /v1/workspaces/{workspace_id}/policy-requirements", s.handleGetPolicyRequirements)

	return loggingMiddleware(log, s.recoveryMiddleware(mux))
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

	// Return system packs (workspace_id IS NULL) plus workspace-specific packs
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
		// Return defaults: no packs enabled, enforced mode
		s.writeJSON(w, http.StatusOK, policySettings{
			WorkspaceID:    workspaceID,
			EnabledPackIDs: []string{},
			Mode:           "enforced",
			CreatedAt:      time.Now().UTC().Format(time.RFC3339),
			UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		})
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

	// Validate pack IDs are valid UUIDs
	for _, id := range req.EnabledPackIDs {
		if _, err := uuid.Parse(id); err != nil {
			s.writeError(r, w, http.StatusBadRequest, "validation_error", fmt.Sprintf("invalid pack id: %s", id))
			return
		}
	}

	mode := "enforced"
	if req.Mode != nil {
		if *req.Mode != "enforced" && *req.Mode != "audit_only" {
			s.writeError(r, w, http.StatusBadRequest, "validation_error", "mode must be enforced or audit_only")
			return
		}
		mode = *req.Mode
	}

	if req.EnabledPackIDs == nil {
		req.EnabledPackIDs = []string{}
	}

	// Verify all pack IDs exist
	for _, packID := range req.EnabledPackIDs {
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

	var settings policySettings
	var packIDs pq.StringArray
	err := s.db.QueryRow(
		`INSERT INTO provisr_policy.workspace_policy_settings (workspace_id, enabled_pack_ids, mode)
		 VALUES ($1, $2, $3::provisr_policy.policy_mode)
		 ON CONFLICT (workspace_id) DO UPDATE SET
		   enabled_pack_ids = EXCLUDED.enabled_pack_ids,
		   mode = EXCLUDED.mode,
		   updated_at = now()
		 RETURNING workspace_id, enabled_pack_ids, mode, created_at, updated_at`,
		workspaceID, pq.Array(req.EnabledPackIDs), mode,
	).Scan(&settings.WorkspaceID, &packIDs, &settings.Mode, &settings.CreatedAt, &settings.UpdatedAt)
	if err != nil {
		if isForeignKeyViolation(err) {
			s.writeError(r, w, http.StatusBadRequest, "workspace_not_found", "workspace does not exist")
			return
		}
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to update policy settings")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to update settings")
		return
	}
	settings.EnabledPackIDs = []string(packIDs)
	if settings.EnabledPackIDs == nil {
		settings.EnabledPackIDs = []string{}
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) handleGetPack(w http.ResponseWriter, r *http.Request) {
	packID := r.PathValue("pack_id")
	if _, err := uuid.Parse(packID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "pack_id must be a valid UUID")
		return
	}

	role := r.Header.Get("X-User-Role")
	isAdmin := role == "admin"

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
		if isAdmin {
			rule.RegoRule = regoRule
		}
		
		pack.Rules = append(pack.Rules, rule)
	}

	s.writeJSON(w, http.StatusOK, pack)
}

func (s *server) handleUpdateRuleParameters(w http.ResponseWriter, r *http.Request) {
	ruleID := r.PathValue("rule_id")
	if _, err := uuid.Parse(ruleID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "rule_id must be a valid UUID")
		return
	}

	role := r.Header.Get("X-User-Role")
	if role != "admin" {
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
	
	// Validate JSON
	if !json.Valid([]byte(req.ParametersSchema)) {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "parameters_schema must be valid JSON")
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

func (s *server) handleGetPolicyRequirements(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("workspace_id")
	if _, err := uuid.Parse(workspaceID); err != nil {
		s.writeError(r, w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}

	reqs, err := ProjectPolicyRequirements(r.Context(), s.db, workspaceID)
	if err != nil {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("failed to project policy requirements")
		s.writeError(r, w, http.StatusInternalServerError, "internal_error", "failed to project policy requirements")
		return
	}

	s.writeJSON(w, http.StatusOK, reqs)
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

func isForeignKeyViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Code == "23503"
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
		correlationID := r.Header.Get("X-Correlation-ID")
		if _, err := uuid.Parse(correlationID); err != nil {
			correlationID = requestID
		}

		l := base.With().Str("request_id", requestID).Str("correlation_id", correlationID).Logger()
		ctx := l.WithContext(r.Context())
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
