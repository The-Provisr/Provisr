package approval

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/provisr/backend/pkg/health"
	"github.com/provisr/backend/pkg/middleware"
	"github.com/rs/zerolog"
)

const maxBody = 1 << 20

const auditEventType = "approval_requirements_evaluated"

var (
	// ErrNotMember means the workspace is missing/deleted or the user is not a member.
	ErrNotMember = errors.New("user is not a member of the workspace")
	// ErrInvalidConfig means the workspace approval_rules settings are malformed.
	// Evaluation fails closed rather than silently falling back to defaults.
	ErrInvalidConfig = errors.New("workspace approval_rules settings are invalid")
)

// EvaluationContext is the server-side state an evaluation depends on.
type EvaluationContext struct {
	WorkspaceEnvironment string
	UserRole             string
	Config               Config
}

// AuditRecord is one evaluation to append to the audit chain.
type AuditRecord struct {
	WorkspaceID  string
	ResourceID   string
	EvaluationID string
	Payload      map[string]any
}

// Store resolves evaluation context and records evaluations.
type Store interface {
	LoadEvaluationContext(ctx context.Context, workspaceID, userID string) (EvaluationContext, error)
	RecordEvaluation(ctx context.Context, rec AuditRecord) error
}

// EvaluateRequest is the request body for POST /v1/approval-requirements/evaluate.
type EvaluateRequest struct {
	WorkspaceID     string           `json:"workspace_id"`
	RunID           string           `json:"run_id,omitempty"`
	UserID          string           `json:"user_id"`
	Environment     string           `json:"environment"`
	Provider        string           `json:"provider"`
	Region          string           `json:"region"`
	PublicExposure  bool             `json:"public_exposure"`
	ResourceChanges []ResourceChange `json:"resource_changes"`
	CostEstimate    CostEstimate     `json:"cost_estimate"`
	Policy          PolicyResult     `json:"policy"`
}

// EvaluateResponse is the Requirement plus its audit identity.
type EvaluateResponse struct {
	Requirement
	EvaluationID string `json:"evaluation_id"`
	EvaluatedAt  string `json:"evaluated_at"`
}

type server struct {
	store Store
	token string
	log   zerolog.Logger
	now   func() time.Time
}

// New returns the approval-service handler backed by PostgreSQL. The evaluate
// endpoint is an internal service boundary authenticated with token; an empty
// token disables it. Callers (MCP/gateway) authorize the end user first.
func New(db *sql.DB, log zerolog.Logger, token string) http.Handler {
	return NewHandler(sqlStore{db: db}, log, token)
}

// NewHandler builds the handler around any Store; used directly by tests.
func NewHandler(store Store, log zerolog.Logger, token string) http.Handler {
	s := &server{store: store, token: token, log: log, now: time.Now}
	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	mux.HandleFunc("POST /v1/approval-requirements/evaluate", s.handleEvaluate)
	return mux
}

