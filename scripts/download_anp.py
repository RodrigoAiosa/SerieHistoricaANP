#!/usr/bin/env python3
"""Baixa os CSVs semestrais (combustíveis automotivos) da série histórica da ANP.

Uso: python scripts/download_anp.py raw/
Endereço oficial: .../dados-abertos/arquivos/shpc/dsas/ca/ca-AAAA-SS.csv (SS = 01 ou 02).
Semestres que ainda não existem (404) são ignorados; falha se nada for baixado.
"""
import datetime as dt
import re
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
                print(f"  HTTP 404 em {url}")
                return False
            err = e
        except Exception as e:  # rede instável: tenta de novo
            err = e
        print(f"  tentativa {k + 1}/{tries} falhou: {err}")
        time.sleep(5 * (k + 1))
    raise SystemExit(f"Falha ao baixar {url}")


PAGE = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis"


def status(url):
    """Código HTTP e tipo do conteúdo (lê só o começo do arquivo)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
            r.read(256)
            return f"{r.status} {r.headers.get('Content-Type', '?')} {r.headers.get('Content-Length', '?')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except Exception as e:
        return f"erro {type(e).__name__}: {e}"


def diagnose():
    """Modo --list: mostra os links de dados que a página da ANP publica e testa endereços candidatos."""
    print("== links na página da ANP ==")
    try:
        req = urllib.request.Request(PAGE, headers=HEADERS)
        html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        links = sorted(set(re.findall(r'href="([^"]+)"', html)))
        keep = [l for l in links if re.search(r"\.(csv|xlsx?|zip|ods)(\?|$)|/shpc/", l, re.I)]
        print(f"{len(links)} links na página, {len(keep)} de dados")
        for l in keep:
            print("  ", l)
    except Exception as e:
        print("não consegui abrir a página:", type(e).__name__, e)
    print("== endereços candidatos ==")
    root = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc"
    for y in (2021, 2022, 2023, 2024, 2025):
        for u in (f"{BASE}/ca-{y}-01.csv", f"{BASE}/ca-{y}-02.csv", f"{root}/ca/ca-{y}-01.csv", f"{root}/dsas/ca-{y}-01.csv",
                  f"{BASE}/ca-{y}-01.xlsx", f"{root}/dsas/ca/ca-{y}-01.zip"):
            print(f"  {status(u):45s} {u}")


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
    if "--list" in sys.argv:
        diagnose()
        sys.exit(0)
    main(sys.argv[1] if len(sys.argv) > 1 else "raw")
