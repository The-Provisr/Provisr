package pricing

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/provisr/backend/pkg/health"
	"github.com/rs/zerolog"
)

const maxRequestBody = 1 << 20

type server struct {
	service *Service
	log     zerolog.Logger
}

func NewHandler(service *Service, log zerolog.Logger) http.Handler {
	s := &server{service: service, log: log}
	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	mux.HandleFunc("POST /v1/pricing/lookup", s.lookup)
	return mux
}

func (s *server) lookup(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request LookupRequest
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid pricing lookup request")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request must contain one JSON object")
		return
	}
	request.Provider = strings.ToLower(strings.TrimSpace(request.Provider))
	price, err := s.service.Lookup(r.Context(), request)
	if err != nil {
		s.log.Warn().Err(err).
			Str("request_id", r.Header.Get("X-Request-ID")).
			Str("correlation_id", r.Header.Get("X-Correlation-ID")).
			Str("provider", request.Provider).
			Msg("provider price lookup failed")
		switch {
		case errors.Is(err, ErrNotFound):
			writeError(w, http.StatusNotFound, "no matching price was found")
		case errors.Is(err, ErrUnavailable):
			writeError(w, http.StatusBadGateway, "pricing provider is unavailable and no cached price exists")
		default:
			writeError(w, http.StatusBadRequest, "invalid pricing lookup request")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(price)
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
