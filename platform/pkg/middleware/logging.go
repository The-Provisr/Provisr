package middleware

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/trace"
)

// StructuredLogger intercepts the request to log performance metrics and OTEL trace IDs
func StructuredLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()

		next.ServeHTTP(ww, r)

		// Extract the OpenTelemetry trace ID from the request context if it exists
		span := trace.SpanFromContext(r.Context())
		traceID := span.SpanContext().TraceID().String()

		log.Info().
			Str("method", r.Method).
			Str("url", r.URL.Path).
			Int("status", ww.Status()).
			Dur("latency", time.Since(start)).
			Str("trace_id", traceID).
			Str("ip", r.RemoteAddr).
			Msg("HTTP Request")
	})
}
