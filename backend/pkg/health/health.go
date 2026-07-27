package health

import "net/http"

// Handler returns an HTTP handler that responds with service health.
func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", live)
	mux.HandleFunc("/health/ready", ready)
	return mux
}

func live(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func ready(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}