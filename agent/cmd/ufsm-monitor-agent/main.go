// Comando ufsm-monitor-agent: o agente homogeneo executado em cada probe.
//
// Subcomandos:
//
//	serve       inicia o servico (health server + inventario + spool de tarefas)
//	run-task F  executa uma unica tarefa a partir do arquivo JSON F e imprime o resultado
//	inventory   coleta e imprime o inventario local
//	version     imprime a versao
//
// Fase 2: as tarefas chegam por um diretorio-spool local (TASKS_DIR). Na Fase 3
// esse spool sera substituido por um consumidor RabbitMQ; o restante do fluxo
// (executar -> persistir no SQLite -> publicar) permanece igual.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/config"
	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/health"
	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/measure"
	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/model"
	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/outbox"
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	cmd := "serve"
	if len(os.Args) >= 2 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		if err := serve(); err != nil {
			log.Fatal(err)
		}
	case "run-task":
		if len(os.Args) < 3 {
			log.Fatal("uso: ufsm-monitor-agent run-task <arquivo.json>")
		}
		if err := runTaskFile(os.Args[2]); err != nil {
			log.Fatal(err)
		}
	case "inventory":
		if err := printInventory(); err != nil {
			log.Fatal(err)
		}
	case "version":
		fmt.Println("ufsm-monitor-agent", measure.AgentVersion)
	default:
		fmt.Fprintf(os.Stderr, "comando desconhecido: %s\nuso: serve | run-task <arquivo> | inventory | version\n", cmd)
		os.Exit(2)
	}
}

// serve inicia o agente como servico de longa duracao.
func serve() error {
	cfg := config.Load()
	probeID, err := cfg.EnsureProbeID()
	if err != nil {
		return fmt.Errorf("identidade do probe: %w", err)
	}
	log.Printf("iniciando agente probe_id=%s versao=%s", probeID, measure.AgentVersion)

	_ = os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755)
	for _, d := range []string{cfg.TasksDir, filepath.Join(cfg.TasksDir, "done"), filepath.Join(cfg.TasksDir, "failed")} {
		_ = os.MkdirAll(d, 0o755)
	}

	ob, err := outbox.Open(cfg.SQLitePath)
	if err != nil {
		return fmt.Errorf("abrir outbox: %w", err)
	}
	defer ob.Close()

	inv := &inventoryStore{}
	inv.update(collectInventory(cfg, probeID, ob))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var wg sync.WaitGroup

	// Loop de inventario.
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(cfg.InventoryInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				inv.update(collectInventory(cfg, probeID, ob))
			}
		}
	}()

	// Watcher do spool de tarefas locais.
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(3 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				processSpool(ctx, cfg, probeID, ob)
			}
		}
	}()

	// Servidor de saude.
	srv := &http.Server{
		Addr: cfg.HealthAddr,
		Handler: health.New(probeID, measure.AgentVersion, func() interface{} {
			return inv.get()
		}).Handler(),
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-ctx.Done()
		shCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shCtx)
	}()

	log.Printf("servidor de saude em %s ; spool de tarefas em %s", cfg.HealthAddr, cfg.TasksDir)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		stop()
		wg.Wait()
		return fmt.Errorf("servidor de saude: %w", err)
	}
	wg.Wait()
	log.Printf("agente encerrado")
	return nil
}

// inventoryStore guarda o ultimo inventario de forma segura para concorrencia.
type inventoryStore struct {
	mu   sync.RWMutex
	last interface{}
}

func (s *inventoryStore) update(v interface{}) {
	s.mu.Lock()
	s.last = v
	s.mu.Unlock()
}

func (s *inventoryStore) get() interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.last
}

// collectInventory coleta o inventario, persiste (outbox + agent_state) e o devolve.
func collectInventory(cfg config.Config, probeID string, ob *outbox.DB) interface{} {
	started := time.Now()
	r := measure.Sysinfo(context.Background(), cfg.Deployment, cfg.VLAN)
	env := model.New(probeID, measure.KindSysinfo, "", started)
	env.Result = r.Payload
	env.Raw = r.Raw
	env.Finish(r.Status, r.ErrMsg)
	if err := ob.SaveResult(env); err != nil {
		log.Printf("inventario: salvar na outbox: %v", err)
	}
	if data, err := json.Marshal(r.Payload); err == nil {
		_ = ob.SetState("last_inventory", string(data))
	}
	return r.Payload
}

