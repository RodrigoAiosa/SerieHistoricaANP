#!/usr/bin/env python3
"""Gera dados SINTÉTICOS de demonstração em public/data/.

Eles imitam o formato e a "forma" da série histórica da ANP (preço médio mensal
por estado, R$/litro, mai/2004 a jun/2026) para o dashboard funcionar antes de
você rodar o pipeline real (scripts/build_data.py). NÃO são dados oficiais.
"""
import json
import math
import random
from pathlib import Path

random.seed(2604)
OUT = Path(__file__).resolve().parent.parent / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

START, END = (2004, 5), (2026, 6)
months = []
y, m = START
while (y, m) <= END:
    months.append(f"{y}-{m:02d}")
    m += 1
    if m == 13:
        y, m = y + 1, 1
N = len(months)


def mi(y, m):
    return (y - START[0]) * 12 + (m - START[1])


def curve(anchors):
    pts = [(mi(a, b), v) for a, b, v in anchors]
    out = []
    for i in range(N):
        for (i0, v0), (i1, v1) in zip(pts, pts[1:]):
            if i0 <= i <= i1:
                t = (i - i0) / (i1 - i0) if i1 > i0 else 0
                out.append(v0 + (v1 - v0) * t)
                break
        else:
            out.append(pts[-1][1] if i > pts[-1][0] else pts[0][1])
    return out


GAS = curve([
    (2004, 5, 2.065), (2005, 6, 2.45), (2006, 6, 2.55), (2008, 9, 2.58),
    (2009, 12, 2.60), (2011, 6, 2.72), (2013, 6, 2.80), (2014, 12, 3.10),
    (2015, 6, 3.35), (2015, 12, 3.60), (2016, 12, 3.72), (2017, 7, 3.90),
    (2018, 4, 4.18), (2018, 6, 4.50), (2018, 12, 4.15), (2019, 12, 4.35),
    (2020, 4, 4.00), (2020, 12, 4.45), (2021, 6, 5.45), (2021, 12, 6.40),
    (2022, 6, 7.20), (2022, 10, 5.30), (2023, 6, 5.60), (2024, 6, 6.10),
    (2025, 3, 6.45), (2025, 9, 6.25), (2026, 6, 6.845),
])
RATIO_ETH = curve([
    (2004, 5, .58), (2006, 6, .55), (2007, 12, .57), (2008, 6, .60),
    (2009, 12, .66), (2010, 3, .72), (2010, 8, .64), (2011, 3, .76),
    (2012, 3, .72), (2013, 6, .70), (2014, 6, .72), (2015, 6, .72),
    (2016, 6, .78), (2017, 6, .76), (2018, 6, .72), (2019, 6, .73),
    (2020, 6, .76), (2021, 6, .72), (2021, 12, .77), (2022, 6, .70),
    (2022, 12, .72), (2023, 6, .75), (2024, 3, .74), (2024, 12, .71),
    (2025, 6, .73), (2026, 6, .728),
])
RATIO_DSL = curve([
    (2004, 5, .76), (2008, 7, .86), (2009, 6, .74), (2012, 6, .80),
    (2015, 1, .78), (2016, 6, .80), (2018, 5, .82), (2018, 6, .93),
    (2018, 12, .82), (2020, 4, .85), (2021, 12, .88), (2022, 6, 1.05),
    (2022, 12, .98), (2023, 6, .95), (2024, 6, .96), (2025, 6, 1.00),
    (2026, 6, 1.045),
])

