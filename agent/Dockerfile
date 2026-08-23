# Imagem do agente (probe) para DEMO local em Docker.
# Em produção, o agente roda como binário Go + systemd nos Raspberry Pi
# (make build-arm64), sem Docker.
#
# --- build ---
FROM golang:1.25-bookworm AS build
# permite baixar automaticamente a toolchain exigida pelo go.mod (>= 1.25)
ENV GOTOOLCHAIN=auto
WORKDIR /src
COPY . .
# go mod tidy garante as dependências (modernc.org/sqlite, amqp091-go, miekg/dns)
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /out/ufsm-monitor-agent ./cmd/ufsm-monitor-agent

# --- runtime ---
FROM debian:bookworm-slim
# Ferramentas de medição usadas pelo executor + servidor iperf3
RUN apt-get update && apt-get install -y --no-install-recommends \
      fping iperf3 dnsutils mtr-tiny ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ufsm-monitor-agent /usr/local/bin/ufsm-monitor-agent
ENTRYPOINT ["ufsm-monitor-agent"]
CMD ["serve"]
