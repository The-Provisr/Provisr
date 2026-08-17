//go:build testcontainers

package main

import (
	"context"

	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

type postgresContainerWrapper struct {
	*postgres.PostgresContainer
}

func (p *postgresContainerWrapper) Terminate(ctx context.Context) error {
	return p.PostgresContainer.Terminate(ctx)
}

// startPostgresContainer boots an ephemeral postgres:16 for integration
// tests. Compiled only with `-tags testcontainers` so the testcontainers-go
// module is not a required dependency of normal builds (`go test ./...`).
func startPostgresContainer(ctx context.Context) (containerTestIface, error) {
	c, err := postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("postgres"),
		postgres.WithUsername("provisr"),
		postgres.WithPassword("provisr"),
	)
	if err != nil {
		return nil, err
	}
	return &postgresContainerWrapper{PostgresContainer: c}, nil
}
