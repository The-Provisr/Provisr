package statemachine

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

var (
	ErrIllegalTransition = errors.New("illegal state transition")
	ErrInvalidState      = errors.New("current state has no transitions defined")
)

type RequestRepository interface {
	GetRequest(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error)
	UpdateRequestStatus(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error)
}

type TransitionInput struct {
	RequestID       uuid.UUID
	NewStatus       models.RequestStatus
	ExpectedVersion int
	ErrorCode       *string
	ErrorMessage    *string
}

type Machine struct {
	repo RequestRepository
}

func New(repo RequestRepository) *Machine {
	return &Machine{repo: repo}
}

var allowedTransitions = map[models.RequestStatus][]models.RequestStatus{
	models.StatusReceived:        {models.StatusPendingAgent, models.StatusFailed},
	models.StatusPendingAgent:    {models.StatusPolicyCheck, models.StatusAbandoned},
	models.StatusPolicyCheck:     {models.StatusPendingApproval, models.StatusPendingAgent, models.StatusAbandoned},
	models.StatusPendingApproval: {models.StatusProvisioning, models.StatusAbandoned},
	models.StatusProvisioning:    {models.StatusLive, models.StatusFailed},
	models.StatusLive:            {models.StatusFailed},
	models.StatusFailed:          {models.StatusPendingAgent},
	models.StatusAbandoned:       {},
}

func (m *Machine) Transition(ctx context.Context, input TransitionInput) (*models.ProvisioningRequest, error) {
	req, err := m.repo.GetRequest(ctx, input.RequestID)
	if err != nil {
		return nil, fmt.Errorf("fetch request: %w", err)
	}

	allowed, ok := allowedTransitions[req.Status]
	if !ok {
		return nil, fmt.Errorf("%w: no transitions defined for %s", ErrInvalidState, req.Status)
	}

	if !contains(allowed, input.NewStatus) {
		return nil, fmt.Errorf("%w: cannot go from %s to %s", ErrIllegalTransition, req.Status, input.NewStatus)
	}

	updated, err := m.repo.UpdateRequestStatus(ctx, input.RequestID, input.NewStatus, input.ExpectedVersion, input.ErrorCode, input.ErrorMessage)
	if err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	return updated, nil
}

func contains(slice []models.RequestStatus, val models.RequestStatus) bool {
	for _, s := range slice {
		if s == val {
			return true
		}
	}
	return false
}
