package statebackend

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/provisr/backend/pkg/cloudcrypto"
)

type Ensurer interface {
	Ensure(context.Context, Request) (*Result, error)
}

// New mounts only the private ensure route; missing service token fails closed.
// No route reads, lists or downloads state: state is provisioner-managed only.
func New(db *sql.DB, master cloudcrypto.MasterKey, token string) http.Handler {
	return NewHandler(NewManager(db, master, nil), token)
}

func NewHandler(ensurer Ensurer, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/state-backends/ensure", func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			write(w, 401, &Failure{Code: "unauthorized", Message: "Service authorization required"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var input Request
		d := json.NewDecoder(r.Body)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF || !validRequest(&input) {
			write(w, 400, &Failure{Code: "invalid_request", Message: "Valid provider and complete idempotent context required"})
			return
		}
		result, err := ensurer.Ensure(r.Context(), input)
		if err != nil {
			var failure *Failure
			if errors.As(err, &failure) {
				write(w, failure.Status, failure)
			} else {
				write(w, 503, &Failure{Code: "unavailable", Message: "State backend management unavailable"})
			}
			return
		}
		write(w, 200, result)
	})
	return mux
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
