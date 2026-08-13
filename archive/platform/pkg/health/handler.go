package health

import (
	"encoding/json"
	"net/http"
)

// Response standardizes the health check output
type Response struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// Handler returns an HTTP handler pre-configured with the service name
func Handler(serviceName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		_ = json.NewEncoder(w).Encode(Response{
			Status:  "healthy",
			Service: serviceName,
		})
	}
}
