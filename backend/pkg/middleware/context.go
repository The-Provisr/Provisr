package middleware

import "context"

type contextKey string

const (
	requestIDKey     contextKey = "request_id"
	correlationIDKey contextKey = "correlation_id"
)

// RequestID returns the request id attached to the context by RequestLogger,
// or "" when absent.
func RequestID(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

// CorrelationID returns the correlation id attached to the context by
// RequestLogger, or "" when absent. RequestLogger always populates it, so
// callers inside the request scope can rely on a non-empty value.
func CorrelationID(ctx context.Context) string {
	if v, ok := ctx.Value(correlationIDKey).(string); ok {
		return v
	}
	return ""
}