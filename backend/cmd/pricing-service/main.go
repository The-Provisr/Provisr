package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/provisr/backend/internal/pricing"
	"github.com/provisr/backend/pkg/middleware"
)

const defaultPort = "8091"

func main() {
	logger := middleware.New("pricing-service")
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		logger.Fatal().Msg("DATABASE_URL is required for the persistent pricing cache")
	}
	db, err := sql.Open("postgres", dbDSN)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to open pricing cache database")
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	bulkTTL, err := durationEnv("PRICING_BULK_CACHE_TTL", 24*time.Hour)
	if err != nil {
		logger.Fatal().Err(err).Msg("invalid bulk pricing cache TTL")
	}
	queryTTL, err := durationEnv("PRICING_ON_DEMAND_CACHE_TTL", time.Hour)
	if err != nil {
		logger.Fatal().Err(err).Msg("invalid on-demand pricing cache TTL")
	}
	service := pricing.NewService(pricing.Config{
		BulkTTL: bulkTTL, OnDemandTTL: queryTTL,
		GoogleAPIKey: os.Getenv("GCP_PRICING_API_KEY"),
		AWSAccessKey: os.Getenv("AWS_ACCESS_KEY_ID"),
		AWSSecretKey: os.Getenv("AWS_SECRET_ACCESS_KEY"),
		AWSSession:   os.Getenv("AWS_SESSION_TOKEN"),
		Cache:        pricing.PostgresCacheStore{DB: db},
	})
	srv := &http.Server{
		Addr: ":" + port, Handler: pricing.NewHandler(service, logger),
		ReadTimeout: 10 * time.Second, WriteTimeout: 2 * time.Minute, IdleTimeout: 30 * time.Second,
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		logger.Info().Str("port", port).Msg("pricing-service starting")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal().Err(err).Msg("pricing-service stopped unexpectedly")
		}
	}()
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error().Err(err).Msg("pricing-service shutdown error")
	}
}

func durationEnv(name string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(name)
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return 0, errors.New(name + " must be a positive duration")
	}
	return parsed, nil
}