func (s *server) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if s.token == "" {
		s.writeError(w, http.StatusServiceUnavailable, "approval_rules_not_configured", "approval rule evaluation is not configured")
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		s.writeError(w, http.StatusUnauthorized, "unauthorized", "service authentication required")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req EvaluateRequest
	if err := dec.Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON for this endpoint")
		return
	}
	if _, err := uuid.Parse(req.WorkspaceID); err != nil {
		s.writeError(w, http.StatusBadRequest, "validation_error", "workspace_id must be a valid UUID")
		return
	}
	if _, err := uuid.Parse(req.UserID); err != nil {
		s.writeError(w, http.StatusBadRequest, "validation_error", "user_id must be a valid UUID")
		return
	}
	if req.RunID != "" {
		if _, err := uuid.Parse(req.RunID); err != nil {
			s.writeError(w, http.StatusBadRequest, "validation_error", "run_id must be a valid UUID")
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	log := zerolog.Ctx(r.Context())

	evalCtx, err := s.store.LoadEvaluationContext(ctx, req.WorkspaceID, req.UserID)
	switch {
	case errors.Is(err, ErrNotMember):
		s.writeError(w, http.StatusNotFound, "not_found", "workspace membership not found")
		return
	case errors.Is(err, ErrInvalidConfig):
		log.Error().Err(err).Str("workspace_id", req.WorkspaceID).Msg("invalid approval configuration")
		s.writeError(w, http.StatusInternalServerError, "invalid_approval_config", "workspace approval configuration is invalid")
		return
	case err != nil:
		log.Error().Err(err).Msg("failed to load approval evaluation context")
		s.writeError(w, http.StatusInternalServerError, "internal_error", "failed to evaluate approval requirements")
		return
	}

	result, err := Evaluate(RunContext{
		WorkspaceID:          req.WorkspaceID,
		RunID:                req.RunID,
		UserID:               req.UserID,
		Environment:          req.Environment,
		Provider:             req.Provider,
		Region:               req.Region,
		PublicExposure:       req.PublicExposure,
		ResourceChanges:      req.ResourceChanges,
		CostEstimate:         req.CostEstimate,
		Policy:               req.Policy,
		UserRole:             evalCtx.UserRole,
		WorkspaceEnvironment: evalCtx.WorkspaceEnvironment,
	}, evalCtx.Config)
	var verr *ValidationError
	switch {
	case errors.Is(err, ErrPolicyDenied):
		s.writeError(w, http.StatusConflict, "policy_denied", err.Error())
		return
	case errors.As(err, &verr):
		s.writeError(w, http.StatusBadRequest, "validation_error", verr.Error())
		return
	case errors.Is(err, ErrInvalidConfig):
		s.writeError(w, http.StatusInternalServerError, "invalid_approval_config", "workspace approval configuration is invalid")
		return
	case err != nil:
		log.Error().Err(err).Msg("failed to evaluate approval rules")
		s.writeError(w, http.StatusInternalServerError, "internal_error", "failed to evaluate approval requirements")
		return
	}

	resp := EvaluateResponse{
		Requirement:  result,
		EvaluationID: uuid.NewString(),
		EvaluatedAt:  s.now().UTC().Format(time.RFC3339Nano),
	}
	resourceID := req.RunID
	if resourceID == "" {
		resourceID = resp.EvaluationID
	}
	if err := s.store.RecordEvaluation(ctx, AuditRecord{
		WorkspaceID:  req.WorkspaceID,
		ResourceID:   resourceID,
		EvaluationID: resp.EvaluationID,
		Payload:      auditPayload(req, resp),
	}); err != nil {
		// Unaudited decisions are never returned.
		log.Error().Err(err).Msg("failed to record approval evaluation")
		s.writeError(w, http.StatusInternalServerError, "internal_error", "failed to record approval evaluation")
		return
	}

	log.Info().
		Str("workspace_id", req.WorkspaceID).
		Str("run_id", req.RunID).
		Str("evaluation_id", resp.EvaluationID).
		Bool("requires_approval", resp.RequiresApproval).
		Str("risk_level", string(resp.RiskLevel)).
		Msg("approval requirements evaluated")
	s.writeJSON(w, http.StatusOK, resp)
}

// auditPayload holds the decision and its provenance. Raw resource properties
// are covered by input_digest and deliberately not copied into the audit log.
func auditPayload(req EvaluateRequest, resp EvaluateResponse) map[string]any {
	var approver any
	if resp.RequiredApproverRole != nil {
		approver = string(*resp.RequiredApproverRole)
	}
	return map[string]any{
		"evaluation_id":          resp.EvaluationID,
		"run_id":                 req.RunID,
		"user_id":                req.UserID,
		"requires_approval":      resp.RequiresApproval,
		"reason":                 resp.Reason,
		"required_approver_role": approver,
		"risk_level":             resp.RiskLevel,
		"triggered_rules":        resp.TriggeredRules,
		"rule_set_version":       resp.RuleSetVersion,
		"input_digest":           resp.InputDigest,
		"config":                 resp.Config,
		"cost_source":            resp.CostSource,
		"resource_change_count":  len(req.ResourceChanges),
		"evaluated_at":           resp.EvaluatedAt,
	}
}

func (s *server) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		s.log.Error().Err(err).Msg("failed to encode response")
	}
}

