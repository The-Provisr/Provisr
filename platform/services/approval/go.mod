module github.com/provisr/platform/services/approval

go 1.25.5

require (
	github.com/aws/aws-sdk-go-v2/service/ses v1.22.0
	github.com/go-chi/chi/v5 v5.0.12
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)