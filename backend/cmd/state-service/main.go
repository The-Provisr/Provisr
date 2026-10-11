package main

import (
	"net/http"
	"os"
	"time"

	"github.com/provisr/backend/pkg/health"
	"github.com/provisr/backend/pkg/middleware"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	logger := middleware.New("state-service")

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      middleware.RequestLogger(logger, middleware.Recover(logger, mux)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("state-service starting")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal().Err(err).Msg("state-service stopped unexpectedly")
	}
}