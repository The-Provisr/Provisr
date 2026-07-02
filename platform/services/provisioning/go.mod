module github.com/provisr/platform/services/provisioning

go 1.25.5

require (
	github.com/go-chi/chi/v5 v5.0.12
	github.com/rs/zerolog v1.33.0
)

require (
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	golang.org/x/sys v0.19.0 // indirect
)

replace (
	github.com/provisr/platform/pkg => ../../pkg
	github.com/provisr/platform/proto => ../../proto
)