// processSpool varre o diretorio de tarefas e executa as pendentes.
func processSpool(ctx context.Context, cfg config.Config, probeID string, ob *outbox.DB) {
	files, _ := filepath.Glob(filepath.Join(cfg.TasksDir, "*.json"))
	for _, f := range files {
		if ctx.Err() != nil {
			return
		}
		done, err := handleTaskFile(ctx, f, probeID, ob)
		switch {
		case err != nil:
			log.Printf("tarefa %s: %v", filepath.Base(f), err)
			moveTo(f, filepath.Join(cfg.TasksDir, "failed"))
		case done:
			moveTo(f, filepath.Join(cfg.TasksDir, "done"))
		}
	}
}

// handleTaskFile le, valida e executa um arquivo de tarefa.
// Retorna done=false (sem erro) quando a tarefa ainda nao deve rodar (not_before).
func handleTaskFile(ctx context.Context, path, probeID string, ob *outbox.DB) (done bool, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	var t model.Task
	if err := json.Unmarshal(data, &t); err != nil {
		return true, fmt.Errorf("json invalido: %w", err)
	}
	if t.TooEarly(time.Now()) {
		return false, nil // deixa para um proximo ciclo
	}
	env, err := executeTask(ctx, &t, probeID, ob)
	if err != nil {
		return true, err
	}
	log.Printf("executada task_id=%s tipo=%s status=%s run_id=%s", t.TaskID, t.Type, env.Status, env.RunID)
	return true, nil
}

// executeTask executa uma tarefa e persiste o resultado na outbox.
// Fluxo (spec 8/9): validar -> enfileirar -> marcar running -> medir ->
// persistir no SQLite (antes de qualquer publicacao).
func executeTask(ctx context.Context, t *model.Task, probeID string, ob *outbox.DB) (*model.Envelope, error) {
	if t.Type == "" {
		return nil, errors.New("tarefa sem tipo")
	}
	now := time.Now()
	if t.Expired(now) {
		_ = ob.RecordFailure(t.TaskID, "tarefa expirada")
		return nil, fmt.Errorf("tarefa expirada (expires_at=%s)", t.ExpiresAt.Format(time.RFC3339))
	}

	_ = ob.EnqueueTask(t)
	_ = ob.MarkRunning(t.TaskID)

	started := time.Now()
	r := measure.Run(ctx, t)

	env := model.New(probeID, t.Type, t.Target, started)
	env.TaskID = t.TaskID
	env.PlanID = t.PlanID
	env.PlanRevision = t.PlanRevision
	env.JobID = t.JobID
	env.TargetProbe = t.TargetProbe
	env.Result = r.Payload
	env.Raw = r.Raw
	env.Finish(r.Status, r.ErrMsg)

	if err := ob.SaveResult(env); err != nil {
		return env, fmt.Errorf("salvar resultado: %w", err)
	}
	return env, nil
}

// runTaskFile executa uma unica tarefa (subcomando run-task) e imprime o envelope.
func runTaskFile(path string) error {
	cfg := config.Load()
	probeID, err := cfg.EnsureProbeID()
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755)
	ob, err := outbox.Open(cfg.SQLitePath)
	if err != nil {
		return err
	}
	defer ob.Close()

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var t model.Task
	if err := json.Unmarshal(data, &t); err != nil {
		return fmt.Errorf("json invalido: %w", err)
	}

	env, execErr := executeTask(context.Background(), &t, probeID, ob)
	if env != nil {
		if out, err := env.JSON(); err == nil {
			fmt.Println(string(out))
		}
	}
	return execErr
}

// printInventory coleta e imprime o inventario local (subcomando inventory).
func printInventory() error {
	cfg := config.Load()
	probeID, err := cfg.EnsureProbeID()
	if err != nil {
		return err
	}
	started := time.Now()
	r := measure.Sysinfo(context.Background(), cfg.Deployment, cfg.VLAN)
	env := model.New(probeID, measure.KindSysinfo, "", started)
	env.Result = r.Payload
	env.Finish(r.Status, r.ErrMsg)
	out, err := env.JSON()
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func moveTo(path, dir string) {
	dst := filepath.Join(dir, filepath.Base(path))
	if err := os.Rename(path, dst); err != nil {
		log.Printf("mover %s -> %s: %v", filepath.Base(path), dir, err)
	}
}
