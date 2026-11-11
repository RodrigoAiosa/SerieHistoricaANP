#!/usr/bin/env python3
"""Baixa o IPCA mensal oficial (SGS 433, Banco Central) e grava public/data/ipca.json.
Alinha ao mesmo vetor de meses de public/data/series.json.  Uso: python scripts/fetch_ipca.py
"""
import json
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
months = json.loads((DATA / "series.json").read_text(encoding="utf-8"))["months"]
y, m = months[0].split("-")
url = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json"
       f"&dataInicial=01/{m}/{y}")
rows = json.load(urllib.request.urlopen(url, timeout=60))
var = {f"{r['data'][6:]}-{r['data'][3:5]}": float(r["valor"]) for r in rows}  # dd/mm/aaaa
level, idx, est = 100.0, [], 0
known = [var[m] for m in months if m in var]
fallback = sum(known[-12:]) / len(known[-12:]) if known else 0.0
for i, mm in enumerate(months):
    if i:
        v = var.get(mm)
        if v is None:
            if mm < max(var):          # buraco no meio da série: não dá para estimar
                raise SystemExit(f"IPCA sem dado para {mm}")
            v, est = fallback, est + 1  # meses finais ainda não divulgados
        level *= 1 + v / 100
    idx.append(round(level, 4))
(DATA / "ipca.json").write_text(json.dumps({
    "aproximado": est > 0, "estimados": est, "base": months[0], "indice": idx,
    "fonte": "IPCA/IBGE via SGS-Banco Central (série 433)" + (f"; {est} mês(es) final(is) estimado(s)" if est else ""),
}, separators=(",", ":")), encoding="utf-8")
print("ok:", len(idx), "meses", f"({est} estimados)" if est else "")
