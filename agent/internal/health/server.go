// Package health expoe um servidor HTTP minimo com /health, /version e /metadata.
// Alem de servir para verificacoes de saude, o endpoint "/" retorna conteudo
// estatico minimo para que OUTROS probes possam medir HTTP/HTTPS contra este
// probe (spec 4.2).
package health

import (
	"encoding/json"
	"net/http"
	"time"
)

// MetadataProvider retorna o inventario mais recente do probe (pode ser nil).
type MetadataProvider func() interface{}

// Server agrega os handlers de saude.
type Server struct {
	probeID  string
	version  string
	metadata MetadataProvider
	started  time.Time
}

// New cria um servidor de saude.
func New(probeID, version string, metadata MetadataProvider) *Server {
	return &Server{
		probeID:  probeID,
		version:  version,
		metadata: metadata,
		started:  time.Now(),
	}
}

// Handler devolve o roteador HTTP.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/version", s.handleVersion)
	mux.HandleFunc("/metadata", s.handleMetadata)
	mux.HandleFunc("/", s.handleRoot)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":         "ok",
		"probe_id":       s.probeID,
		"uptime_seconds": int(time.Since(s.started).Seconds()),
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"agent_version": s.version,
		"probe_id":      s.probeID,
	})
}

func (s *Server) handleMetadata(w http.ResponseWriter, _ *http.Request) {
	var md interface{}
	if s.metadata != nil {
		md = s.metadata()
	}
	if md == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "inventario ainda nao coletado",
		})
		return
	}
	writeJSON(w, http.StatusOK, md)
}

func (s *Server) handleRoot(w http.ResponseWriter, _ *http.Request) {
	// Conteudo minimo e estatico: alvo para medicoes HTTP entre probes.
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ufsm-monitor-agent\n"))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
