package main

import (
	"database/sql"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	"github.com/provisr/backend/internal/manifest"
	"github.com/provisr/backend/pkg/middleware"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	logger := middleware.New("state-service")

	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		logger.Fatal().Err(err).Msg("database initialization failed")
	}
	defer db.Close()
	token := os.Getenv("ORCHESTRATOR_SERVICE_TOKEN")
	if token == "" {
		logger.Fatal().Msg("ORCHESTRATOR_SERVICE_TOKEN is required")
	}
	mcpURL := os.Getenv("MCP_URL")
	if mcpURL == "" {
		mcpURL = "http://localhost:5100"
	}
	handler := manifest.NewDraftHandler(db, &http.Client{Timeout: 15 * time.Second}, mcpURL, token)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      middleware.RequestLogger(logger, middleware.Recover(logger, handler)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 35 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("state-service starting")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal().Err(err).Msg("state-service stopped unexpectedly")
	}
}
