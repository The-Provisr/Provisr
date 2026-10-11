package middleware

import (
	"net/http"

	"github.com/rs/zerolog"
)

// Recover converts panics into a 500 response with the shared
// {error, message, status} shape and logs the panic with request context.
func Recover(base zerolog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				zerolog.Ctx(r.Context()).Error().Interface("panic", rec).Str("path", r.URL.Path).Msg("panic recovered")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"internal_error","message":"unexpected server error","status":500}`))
			}
		}()
		next.ServeHTTP(w, r)
	})
}