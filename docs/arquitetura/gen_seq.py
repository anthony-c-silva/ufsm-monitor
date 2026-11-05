# -*- coding: utf-8 -*-
# Gera o diagrama de sequencia do fluxo de execucao (SVG e PDF vetorial).
# Uso: python3 gen_seq.py   (requer cairosvg para o PDF)
FONT = "Liberation Sans, Helvetica, Arial, sans-serif"
parts = [
    ("Administrador", "#ffe6cc", "#d79b00"),
    ("Painel web", "#dae8fc", "#6c8ebf"),
    ("Controlador", "#dae8fc", "#6c8ebf"),
    ("Barramento", "#dae8fc", "#6c8ebf"),
    ("Sonda", "#d5e8d4", "#82b366"),
    ("Ingestão", "#dae8fc", "#6c8ebf"),
    ("Banco de dados", "#fff2cc", "#d6b656"),
]
W = 900
n = len(parts)
X0, X1 = 62, W - 62
xs = [round(X0 + i * (X1 - X0) / (n - 1)) for i in range(n)]
BOXW, BOXH, BOXY = 112, 30, 8
svg = [f'<svg viewBox="0 0 {W} H" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">',
       '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">'
       '<path d="M0,0 L7,3 L0,6 Z" fill="#333333"/></marker></defs>']
body = []

def msg(a, b, y, text, dashed=False):
    x1, x2 = xs[a], xs[b]
    d = ' stroke-dasharray="5,3"' if dashed else ''
    body.append(f'<line x1="{x1}" y1="{y}" x2="{x2 - (6 if x2 > x1 else -6)}" y2="{y}" stroke="#333333" stroke-width="1.1"{d} marker-end="url(#a)"/>')
    tw = len(text) * 5.6 + 6
    body.append(f'<rect x="{(x1 + x2) / 2 - tw / 2}" y="{y - 17}" width="{tw}" height="14" fill="white"/>')
    body.append(f'<text x="{(x1 + x2) / 2}" y="{y - 6}" text-anchor="middle" font-size="11" fill="#222222">{text}</text>')

def selfmsg(a, y, text):
    x = xs[a]
    body.append(f'<path d="M{x},{y - 7} h24 v14 h-18" fill="none" stroke="#333333" stroke-width="1.1" marker-end="url(#a)"/>')
    tw = len(text) * 5.6 + 6
    body.append(f'<rect x="{x + 27}" y="{y - 7}" width="{tw}" height="14" fill="white"/>')
    body.append(f'<text x="{x + 30}" y="{y + 4}" font-size="11" fill="#222222">{text}</text>')

Y, S = 70, 34
msg(0, 1, Y, "1. cadastra o plano"); Y += S
msg(1, 2, Y, "2. envia o plano (HTTPS)"); Y += S
msg(2, 6, Y, "3. valida e armazena o plano (SQL)"); Y += S
loop_top = Y - 12; Y += 22
selfmsg(2, Y, "4. gera as tarefas do período"); Y += S
msg(2, 3, Y, "5. publica as tarefas"); Y += S
msg(3, 4, Y, "6. entrega a tarefa (AMQP)"); Y += S
selfmsg(4, Y, "7. mede e grava na fila local"); Y += S
msg(4, 3, Y, "8. publica o resultado"); Y += S
msg(3, 5, Y, "9. entrega o resultado"); Y += S
msg(5, 6, Y, "10. grava a série (SQL)"); Y += S - 10
loop_bot = Y; Y += S
msg(0, 1, Y, "11. consulta os resultados"); Y += S
msg(1, 2, Y, "12. requisita os dados (HTTPS)"); Y += S
msg(2, 6, Y, "13. consulta as séries (SQL)"); Y += S
msg(1, 0, Y, "14. gráficos e matriz", dashed=True); Y += 22
H = Y

lx1, lx2 = xs[2] - 40, xs[6] + 52
frame = [f'<rect x="{lx1}" y="{loop_top}" width="{lx2 - lx1}" height="{loop_bot - loop_top}" fill="none" stroke="#82b366" stroke-width="1" stroke-dasharray="4,3"/>',
         f'<path d="M{lx1},{loop_top} h46 v14 l-6,6 h-40 z" fill="#d5e8d4" stroke="#82b366" stroke-width="1"/>',
         f'<text x="{lx1 + 6}" y="{loop_top + 14}" font-size="10.5" font-weight="bold" fill="#2d5a2d">loop</text>',
         f'<text x="{lx1 + 54}" y="{loop_top + 14}" font-size="10.5" fill="#2d5a2d">[a cada período definido no plano]</text>']
heads = []
for (name, fill, stroke), x in zip(parts, xs):
    heads.append(f'<line x1="{x}" y1="{BOXY + BOXH}" x2="{x}" y2="{H - 8}" stroke="#aaaaaa" stroke-width="1" stroke-dasharray="4,4"/>')
    heads.append(f'<rect x="{x - BOXW / 2}" y="{BOXY}" width="{BOXW}" height="{BOXH}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1.2"/>')
    heads.append(f'<text x="{x}" y="{BOXY + 19.5}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#000000">{name}</text>')
svg[0] = svg[0].replace(' H"', f' {H}"')
svg += ['<rect x="0" y="0" width="100%" height="100%" fill="white"/>'] + heads + frame + body + ['</svg>']
out = "\n".join(svg)
open("fluxo-execucao-sequencia.svg", "w", encoding="utf-8").write(out)
try:
    import cairosvg
    cairosvg.svg2pdf(bytestring=out.encode("utf-8"), write_to="fluxo-execucao-sequencia.pdf")
    cairosvg.svg2png(bytestring=out.encode("utf-8"), write_to="fluxo-execucao-sequencia.png", scale=2.5)
except ImportError:
    pass
print("ok", W, H)
