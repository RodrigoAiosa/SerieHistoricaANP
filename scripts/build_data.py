#!/usr/bin/env python3
"""Pipeline REAL: CSVs da ANP -> JSONs do dashboard (public/data/).

Uso:
    pip install pandas
    # baixe os CSVs semestrais (ca-AAAA-SS.csv) da página "Série histórica do
    # levantamento de preços de combustíveis" da ANP para a pasta raw/
    python scripts/build_data.py raw/

Saída: series.json, municipios.json e meta.json (demo=false).
Para o IPCA oficial: python scripts/fetch_ipca.py
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
    "municipio": "mun",
    "produto": "produto",
    "data da coleta": "data",
    "valor de venda": "venda",
    "bandeira": "bandeira",
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
    if "aditivada" in p:      # o painel usa gasolina comum (a aditivada é mais cara e distorceria a média)
        return None
    for frag, key in PRODUCTS.items():
        if frag in p:
            return key
    return None


def main(raw_dir):
    files = sorted(Path(raw_dir).glob("*.csv"))
    if not files:
        sys.exit(f"Nenhum CSV em {raw_dir}")
    parts, mparts, bparts, total = [], [], [], 0
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
        df["fuel"] = df["produto"].map(product_key)
        df = df.dropna(subset=["fuel"])          # só gasolina, etanol e diesel (ignora GLP, GNV etc.)
        df["venda"] = pd.to_numeric(df["venda"].str.replace(",", "."), errors="coerce")
        raw_d = df["data"]
        df["data"] = pd.to_datetime(raw_d, format="%d/%m/%Y", errors="coerce")
        iso = df["data"].isna()
        if iso.any():  # alguns semestres vêm em AAAA-MM-DD
            df.loc[iso, "data"] = pd.to_datetime(raw_d[iso], format="ISO8601", errors="coerce")
        df = df.dropna(subset=["venda", "data"])  # exige preço e data válidos
        total += len(df)                         # coletas = linhas efetivamente usadas pelo painel
        df["ym"] = df["data"].dt.strftime("%Y-%m")
        parts.append(df.groupby(["fuel", "uf", "ym"])["venda"].agg(["sum", "count"]).reset_index())
        if "bandeira" in df.columns:  # bandeira branca x bandeiradas (por estado/mês)
            bd = df.dropna(subset=["bandeira"]).copy()
            bd["branca"] = bd["bandeira"].map(norm) == "branca"
            bparts.append(bd.groupby(["fuel", "uf", "ym", "branca"])["venda"].agg(["sum", "count"]).reset_index())
        if "mun" in df.columns:
            mparts.append(df.groupby(["fuel", "uf", "mun", "ym"])["venda"].agg(["sum", "count"]).reset_index())
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
    if mparts:  # ranking de municípios: últimos 24 meses, top MUN_TOP por nº de coletas
        W, MUN_TOP = 24, 300
        mm = pd.concat(mparts).groupby(["fuel", "uf", "mun", "ym"]).sum().reset_index()
        mm["mun"] = mm["mun"].str.title()
        wm = months[-W:]
        mm = mm[mm["ym"].isin(wm)]
        top = (mm.groupby(["uf", "mun"])["count"].sum().nlargest(MUN_TOP).index)
        items = []
        for uf, mun in top:
            sub = mm[(mm["uf"] == uf) & (mm["mun"] == mun)]
            it = {"n": mun, "uf": uf}
            for fuel in ("gasolina", "etanol", "diesel"):
                v = sub[sub["fuel"] == fuel].set_index("ym")
                v = (v["sum"] / v["count"]).reindex(wm).interpolate(limit_direction="both").round(3)
                it[fuel] = v.tolist()
            items.append(it)
        (OUT / "municipios.json").write_text(json.dumps({"months": wm, "items": items},
            ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"municipios.json: {len(items)} municípios")
    if bparts:  # bandeira.json: mês só vale com >= MIN_B coletas; buracos internos interpolados, pontas ficam vazias (null)
        MIN_B = 3
        bb = pd.concat(bparts).groupby(["fuel", "uf", "ym", "branca"]).sum().reset_index()
        bout = {"months": months, "branca": {}, "bandeirada": {}}
        for flag, key in ((True, "branca"), (False, "bandeirada")):
            for fuel in ("gasolina", "etanol", "diesel"):
                bout[key][fuel] = {}
                sub = bb[(bb["fuel"] == fuel) & (bb["branca"] == flag)]
                for uf in [s["uf"] for s in meta_states]:
                    t = sub[sub["uf"] == uf].set_index("ym")
                    v = (t["sum"] / t["count"]).where(t["count"] >= MIN_B).reindex(months)
                    v = v.interpolate(limit_area="inside").round(3)
                    bout[key][fuel][uf] = [None if pd.isna(x) else float(x) for x in v]
        (OUT / "bandeira.json").write_text(json.dumps(bout, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("bandeira.json: ok")
    (OUT / "meta.json").write_text(json.dumps({
        "demo": False, "coletas": int(total),
        "fonte": "ANP — Série histórica do levantamento de preços de combustíveis",
        "atualizado": months[-1],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ok: {len(months)} meses, {len(ufs)} UFs, {total:,} coletas (gasolina, etanol e diesel)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "raw")
