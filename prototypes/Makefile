BIN  := bin
CMDS := icmp iperf3 dns http traceroute sysinfo

# Cross-compile: Raspberry Pi 3/4 64-bit = arm64 ; Pi Zero/1/2 32-bit = arm/GOARM=7
ARM64 := GOOS=linux GOARCH=arm64
ARMV7 := GOOS=linux GOARCH=arm GOARM=7

.PHONY: all build fmt vet tidy clean $(CMDS) build-arm64 build-armv7

all: build

build: $(CMDS)

$(CMDS):
	@mkdir -p $(BIN)
	go build -o $(BIN)/$@ ./cmd/$@

build-arm64:
	@mkdir -p $(BIN)/arm64
	@for c in $(CMDS); do $(ARM64) go build -o $(BIN)/arm64/$$c ./cmd/$$c; done

build-armv7:
	@mkdir -p $(BIN)/armv7
	@for c in $(CMDS); do $(ARMV7) go build -o $(BIN)/armv7/$$c ./cmd/$$c; done

fmt:
	gofmt -w .

vet:
	go vet ./...

tidy:
	go mod tidy

clean:
	rm -rf $(BIN)
