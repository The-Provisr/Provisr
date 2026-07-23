package models

import (
	"time"

	"github.com/google/uuid"
)

type RequestStatus string

const (
	StatusReceived        RequestStatus = "RECEIVED"
	StatusPendingAgent    RequestStatus = "PENDING_AGENT"
	StatusPolicyCheck     RequestStatus = "POLICY_CHECK"
	StatusPendingApproval RequestStatus = "PENDING_APPROVAL"
	StatusProvisioning    RequestStatus = "PROVISIONING"
	StatusLive            RequestStatus = "LIVE"
	StatusFailed          RequestStatus = "FAILED"
	StatusAbandoned       RequestStatus = "ABANDONED"
)

type RequestIntent string

const (
	IntentCreate      RequestIntent = "CREATE"
	IntentUpdate      RequestIntent = "UPDATE"
	IntentDestroy     RequestIntent = "DESTROY"
	IntentImport      RequestIntent = "IMPORT"
	IntentReprovision RequestIntent = "REPROVISION"
)

type ProvisioningRequest struct {
	RequestID       uuid.UUID      `json:"request_id"`
	OrgID           uuid.UUID      `json:"org_id"`
	SubmitterUserID uuid.UUID      `json:"submitter_user_id"`
	Intent          RequestIntent  `json:"intent"`
	Status          RequestStatus  `json:"status"`
	NLInput         string         `json:"nl_input"`
	StateVersion    int            `json:"state_version"`
	IdempotencyKey  *string        `json:"idempotency_key,omitempty"`
	CorrelationID   *string        `json:"correlation_id,omitempty"`
	ErrorCode       *string        `json:"error_code,omitempty"`
	ErrorMessage    *string        `json:"error_message,omitempty"`
	EstimatedCostUSD *float64      `json:"estimated_cost_usd,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	CompletedAt     *time.Time     `json:"completed_at,omitempty"`
}

type CreateProvisionRequest struct {
	OrgID           uuid.UUID      `json:"org_id"`
	SubmitterUserID uuid.UUID      `json:"submitter_user_id"`
	Intent          RequestIntent  `json:"intent"`
	NLInput         string         `json:"nl_input"`
	IdempotencyKey  *string        `json:"idempotency_key,omitempty"`
}

type TransitionRequest struct {
	NewStatus       RequestStatus `json:"new_status"`
	ExpectedVersion int           `json:"expected_version"`
	ErrorCode       *string       `json:"error_code,omitempty"`
	ErrorMessage    *string       `json:"error_message,omitempty"`
}
