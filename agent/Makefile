BIN := bin
APP := ufsm-monitor-agent
PKG := ./cmd/ufsm-monitor-agent

ARM64 := GOOS=linux GOARCH=arm64
ARMV7 := GOOS=linux GOARCH=arm GOARM=7

.PHONY: all deps build build-arm64 build-armv7 fmt vet test tidy clean

all: build

# Baixa e fixa as dependências (modernc.org/sqlite). Precisa de rede — rode uma vez.
deps:
	go mod tidy

build:
	@mkdir -p $(BIN)
	go build -o $(BIN)/$(APP) $(PKG)

# Cross-compile para Raspberry Pi (modernc.org/sqlite é Go puro: CGO_ENABLED=0).
build-arm64:
	@mkdir -p $(BIN)/arm64
	CGO_ENABLED=0 $(ARM64) go build -o $(BIN)/arm64/$(APP) $(PKG)

build-armv7:
	@mkdir -p $(BIN)/armv7
	CGO_ENABLED=0 $(ARMV7) go build -o $(BIN)/armv7/$(APP) $(PKG)

fmt:
	gofmt -w .

vet:
	go vet ./...

test:
	go test ./...

tidy:
	go mod tidy

clean:
	rm -rf $(BIN)