# uf: (nome, região, mult. gasolina, mult. diesel, desvio razão etanol/gasolina)
STATES = {
    "AC": ("Acre", "Norte", 1.10, 1.13, +.009),
    "AM": ("Amazonas", "Norte", 1.03, 1.06, +.030),
    "AP": ("Amapá", "Norte", 1.02, 1.05, +.020),
    "PA": ("Pará", "Norte", 1.00, 1.02, +.030),
    "RO": ("Rondônia", "Norte", 1.05, 1.07, +.020),
    "RR": ("Roraima", "Norte", 1.00, 1.04, +.040),
    "TO": ("Tocantins", "Norte", 1.01, 1.02, +.020),
    "AL": ("Alagoas", "Nordeste", .99, .98, +.010),
    "BA": ("Bahia", "Nordeste", 1.00, .99, +.020),
    "CE": ("Ceará", "Nordeste", .98, .98, +.030),
    "MA": ("Maranhão", "Nordeste", .96, .97, +.050),
    "PB": ("Paraíba", "Nordeste", .97, .97, +.020),
    "PE": ("Pernambuco", "Nordeste", .99, .98, +.010),
    "PI": ("Piauí", "Nordeste", .97, .97, +.050),
    "RN": ("Rio Grande do Norte", "Nordeste", .98, .98, +.060),
    "SE": ("Sergipe", "Nordeste", .99, .98, +.040),
    "DF": ("Distrito Federal", "Centro-Oeste", 1.01, 1.00, -.040),
    "GO": ("Goiás", "Centro-Oeste", .98, .99, -.080),
    "MS": ("Mato Grosso do Sul", "Centro-Oeste", 1.01, 1.01, -.045),
    "MT": ("Mato Grosso", "Centro-Oeste", 1.04, 1.02, -.090),
    "ES": ("Espírito Santo", "Sudeste", 1.00, 1.00, +.015),
    "MG": ("Minas Gerais", "Sudeste", 1.01, 1.00, -.035),
    "RJ": ("Rio de Janeiro", "Sudeste", 1.01, 1.00, +.010),
    "SP": ("São Paulo", "Sudeste", .96, .97, -.065),
    "PR": ("Paraná", "Sul", .97, .98, -.040),
    "RS": ("Rio Grande do Sul", "Sul", .99, 1.00, +.030),
    "SC": ("Santa Catarina", "Sul", 1.00, 1.00, +.040),
}
mean_g = sum(s[2] for s in STATES.values()) / len(STATES)
mean_d = sum(s[3] for s in STATES.values()) / len(STATES)


def ar1(sd, phi=.6):
    e, out = 0.0, []
    for _ in range(N):
        e = phi * e + random.gauss(0, sd)
        out.append(e)
    return out


nat_noise = ar1(.008)
series = {"gasolina": {}, "etanol": {}, "diesel": {}}
for uf, (_, _, mg, md, dr) in STATES.items():
    sn = ar1(.006)
    rn = ar1(.005)
    dn = ar1(.007)
    g, e, d = [], [], []
    for i in range(N):
        mon = int(months[i][5:])
        seas = 1 + .02 * math.cos(2 * math.pi * (mon - 2) / 12)
        gas = GAS[i] * (mg / mean_g) * (1 + nat_noise[i] + sn[i])
        ratio = RATIO_ETH[i] * seas + dr + rn[i]
        dsl = GAS[i] * RATIO_DSL[i] * (md / mean_d) * (1 + nat_noise[i] * .7 + dn[i])
        g.append(round(gas, 3))
        e.append(round(gas * ratio, 3))
        d.append(round(dsl, 3))
    series["gasolina"][uf], series["etanol"][uf], series["diesel"][uf] = g, e, d

# sanidade: no último mês o etanol deve compensar (<70%) só nos estados produtores
winners = sorted(uf for uf in STATES if series["etanol"][uf][-1] / series["gasolina"][uf][-1] < .70)
print("Etanol compensa em jun/2026 (demo):", winners, len(winners))

