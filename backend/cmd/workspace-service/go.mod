module github.com/provisr/backend/cmd/workspace-service

go 1.23

require (
	github.com/google/uuid v1.6.0
	github.com/lib/pq v1.10.9
	github.com/provisr/backend v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace github.com/provisr/backend => ../../
