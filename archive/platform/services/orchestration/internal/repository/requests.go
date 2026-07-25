package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

var (
	ErrNotFound        = errors.New("request not found")
	ErrVersionConflict = errors.New("version conflict: request was modified by another process")
	ErrDuplicateKey    = errors.New("idempotency key already exists")
)

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) CreateRequest(ctx context.Context, req *models.ProvisioningRequest) error {
	query := `
		INSERT INTO provisioning_requests
			(org_id, submitter_user_id, intent, status, nl_input, state_version, idempotency_key, correlation_id)
		VALUES
			($1, $2, $3, $4, $5, 1, $6, $7)
		RETURNING request_id, created_at, updated_at`

	err := r.pool.QueryRow(ctx, query,
		req.OrgID,
		req.SubmitterUserID,
		req.Intent,
		req.Status,
		req.NLInput,
		req.IdempotencyKey,
		req.CorrelationID,
	).Scan(&req.RequestID, &req.CreatedAt, &req.UpdatedAt)

	if err != nil {
		return fmt.Errorf("insert provisioning request: %w", err)
	}

	req.StateVersion = 1
	return nil
}

func (r *Repository) GetRequest(ctx context.Context, requestID uuid.UUID) (*models.ProvisioningRequest, error) {
	query := `
		SELECT request_id, org_id, submitter_user_id, intent, status, nl_input,
		       state_version, idempotency_key, correlation_id, error_code, error_message,
		       estimated_cost_usd, created_at, updated_at, completed_at
		FROM provisioning_requests
		WHERE request_id = $1`

	req := &models.ProvisioningRequest{}
	err := r.pool.QueryRow(ctx, query, requestID).Scan(
		&req.RequestID,
		&req.OrgID,
		&req.SubmitterUserID,
		&req.Intent,
		&req.Status,
		&req.NLInput,
		&req.StateVersion,
		&req.IdempotencyKey,
		&req.CorrelationID,
		&req.ErrorCode,
		&req.ErrorMessage,
		&req.EstimatedCostUSD,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.CompletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get provisioning request: %w", err)
	}

	return req, nil
}

func (r *Repository) FindByIdempotencyKey(ctx context.Context, orgID uuid.UUID, key string) (*models.ProvisioningRequest, error) {
	query := `
		SELECT request_id, org_id, submitter_user_id, intent, status, nl_input,
		       state_version, idempotency_key, correlation_id, error_code, error_message,
		       estimated_cost_usd, created_at, updated_at, completed_at
		FROM provisioning_requests
		WHERE org_id = $1 AND idempotency_key = $2`

	req := &models.ProvisioningRequest{}
	err := r.pool.QueryRow(ctx, query, orgID, key).Scan(
		&req.RequestID,
		&req.OrgID,
		&req.SubmitterUserID,
		&req.Intent,
		&req.Status,
		&req.NLInput,
		&req.StateVersion,
		&req.IdempotencyKey,
		&req.CorrelationID,
		&req.ErrorCode,
		&req.ErrorMessage,
		&req.EstimatedCostUSD,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.CompletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("find by idempotency key: %w", err)
	}

	return req, nil
}

func (r *Repository) UpdateRequestStatus(
	ctx context.Context,
	requestID uuid.UUID,
	newStatus models.RequestStatus,
	expectedVersion int,
	errorCode, errorMessage *string,
) (*models.ProvisioningRequest, error) {
	query := `
		UPDATE provisioning_requests
		SET status = $1,
		    state_version = state_version + 1,
		    updated_at = now(),
		    error_code = COALESCE($4, error_code),
		    error_message = COALESCE($5, error_message),
		    completed_at = CASE WHEN $1 IN ('LIVE', 'FAILED', 'ABANDONED') THEN now() ELSE completed_at END
		WHERE request_id = $2 AND state_version = $3
		RETURNING request_id, org_id, submitter_user_id, intent, status, nl_input,
		          state_version, idempotency_key, correlation_id, error_code, error_message,
		          estimated_cost_usd, created_at, updated_at, completed_at`

	req := &models.ProvisioningRequest{}
	err := r.pool.QueryRow(ctx, query,
		newStatus,
		requestID,
		expectedVersion,
		errorCode,
		errorMessage,
	).Scan(
		&req.RequestID,
		&req.OrgID,
		&req.SubmitterUserID,
		&req.Intent,
		&req.Status,
		&req.NLInput,
		&req.StateVersion,
		&req.IdempotencyKey,
		&req.CorrelationID,
		&req.ErrorCode,
		&req.ErrorMessage,
		&req.EstimatedCostUSD,
		&req.CreatedAt,
		&req.UpdatedAt,
		&req.CompletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			exists, existsErr := r.GetRequest(ctx, requestID)
			if existsErr != nil {
				return nil, ErrNotFound
			}
			if exists.StateVersion != expectedVersion {
				return nil, ErrVersionConflict
			}
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update provisioning request status: %w", err)
	}

	return req, nil
}
