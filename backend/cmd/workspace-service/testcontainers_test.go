//go:build testcontainers

package main

import (
	"context"

	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// startPostgresContainer boots an ephemeral postgres:16 for integration
// tests. Compiled only with `-tags testcontainers` so the testcontainers-go
// module is not a required dependency of normal builds (`go test ./...`).
func startPostgresContainer(ctx context.Context) (containerTestIface, error) {
	return postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("postgres"),
		postgres.WithUsername("provisr"),
		postgres.WithPassword("provisr"),
	)
}
