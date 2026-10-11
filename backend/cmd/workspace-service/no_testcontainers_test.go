//go:build !testcontainers

package main

import (
	"context"
	"fmt"
)

// Without the `testcontainers` build tag there is no container provider;
// startPostgresContainer reports failure so the suite skips.
func startPostgresContainer(ctx context.Context) (containerTestIface, error) {
	return nil, fmt.Errorf("testcontainers build tag not enabled (use -tags testcontainers)")
}
