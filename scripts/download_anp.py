#!/usr/bin/env python3
"""Baixa os CSVs semestrais (combustíveis automotivos) da série histórica da ANP.

Uso: python scripts/download_anp.py raw/
Endereço oficial: .../dados-abertos/arquivos/shpc/dsas/ca/ca-AAAA-SS.csv (SS = 01 ou 02).
Semestres que ainda não existem (404) são ignorados; falha se nada for baixado.
"""
import datetime as dt
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/dsas/ca"
HEADERS = {"User-Agent": "Mozilla/5.0 (SerieHistoricaANP; +https://github.com/RodrigoAiosa/SerieHistoricaANP)"}


def fetch(url, dest, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            err = e
        except Exception as e:  # rede instável: tenta de novo
            err = e
        print(f"  tentativa {k + 1}/{tries} falhou: {err}")
        time.sleep(5 * (k + 1))
    raise SystemExit(f"Falha ao baixar {url}")


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    got = 0
    for year in range(2004, dt.date.today().year + 1):
        for sem in ("01", "02"):
            name = f"ca-{year}-{sem}.csv"
            if fetch(f"{BASE}/{name}", out / name):
                size = (out / name).stat().st_size / 1e6
                print(f"ok  {name}  {size:,.1f} MB")
                got += 1
            else:
                (out / name).unlink(missing_ok=True)
                print(f"--  {name}  (não existe)")
    if not got:
        sys.exit("Nenhum arquivo baixado: confira o endereço da ANP.")
    print(f"{got} arquivos em {out}/")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "raw")
