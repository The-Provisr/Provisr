module github.com/provisr/platform/services/audit

go 1.25.5

require (
	github.com/go-chi/chi/v5 v5.0.12
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0-00010101000000-000000000000
	github.com/rs/zerolog v1.33.0
)

require (
	github.com/golang-jwt/jwt/v5 v5.2.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20221227161230-091c0ba34f0a // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	go.opentelemetry.io/otel v1.26.0 // indirect
	go.opentelemetry.io/otel/trace v1.26.0 // indirect
	golang.org/x/crypto v0.17.0 // indirect
	golang.org/x/sync v0.1.0 // indirect
	golang.org/x/sys v0.19.0 // indirect
	golang.org/x/text v0.14.0 // indirect
)

replace github.com/provisr/platform/pkg => ../../pkg
