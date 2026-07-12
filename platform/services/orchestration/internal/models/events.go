package models

import (
	"time"

	"github.com/google/uuid"
)

type StateChangedEvent struct {
	EventID        uuid.UUID     `json:"event_id"`
	RequestID      uuid.UUID     `json:"request_id"`
	OrgID          uuid.UUID     `json:"org_id"`
	PreviousStatus RequestStatus `json:"previous_status"`
	NewStatus      RequestStatus `json:"new_status"`
	StateVersion   int           `json:"state_version"`
	Actor          string        `json:"actor"`
	Timestamp      time.Time     `json:"timestamp"`
	CorrelationID  string        `json:"correlation_id"`
}
