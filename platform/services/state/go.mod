module github.com/provisr/platform/services/state

go 1.25.5

require (
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0
	github.com/provisr/platform/proto v0.0.0
	github.com/rs/zerolog v1.33.0
	google.golang.org/grpc v1.63.2
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
	github.com/provisr/platform/proto => ../../proto
)