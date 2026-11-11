#!/usr/bin/env python3
"""Gera public/data/bandeira.json SINTÉTICO (demonstração) a partir de series.json.

O arquivo real é produzido por scripts/build_data.py (coluna "Bandeira" dos CSVs
da ANP: "BRANCA" = posto sem bandeira de distribuidora).
Formato: {months, branca:{fuel:{UF:[...]}}, bandeirada:{fuel:{UF:[...]}}}
"""
import json
import random
from pathlib import Path

random.seed(2605)
OUT = Path(__file__).resolve().parent.parent / "public" / "data"
s = json.loads((OUT / "series.json").read_text(encoding="utf-8"))
months, ufs = s["months"], [x["uf"] for x in s["states"]]
N = len(months)
ramp_end = {"gasolina": 0.034, "etanol": 0.045, "diesel": 0.022}  # desconto médio da bandeira branca no fim da série
out = {"months": months, "branca": {}, "bandeirada": {}}
for fuel, top in ramp_end.items():
    out["branca"][fuel], out["bandeirada"][fuel] = {}, {}
    for u in ufs:
        off = random.uniform(-0.01, 0.012)      # cada estado tem seu nível
        noise = 0.0
        br, bd = [], []
        for k in range(N):
            noise = 0.6 * noise + random.gauss(0, 0.004)
            disc = max(0.002, 0.004 + (top - 0.004) * (k / (N - 1)) ** 0.8 + off * (k / (N - 1)) + noise)
            p = s[fuel][u][k]
            br.append(round(p * (1 - disc), 3))
            bd.append(round(p * (1 + disc * 0.18), 3))
        out["branca"][fuel][u], out["bandeirada"][fuel][u] = br, bd
(OUT / "bandeira.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print("bandeira.json (demo):", len(ufs), "UFs,", N, "meses")
