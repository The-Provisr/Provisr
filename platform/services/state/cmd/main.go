package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

type Config struct {
	ServiceName string `json:"service_name"`
	Port        string `json:"port"`
	Environment string `json:"environment"`
}

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})

	appConfig := Config{
		ServiceName: "state",
		Port:        "8080",
		Environment: "development",
	}

	configFile, err := os.ReadFile("config.json")
	if err == nil {
		if parseErr := json.Unmarshal(configFile, &appConfig); parseErr != nil {
			log.Warn().Err(parseErr).Msg("Config file found but malformed; using defaults")
		} else {
			log.Info().Msg("Successfully loaded configurations from config.json")
		}
	} else {
		log.Info().Msg("No config.json found; relying on environment defaults")
	}

	log.Info().
		Str("service", appConfig.ServiceName).
		Str("port", appConfig.Port).
		Str("env", appConfig.Environment).
		Msg("Initializing stub HTTP server")

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"healthy","service":"` + appConfig.ServiceName + `"}`))
	})

	srv := &http.Server{
		Addr:         ":" + appConfig.Port,
		Handler:      r,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Info().Str("addr", srv.Addr).Msg("Server listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		log.Fatal().Err(err).Msg("Server encountered a fatal error during startup")
	case sig := <-shutdown:
		log.Info().Str("signal", sig.String()).Msg("Graceful shutdown initiated")
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			_ = srv.Close()
		}
		log.Info().Msg("Server exiting cleanly")
	}
}
