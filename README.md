# Brasil Combustíveis · Série Histórica ANP

Dashboard interativo (HTML + D3, sem build, sem Power BI) com a série histórica de preços de gasolina, etanol e diesel da ANP (2004–2026).

**Painéis:** contador de coletas · KPIs por estado · linha do tempo com eventos e governos · halteres por região · variação anual · regra dos 70% por estado · mapa de calor etanol/gasolina (27 UFs × anos) · feed de notícias · linha do tempo com play. O estado do painel fica na URL (`#uf=SP&fuel=etanol&m=2022-06`).

## Estrutura
```
public/            site estático (é o que a Vercel publica)
  index.html, css/, js/main.js, vendor/d3.min.js
  data/series.json   preço médio mensal por UF (R$/L)
  data/events.json   notícias/marcos (edite à vontade)
  data/meta.json     { demo, coletas, fonte, atualizado }
scripts/
  make_demo_data.py  gera dados SINTÉTICOS de demonstração
  build_data.py      gera os JSONs REAIS a partir dos CSVs da ANP
vercel.json
```

## Dados reais
Os dados que vêm no repositório são **de demonstração** (aparece o selo "Dados de demonstração"). Para usar a série oficial:
```bash
pip install pandas
# baixe os CSVs semestrais da ANP (Série histórica do levantamento de preços) em raw/
python scripts/build_data.py raw/
```
Isso reescreve `series.json` e `meta.json` (`demo:false`, com a contagem real de coletas). O script normaliza colunas e produtos, mas os layouts da ANP mudaram ao longo dos anos: ajuste `COLS`/`PRODUCTS` se algum semestre for ignorado.

## Rodar local / publicar
```bash
cd public && python3 -m http.server 8000     # http://localhost:8000
```
Vercel: importe o repositório (Framework: *Other*). `vercel.json` já aponta `outputDirectory` para `public`; não há build.
