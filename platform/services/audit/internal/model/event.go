package model

// CreateEventRequest is the JSON body for POST /v1/audit/events.
// All time.Time fields use RFC3339 format for JSON.
type CreateEventRequest struct {
	OrgID             string `json:"org_id"`
	EventType         string `json:"event_type"`
	EventSeverity     string `json:"event_severity"`
	ActorType         string `json:"actor_type"`
	ActorID           string `json:"actor_id,omitempty"`
	ActorRoleSnapshot string `json:"actor_role_snapshot,omitempty"`
	ActorIP           string `json:"actor_ip,omitempty"`
	ActorUserAgent    string `json:"actor_user_agent,omitempty"`
	RequestID         string `json:"request_id,omitempty"`
	ResourceID        string `json:"resource_id,omitempty"`
	SubjectType       string `json:"subject_type,omitempty"`
	SubjectID         string `json:"subject_id,omitempty"`
	Action            string `json:"action"`
	Outcome           string `json:"outcome"`
	Reason            string `json:"reason,omitempty"`
	FromState         string `json:"from_state,omitempty"`
	ToState           string `json:"to_state,omitempty"`
	ToolName          string `json:"tool_name,omitempty"`
	PolicyViolations  any    `json:"policy_violations,omitempty"`
	ManifestHash      string `json:"manifest_hash,omitempty"`
	TraceID           string `json:"trace_id,omitempty"`
	SpanID            string `json:"span_id,omitempty"`
	CorrelationID     string `json:"correlation_id,omitempty"`
	SourceService     string `json:"source_service"`
	SourceVersion     string `json:"source_version,omitempty"`
	Metadata          any    `json:"metadata,omitempty"`
}

// CreateEventResponse is returned on successful insert.
type CreateEventResponse struct {
	EventID   string `json:"event_id"`
	EventHash string `json:"event_hash"`
	CreatedAt string `json:"created_at"`
}

// ValidationError is returned when required fields are missing.
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ErrorResponse wraps validation errors for the API response.
type ErrorResponse struct {
	Errors []ValidationError `json:"errors"`
}
