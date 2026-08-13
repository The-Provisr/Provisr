package events

import (
	"context"

	"github.com/provisr/platform/services/orchestration/internal/models"
)

type Publisher interface {
	PublishStateChanged(ctx context.Context, event models.StateChangedEvent) error
	Close() error
}
