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
	"github.com/provisr/backend/internal/approval"
	"github.com/provisr/backend/pkg/middleware"
)

const defaultPort = "8084"

func main() {
	logger := middleware.New("approval-service")

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		logger.Fatal().Msg("DATABASE_URL is required")
	}

	token := os.Getenv("ORCHESTRATOR_SERVICE_TOKEN")
	if token == "" {
		logger.Warn().Msg("ORCHESTRATOR_SERVICE_TOKEN is not set; approval rule evaluation is disabled")
	}

	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open database connection")
	}
	defer func() { _ = db.Close() }()

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		logger.Warn().Err(err).Msg("warning: database ping failed at startup, will retry on requests")
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      middleware.RequestLogger(logger, middleware.Recover(logger, approval.New(db, logger, token))),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		logger.Info().Str("port", port).Msg("approval-service starting")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal().Err(err).Msg("approval-service stopped unexpectedly")
		}
	}()

	<-stop
	logger.Info().Msg("shutting down approval-service gracefully")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("server shutdown error")
	}
	logger.Info().Msg("approval-service stopped")
}
