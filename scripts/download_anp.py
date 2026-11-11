#!/usr/bin/env python3
"""Baixa a série histórica de preços de combustíveis automotivos da ANP (gasolina, etanol, diesel).

Uso: python scripts/download_anp.py raw/        (--list e --peek: modos de diagnóstico)

A ANP publica em três formatos; este script junta todos SEM sobreposição:
  2004-2021  .../shpc/dsas/ca/ca-AAAA-SS.csv           (semestral, CSV)
  2022       .../shpc/dsas/ca/ca-2022-0S.zip           (semestral, ZIP com o CSV)
  2023 em diante .../shpc/dsan/AAAA/<arquivo mensal>.csv (um arquivo "gasolina-etanol" e um "diesel-gnv" por mês;
             os nomes mudam de mês a mês, então os links são lidos da página da série histórica)
Todos têm as mesmas colunas ("Regiao - Sigla;...;Produto;Data da Coleta;Valor de Venda;...;Bandeira").
Arquivos de períodos antigos já baixados são reaproveitados (cache); os últimos meses são sempre baixados de novo.
"""
import datetime as dt
import io
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urljoin

ROOT = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc"
BASE = f"{ROOT}/dsas/ca"
PAGE = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis"
HEADERS = {"User-Agent": "Mozilla/5.0 (SerieHistoricaANP; +https://github.com/RodrigoAiosa/SerieHistoricaANP)"}
REFRESH_DAYS = 100   # arquivos mais recentes que isso são rebaixados (a ANP pode corrigir/atualizar)


def fetch(url, dest, tries=4):
    """Baixa url para dest. False se 404; levanta erro se falhar mesmo após as tentativas."""
    err = None
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


def page_html():
    req = urllib.request.Request(PAGE, headers=HEADERS)
    return urllib.request.urlopen(req, timeout=90).read().decode("utf-8", "replace")


def discover_monthly(html):
    """Lê da página os arquivos mensais (2023+): [(ano, mes, tipo, url)], tipo = gasolina-etanol | diesel-gnv."""
    found = {}
    for href in sorted(set(re.findall(r'href="([^"]+)"', html))):
        m = re.search(r"/shpc/dsan/(\d{4})/([^/?#]+)$", href)
        if not m:
            continue
        year, fname = int(m.group(1)), m.group(2).lower()
        kind = "gasolina-etanol" if "gasolina-etanol" in fname else "diesel-gnv" if "diesel-gnv" in fname else None
        if not kind:   # GLP e outros não entram
            continue
        mm = re.match(r"(\d{2})-", fname) or re.search(r"-(\d{2})(?:\.csv)?$", fname)
        if not mm or not 1 <= int(mm.group(1)) <= 12:
            print(f"  aviso: não entendi o mês em {fname}")
            continue
        found[(year, mm.group(1), kind)] = urljoin(PAGE, href)
    return [(y, mo, k, u) for (y, mo, k), u in sorted(found.items())]


def is_old(year, month):
    """True se o período é antigo o bastante para reaproveitar o arquivo já baixado."""
    return (dt.date.today() - dt.date(year, month, 1)).days > REFRESH_DAYS


def have(dest, old):
    return old and dest.exists() and dest.stat().st_size > 0


def save_csv_from_zip(zpath, out):
    """Extrai os CSVs de um ZIP para out/; devolve os nomes extraídos."""
    names = []
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            if info.filename.lower().endswith(".csv"):
                target = out / Path(info.filename).name
                with z.open(info) as src, open(target, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
                names.append(target.name)
    return names


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    got = 0

    # 1) semestrais 2004-2022 (CSV; 2022 em ZIP)
    for year in range(2004, 2023):
        for sem in ("01", "02"):
            name = f"ca-{year}-{sem}.csv"
            dest = out / name
            if have(dest, True):
                print(f"==  {name}  (já baixado)")
                got += 1
                continue
            if fetch(f"{BASE}/{name}", dest):
                print(f"ok  {name}  {dest.stat().st_size / 1e6:,.1f} MB")
                got += 1
                continue
            dest.unlink(missing_ok=True)
            zpath = out / f"ca-{year}-{sem}.zip"
            if fetch(f"{BASE}/ca-{year}-{sem}.zip", zpath):
                names = save_csv_from_zip(zpath, out)
                zpath.unlink(missing_ok=True)
                print(f"ok  ca-{year}-{sem}.zip -> {', '.join(names)}")
                got += 1
            else:
                zpath.unlink(missing_ok=True)
                print(f"--  ca-{year}-{sem}  (não publicado pela ANP)")

    # 2) mensais 2023+ (links lidos da página)
    monthly = discover_monthly(page_html())
    if not monthly:
        sys.exit("Nenhum arquivo mensal (2023+) encontrado na página da ANP: o layout da página mudou?")
    for year, mo, kind, url in monthly:
        name = f"dsan-{year}-{mo}-{kind}.csv"
        dest = out / name
        if have(dest, is_old(year, int(mo))):
            print(f"==  {name}  (já baixado)")
            got += 1
            continue
        if fetch(url, dest):
            print(f"ok  {name}  {dest.stat().st_size / 1e6:,.1f} MB")
            got += 1
        else:
            dest.unlink(missing_ok=True)
            print(f"--  {name}  (404: {url})")
    last = max((y, m) for y, m, _, _ in monthly)
    print(f"{got} arquivos em {out}/ · último mês publicado: {last[0]}-{last[1]}")


def status(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
            r.read(256)
            return f"{r.status} {r.headers.get('Content-Type', '?')} {r.headers.get('Content-Length', '?')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except Exception as e:
        return f"erro {type(e).__name__}: {e}"


def diagnose():
    """--list: mostra o que o download vai pegar (sem baixar nada)."""
    monthly = discover_monthly(page_html())
    print(f"{len(monthly)} arquivos mensais na página; primeiro/último: {monthly[0][:3]} / {monthly[-1][:3]}")
    for y, mo, k, u in monthly[-6:]:
        print(f"  {y}-{mo} {k:16s} {status(u):40s} {u}")
    for u in (f"{BASE}/ca-2021-02.csv", f"{BASE}/ca-2022-01.zip", f"{BASE}/ca-2022-02.zip"):
        print(f"  {status(u):40s} {u}")


if __name__ == "__main__":
    if "--list" in sys.argv:
        diagnose()
        sys.exit(0)
    main(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "raw")
