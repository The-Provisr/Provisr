package statemachine

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

type mockRepo struct {
	getRequestFn   func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error)
	updateStatusFn func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error)
}

func (m *mockRepo) GetRequest(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
	return m.getRequestFn(ctx, id)
}

func (m *mockRepo) UpdateRequestStatus(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
	return m.updateStatusFn(ctx, id, s, v, ec, em)
}

func TestTransition_ReceivedToPendingAgent(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusReceived,
				StateVersion: 1,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    id,
				Status:       s,
				StateVersion: v + 1,
			}, nil
		},
	}

	m := New(mock)
	result, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: 1,
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != models.StatusPendingAgent {
		t.Fatalf("expected status PENDING_AGENT, got %s", result.Status)
	}
	if result.StateVersion != 2 {
		t.Fatalf("expected state_version 2, got %d", result.StateVersion)
	}
}

func TestTransition_FullHappyPath(t *testing.T) {
	requestID := uuid.New()
	currentVersion := 1

	transitions := []struct {
		from models.RequestStatus
		to   models.RequestStatus
	}{
		{models.StatusReceived, models.StatusPendingAgent},
		{models.StatusPendingAgent, models.StatusPolicyCheck},
		{models.StatusPolicyCheck, models.StatusPendingApproval},
		{models.StatusPendingApproval, models.StatusProvisioning},
		{models.StatusProvisioning, models.StatusLive},
	}

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.RequestStatus(""), // will be set per step
				StateVersion: currentVersion,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			currentVersion = v + 1
			return &models.ProvisioningRequest{
				RequestID:    id,
				Status:       s,
				StateVersion: currentVersion,
			}, nil
		},
	}

	m := New(mock)

	for _, step := range transitions {
		mock.getRequestFn = func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       step.from,
				StateVersion: currentVersion,
			}, nil
		}

		result, err := m.Transition(context.Background(), TransitionInput{
			RequestID:       requestID,
			NewStatus:       step.to,
			ExpectedVersion: currentVersion,
		})
		if err != nil {
			t.Fatalf("transition %s -> %s failed: %v", step.from, step.to, err)
		}
		if result.Status != step.to {
			t.Fatalf("expected %s, got %s after transition %s -> %s", step.to, result.Status, step.from, step.to)
		}
	}
}

func TestTransition_Illegal_ReceivedToLive(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusReceived,
				StateVersion: 1,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			t.Error("updateStatus should not be called for illegal transition")
			return nil, nil
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusLive,
		ExpectedVersion: 1,
	})

	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition, got %v", err)
	}
}

func TestTransition_Illegal_LiveToReceived(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusLive,
				StateVersion: 5,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			t.Error("updateStatus should not be called for illegal transition")
			return nil, nil
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusReceived,
		ExpectedVersion: 5,
	})

	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition, got %v", err)
	}
}

func TestTransition_Illegal_FailedToLive(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusFailed,
				StateVersion: 3,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			t.Error("updateStatus should not be called for illegal transition")
			return nil, nil
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusLive,
		ExpectedVersion: 3,
	})

	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition, got %v", err)
	}
}

func TestTransition_VersionConflict(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusReceived,
				StateVersion: 1,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			return nil, errors.New("update status: version conflict: request was modified by another process")
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: 2, // wrong version — repo returns conflict
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTransition_NotFound(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return nil, errors.New("fetch request: request not found")
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			t.Error("updateStatus should not be called when request is not found")
			return nil, nil
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: 1,
	})

	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestTransition_AbandonedIsTerminal(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusAbandoned,
				StateVersion: 4,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			t.Error("updateStatus should not be called for terminal state")
			return nil, nil
		},
	}

	m := New(mock)
	_, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: 4,
	})

	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("expected ErrIllegalTransition for terminal state, got %v", err)
	}
}

func TestTransition_Retry_FailedToPendingAgent(t *testing.T) {
	requestID := uuid.New()

	mock := &mockRepo{
		getRequestFn: func(ctx context.Context, id uuid.UUID) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    requestID,
				Status:       models.StatusFailed,
				StateVersion: 3,
			}, nil
		},
		updateStatusFn: func(ctx context.Context, id uuid.UUID, s models.RequestStatus, v int, ec, em *string) (*models.ProvisioningRequest, error) {
			return &models.ProvisioningRequest{
				RequestID:    id,
				Status:       s,
				StateVersion: v + 1,
			}, nil
		},
	}

	m := New(mock)
	result, err := m.Transition(context.Background(), TransitionInput{
		RequestID:       requestID,
		NewStatus:       models.StatusPendingAgent,
		ExpectedVersion: 3,
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Status != models.StatusPendingAgent {
		t.Fatalf("expected PENDING_AGENT, got %s", result.Status)
	}
	if result.StateVersion != 4 {
		t.Fatalf("expected state_version 4, got %d", result.StateVersion)
	}
}
