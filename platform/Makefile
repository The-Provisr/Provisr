GO_MODULES := \
	pkg \
	proto \
	tests/integration

GO_SERVICES := \
	services/approval \
	services/audit \
	services/notification \
	services/orchestration \
	services/policy \
	services/provisioning \
	services/reconciler \
	services/state

export GOCACHE ?= /tmp/provisr-go-build-cache
BUILD_DIR ?= /tmp/provisr-build

.PHONY: build test tidy

build:
	@mkdir -p $(BUILD_DIR)
	@for module in $(GO_MODULES); do \
		echo "==> building $$module"; \
		(cd $$module && packages=$$(go list ./... 2>/dev/null); \
			if [ -n "$$packages" ]; then go build $$packages; else echo "no packages to build"; fi); \
	done
	@for module in $(GO_SERVICES); do \
		name=$$(basename $$module); \
		echo "==> building $$module"; \
		(cd $$module && go build -o $(BUILD_DIR)/$$name ./cmd); \
	done

test:
	@for module in $(GO_MODULES); do \
		echo "==> testing $$module"; \
		(cd $$module && packages=$$(go list ./... 2>/dev/null); \
			if [ -n "$$packages" ]; then go test $$packages; else echo "no packages to test"; fi); \
	done
	@for module in $(GO_SERVICES); do \
		echo "==> testing $$module"; \
		(cd $$module && go test ./...); \
	done

tidy:
	@for module in $(GO_MODULES); do \
		echo "==> tidying $$module"; \
		(cd $$module && go mod tidy); \
	done
	@for module in $(GO_SERVICES); do \
		echo "==> tidying $$module"; \
		(cd $$module && go mod tidy); \
	done
