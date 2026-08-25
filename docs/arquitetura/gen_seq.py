# -*- coding: utf-8 -*-
W = 1600
parts = [
    ("Administrador", "[Equipe de Redes]", "#08427b"),
    ("Controlador", "+ Scheduler", "#1168bd"),
    ("RabbitMQ", "[Broker AMQP]", "#1168bd"),
    ("Agente (probe)", "[Go]", "#2f7d4f"),
    ("Servico de Ingestao", "[Python]", "#1168bd"),
    ("PostgreSQL /", "TimescaleDB", "#0e5a9c"),
    ("Grafana", "[Dashboards]", "#1168bd"),
]
n = len(parts)
xs = [round(120 + i * (1360/(n-1))) for i in range(n)]
BOXW, BOXH, BOXY = 168, 46, 24
top = BOXY + BOXH

svg = []
svg.append(f'<svg viewBox="0 0 {W} 740" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">')
svg.append('<rect x="0" y="0" width="%d" height="740" fill="white"/>' % W)
svg.append('<defs><marker id="arw" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">'
           '<path d="M0,0 L8,3 L0,6 Z" fill="#33475b"/></marker></defs>')
svg.append(f'<text x="{W//2}" y="16" text-anchor="middle" font-size="15" font-weight="bold" fill="#12467b">'
           'Fluxo de execucao — de um plano ao dashboard (diagrama de sequencia)</text>')

# participantes + lifelines
LIFE_BOTTOM = 700
for (l1, l2, color), x in zip(parts, xs):
    svg.append(f'<rect x="{x-BOXW//2}" y="{BOXY}" width="{BOXW}" height="{BOXH}" rx="8" fill="{color}"/>')
    svg.append(f'<text x="{x}" y="{BOXY+19}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="white">{l1}</text>')
    svg.append(f'<text x="{x}" y="{BOXY+35}" text-anchor="middle" font-size="9" fill="white">{l2}</text>')
    svg.append(f'<line x1="{x}" y1="{top}" x2="{x}" y2="{LIFE_BOTTOM}" stroke="#9db0c2" stroke-width="1.2" stroke-dasharray="4,4"/>')

def msg(a, b, y, text, dashed=False, color="#33475b"):
    x1, x2 = xs[a], xs[b]
    dash = ' stroke-dasharray="6,4"' if dashed else ''
    svg.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="1.5"{dash} marker-end="url(#arw)"/>')
    mid = (x1 + x2) // 2
    svg.append(f'<text x="{mid}" y="{y-6}" text-anchor="middle" font-size="10" fill="#22333f">{text}</text>')

def selfmsg(a, y, text, note=None, note_color="#176a30"):
    x = xs[a]
    svg.append(f'<path d="M{x},{y-6} h34 v14 h-34" fill="none" stroke="#33475b" stroke-width="1.5" marker-end="url(#arw)"/>')
    svg.append(f'<text x="{x+42}" y="{y-1}" font-size="10" fill="#22333f">{text}</text>')
    if note:
        svg.append(f'<text x="{x+42}" y="{y+13}" font-size="8.5" font-style="italic" fill="{note_color}">{note}</text>')

# loop frame
def loop(y1, y2, label):
    x1, x2 = xs[1]-40, xs[5]+90
    svg.append(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" fill="none" stroke="#4fa06a" stroke-width="1.2" stroke-dasharray="3,3" rx="4"/>')
    svg.append(f'<path d="M{x1},{y1} h74 v16 h-64 z" fill="#e7f3ec" stroke="#4fa06a" stroke-width="1"/>')
    svg.append(f'<text x="{x1+8}" y="{y1+12}" font-size="9" font-weight="bold" fill="#176a30">loop</text>')
    svg.append(f'<text x="{x1+80}" y="{y1+12}" font-size="9" fill="#176a30">{label}</text>')

Y=112; S=47
loop(180, 566, "a cada period_seconds — o scheduler dispara automaticamente")
msg(0,1, Y, "1. cria o plano (POST /plans)  |  HTTPS"); Y+=S
selfmsg(1, Y, "2. valida e armazena o plano (PostgreSQL)"); Y+=S
selfmsg(1, Y, "3. Scheduler: expande a malha em tarefas (n(n-1))", note="iperf3 -> serializado: 1 teste por probe de cada vez"); Y+=S
msg(1,2, Y, "4. publica tarefas  |  AMQP"); Y+=S
msg(2,3, Y, "5. entrega comando ao probe  |  AMQP"); Y+=S
selfmsg(3, Y, "6. executa a medicao (ICMP/DNS/HTTP/iperf3)", note="contra outro probe ou destino externo"); Y+=S
selfmsg(3, Y, "7. grava na outbox SQLite", note="persiste ANTES de publicar -> nada se perde"); Y+=S
msg(3,2, Y, "8. publica resultado (+ publisher confirm)  |  AMQP"); Y+=S
msg(2,4, Y, "9. entrega resultado  |  AMQP"); Y+=S
msg(4,5, Y, "10. grava serie temporal  |  SQL"); Y+=S
Y+=18
msg(0,6, Y, "11. abre o dashboard  |  HTTPS"); Y+=S
msg(6,5, Y, "12. consulta as series  |  SQL"); Y+=S
msg(6,0, Y, "13. graficos + matriz probe x destino", dashed=True)

svg.append('</svg>')
open("fluxo-execucao-sequencia.svg","w",encoding="utf-8").write("\n".join(svg))
print("SVG gerado")
