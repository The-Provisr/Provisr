module github.com/provisr/platform/services/audit

go 1.25.5

require (
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)