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
	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/provisr/backend/pkg/middleware"
)

const defaultPort = "8089"

func main() {
	logger := middleware.New("cloud-account-service")

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		logger.Fatal().Msg("DATABASE_URL is required")
	}

	masterKeyHex := os.Getenv("CLOUD_ACCOUNT_MASTER_KEY")
	if masterKeyHex == "" {
		logger.Fatal().Msg("CLOUD_ACCOUNT_MASTER_KEY is required (64 hex characters)")
	}
	master, err := cloudcrypto.ParseMasterKey(masterKeyHex)
	if err != nil {
		logger.Fatal().Err(err).Msg("invalid CLOUD_ACCOUNT_MASTER_KEY")
	}

	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open database connection")
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		logger.Fatal().Err(err).Msg("failed to ping database")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	capabilities := cloudaccount.NewStoredCapabilities(db, master, os.Getenv("ORCHESTRATOR_SERVICE_TOKEN"))
	go cloudaccount.RunCapabilityRefresh(ctx, db, capabilities)
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      cloudaccount.NewWithCapabilities(db, logger, master, capabilities),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("cloud-account-service starting")
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal().Err(err).Msg("server stopped")
	}
}
