package main

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"

	"github.com/provisr/backend/internal/statebackend"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/provisr/backend/pkg/health"
	"github.com/provisr/backend/pkg/middleware"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	logger := middleware.New("provisioning-service")

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		logger.Fatal().Msg("DATABASE_URL is required")
	}
	// Decrypts delegated cloud identity metadata; never logged or returned.
	master, err := cloudcrypto.ParseMasterKey(os.Getenv("CLOUD_ACCOUNT_MASTER_KEY"))
	if err != nil {
		logger.Fatal().Msg("CLOUD_ACCOUNT_MASTER_KEY must be a valid master key")
	}

	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open database connection")
	}
	defer func() {
		if err := db.Close(); err != nil {
			logger.Error().Err(err).Msg("failed to close database connection")
		}
	}()

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	pingCtx, cancelPing := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelPing()
	if err := db.PingContext(pingCtx); err != nil {
		logger.Warn().Err(err).Msg("warning: database ping failed at startup, will retry on requests")
	}

	mux := http.NewServeMux()
	mux.Handle("/health/", health.Handler())
	mux.Handle("/v1/state-backends/", statebackend.New(db, master, os.Getenv("ORCHESTRATOR_SERVICE_TOKEN")))

	srv := &http.Server{
		Addr:        ":" + port,
		Handler:     middleware.RequestLogger(logger, middleware.Recover(logger, mux)),
		ReadTimeout: 10 * time.Second,
		// First-run bucket and lock table creation can take tens of seconds.
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		logger.Info().Str("port", port).Msg("provisioning-service starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal().Err(err).Msg("provisioning-service stopped unexpectedly")
		}
	}()

	<-stop
	logger.Info().Msg("shutting down provisioning-service gracefully")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("server shutdown error")
	}
	logger.Info().Msg("provisioning-service stopped")
}
