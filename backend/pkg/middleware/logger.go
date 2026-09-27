// Package middleware provides shared HTTP middleware for all Provisr backend
// services: structured zerolog setup, request/correlation id propagation, and
// panic recovery with a consistent error shape.
package middleware

import (
	"os"
	"strings"

	"github.com/rs/zerolog"
)

// New builds a zerolog logger writing JSON to stdout with timestamp and
// service fields. The level is controlled by the LOG_LEVEL environment
// variable (trace|debug|info|warn|error, default info). Services must use
// this constructor so log format and fields stay uniform across the fleet.
func New(service string) zerolog.Logger {
	level := zerolog.InfoLevel
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "trace":
		level = zerolog.TraceLevel
	case "debug":
		level = zerolog.DebugLevel
	case "info":
		level = zerolog.InfoLevel
	case "warn":
		level = zerolog.WarnLevel
	case "error":
		level = zerolog.ErrorLevel
	}
	return zerolog.New(os.Stdout).Level(level).With().Timestamp().Str("service", service).Logger()
}