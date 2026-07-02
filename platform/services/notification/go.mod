module github.com/provisr/platform/services/notification

go 1.25.5

require (
	github.com/aws/aws-sdk-go-v2/service/eventbridge v1.30.0
	github.com/provisr/platform/pkg v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)