func (s *server) writeError(w http.ResponseWriter, status int, code, message string) {
	s.writeJSON(w, status, map[string]any{"error": code, "message": message, "status": status})
}

// --- PostgreSQL store ---

type sqlStore struct{ db *sql.DB }

func (s sqlStore) LoadEvaluationContext(ctx context.Context, workspaceID, userID string) (EvaluationContext, error) {
	var (
		out       EvaluationContext
		threshold sql.NullString
	)
	err := s.db.QueryRowContext(ctx,
		`SELECT w.environment::text, m.role::text,
		        w.settings->'approval_rules'->'cost_threshold_usd'
		   FROM provisr_identity.workspaces w
		   JOIN provisr_identity.memberships m ON m.workspace_id = w.id AND m.user_id = $2
		  WHERE w.id = $1 AND w.deleted_at IS NULL`,
		workspaceID, userID,
	).Scan(&out.WorkspaceEnvironment, &out.UserRole, &threshold)
	if errors.Is(err, sql.ErrNoRows) {
		return EvaluationContext{}, ErrNotMember
	}
	if err != nil {
		return EvaluationContext{}, fmt.Errorf("load approval context: %w", err)
	}
	cfg, err := parseConfig(threshold)
	if err != nil {
		return EvaluationContext{}, err
	}
	out.Config = cfg
	return out, nil
}

// parseConfig reads settings.approval_rules.cost_threshold_usd (JSON text).
// Absent or JSON null means the default; anything but a non-negative number
// is an error.
func parseConfig(raw sql.NullString) (Config, error) {
	cfg := DefaultConfig()
	if !raw.Valid || raw.String == "null" {
		return cfg, nil
	}
	v, err := strconv.ParseFloat(raw.String, 64)
	if err != nil || v < 0 {
		return Config{}, fmt.Errorf("%w: cost_threshold_usd must be a non-negative number", ErrInvalidConfig)
	}
	cfg.CostThresholdUSD = v
	return cfg, nil
}

func (s sqlStore) RecordEvaluation(ctx context.Context, rec AuditRecord) error {
	payloadJSON, err := json.Marshal(rec.Payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin audit tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var previousHash sql.NullString
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('provisr_audit.chain'), 0)`); err != nil {
		return fmt.Errorf("acquire audit chain lock: %w", err)
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT hash FROM provisr_audit.audit_events ORDER BY seq DESC LIMIT 1`,
	).Scan(&previousHash); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read previous audit hash: %w", err)
	}

	corrID := middleware.CorrelationID(ctx)
	if _, err := uuid.Parse(corrID); err != nil {
		corrID = uuid.NewString()
	}
	actorID := "approval-service"
	actorType := "system"
	resourceType := "approval_requirement"

	// Same chain formula as policy-service's emitAudit.
	sum := sha256.New()
	sum.Write([]byte(previousHash.String + "\x00"))
	sum.Write([]byte(rec.WorkspaceID + "\x00"))
	sum.Write([]byte(actorID + "\x00"))
	sum.Write([]byte(actorType + "\x00"))
	sum.Write([]byte(resourceType + "\x00"))
	sum.Write([]byte(rec.ResourceID + "\x00"))
	sum.Write([]byte(auditEventType + "\x00"))
	sum.Write(payloadJSON)
	sum.Write([]byte("\x00" + corrID))
	eventHash := hex.EncodeToString(sum.Sum(nil))

	var prev any
	if previousHash.Valid {
		prev = previousHash.String
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO provisr_audit.audit_events
		   (workspace_id, event_type, actor_id, actor_type, resource_type, resource_id,
		    payload, hash, previous_hash, correlation_id)
		 VALUES ($1, $2::provisr_audit.event_type, $3, $4::provisr_audit.actor_type, $5, $6, $7, $8, $9, $10)`,
		rec.WorkspaceID, auditEventType, actorID, actorType, resourceType, rec.ResourceID, payloadJSON, eventHash, prev, corrID,
	); err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return tx.Commit()
}
