#!/usr/bin/env python3
"""Pipeline REAL: CSVs da ANP -> JSONs do dashboard (public/data/).

Uso:
    pip install pandas
    # baixe os CSVs semestrais (ca-AAAA-SS.csv) da página "Série histórica do
    # levantamento de preços de combustíveis" da ANP para a pasta raw/
    python scripts/build_data.py raw/

Saída: public/data/series.json e public/data/meta.json (demo=false).
Mantém public/data/events.json como está (edite à mão).

Observação: os layouts dos CSVs da ANP variaram ao longo dos anos. Este script
normaliza nomes de colunas e produtos; se algum semestre falhar, ele avisa e
segue, para você ajustar o mapeamento em COLS/PRODUCTS.
"""
import json
import sys
import unicodedata
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "public" / "data"

COLS = {  # nome normalizado -> campo interno
    "estado - sigla": "uf", "estado": "uf",
    "produto": "produto",
    "data da coleta": "data",
    "valor de venda": "venda",
}
PRODUCTS = {  # trecho do nome normalizado -> chave
    "gasolina comum": "gasolina", "gasolina": "gasolina",
    "etanol": "etanol", "alcool": "etanol",
    "diesel": "diesel",
}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return s.strip().lower()


def product_key(p):
    p = norm(p)
    for frag, key in PRODUCTS.items():
        if frag in p:
            return key
    return None


def main(raw_dir):
    files = sorted(Path(raw_dir).glob("*.csv"))
    if not files:
        sys.exit(f"Nenhum CSV em {raw_dir}")
    parts, total = [], 0
    for f in files:
        try:
            df = pd.read_csv(f, sep=";", decimal=",", encoding="utf-8",
                             dtype=str, on_bad_lines="skip")
        except UnicodeDecodeError:
            df = pd.read_csv(f, sep=";", decimal=",", encoding="latin-1",
                             dtype=str, on_bad_lines="skip")
        df.columns = [norm(c) for c in df.columns]
        df = df.rename(columns={c: COLS[c] for c in df.columns if c in COLS})
        if not {"uf", "produto", "data", "venda"} <= set(df.columns):
            print(f"[aviso] {f.name}: colunas inesperadas {list(df.columns)[:8]}...")
            continue
        total += len(df)
        df["fuel"] = df["produto"].map(product_key)
        df = df.dropna(subset=["fuel"])
        df["venda"] = pd.to_numeric(df["venda"].str.replace(",", "."), errors="coerce")
        df["data"] = pd.to_datetime(df["data"], dayfirst=True, errors="coerce")
        df = df.dropna(subset=["venda", "data"])
        df["ym"] = df["data"].dt.strftime("%Y-%m")
        parts.append(df.groupby(["fuel", "uf", "ym"])["venda"].agg(["sum", "count"]).reset_index())
        print(f"{f.name}: {len(df):,} linhas úteis")

    agg = pd.concat(parts).groupby(["fuel", "uf", "ym"]).sum().reset_index()
    agg["mean"] = agg["sum"] / agg["count"]
    months = sorted(agg["ym"].unique())
    ufs = sorted(agg["uf"].unique())
    meta_states = json.loads((OUT / "series.json").read_text(encoding="utf-8"))["states"] \
        if (OUT / "series.json").exists() else [{"uf": u, "nome": u, "regiao": ""} for u in ufs]

    out = {"months": months, "states": meta_states}
    for fuel in ("gasolina", "etanol", "diesel"):
        out[fuel] = {}
        sub = agg[agg["fuel"] == fuel]
        for uf in [s["uf"] for s in meta_states]:
            s = sub[sub["uf"] == uf].set_index("ym")["mean"].reindex(months)
            s = s.interpolate(limit_direction="both").round(3)
            out[fuel][uf] = s.tolist()
    (OUT / "series.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "meta.json").write_text(json.dumps({
        "demo": False, "coletas": int(total),
        "fonte": "ANP — Série histórica do levantamento de preços de combustíveis",
        "atualizado": months[-1],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ok: {len(months)} meses, {len(ufs)} UFs, {total:,} coletas")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "raw")
