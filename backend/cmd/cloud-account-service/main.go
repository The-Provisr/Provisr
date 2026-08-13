package main

import (
	"database/sql"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
	"github.com/provisr/backend/internal/cloudaccount"
	"github.com/provisr/backend/pkg/cloudcrypto"
	"github.com/rs/zerolog"
)

const defaultPort = "8089"

func main() {
	logger := zerolog.New(os.Stdout).With().Timestamp().Str("service", "cloud-account-service").Logger()

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

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      cloudaccount.New(db, logger, master),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	logger.Info().Str("port", port).Msg("cloud-account-service starting")
	if err := srv.ListenAndServe(); err != nil {
		logger.Fatal().Err(err).Msg("server stopped")
	}
}