(OUT / "series.json").write_text(json.dumps({
    "months": months,
    "states": [{"uf": uf, "nome": v[0], "regiao": v[1]} for uf, v in STATES.items()],
    **series,
}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

(OUT / "events.json").write_text(json.dumps([
    {"date": "2008-09", "type": "crise", "title": "Crise financeira global",
     "text": "Colapso do Lehman Brothers; o barril de petróleo despenca nos meses seguintes."},
    {"date": "2015-02", "type": "politica", "title": "Alta de PIS/Cofins e Cide",
     "text": "Governo eleva tributos federais sobre gasolina e diesel."},
    {"date": "2017-07", "type": "petrobras", "title": "Reajustes mais frequentes na Petrobras",
     "text": "Nova política permite revisões de preço quase diárias nas refinarias."},
    {"date": "2018-05", "type": "greve", "title": "Greve dos caminhoneiros",
     "text": "Dez dias de bloqueios."},
    {"date": "2020-03", "type": "pandemia", "title": "Pandemia",
     "text": "A demanda despenca."},
    {"date": "2022-02", "type": "guerra", "title": "Guerra na Ucrânia",
     "text": "Barril a US$ 127."},
    {"date": "2022-06", "type": "politica", "title": "Teto de ICMS sobre combustíveis",
     "text": "Lei Complementar 194 limita o ICMS cobrado sobre combustíveis."},
    {"date": "2023-03", "type": "politica", "title": "Volta o PIS/Cofins na gasolina",
     "text": "Fim da desoneração federal sobre a gasolina."},
    {"date": "2023-05", "type": "petrobras", "title": "Petrobras deixa a paridade de importação",
     "text": "Estatal abandona o PPI e adota nova estratégia comercial de preços."},
    {"date": "2025-08", "type": "etanol", "title": "Gasolina E30",
     "text": "Mistura obrigatória de etanol na gasolina sobe para 30%."},
], ensure_ascii=False, indent=2), encoding="utf-8")

(OUT / "meta.json").write_text(json.dumps({
    "demo": True,
    "coletas": 25253048,
    "fonte": "ANP — Série histórica do levantamento de preços de combustíveis",
    "atualizado": months[-1],
}, ensure_ascii=False, indent=2), encoding="utf-8")
print("ok ->", OUT)


# ---------------------------------------------------------------------------
# IPCA APROXIMADO (taxas anuais conhecidas distribuídas de forma geométrica
# pelos meses; 2025-26 são estimativas). Para o índice oficial, rode
# scripts/fetch_ipca.py (série 433 do SGS/Banco Central).
IPCA_ANUAL = {2004: 7.60, 2005: 5.69, 2006: 3.14, 2007: 4.46, 2008: 5.90, 2009: 4.31,
              2010: 5.91, 2011: 6.50, 2012: 5.84, 2013: 5.91, 2014: 6.41, 2015: 10.67,
              2016: 6.29, 2017: 2.95, 2018: 3.75, 2019: 4.31, 2020: 4.52, 2021: 10.06,
              2022: 5.79, 2023: 4.62, 2024: 4.83, 2025: 4.30, 2026: 4.00}
idx, level = [], 100.0
for i, mm in enumerate(months):
    if i:
        yr = int(mm[:4])
        level *= (1 + IPCA_ANUAL[yr] / 100) ** (1 / 12)
    idx.append(round(level, 4))
(OUT / "ipca.json").write_text(json.dumps({
    "aproximado": True, "base": months[0], "indice": idx,
    "fonte": "IPCA/IBGE (aproximação a partir de taxas anuais)",
}, separators=(",", ":")), encoding="utf-8")

# ---------------------------------------------------------------------------
# MUNICÍPIOS (demo): as 27 capitais, últimos 24 meses, em torno da série do estado.
CAPITAIS = {"AC": "Rio Branco", "AL": "Maceió", "AP": "Macapá", "AM": "Manaus", "BA": "Salvador",
            "CE": "Fortaleza", "DF": "Brasília", "ES": "Vitória", "GO": "Goiânia", "MA": "São Luís",
            "MT": "Cuiabá", "MS": "Campo Grande", "MG": "Belo Horizonte", "PA": "Belém",
            "PB": "João Pessoa", "PR": "Curitiba", "PE": "Recife", "PI": "Teresina",
            "RJ": "Rio de Janeiro", "RN": "Natal", "RS": "Porto Alegre", "RO": "Porto Velho",
            "RR": "Boa Vista", "SC": "Florianópolis", "SP": "São Paulo", "SE": "Aracaju", "TO": "Palmas"}
W = 24
items = []
for uf, nome in CAPITAIS.items():
    f = 1 + random.gauss(0, .018)
    it = {"n": nome, "uf": uf}
    for fuel in ("gasolina", "etanol", "diesel"):
        it[fuel] = [round(v * f * (1 + random.gauss(0, .004)), 3) for v in series[fuel][uf][-W:]]
    items.append(it)
(OUT / "municipios.json").write_text(json.dumps(
    {"months": months[-W:], "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("ipca/municipios ok")
