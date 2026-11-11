# Brasil Combustíveis · Série Histórica ANP

Dashboard interativo (HTML + D3, sem build, sem Power BI) com a série histórica de preços de gasolina, etanol e diesel da ANP (2004–2026).

**Painéis:** contador de coletas · KPIs por estado · **mapa do Brasil** (gasolina, etanol, diesel ou razão etanol/gasolina) · **ranking de municípios** · **preço real (IPCA)** · linha do tempo com eventos e governos · halteres por região · variação anual · regra dos 70% por estado · mapa de calor etanol/gasolina (27 UFs × anos) · feed de notícias · linha do tempo com play. O estado do painel fica na URL (`#uf=SP&fuel=etanol&m=2022-06&real=1&map=ratio`).

## Estrutura
```
public/            site estático (é o que a Vercel publica)
  index.html, css/, js/main.js, vendor/d3.min.js
  data/series.json   preço médio mensal por UF (R$/L)
  data/events.json   notícias/marcos, com data, tipo e link da fonte (curado à mão; datas após o fim da série entram só no feed)
  data/meta.json     { demo, coletas, fonte, atualizado }
  data/ipca.json     índice IPCA mensal (base do toggle Real)
  data/brasil-uf.json  malha SVG dos 27 estados (@svg-maps/brazil, CC BY 4.0)
  data/municipios.json ranking: últimos 24 meses, top 300 municípios por coletas
scripts/
  make_demo_data.py  gera dados SINTÉTICOS de demonstração
  build_data.py      gera os JSONs REAIS (séries + municípios) a partir dos CSVs da ANP
  fetch_ipca.py      baixa o IPCA oficial (SGS 433, Banco Central)
vercel.json
```

## Dados reais
Os dados que vêm no repositório são **de demonstração** (aparece o selo "Dados de demonstração"). Para usar a série oficial:
```bash
pip install pandas
# baixe os CSVs semestrais da ANP (Série histórica do levantamento de preços) em raw/
python scripts/build_data.py raw/
```
Isso reescreve `series.json`, `municipios.json` e `meta.json` (`demo:false`, com a contagem real de coletas). O script normaliza colunas e produtos, mas os layouts da ANP mudaram ao longo dos anos: ajuste `COLS`/`PRODUCTS` se algum semestre for ignorado.

**IPCA:** o `ipca.json` que vem no repositório é uma *aproximação* (taxas anuais distribuídas pelos meses; 2025–26 estimados), e a tela avisa "IPCA aprox.". Rode `python scripts/fetch_ipca.py` para trocar pelo índice oficial.

**Municípios:** na demonstração são só as 27 capitais; com os dados reais, os 300 municípios com mais coletas. O ranking cobre os últimos 24 meses.

## Rodar local / publicar
```bash
cd public && python3 -m http.server 8000     # http://localhost:8000
```
Vercel: importe o repositório (Framework: *Other*). `vercel.json` já aponta `outputDirectory` para `public`; não há build.
