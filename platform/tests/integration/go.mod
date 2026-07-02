module github.com/provisr/platform/tests/integration

go 1.25.5

require (
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0
	github.com/stretchr/testify v1.9.0
	github.com/testcontainers/testcontainers-go v0.30.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)