// Package broker encapsula a comunicacao com o RabbitMQ (AMQP 0-9-1).
//
// Topologia (spec 8):
//
//	Exchange monitor.commands (topic)  ->  probe.<id>.command  ->  fila probe.<id>.commands
//	Exchange monitor.results  (topic)  ->  result.<tipo>       ->  fila monitor.ingestion.results
//	Exchange monitor.events   (topic)  ->  event.<id>.<evento>
//
// Confiabilidade: o canal usa publisher confirms (spec 8). Cada publicacao
// aguarda o confirm do broker antes de o chamador remover o item da outbox.
package broker

import (
	"context"
	"errors"
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	ExchangeCommands = "monitor.commands"
	ExchangeResults  = "monitor.results"
	ExchangeEvents   = "monitor.events"

	QueueResults = "monitor.ingestion.results"
)

// Conn e uma conexao AMQP com um canal em modo confirm.
type Conn struct {
	conn     *amqp.Connection
	ch       *amqp.Channel
	confirms chan amqp.Confirmation
}

// Dial conecta ao broker, abre um canal em modo confirm e declara as exchanges.
func Dial(url string) (*Conn, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, err
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := ch.Confirm(false); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, err
	}
	c := &Conn{
		conn:     conn,
		ch:       ch,
		confirms: ch.NotifyPublish(make(chan amqp.Confirmation, 1)),
	}
	if err := c.declareExchanges(); err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}

// Close fecha canal e conexao.
func (c *Conn) Close() {
	if c.ch != nil {
		_ = c.ch.Close()
	}
	if c.conn != nil {
		_ = c.conn.Close()
	}
}

func (c *Conn) declareExchanges() error {
	for _, ex := range []string{ExchangeCommands, ExchangeResults, ExchangeEvents} {
		if err := c.ch.ExchangeDeclare(ex, "topic", true, false, false, false, nil); err != nil {
			return err
		}
	}
	return nil
}

// DeclareCommandQueue declara (idempotente) a fila de comandos de um probe e a
// vincula a exchange de comandos.
func (c *Conn) DeclareCommandQueue(probeID string) (string, error) {
	name := "probe." + probeID + ".commands"
	if _, err := c.ch.QueueDeclare(name, true, false, false, false, nil); err != nil {
		return "", err
	}
	if err := c.ch.QueueBind(name, "probe."+probeID+".command", ExchangeCommands, false, nil); err != nil {
		return "", err
	}
	return name, nil
}

// DeclareResultsQueue declara a fila duravel de ingestao de resultados. Declarada
// tambem pelo publicador do agente para que nenhum resultado se perca caso a
// ingestao esteja fora do ar (fica retido na fila ate ser consumido).
func (c *Conn) DeclareResultsQueue() (string, error) {
	if _, err := c.ch.QueueDeclare(QueueResults, true, false, false, false, nil); err != nil {
		return "", err
	}
	if err := c.ch.QueueBind(QueueResults, "result.#", ExchangeResults, false, nil); err != nil {
		return "", err
	}
	return QueueResults, nil
}

// publish envia uma mensagem persistente e AGUARDA o publisher confirm.
// Como cada Conn e usada por uma unica goroutine, as publicacoes sao
// sequenciais e os confirms casam 1:1.
func (c *Conn) publish(exchange, key string, body []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := c.ch.PublishWithContext(ctx, exchange, key, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now(),
		Body:         body,
	}); err != nil {
		return err
	}
	select {
	case confirm, ok := <-c.confirms:
		if !ok {
			return errors.New("canal de confirms fechado (conexao caiu)")
		}
		if !confirm.Ack {
			return errors.New("publicacao recusada pelo broker (nack)")
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("timeout aguardando confirm: %w", ctx.Err())
	}
}

// PublishResult publica um envelope de resultado (routing key result.<tipo>).
func (c *Conn) PublishResult(kind string, body []byte) error {
	return c.publish(ExchangeResults, "result."+kind, body)
}

// PublishCommand publica uma tarefa na fila de comandos de um probe (uso de teste).
func (c *Conn) PublishCommand(probeID string, body []byte) error {
	return c.publish(ExchangeCommands, "probe."+probeID+".command", body)
}

// PublishEvent publica um evento (ex.: heartbeat) do probe.
func (c *Conn) PublishEvent(probeID, event string, body []byte) error {
	return c.publish(ExchangeEvents, "event."+probeID+"."+event, body)
}

// ConsumeCommands consome as tarefas da fila do probe e chama handler para cada
// uma. handler==nil (ack automatico) nao e permitido; se handler retornar erro,
// a mensagem e rejeitada sem reenfileirar (evita loop de mensagem envenenada).
// Retorna quando ctx e cancelado ou quando a conexao cai.
func (c *Conn) ConsumeCommands(ctx context.Context, probeID string, handler func([]byte) error) error {
	name, err := c.DeclareCommandQueue(probeID)
	if err != nil {
		return err
	}
	if err := c.ch.Qos(1, 0, false); err != nil {
		return err
	}
	return c.consume(ctx, name, handler)
}

// ConsumeResults consome a fila de ingestao de resultados (usado pela ferramenta
// de teste que simula o servico de ingestao).
func (c *Conn) ConsumeResults(ctx context.Context, handler func([]byte) error) error {
	name, err := c.DeclareResultsQueue()
	if err != nil {
		return err
	}
	return c.consume(ctx, name, handler)
}

func (c *Conn) consume(ctx context.Context, queue string, handler func([]byte) error) error {
	msgs, err := c.ch.Consume(queue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case d, ok := <-msgs:
			if !ok {
				return errors.New("canal de consumo fechado (conexao caiu)")
			}
			if err := handler(d.Body); err != nil {
				_ = d.Nack(false, false)
			} else {
				_ = d.Ack(false)
			}
		}
	}
}
