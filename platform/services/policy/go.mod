module github.com/provisr/platform/services/policy

go 1.25.5

require (
	github.com/go-chi/chi/v5 v5.0.12
	github.com/open-policy-agent/opa v0.64.1
	github.com/provisr/platform/pkg v0.0.0
	github.com/rs/zerolog v1.33.0
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
)