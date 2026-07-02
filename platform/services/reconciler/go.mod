module github.com/provisr/platform/services/reconciler

go 1.25.5

require (
	github.com/aws/aws-sdk-go-v2/service/sqs v1.31.0
	github.com/jackc/pgx/v5 v5.5.5
	github.com/provisr/platform/pkg v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)