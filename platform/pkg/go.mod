module github.com/provisr/platform/pkg

go 1.25.5

require (
	github.com/aws/aws-sdk-go-v2 v1.26.0
	github.com/aws/aws-sdk-go-v2/service/eventbridge v1.30.0
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/hashicorp/vault/api v1.13.0
	github.com/jackc/pgx/v5 v5.5.5
	github.com/rs/zerolog v1.33.0
	go.opentelemetry.io/otel v1.26.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.26.0
	go.opentelemetry.io/otel/sdk v1.26.0
)