/* Brasil Combustíveis — dashboard da série histórica da ANP (HTML + D3) */
(() => {
  'use strict';

  /* ---------- constantes ---------- */
  const FUELS = [
    { k: 'gasolina', n: 'Gasolina', c: '#B87D00' },
    { k: 'etanol', n: 'Etanol', c: '#2E7D4F' },
    { k: 'diesel', n: 'Diesel', c: '#1F4E79' },
  ];
  const FUEL = Object.fromEntries(FUELS.map(f => [f.k, f]));
  const REGIONS = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
  const TYPES = {
    greve: { n: 'Greve', c: '#B87D00' },
    pandemia: { n: 'Pandemia', c: '#7a56d6' },
    guerra: { n: 'Guerra', c: '#C0392B' },
    crise: { n: 'Crise', c: '#8C5E3C' },
    anp: { n: 'ANP', c: '#5A7A2B' },
    petroleo: { n: 'Petróleo', c: '#4A5560' },
    inflacao: { n: 'Inflação', c: '#A0522D' },
    politica: { n: 'Política', c: '#5C6B7A' },
    petrobras: { n: 'Petrobras', c: '#0E7C86' },
    etanol: { n: 'Biocombustíveis', c: '#2E7D4F' },
  };
  const ERAS = [
    { n: 'Lula', from: '2004-05', to: '2010-12' },
    { n: 'Dilma', from: '2011-01', to: '2016-08' },
    { n: 'Temer', from: '2016-09', to: '2018-12' },
    { n: 'Bolsonaro', from: '2019-01', to: '2022-12' },
    { n: 'Lula', from: '2023-01', to: '2099-12' },
  ];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const THRESH = 0.70;
  const RAMP = { gasolina: ['#F8EBC8', '#7A5200'], etanol: ['#DCEBDF', '#1C4F31'], diesel: ['#DCE6F1', '#12304D'] };

  const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const f3 = nf(3), f1 = nf(1), f2 = nf(2), f0 = nf(0);
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------- estado ---------- */
  const S = { uf: 'BR', fuel: 'all', idx: 0, playing: false, type: 'all', q: '', real: false, mapMetric: null, cmp: ['SP', 'RJ', 'AM'], mv: 12, cd: false, cm: 'var', cp: 0, tf: 'gasolina', tg: 'm', tm: false };
  let D = null;           // dados processados
  let timer = null;

  /* ---------- carga ---------- */
  const optional = fetch('data/bandeira.json').then(r => (r.ok ? r.json() : null)).catch(() => null);   // opcional: sem ele o card some
  Promise.all(['series', 'events', 'meta', 'brasil-uf', 'ipca', 'municipios'].map(n => fetch(`data/${n}.json`).then(r => {
    if (!r.ok) throw new Error(`${n}.json: ${r.status}`);
    return r.json();
  })).concat(optional)).then(([series, events, meta, geo, ipca, mun, band]) => init(series, events, meta, geo, ipca, mun, band))
    .catch(err => {
      document.querySelector('.layout').innerHTML =
        `<div class="card" style="grid-column:1/-1"><b>Não foi possível carregar os dados.</b><p class="sub">${err.message}</p></div>`;
      console.error(err);
    });

  function init(series, events, meta, geo, ipca, mun, band) {
    const months = series.months, N = months.length;
    const states = series.states, ufs = states.map(s => s.uf);
    const byUf = Object.fromEntries(states.map(s => [s.uf, s]));

    // série por combustível/UF + média do Brasil (média simples dos estados)
    const data = {};
    for (const f of FUELS) {
      data[f.k] = { ...series[f.k] };
      data[f.k].BR = months.map((_, i) => d3.mean(ufs, u => series[f.k][u][i]));
    }
    const ratio = { BR: months.map((_, i) => data.etanol.BR[i] / data.gasolina.BR[i]) };
    for (const u of ufs) ratio[u] = months.map((_, i) => data.etanol[u][i] / data.gasolina[u][i]);

    const yearOf = (i) => +months[i].slice(0, 4);
    const monthOf = (i) => +months[i].slice(5) - 1;
    const label = (i) => `${MESES[monthOf(i)]}/${yearOf(i)}`;
    const years = [...new Set(months.map(m => +m.slice(0, 4)))];
    const yearIdx = {}; // ano -> índices
    months.forEach((m, i) => (yearIdx[+m.slice(0, 4)] ||= []).push(i));

    // médias anuais
    const ym = (arr, y) => d3.mean(yearIdx[y], i => arr[i]);
    // eventos posteriores ao fim da série entram no feed (i = último mês, after = true) mas não no gráfico
    const lastYm = months[N - 1];
    const evs = events.map(e => ({ ...e, after: e.date > lastYm, i: e.date > lastYm ? N - 1 : months.indexOf(e.date) }))
      .filter(e => e.i >= 0).sort((a, b) => a.i - b.i);   // ordenação estável: a ordem do arquivo desempata o mesmo mês

    // preços reais: reais de hoje (último mês) via IPCA
    const defl = ipca.indice.map(v => ipca.indice[ipca.indice.length - 1] / v);
    const dataReal = {};
    for (const f of FUELS) { dataReal[f.k] = {}; for (const u of [...ufs, 'BR']) dataReal[f.k][u] = data[f.k][u].map((v, i) => v * defl[i]); }
    const munMonths = mun.months.map(m => months.indexOf(m));

    D = { band: band && band.months.length === months.length ? band : null, dataNom: data, dataReal, defl, ipca, geo, mun, munMonths, months, N, states, ufs, byUf, ratio, years, yearIdx, yearOf, monthOf, label, ym, evs, meta };
    S.idx = N - 1;

    readHash();
    buildControls();
    renderAll(true);
    window.addEventListener('hashchange', () => { readHash(); syncControls(); renderAll(true); });
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderCharts(true)); })
      .observe($('.content'));
  }

  /* ---------- helpers de dados ---------- */
  const DT = () => (S.real ? D.dataReal : D.dataNom);
  const ser = (fuel, uf = S.uf) => DT()[fuel][uf];
  const rat = (uf = S.uf) => D.ratio[uf];
  const shown = () => (S.fuel === 'all' ? FUELS : [FUEL[S.fuel]]);
  const ufName = (u) => (u === 'BR' ? 'Brasil' : D.byUf[u].nome);
  const R$ = (v) => `R$ ${f3.format(v)}`;
  const pctTxt = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(d).format(Math.abs(v))}%`;

  /* ---------- hash ---------- */
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const uf = p.get('uf'), fuel = p.get('fuel'), m = p.get('m');
    if (uf && (uf === 'BR' || D.byUf[uf])) S.uf = uf;
    if (fuel && (fuel === 'all' || FUEL[fuel])) S.fuel = fuel;
    if (m && D.months.includes(m)) S.idx = D.months.indexOf(m);
    S.real = p.get('real') === '1';
    const cmp = p.get('cmp'); if (cmp != null) S.cmp = cmp.split(',').filter(u => D.byUf[u]).slice(0, 4);
    S.cd = p.get('cd') === '1';
    if (['gasolina', 'etanol', 'diesel'].includes(p.get('tf'))) S.tf = p.get('tf'); else if (['gasolina', 'etanol', 'diesel'].includes(S.fuel)) S.tf = S.fuel;
    S.tg = p.get('tg') === 'y' ? 'y' : 'm'; S.tm = p.get('tm') === '1';
    S.cm = p.get('cm') === 'lvl' ? 'lvl' : 'var';
    const cp = +p.get('cp'); S.cp = [1, 2].includes(cp) ? cp : 0;
    const mv = +p.get('mv'); if ([1, 12, 60].includes(mv)) S.mv = mv;
    const mm = p.get('map'); if (['gasolina', 'etanol', 'diesel', 'ratio'].includes(mm)) S.mapMetric = mm;
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.uf !== 'BR') p.set('uf', S.uf);
    if (S.fuel !== 'all') p.set('fuel', S.fuel);
    if (S.idx !== D.N - 1) p.set('m', D.months[S.idx]);
    if (S.real) p.set('real', '1');
    if (S.mapMetric) p.set('map', S.mapMetric);
    if (S.cmp.join() !== 'SP,RJ,AM') p.set('cmp', S.cmp.join(','));
    if (S.mv !== 12) p.set('mv', S.mv);
    if (S.cd) p.set('cd', '1');
    if (S.tf !== (S.fuel === 'all' ? 'gasolina' : S.fuel)) p.set('tf', S.tf);
    if (S.tg === 'y') p.set('tg', 'y');
    if (S.tm) p.set('tm', '1');
    if (S.cm !== 'var') p.set('cm', S.cm);
    if (S.cp) p.set('cp', S.cp);
    const h = p.toString();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }

  /* ---------- controles ---------- */
  function buildControls() {
    const selUf = $('#sel-uf');
    selUf.append(new Option('Brasil (média)', 'BR'));
    for (const s of D.states) selUf.append(new Option(`${s.uf} — ${s.nome}`, s.uf));
    selUf.onchange = () => setUf(selUf.value);
    $('#sel-fuel').onchange = (e) => { S.fuel = e.target.value; if (S.fuel !== 'all') S.tf = S.fuel; renderAll(true); };

    const selType = $('#sel-type');
    const present = [...new Set(D.evs.map(e => e.type))];
    for (const t of present) selType.append(new Option(TYPES[t]?.n || t, t));
    selType.onchange = () => { S.type = selType.value; renderFeed(); };
    $('#q').oninput = (e) => { S.q = e.target.value; renderFeed(); };

    const sl = $('#slider');
    sl.max = D.N - 1;
    sl.oninput = () => setIdx(+sl.value, true);
    $('#btn-play').onclick = togglePlay;
    $('#btn-last').onclick = () => { stop(); setIdx(D.N - 1); };
    $('#chip-uf').onclick = () => setUf('BR');
    $('#v-nom').onclick = () => { S.real = false; syncControls(); renderAll(true); };
    $('#v-real').onclick = () => { S.real = true; syncControls(); renderAll(true); };
    $('#btn-copy').onclick = copyResumo;
    $('#btn-csv-sel').onclick = () => downloadCsv(false);
    $('#btn-csv-all').onclick = () => downloadCsv(true);
    document.querySelectorAll('#mv-win button').forEach(b => b.onclick = () => { S.mv = +b.dataset.w; syncControls(); writeHash(); drawMovers(); });
    $('#cmp-add').onchange = (e) => { const u = e.target.value; if (u && S.cmp.length < 4 && !S.cmp.includes(u)) S.cmp.push(u); cmpControls(); writeHash(); drawCompare(); };
    document.querySelectorAll('#cmp-mode button').forEach(b => b.onclick = () => { S.cd = b.dataset.cd === '1'; syncControls(); writeHash(); drawCompare(); });
    document.querySelectorAll('.cm-mode button').forEach(b => b.onclick = () => { S.cm = b.dataset.cm; syncControls(); writeHash(); drawCorr(); });
    document.querySelectorAll('#cp-pair button').forEach(b => b.onclick = () => { S.cp = +b.dataset.p; syncControls(); writeHash(); drawCorr(); });
    document.querySelectorAll('#tb-fuel button').forEach(b => b.onclick = () => { S.tf = b.dataset.tf; syncControls(); writeHash(); buildTable(); });
    document.querySelectorAll('#tb-gran button').forEach(b => b.onclick = () => { S.tg = b.dataset.g; syncControls(); writeHash(); buildTable(); });
    $('#tb-more').onchange = (e) => { S.tm = e.target.checked; writeHash(); buildTable(); };
    $('#tb-csv').onclick = downloadTableCsv;
    buildGuide();
    if (!D.band) $('#card-band').hidden = true;
    document.querySelectorAll('#map-metric button').forEach(b => b.onclick = () => { S.mapMetric = b.dataset.m; renderAll(false); });
    if (D.meta.demo) $('#demo-flag').hidden = false;
    $('#src').textContent = `Fonte: ${D.meta.fonte || 'ANP'}`;
    $('#heat-range').textContent = `${D.years[0]} – ${D.years.at(-1)}`;
    $('#hero-range').textContent = `${D.years[0]} – ${D.years.at(-1)}`;
    syncControls();
  }
  function syncControls() {
    $('#sel-uf').value = S.uf;
    $('#sel-fuel').value = S.fuel;
    $('#slider').value = S.idx;
    $('#v-nom').classList.toggle('on', !S.real);
    $('#v-real').classList.toggle('on', S.real);
    const chip = $('#chip-uf');
    chip.hidden = S.uf === 'BR';
    chip.textContent = `${S.uf} ✕`;
    document.querySelectorAll('#mv-win button').forEach(b => b.classList.toggle('on', +b.dataset.w === S.mv));
    document.querySelectorAll('#cmp-mode button').forEach(b => b.classList.toggle('on', (b.dataset.cd === '1') === S.cd));
    document.querySelectorAll('.cm-mode button').forEach(b => b.classList.toggle('on', b.dataset.cm === S.cm));
    document.querySelectorAll('#tb-fuel button').forEach(b => b.classList.toggle('on', b.dataset.tf === S.tf));
    document.querySelectorAll('#tb-gran button').forEach(b => b.classList.toggle('on', b.dataset.g === S.tg));
    $('#tb-more').checked = S.tm;
    document.querySelectorAll('#cp-pair button').forEach(b => b.classList.toggle('on', +b.dataset.p === S.cp));
    cmpControls();
  }
  function setUf(uf) { S.uf = uf; syncControls(); renderAll(true); }
  function setIdx(i, fromSlider) {
    S.idx = Math.max(0, Math.min(D.N - 1, i));
    if (!fromSlider) $('#slider').value = S.idx;
    renderAll(false);
  }
  function togglePlay() { S.playing ? stop() : play(); }
  function play() {
    if (S.idx >= D.N - 1) S.idx = 0;
    S.playing = true; $('#btn-play').textContent = '❚❚';
    timer = setInterval(() => {
      if (S.idx >= D.N - 1) return stop();
      setIdx(S.idx + 1);
    }, 110);
  }
  function stop() { S.playing = false; clearInterval(timer); $('#btn-play').textContent = '▶'; }

  /* ---------- render ---------- */
  function renderAll(full) {
    $('#lbl-month').textContent = D.label(S.idx);
    writeHash();
    renderKpis();
    renderFeed();
    renderCharts(full);
    renderResumo();
  }
  function renderCharts(full) {
    drawLine();
    drawDumbbell();
    drawScatter();
    drawMap();
    drawMunicipios();
    drawInflation();
    drawMovers();
    drawCompare();
    drawBandeira();
    drawCorr();
    if (full || !S._tbBuilt) buildTable(); else markTable();
    if (full || !S._barsDrawn) { drawBars(); }
    else markBars();
    if (full || !S._heatDrawn) drawHeat(); else markHeat();
  }



  /* ---------- novos gráficos: inflação, altas/quedas, comparar, bandeira ---------- */
  const focusFuel = () => (S.fuel === 'all' ? 'gasolina' : S.fuel);
  const CMP_COLORS = ['#C0392B', '#6A4C93', '#00838F', '#8A5A00'];
  const escH = (t) => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // eixo X por ano (índices dos meses) — adapta a densidade à largura
  function yearAxis(svg, x, W, H, m) {
    const gx = svg.append('g').attr('class', 'axis'), step = W > 620 ? 2 : 4;
    D.years.forEach((yr, k) => { if (k % step === 0) gx.append('text').attr('x', x(D.yearIdx[yr][0])).attr('y', H - 8).attr('text-anchor', 'middle').text(yr); });
  }
  // gráfico de linhas genérico: lines = [{n,c,dash,w,v:[...]}]; v pode ter null
  function lineChart(host, lines, opt) {
    const H = opt.H || 260, i = S.idx, m = { l: 46, r: 12, t: 12, b: 24 };
    const { svg, W } = mount(host, H);
    const vals = lines.flatMap(l => l.v.filter(v => v != null && !isNaN(v)));
    if (!vals.length) { host.innerHTML = '<div class="empty">Sem dados suficientes para esta seleção.</div>'; return; }
    const x = d3.scaleLinear([0, D.N - 1], [m.l, W - m.r]);
    const y = opt.dom ? d3.scaleLinear(opt.dom, [H - m.b, m.t]) : d3.scaleLinear([Math.min(opt.min ?? Infinity, d3.min(vals)), d3.max(vals)], [H - m.b, m.t]).nice(5);
    const gy = svg.append('g').attr('class', 'axis');
    for (const t of y.ticks(opt.dom ? 4 : 5)) {
      gy.append('line').attr('class', 'gridl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      gy.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').text(opt.tick(t));
    }
    if (opt.ref != null) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(opt.ref)).attr('y2', y(opt.ref)).attr('stroke', '#bdbdbd').attr('stroke-dasharray', '2 3');
    yearAxis(svg, x, W, H, m);
    for (const l of lines)
      svg.append('path').datum(l.v).attr('fill', 'none').attr('stroke', l.c).attr('stroke-width', l.w || 1.7).attr('stroke-linejoin', 'round')
        .attr('stroke-dasharray', l.dash || null).attr('d', d3.line().defined(v => v != null && !isNaN(v)).x((_, k) => x(k)).y(v => y(v)));
    const cur = svg.append('g');
    cur.append('line').attr('x1', x(i)).attr('x2', x(i)).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#8A5A00');
    for (const l of lines) if (l.v[i] != null) cur.append('circle').attr('cx', x(i)).attr('cy', y(l.v[i])).attr('r', 3.8).attr('fill', l.c).attr('stroke', '#fff').attr('stroke-width', 1.4);
    const guide = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#bbb').attr('stroke-dasharray', '3 3').style('display', 'none');
    const kAt = (e) => Math.max(0, Math.min(D.N - 1, Math.round(x.invert(d3.pointer(e)[0]))));
    svg.append('rect').attr('class', 'hover-rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.b - m.t)
      .on('mousemove', (e) => {
        const k = kAt(e); guide.style('display', null).attr('x1', x(k)).attr('x2', x(k));
        const rows = lines.filter(l => l.v[k] != null).sort((a, b) => b.v[k] - a.v[k]);
        showTip(e, `<b>${D.label(k)}</b><br>` + rows.map(l => `<span style="color:#cfd8dc">●</span> ${escH(l.n)} <span class="mono">${opt.tip(l.v[k])}</span>`).join('<br>'));
      })
      .on('mouseleave', () => { guide.style('display', 'none'); hideTip(); })
      .on('click', (e) => { stop(); setIdx(kAt(e)); });
  }
  const legendLines = (lines, fmt) => lines.map(l =>
    `<span class="it"><i class="ln${l.dash ? ' dash' : ''}" style="border-color:${l.c}"></i>${escH(l.n)}${l.v[S.idx] != null ? ` <span class="v">${fmt(l.v[S.idx])}</span>` : ''}</span>`).join('');

  /* 1 · combustível contra a inflação (base 100 no 1º mês) */
  function drawInflation() {
    const fuels = shown(), i = S.idx;
    const base = (a) => a.map(v => v / a[0] * 100);
    const ip = base(D.ipca.indice);
    const lines = fuels.map(f => ({ n: f.n, c: f.c, v: base(D.dataNom[f.k][S.uf]) }))
      .concat({ n: 'IPCA (inflação)', c: '#5B666E', dash: '5 3', w: 2, v: ip });
    $('#s-infl').textContent = `${ufName(S.uf)} · base 100 = ${D.label(0)} · valores nominais`;
    $('#legend-infl').innerHTML = legendLines(lines, v => f0.format(v));
    lineChart($('#chart-infl'), lines, { H: 290, min: 100, ref: 100, tick: (t) => f0.format(t), tip: (v) => `${f0.format(v)} <small>(${pctTxt(v - 100, 0)})</small>` });
    const ipg = ip[i] - 100;
    $('#n-infl').innerHTML = (i === 0 ? 'Escolha um mês depois do início para comparar.' : lines.slice(0, -1).map(l => {
      const g = l.v[i] - 100, d = g - ipg;
      return `<b style="color:${FUEL[fuels.find(f => f.n === l.n).k].c}">${l.n}</b> ${pctTxt(g, 0)} · IPCA ${pctTxt(ipg, 0)} → <span class="${d > 0 ? 'up' : 'dn'}">${f0.format(Math.abs(d))} p.p. ${d > 0 ? 'acima' : 'abaixo'} da inflação</span>`;
    }).join('<br>')) + (D.ipca.aproximado ? '<br><span class="sub">IPCA aproximado — rode scripts/fetch_ipca.py para o oficial.</span>' : '');
  }

  /* 4 · maiores altas e quedas entre estados */
  function drawMovers() {
    const host = $('#chart-mov'), f = FUEL[focusFuel()], i = S.idx, w = Math.min(S.mv, i);
    $('#s-mov').textContent = `${f.n} · ${w ? `variação em ${w} ${w === 1 ? 'mês' : 'meses'} até ${D.label(i)}` : 'escolha um mês depois do início'} · ${S.real ? 'real' : 'nominal'}${S.fuel === 'all' ? ' · filtre o combustível acima' : ''}`;
    if (!w) { host.innerHTML = '<div class="empty">Mova a linha do tempo para um mês posterior a ' + D.label(0) + '.</div>'; return; }
    const rows = D.ufs.map(u => { const a = DT()[f.k][u]; return { u, p: (a[i] / a[i - w] - 1) * 100, v: a[i] }; }).sort((a, b) => b.p - a.p);
    const K = 7, list = rows.length > 2 * K ? [...rows.slice(0, K), { gap: true }, ...rows.slice(-K)] : rows;
    const rh = 21, H = list.reduce((h, r) => h + (r.gap ? 16 : rh), 0) + 14;
    const { svg, W } = mount(host, H);
    const m = { l: 140, r: 50 };
    const ext = d3.extent(list.filter(r => !r.gap).map(r => r.p).concat(0));
    const x = d3.scaleLinear(ext, [m.l + (ext[0] < 0 ? 46 : 0), W - m.r]).nice();
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 4).attr('y2', H - 4).attr('stroke', '#bdbdbd');
    let yy = 6;
    for (const r of list) {
      if (r.gap) { svg.append('text').attr('x', m.l).attr('y', yy + 11).style('font', '400 10px var(--mono)').attr('fill', '#999').text('···'); yy += 16; continue; }
      const g = svg.append('g').attr('class', 'mov-row').attr('transform', `translate(0,${yy})`);
      const up = r.p >= 0, x0 = x(Math.min(0, r.p)), bw = Math.max(1, Math.abs(x(r.p) - x(0)));
      g.append('text').attr('x', m.l - 8).attr('y', rh / 2 + 3).attr('text-anchor', 'end').style('font', `${r.u === S.uf ? 700 : 400} 11px var(--sans, Inter)`).attr('fill', '#1F2A33').text(`${r.u} · ${D.byUf[r.u].nome}`);
      g.append('rect').attr('class', 'bar').attr('x', x0).attr('y', 3).attr('width', bw).attr('height', rh - 6).attr('rx', 2).attr('fill', up ? '#C0392B' : '#2E7D4F').attr('opacity', .85)
        .attr('stroke', r.u === S.uf ? '#1F2A33' : 'none').attr('stroke-width', 1.6);
      g.append('text').attr('x', up ? x(r.p) + 5 : x(r.p) - 5).attr('y', rh / 2 + 3).attr('text-anchor', up ? 'start' : 'end').style('font', '500 10.5px var(--mono)').attr('fill', '#1F2A33').text(pctTxt(r.p));
      g.append('rect').attr('class', 'hover-rect').attr('x', 0).attr('width', W).attr('height', rh)
        .on('mousemove', (e) => showTip(e, `<b>${D.byUf[r.u].nome}</b><br>${f.n} <span class="mono">${R$(r.v)}</span><br>${w} ${w === 1 ? 'mês' : 'meses'}: <span class="mono">${pctTxt(r.p)}</span>`))
        .on('mouseleave', hideTip).on('click', () => setUf(r.u));
      yy += rh;
    }
  }

  /* 3 · comparar estados */
  function cmpControls() {
    const chips = $('#cmp-chips'), sel = $('#cmp-add'); if (!chips) return;
    chips.innerHTML = '';
    S.cmp.forEach((u, k) => {
      const b = el('button', 'cchip', `<i style="background:${CMP_COLORS[k]}"></i>${u} ✕`);
      b.type = 'button'; b.title = `Remover ${ufName(u)}`;
      b.onclick = () => { S.cmp.splice(k, 1); cmpControls(); writeHash(); drawCompare(); };
      chips.append(b);
    });
    sel.innerHTML = '';
    const full = S.cmp.length >= 4;
    sel.append(new Option(full ? 'Máximo de 4 estados' : '+ Adicionar estado', ''));
    for (const s of D.states) if (!S.cmp.includes(s.uf)) sel.append(new Option(`${s.uf} — ${s.nome}`, s.uf));
    sel.disabled = full; sel.value = '';
  }
  function drawCompare() {
    const f = FUEL[focusFuel()];
    const us = S.cmp.filter(u => D.byUf[u]), BRv = DT()[f.k].BR;
    let lines, opt;
    if (S.cd) {   // diferença percentual contra a média do Brasil (separa estados com preços parecidos)
      lines = us.map((u, k) => ({ n: ufName(u), c: CMP_COLORS[k], v: DT()[f.k][u].map((v, j) => (v / BRv[j] - 1) * 100) }));
      opt = { H: 270, ref: 0, tick: (t) => pctTxt(t, 0), tip: (v) => pctTxt(v) };
    } else {
      lines = [{ n: 'Brasil (média)', c: '#8A949B', dash: '4 3', w: 1.8, v: BRv }]
        .concat(us.map((u, k) => ({ n: ufName(u), c: CMP_COLORS[k], v: DT()[f.k][u] })));
      opt = { H: 270, tick: (t) => f2.format(t), tip: R$ };
    }
    $('#s-cmp').textContent = `${f.n} · ${S.cd ? '% acima (+) ou abaixo (−) da média do Brasil' : 'R$/litro'} · ${S.real ? 'valores reais' : 'valores nominais'}${S.fuel === 'all' ? ' · filtre o combustível acima' : ''}`;
    $('#legend-cmp').innerHTML = legendLines(lines, S.cd ? (v) => pctTxt(v) : R$);
    if (!lines.length) { $('#chart-cmp').innerHTML = '<div class="empty">Adicione estados para comparar com a média do Brasil.</div>'; return; }
    lineChart($('#chart-cmp'), lines, opt);
    if (!us.length) $('#chart-cmp').insertAdjacentHTML('beforeend', '<div class="empty">Adicione estados para comparar com a média do Brasil.</div>');
  }

  /* 8 · bandeira branca x bandeiradas */
  function bandSeries(kind, fuel, uf) {
    const B = D.band, get = (u, k) => B[kind][fuel][u]?.[k];
    return D.months.map((_, k) => {
      const v = uf === 'BR' ? d3.mean(D.ufs, u => get(u, k)) : get(uf, k);
      return v == null || isNaN(v) ? null : v * (S.real ? D.defl[k] : 1);
    });
  }
  function drawBandeira() {
    if (!D.band) return;
    const f = FUEL[focusFuel()], i = S.idx;
    const br = bandSeries('branca', f.k, S.uf), bd = bandSeries('bandeirada', f.k, S.uf);
    const lines = [{ n: 'Bandeiradas', c: f.c, v: bd }, { n: 'Bandeira branca', c: f.c, dash: '5 3', v: br }];
    $('#s-band').textContent = `${f.n} · ${ufName(S.uf)} · ${S.real ? 'real' : 'nominal'}${S.fuel === 'all' ? ' · filtre o combustível acima' : ''}`;
    $('#legend-band').innerHTML = legendLines(lines, R$);
    lineChart($('#chart-band'), lines, { H: 240, tick: (t) => f2.format(t), tip: R$ });
    const gap = (k) => (br[k] != null && bd[k] != null ? (br[k] / bd[k] - 1) * 100 : null);
    const g = gap(i), all = D.months.map((_, k) => gap(k)).filter(v => v != null);
    const avg = all.length ? d3.mean(all) : null;
    $('#n-band').innerHTML = g == null ? 'Sem dados de bandeira branca para este mês.'
      : `Em ${D.label(i)}, a bandeira branca estava <span class="${g < 0 ? 'dn' : 'up'}">${f1.format(Math.abs(g))}% ${g < 0 ? 'mais barata' : 'mais cara'}</span> (${R$(br[i] - bd[i] < 0 ? bd[i] - br[i] : br[i] - bd[i])}/litro de diferença).`
        + (avg != null ? ` Média da série: ${pctTxt(avg)}.` : '');
  }


  /* ---------- sumário (guia de cada item do painel) ---------- */
  const GUIDE = [
    ['Controles', [
      ['Estado', '.topbar', 'Filtra o painel para um estado. “Brasil (média)” é a média simples dos 27 estados. Também dá para escolher clicando no mapa, nas barras, na dispersão ou no ranking de municípios.'],
      ['Combustível', '.topbar', 'Gasolina, etanol, diesel ou “Os três”. Os gráficos que mostram um combustível só (altas e quedas, comparar estados, bandeira) usam a gasolina quando está em “Os três”.'],
      ['Nominal / Real (IPCA)', '.topbar', '<em>Nominal</em> é o preço como foi coletado. <em>Real</em> corrige pelo IPCA e mostra tudo em reais de hoje, para comparar épocas diferentes sem o efeito da inflação.'],
      ['Linha do tempo', '.timebar', 'Escolhe o mês analisado; todo o painel acompanha. O botão ▶ anima mês a mês e “Mais recente” volta ao último mês. A seleção fica no endereço da página, então o link já compartilha a visão atual.'],
    ]],
    ['Notícias', [
      ['O que aconteceu', '.feed', 'Fatos que mexeram com o preço (greves, guerras, mudanças de política, reajustes). Aparecem os mais próximos do mês escolhido, com fonte. Dá para buscar por qualquer termo, filtrar por tipo e clicar num fato para ir ao mês dele. Passe o mouse sobre um fato para ver a miniatura da matéria.'],
    ]],
    ['Indicadores (cartões)', [
      ['Gasolina · Etanol · Diesel', '#kpis', 'Preço médio por litro no mês, a variação contra o mês anterior (▲ vermelho = subiu, ▼ verde = caiu) e uma mini-linha com a série inteira.'],
      ['Etanol vale a pena?', '#kpis', 'Preço do etanol ÷ preço da gasolina. Até 70% compensa abastecer com etanol; acima disso, a gasolina rende mais por real gasto.'],
      ['Posição no ranking', '#kpis', 'Com um estado escolhido, mostra a posição dele entre os 27 no preço da gasolina (1º = mais caro).'],
      ['Contra a média do Brasil', '#kpis', 'Quanto a gasolina do estado está acima ou abaixo da média nacional, em % e em R$ por litro.'],
    ]],
    ['Gráficos', [
      ['Para onde foi o preço', '#chart-line', 'A série mensal desde 2004. Os círculos no topo são os fatos do feed e as faixas indicam os governos. Passe o mouse para ver os valores; clique para ir ao mês.'],
      ['Onde é mais caro abastecer', '#chart-dumb', 'Preço médio de cada região no mês. Cada ponto é um combustível; quanto mais à direita, mais caro.'],
      ['Quanto subiu em cada ano', '#chart-bars', 'Variação % da média de cada ano contra o ano anterior. O ano do mês selecionado fica destacado; clique numa coluna para ir àquele ano.'],
      ['Vale a pena abastecer com etanol?', '#chart-scatter', 'Cada ponto é um estado: na horizontal, o preço da gasolina; na vertical, a razão etanol ÷ gasolina. A faixa verde (abaixo de 70%) é onde o etanol compensa.'],
      ['Mapa do Brasil', '#chart-map', 'Os estados coloridos pelo valor do mês (gasolina, etanol, diesel ou razão etanol ÷ gasolina). Cor mais escura = valor mais alto. Clique num estado para selecioná-lo.'],
      ['Municípios mais caros e mais baratos', '#mun-list', 'Os 7 municípios mais caros e os 7 mais baratos entre os mais pesquisados, só dos últimos 24 meses dos dados. Com um estado escolhido, o recorte é dele.'],
      ['Combustível contra a inflação', '#chart-infl', 'Gasolina, etanol e diesel com o IPCA, todos em base 100 no primeiro mês. Acima da linha tracejada do IPCA, o combustível subiu mais que a inflação.'],
      ['Maiores altas e quedas', '#chart-mov', 'Os 7 estados que mais subiram e os 7 que mais caíram em 1 mês, 12 meses ou 5 anos, até o mês escolhido. Clique numa barra para selecionar o estado.'],
      ['Comparar estados', '#chart-cmp', 'Até 4 estados lado a lado com a média do Brasil. O modo “vs. Brasil” mostra a diferença em % e separa estados de preços parecidos.'],
      ['Bandeira branca vs. bandeiradas', '#chart-band', 'Preço médio em postos sem bandeira (brancos) contra postos de distribuidoras, e quanto o branco é mais barato ou mais caro no mês.'],
      ['Mapa de calor etanol ÷ gasolina', '#chart-heat', 'Um quadro estado × ano com a razão etanol ÷ gasolina. Tons de verde = o etanol compensou naquele ano e lugar; tons quentes = não compensou.'],
    ]],
    ['Correlações', [
      ['Matriz de correlação', '#chart-cmat', 'Mede o quanto gasolina, etanol, diesel e IPCA andam juntos (r de −1 a +1; azul = juntos, vermelho = em sentidos opostos). Use “Variações” (mudança mês a mês), que mostra a relação real; “Níveis” fica inflado porque tudo sobe com o tempo. Clique numa célula para ver o par na dispersão.'],
      ['Um combustível explica o outro?', '#chart-cscat', 'Cada ponto é um mês, com a reta de tendência, r, R² e quanto um combustível varia quando o outro varia 1%. Pontos claros são anos antigos; o círculo dourado é o mês selecionado.'],
      ['A relação mudou ao longo do tempo?', '#chart-croll', 'Correlação das variações mensais numa janela móvel de 36 meses para cada par. Quedas bruscas indicam períodos em que a ligação entre os preços se rompeu.'],
      ['Quem acompanha o Brasil', '#chart-crank', 'Correlação de cada estado com a média nacional. Valores baixos indicam estados cujo preço se move mais por conta própria.'],
    ]],
    ['Resumo e dados', [
      ['Tabela de variações', '#tabela', 'Período, valor, %YoY (contra o mesmo mês do ano anterior) e %MoM (contra o mês anterior), do mais recente para o mais antigo. Dá para trocar o combustível, ver por ano e ligar “Mais colunas” (Δ R$, % no ano, mínimo e máximo para ver a volatilidade, IPCA 12m e vs. Brasil). A linha dourada é o mês selecionado e há botão para baixar CSV.'],
      ['Resumo da seleção', '#resumo', 'Texto pronto para apresentar, gerado conforme os filtros: preços, variações, inflação, regra dos 70%, ranking e fatos recentes. Tem botão para copiar e para baixar CSV (da seleção ou da série completa).'],
      ['Fonte e avisos', '.foot', 'Dados da ANP (levantamento de preços de revenda). “Dados de demonstração” indica números sintéticos; “IPCA aproximado” indica que o índice oficial ainda não foi carregado.'],
    ]],
  ];
  function buildGuide() {
    const dlg = $('#guide'), body = $('#guide-body');
    body.innerHTML = GUIDE.map(([grp, items]) => `<h4>${grp}</h4>` + items.map(([t, sel, d]) =>
      `<button class="g-item" type="button" data-sel="${sel}"><b>${t}<span>ir ↗</span></b><p>${d}</p></button>`).join('')).join('');
    $('#btn-guide').onclick = () => dlg.showModal();
    $('#guide-close').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // clique fora (no fundo)
    body.querySelectorAll('.g-item').forEach(b => b.onclick = () => {
      const node = document.querySelector(b.dataset.sel); if (!node) return;
      const target = node.closest('.card, .feed, .timebar, .topbar, .foot, .kpis') || node;
      dlg.close();
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    });
  }


  /* ---------- correlações ---------- */
  const CVARS = [{ k: 'gasolina', n: 'Gasolina' }, { k: 'etanol', n: 'Etanol' }, { k: 'diesel', n: 'Diesel' }, { k: 'ipca', n: 'IPCA' }];
  const CPAIRS = [['gasolina', 'etanol'], ['gasolina', 'diesel'], ['etanol', 'diesel']];
  const CNAME = (k) => CVARS.find(v => v.k === k).n;
  const pearson = (a, b) => {
    const n = a.length; if (n < 3) return null;
    const ma = d3.mean(a), mb = d3.mean(b); let sab = 0, saa = 0, sbb = 0;
    for (let k = 0; k < n; k++) { const da = a[k] - ma, db = b[k] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
  };
  const chg = (arr) => arr.map((v, k) => (k ? (v / arr[k - 1] - 1) * 100 : null));   // variação mensal em %
  const cSer = (k, uf) => (k === 'ipca' ? D.ipca.indice : D.dataNom[k][uf]);          // sempre nominal
  const cBase = (k, uf) => (S.cm === 'var' ? chg(cSer(k, uf)) : cSer(k, uf));
  const cFrom = () => (S.cm === 'var' ? 1 : 0);
  const cr = (v) => (v == null ? '—' : f2.format(v));
  const cLabel = (r) => {
    if (r == null) return 'sem dados';
    const a = Math.abs(r), g = a < .2 ? 'muito fraca' : a < .4 ? 'fraca' : a < .6 ? 'moderada' : a < .8 ? 'forte' : 'muito forte';
    return `${g}${a < .2 ? '' : r > 0 ? ' positiva' : ' negativa'}`;
  };
  const cMode = () => (S.cm === 'var' ? 'variações mensais (%)' : 'níveis de preço');
  const cMinMsg = (host) => { host.innerHTML = '<div class="empty">Mova a linha do tempo para depois de ' + D.label(Math.min(D.N - 1, 12)) + ' — são necessários ao menos 12 meses.</div>'; };
  const cCorr = (k1, k2, uf, i) => { const a = cBase(k1, uf), b = cBase(k2, uf), f = cFrom(); return pearson(a.slice(f, i + 1), b.slice(f, i + 1)); };

  function drawCorr() { drawCorrMatrix(); drawCorrScatter(); drawCorrRolling(); drawCorrRank(); }

  /* matriz 4×4 (gasolina, etanol, diesel, IPCA) */
  function drawCorrMatrix() {
    const host = $('#chart-cmat'), i = S.idx;
    $('#s-cmat').textContent = `${ufName(S.uf)} · ${cMode()} · ${D.label(0)} até ${D.label(i)} · nominal`;
    if (i < 12) { cMinMsg(host); $('#n-cmat').textContent = ''; return; }
    const n = CVARS.length, lab = 62, W0 = Math.max(240, host.clientWidth), cell = Math.min(74, (W0 - lab - 6) / n), top = 26;
    const { svg } = mount(host, top + n * cell + 6);
    const col = d3.scaleLinear([-1, 0, 1], ['#C0392B', '#FFFFFF', '#1F4E79']).clamp(true);
    const M = CVARS.map(a => CVARS.map(b => (a.k === b.k ? 1 : cCorr(a.k, b.k, S.uf, i))));
    CVARS.forEach((v, c) => svg.append('text').attr('x', lab + c * cell + cell / 2).attr('y', 17).attr('text-anchor', 'middle').style('font', '500 11px var(--mono)').attr('fill', '#5B666E').text(v.n));
    CVARS.forEach((v, r) => svg.append('text').attr('x', lab - 8).attr('y', top + r * cell + cell / 2 + 4).attr('text-anchor', 'end').style('font', '500 11px var(--mono)').attr('fill', '#5B666E').text(v.n));
    CVARS.forEach((a, r) => CVARS.forEach((b, c) => {
      const v = M[r][c], g = svg.append('g').style('cursor', CPAIRS.some(p => p.includes(a.k) && p.includes(b.k)) && a.k !== b.k ? 'pointer' : 'default');
      g.append('rect').attr('x', lab + c * cell + 1).attr('y', top + r * cell + 1).attr('width', cell - 2).attr('height', cell - 2).attr('rx', 4).attr('fill', v == null ? '#eee' : col(v));
      g.append('text').attr('x', lab + c * cell + cell / 2).attr('y', top + r * cell + cell / 2 + 4).attr('text-anchor', 'middle').style('font', '600 13px var(--mono)')
        .attr('fill', v != null && Math.abs(v) > .55 ? '#fff' : '#1F2A33').text(cr(v));
      g.on('mousemove', (e) => showTip(e, `<b>${a.n} × ${b.n}</b><br>r = <span class="mono">${cr(v)}</span> · ${cLabel(a.k === b.k ? 1 : v)}<br>${cMode()}`)).on('mouseleave', hideTip)
        .on('click', () => { const k = CPAIRS.findIndex(p => p.includes(a.k) && p.includes(b.k)); if (a.k !== b.k && k >= 0) { S.cp = k; syncControls(); writeHash(); drawCorrScatter(); } });
    }));
    const off = []; CVARS.forEach((a, r) => CVARS.forEach((b, c) => { if (c > r && M[r][c] != null) off.push({ a, b, v: M[r][c] }); }));
    off.sort((x, y) => y.v - x.v);
    const hi = off[0], lo = off.at(-1);
    $('#n-cmat').innerHTML = `Mais ligados: <b>${hi.a.n} × ${hi.b.n}</b> (r = ${cr(hi.v)}, ${cLabel(hi.v)}). Menos ligados: <b>${lo.a.n} × ${lo.b.n}</b> (r = ${cr(lo.v)}, ${cLabel(lo.v)}).`
      + (S.cm === 'lvl' ? '<br><span class="sub">Em níveis, quase tudo sobe junto com o tempo e a correlação fica inflada; as variações mensais mostram a relação de verdade.</span>' : '')
      + (D.ipca.aproximado ? '<br><span class="sub">IPCA aproximado: correlações com ele são só indicativas.</span>' : '');
  }

  /* dispersão de um par com reta de regressão */
  function drawCorrScatter() {
    const host = $('#chart-cscat'), i = S.idx, [ka, kb] = CPAIRS[S.cp], f = cFrom();
    $('#s-cscat').textContent = `${ufName(S.uf)} · ${CNAME(kb)} (eixo vertical) contra ${CNAME(ka)} (horizontal) · ${cMode()} · cada ponto é um mês`;
    if (i < 12) { cMinMsg(host); $('#n-cscat').textContent = ''; return; }
    const A = cBase(ka, S.uf), B = cBase(kb, S.uf);
    const pts = []; for (let k = f; k <= i; k++) pts.push({ k, x: A[k], y: B[k] });
    const H = 290, m = { l: 48, r: 14, t: 12, b: 34 };
    const { svg, W } = mount(host, H);
    const x = d3.scaleLinear(d3.extent(pts, p => p.x), [m.l, W - m.r]).nice(5), y = d3.scaleLinear(d3.extent(pts, p => p.y), [H - m.b, m.t]).nice(5);
    const unit = S.cm === 'var' ? (v) => `${f0.format(v)}%` : (v) => f2.format(v);
    const ax = svg.append('g').attr('class', 'axis');
    for (const t of y.ticks(5)) { ax.append('line').attr('class', 'gridl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t)); ax.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').text(unit(t)); }
    for (const t of x.ticks(6)) ax.append('text').attr('x', x(t)).attr('y', H - m.b + 15).attr('text-anchor', 'middle').text(unit(t));
    ax.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 4).attr('text-anchor', 'middle').text(`${CNAME(ka)}${S.cm === 'var' ? ' · variação mensal' : ' · R$/litro'}`);
    if (S.cm === 'var') { // eixos em zero
      if (x.domain()[0] < 0) svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#bdbdbd').attr('stroke-dasharray', '2 3');
      if (y.domain()[0] < 0) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#bdbdbd').attr('stroke-dasharray', '2 3');
    }
    const tcol = d3.scaleLinear([0, D.N - 1], ['#E3BE6B', '#1F2A33']);   // mais antigo = dourado claro, mais recente = escuro
    svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', p => x(p.x)).attr('cy', p => y(p.y)).attr('r', 2.8).attr('fill', p => tcol(p.k)).attr('opacity', .78);
    // regressão linear (mínimos quadrados)
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), mx = d3.mean(xs), my = d3.mean(ys);
    const sxx = d3.sum(xs, v => (v - mx) ** 2), sxy = d3.sum(pts, p => (p.x - mx) * (p.y - my));
    const r = pearson(xs, ys);
    if (sxx) { const b1 = sxy / sxx, b0 = my - b1 * mx, [x0, x1] = x.domain();
      svg.append('line').attr('x1', x(x0)).attr('x2', x(x1)).attr('y1', y(b0 + b1 * x0)).attr('y2', y(b0 + b1 * x1)).attr('stroke', '#C0392B').attr('stroke-width', 2).attr('clip-path', null);
      const cur = pts.at(-1); svg.append('circle').attr('cx', x(cur.x)).attr('cy', y(cur.y)).attr('r', 6).attr('fill', 'none').attr('stroke', '#B87D00').attr('stroke-width', 2.2);
      $('#n-cscat').innerHTML = `<b>r = ${cr(r)}</b> · R² = ${cr(r * r)} · ${pts.length} meses — correlação <b>${cLabel(r)}</b>.`
        + (S.cm === 'var' ? ` Em média, cada +1% na ${CNAME(ka).toLowerCase()} acompanha ${b1 >= 0 ? '+' : '−'}${f2.format(Math.abs(b1))}% no ${CNAME(kb).toLowerCase()} no mesmo mês.` : '')
        + ' <span class="sub">Pontos claros = anos antigos; escuros = recentes; círculo dourado = mês selecionado.</span>';
    }
    const dl = d3.Delaunay.from(pts, p => x(p.x), p => y(p.y));
    svg.append('rect').attr('class', 'hover-rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .on('mousemove', (e) => { const [px, py] = d3.pointer(e), p = pts[dl.find(px, py)]; showTip(e, `<b>${D.label(p.k)}</b><br>${CNAME(ka)} <span class="mono">${S.cm === 'var' ? pctTxt(p.x) : R$(p.x)}</span><br>${CNAME(kb)} <span class="mono">${S.cm === 'var' ? pctTxt(p.y) : R$(p.y)}</span>`); })
      .on('mouseleave', hideTip).on('click', (e) => { const [px, py] = d3.pointer(e); stop(); setIdx(pts[dl.find(px, py)].k); });
  }

  /* correlação móvel de 36 meses entre pares */
  function drawCorrRolling() {
    const W36 = 36, uf = S.uf, colors = ['#6A4C93', '#C0392B', '#00838F'];
    const lines = CPAIRS.map(([a, b], q) => {
      const ca = chg(D.dataNom[a][uf]), cb = chg(D.dataNom[b][uf]);
      return { n: `${CNAME(a)} × ${CNAME(b)}`, c: colors[q], v: ca.map((_, k) => (k >= W36 ? pearson(ca.slice(k - W36 + 1, k + 1), cb.slice(k - W36 + 1, k + 1)) : null)) };
    });
    $('#s-croll').textContent = `${ufName(uf)} · correlação das variações mensais numa janela móvel de ${W36} meses`;
    $('#legend-croll').innerHTML = legendLines(lines, cr);
    lineChart($('#chart-croll'), lines, { H: 290, dom: [-1, 1], ref: 0, tick: (t) => f2.format(t), tip: cr });
    const vs = lines.map(l => ({ n: l.n, v: l.v[S.idx] })).filter(o => o.v != null);
    $('#n-croll').innerHTML = (vs.length ? `Em ${D.label(S.idx)}: ` + vs.map(o => `${o.n} <b>${cr(o.v)}</b> (${cLabel(o.v)})`).join(' · ') + '. ' : `Há dados só a partir de ${D.label(W36)}. `)
      + '<span class="sub">Perto de +1: andam juntos · perto de 0: independentes · negativo: sentidos opostos. Quedas bruscas costumam coincidir com choques (greves, guerra, mudança de política).</span>';
  }

  /* correlação de cada estado com a média do Brasil (variações mensais do combustível) */
  function drawCorrRank() {
    const host = $('#chart-crank'), fk = focusFuel(), i = S.idx;
    $('#s-crank').textContent = `${FUEL[fk].n} · variações mensais · cada estado contra a média do Brasil · até ${D.label(i)}`;
    if (i < 12) { cMinMsg(host); $('#n-crank').textContent = ''; return; }
    const br = chg(D.dataNom[fk].BR).slice(1, i + 1);
    const rows = D.ufs.map(u => ({ u, r: pearson(chg(D.dataNom[fk][u]).slice(1, i + 1), br) })).filter(o => o.r != null).sort((a, b) => b.r - a.r);
    const K = 7, list = rows.length > 2 * K ? [...rows.slice(0, K), { gap: true }, ...rows.slice(-K)] : rows;
    const rh = 21, H = list.reduce((h, r) => h + (r.gap ? 16 : rh), 0) + 14;
    const { svg, W } = mount(host, H);
    const m = { l: 140, r: 44 };
    const x = d3.scaleLinear([Math.min(0, d3.min(rows, o => o.r)), 1], [m.l, W - m.r]);
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 4).attr('y2', H - 4).attr('stroke', '#bdbdbd');
    let yy = 6;
    for (const o of list) {
      if (o.gap) { svg.append('text').attr('x', m.l).attr('y', yy + 11).style('font', '400 10px var(--mono)').attr('fill', '#999').text('···'); yy += 16; continue; }
      const g = svg.append('g').attr('class', 'mov-row').attr('transform', `translate(0,${yy})`);
      g.append('text').attr('x', m.l - 8).attr('y', rh / 2 + 3).attr('text-anchor', 'end').style('font', `${o.u === S.uf ? 700 : 400} 11px var(--sans, Inter)`).attr('fill', '#1F2A33').text(`${o.u} · ${D.byUf[o.u].nome}`);
      g.append('rect').attr('class', 'bar').attr('x', x(Math.min(0, o.r))).attr('y', 3).attr('width', Math.max(1, Math.abs(x(o.r) - x(0)))).attr('height', rh - 6).attr('rx', 2).attr('fill', '#1F4E79').attr('opacity', .85)
        .attr('stroke', o.u === S.uf ? '#1F2A33' : 'none').attr('stroke-width', 1.6);
      g.append('text').attr('x', x(o.r) + 5).attr('y', rh / 2 + 3).style('font', '500 10.5px var(--mono)').attr('fill', '#1F2A33').text(cr(o.r));
      g.append('rect').attr('class', 'hover-rect').attr('width', W).attr('height', rh)
        .on('mousemove', (e) => showTip(e, `<b>${D.byUf[o.u].nome}</b><br>r = <span class="mono">${cr(o.r)}</span> · ${cLabel(o.r)}<br>com a média do Brasil`)).on('mouseleave', hideTip).on('click', () => setUf(o.u));
      yy += rh;
    }
    $('#n-crank').innerHTML = `Quanto menor o valor, mais o estado se move por conta própria (impostos locais, logística). Mais descolado: <b>${ufName(rows.at(-1).u)}</b> (${cr(rows.at(-1).r)}).`;
  }


  /* ---------- tabela: período · valor · %YoY · %MoM (+ colunas extras) ---------- */
  function tableRows() {
    const a = DT()[S.tf][S.uf], br = DT()[S.tf].BR, ip = D.ipca.indice, rows = [];
    if (S.tg === 'm') {
      for (let i = 0; i < D.N; i++) {
        const yi = D.yearIdx[D.yearOf(i)][0];
        rows.push({
          i, per: D.label(i), v: a[i],
          yoy: i >= 12 ? (a[i] / a[i - 12] - 1) * 100 : null,
          mom: i >= 1 ? (a[i] / a[i - 1] - 1) * 100 : null,
          dr: i >= 1 ? a[i] - a[i - 1] : null,
          mn: d3.min(a.slice(Math.max(0, i - 11), i + 1)), mx: d3.max(a.slice(Math.max(0, i - 11), i + 1)),
          ytd: i > yi ? (a[i] / a[yi - 1 >= 0 ? yi - 1 : yi] - 1) * 100 : null,
          ipca: i >= 12 ? (ip[i] / ip[i - 12] - 1) * 100 : null,
          vsbr: S.uf !== 'BR' ? (a[i] / br[i] - 1) * 100 : null,
        });
      }
    } else {
      let prev = null;
      for (const yr of D.years) {
        const ix = D.yearIdx[yr], v = d3.mean(ix, k => a[k]), last = ix.at(-1);
        const ipv = d3.mean(ix, k => ip[k]);
        rows.push({
          i: last, per: ix.length < 12 ? `${yr}*` : String(yr), v,
          yoy: prev ? (v / prev.v - 1) * 100 : null, mom: null,
          dr: prev ? v - prev.v : null, mn: d3.min(ix, k => a[k]), mx: d3.max(ix, k => a[k]), ytd: null, ipca: prev ? (ipv / prev.ip - 1) * 100 : null,
          vsbr: S.uf !== 'BR' ? (v / d3.mean(ix, k => br[k]) - 1) * 100 : null,
        });
        prev = { v, ip: ipv };
      }
    }
    return rows.reverse();   // mais recente primeiro
  }
  const tCols = () => {
    const c = [['per', 'Período'], ['v', `Valor (R$/L)`], ['yoy', '% YoY']];
    if (S.tg === 'm') c.push(['mom', '% MoM']);
    if (S.tm) { c.push(['dr', S.tg === 'm' ? 'Δ R$ no mês' : 'Δ R$ no ano']); if (S.tg === 'm') c.push(['ytd', '% no ano']); c.push(['mn', S.tg === 'm' ? 'Mín. 12m' : 'Mín. do ano'], ['mx', S.tg === 'm' ? 'Máx. 12m' : 'Máx. do ano']); c.push(['ipca', 'IPCA 12m']); if (S.uf !== 'BR') c.push(['vsbr', 'vs. Brasil']); }
    return c;
  };
  function buildTable() {
    const wrap = $('#tb-wrap'); if (!wrap) return;
    const cols = tCols(), rows = tableRows();
    S._tbBuilt = true;
    const fmt = { per: (r) => r.per, v: (r) => R$(r.v), mn: (r) => R$(r.mn), mx: (r) => R$(r.mx), dr: (r) => (r.dr == null ? null : `${r.dr > 0 ? '+' : r.dr < 0 ? '−' : ''}${f2.format(Math.abs(r.dr))}`) };
    const cell = (r, [k]) => {
      if (fmt[k]) return `<td>${fmt[k](r) ?? '—'}</td>`;
      const v = r[k]; if (v == null) return '<td class="na">—</td>';
      const tone = k === 'ipca' || k === 'vsbr' ? '' : v > 0.005 ? 'up' : v < -0.005 ? 'dn' : '';
      return `<td class="${tone}">${pctTxt(v, 2)}</td>`;
    };
    wrap.innerHTML = `<table class="tbl"><thead><tr>${cols.map(c => `<th scope="col">${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr data-i="${r.i}">${cols.map(c => cell(r, c)).join('')}</tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { stop(); setIdx(+tr.dataset.i); });
    $('#tb-sub').textContent = `${FUEL[S.tf].n} · ${ufName(S.uf)} · ${S.real ? 'valores reais (IPCA)' : 'valores nominais'} · ${S.tg === 'm' ? 'mensal' : 'média anual'} · ${rows.length} linhas`;
    $('#tb-note').innerHTML = '%YoY: variação contra o mesmo período do ano anterior · %MoM: contra o mês anterior · linha dourada = mês selecionado (clique numa linha para ir até ele)'
      + (S.tg === 'y' ? ' · * ano incompleto (média só dos meses disponíveis)' : '') + (S.tm && D.ipca.aproximado ? ' · IPCA aproximado' : '');
    markTable(true);
  }
  function markTable(jump) {
    const wrap = $('#tb-wrap'); if (!wrap) return;
    const target = S.tg === 'm' ? S.idx : D.yearIdx[D.yearOf(S.idx)].at(-1);
    wrap.querySelectorAll('tr.sel').forEach(t => t.classList.remove('sel'));
    const tr = wrap.querySelector(`tbody tr[data-i="${target}"]`); if (!tr) return;
    tr.classList.add('sel');
    wrap.scrollTop = Math.max(0, tr.offsetTop - wrap.clientHeight / 2 + tr.offsetHeight / 2 + (jump ? 0 : 0));
  }
  function downloadTableCsv() {
    const cols = tCols(), rows = tableRows();
    const n = (v) => (v == null ? '' : String(+v.toFixed(3)).replace('.', ','));
    const head = cols.map(c => ({ per: 'periodo', v: 'valor_rs_l', yoy: 'yoy_pct', mom: 'mom_pct', dr: 'variacao_rs', ytd: 'acum_ano_pct', mn: 'min_rs_l', mx: 'max_rs_l', ipca: 'ipca_12m_pct', vsbr: 'vs_brasil_pct' }[c[0]]));
    const lines = [head.join(';')].concat(rows.map(r => cols.map(([k]) => (k === 'per' ? r.per.replace('*', '') : n(r[k]))).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `anp_tabela_${S.uf}_${S.tf}_${S.tg === 'm' ? 'mensal' : 'anual'}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- resumo em texto + CSV ---------- */
  function resumoData() {
    const i = S.idx, N = D.N, prev = Math.max(0, i - 12);
    const where = S.uf === 'BR' ? 'no Brasil (média dos 27 estados)' : `em ${ufName(S.uf)} (${S.uf})`;
    const when = D.label(i), kind = S.real ? 'valores reais, corrigidos pelo IPCA para reais de hoje' : 'valores nominais, como coletados';
    const blocks = [];
    for (const f of shown()) {
      const a = ser(f.k), v = a[i];
      const yoy = i >= 12 ? (v / a[prev] - 1) * 100 : null;
      const mom = i > 0 ? (v / a[i - 1] - 1) * 100 : null;
      const upto = a.slice(0, i + 1);
      const mx = d3.max(upto), mn = d3.min(upto);
      const imx = upto.indexOf(mx), imn = upto.indexOf(mn);
      const acc = (v / a[0] - 1) * 100;
      let t = `${f.n}: ${R$(v)} por litro em ${when}`;
      if (mom != null) t += `, ${pctTxt(mom)} sobre o mês anterior`;
      if (yoy != null) t += ` e ${pctTxt(yoy)} em 12 meses`;
      t += `. Máxima da série: ${R$(mx)} (${D.label(imx)}); mínima: ${R$(mn)} (${D.label(imn)}). Desde ${D.label(0)}, ${acc >= 0 ? 'alta' : 'queda'} de ${nf(0).format(Math.abs(acc))}%.`;
      blocks.push(t);
    }
    // contra a inflação (valores nominais; IPCA acumulado desde o 1º mês)
    const ipg = (D.ipca.indice[i] / D.ipca.indice[0] - 1) * 100;
    const inflacao = i === 0 ? '' : `Contra a inflação: o IPCA acumulou ${pctTxt(ipg, 0)} desde ${D.label(0)}. ` + shown().map(f => {
      const g = (D.dataNom[f.k][S.uf][i] / D.dataNom[f.k][S.uf][0] - 1) * 100, d = g - ipg;
      return `${f.n} ${pctTxt(g, 0)} (${f0.format(Math.abs(d))} p.p. ${d > 0 ? 'acima' : 'abaixo'})`;
    }).join('; ') + '.' + (D.ipca.aproximado ? ' IPCA aproximado.' : '');
    const r = rat()[i] * 100, ok = r <= THRESH * 100;
    const regra = `Regra dos 70%: em ${when} ${where}, o etanol custava ${f1.format(r)}% do preço da gasolina — ${ok ? 'compensava abastecer com etanol' : 'não compensava, pois ficou acima de 70%'}.`;
    // ranking de estados (gasolina, mês selecionado)
    const rk = D.ufs.map(u => ({ u, v: DT().gasolina[u][i] })).sort((a, b) => b.v - a.v);
    const ranking = `Gasolina mais cara entre os estados: ${ufName(rk[0].u)} (${R$(rk[0].v)}); mais barata: ${ufName(rk.at(-1).u)} (${R$(rk.at(-1).v)}).` +
      (S.uf !== 'BR' ? ` ${ufName(S.uf)} ocupa a ${rk.findIndex(o => o.u === S.uf) + 1}ª posição entre 27.` : '');
    // fatos recentes (até o mês selecionado)
    const fatos = D.evs.filter(e => e.i <= i && !e.after).slice(-3).reverse().map(e => `${e.title} (${MESES[+e.date.slice(5) - 1]}/${e.date.slice(0, 4)})`);
    return { where, when, kind, blocks, inflacao, regra, ranking, fatos };
  }
  function renderResumo() {
    const host = $('#resumo-txt'); if (!host) return;
    const r = resumoData();
    host.innerHTML = '';
    if (D.meta.demo) host.append(el('p', 'warn', 'Atenção: dados de demonstração (sintéticos) — não use estes números como oficiais.'));
    host.append(el('h4', null, `Panorama · ${r.when}`));
    host.append(el('p', null, `Preços ${r.where}, ${r.kind}.`));
    for (const b of r.blocks) host.append(el('p', null, b.replace(/&/g, '&amp;').replace(/</g, '&lt;')));
    if (r.inflacao) { host.append(el('h4', null, 'Combustível e inflação')); host.append(el('p', null, r.inflacao)); }
    host.append(el('h4', null, 'Etanol ou gasolina?'));
    host.append(el('p', null, r.regra));
    host.append(el('h4', null, 'Entre os estados'));
    host.append(el('p', null, r.ranking));
    if (r.fatos.length) {
      host.append(el('h4', null, 'Fatos recentes'));
      host.append(el('p', null, r.fatos.map(t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>').replace(/^/, '')));
    }
    host.append(el('p', 'note sm', `Fonte: ${D.meta.fonte || 'ANP'} · preços médios de revenda.`));
  }
  function resumoPlain() {
    const r = resumoData();
    const L = [`RESUMO · ${r.when} · ${r.where}`, `(${r.kind})`, ''];
    if (D.meta.demo) L.push('ATENÇÃO: dados de demonstração (sintéticos).', '');
    L.push(...r.blocks, '', ...(r.inflacao ? [r.inflacao, ''] : []), r.regra, '', r.ranking);
    if (r.fatos.length) L.push('', 'Fatos recentes:', ...r.fatos.map(t => `- ${t}`));
    L.push('', `Fonte: ${D.meta.fonte || 'ANP'}.`);
    return L.join('\n');
  }
  async function copyResumo() {
    const b = $('#btn-copy'), txt = resumoPlain();
    try { await navigator.clipboard.writeText(txt); b.textContent = 'Copiado ✓'; }
    catch { const t = el('textarea'); t.value = txt; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); b.textContent = 'Copiado ✓'; }
    setTimeout(() => { b.textContent = 'Copiar texto'; }, 1800);
  }
  function downloadCsv(all) {
    const ufs = all ? [...D.ufs, 'BR'] : [S.uf];
    const fuels = all ? FUELS : shown();
    const num = (v) => String(+v.toFixed(3)).replace('.', ',');
    const rows = ['mes;uf;estado;combustivel;preco_nominal_rs_l;preco_real_ipca_rs_l'];
    for (const u of ufs) for (const f of fuels) for (let i = 0; i < D.N; i++) {
      rows.push([D.months[i], u, u === 'BR' ? 'Brasil (média)' : D.byUf[u].nome, f.k, num(D.dataNom[f.k][u][i]), num(D.dataReal[f.k][u][i])].join(';'));
    }
    const blob = new Blob(['﻿' + rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = all ? 'anp_serie_historica_completa.csv' : `anp_${S.uf}_${S.fuel === 'all' ? 'tres_combustiveis' : S.fuel}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- KPIs ---------- */
  function sparkSvg(arr, color, i1) {
    const i0 = Math.max(0, i1 - 59), pts = arr.slice(i0, i1 + 1);
    const w = 100, h = 26;
    const x = d3.scaleLinear([0, Math.max(1, pts.length - 1)], [1, w - 3]);
    const [lo, hi] = d3.extent(pts), y = d3.scaleLinear([lo, hi === lo ? lo + 1 : hi], [h - 3, 3]);
    const path = d3.line().x((_, i) => x(i)).y(v => y(v))(pts);
    const last = pts.length - 1;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last)}" cy="${y(pts[last])}" r="2" fill="${color}"/></svg>`;
  }
  function pill(delta, goodWhenDown = true, unit = '%') {
    const cls = Math.abs(delta) < 0.05 ? 'flat' : delta > 0 ? 'up' : 'down'; // alta = vermelho, queda = verde
    const arrow = delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '■';
    return `<span class="pill ${cls}">${arrow} ${f1.format(Math.abs(delta))}${unit}</span>`;
  }
  function renderKpis() {
    const i = S.idx, p = Math.max(0, i - 1), box = $('#kpis');
    const cards = [];
    for (const f of FUELS) {
      const a = ser(f.k), v = a[i], d = (v / a[p] - 1) * 100;
      cards.push(`<div class="kpi" style="--accent:${f.c}">
        <div class="lab">${f.n} · ${S.uf === 'BR' ? 'Brasil' : S.uf}</div>
        <div class="val"><small>R$</small>${f3.format(v)}</div>
        ${pill(d, false)}
        <div class="hint">vs mês anterior</div>${sparkSvg(a, f.c, i)}</div>`);
    }
    const r = rat()[i], rp = rat()[p], dpp = (r - rp) * 100, ok = r < THRESH;
    cards.push(`<div class="kpi" style="--accent:${ok ? '#2E7D4F' : '#C0392B'}">
      <div class="lab">Etanol vale a pena? · ${S.uf === 'BR' ? 'Brasil' : S.uf}</div>
      <div class="val">${f1.format(r * 100)}%</div>
      <span class="pill ${Math.abs(dpp) < .05 ? 'flat' : dpp > 0 ? 'up' : 'down'}">${dpp > 0.05 ? '▲' : dpp < -0.05 ? '▼' : '■'} ${f1.format(Math.abs(dpp))} p.p.</span>
      <div class="hint">${ok ? '<span class="good">✓ compensa — abaixo de 70%</span>' : '<span class="bad">✗ não compensa — acima de 70%</span>'}</div>
      ${sparkSvg(rat(), ok ? '#2E7D4F' : '#C0392B', i)}</div>`);

    // ranking e comparação com a média do Brasil (gasolina)
    if (S.uf === 'BR') {
      cards.push(`<div class="kpi" style="--accent:#ccc"><div class="lab">Posição no ranking</div>
        <div class="val">—</div><div class="hint">Escolha um estado para ver a posição entre os 27.</div></div>`);
      cards.push(`<div class="kpi" style="--accent:#ccc"><div class="lab">Contra a média do Brasil</div>
        <div class="val">—</div><div class="hint">Média simples dos 27 estados.</div></div>`);
    } else {
      const rank = D.ufs.map(u => ({ u, v: DT().gasolina[u][i] })).sort((a, b) => b.v - a.v).findIndex(o => o.u === S.uf) + 1;
      cards.push(`<div class="kpi" style="--accent:#B87D00"><div class="lab">Posição no ranking</div>
        <div class="val">${rank}º <span class="of">de ${D.ufs.length}</span></div>
        <div class="hint">${D.ufs.length - rank} estados mais baratos<br>↑ gasolina mais cara</div></div>`);
      const br = DT().gasolina.BR[i], v = DT().gasolina[S.uf][i], diff = v - br, pc = (v / br - 1) * 100;
      cards.push(`<div class="kpi" style="--accent:${diff > 0 ? '#C0392B' : '#2E7D4F'}"><div class="lab">Contra a média do Brasil</div>
        <div class="val">${pctTxt(pc)}</div>
        <div class="hint"><span class="${diff > 0 ? 'bad' : 'good'}">${diff > 0 ? '+' : '−'}R$ ${f3.format(Math.abs(diff))}</span><br>média BR ${R$(br)} · gasolina</div></div>`);
    }
    box.innerHTML = cards.join('');
  }

  /* ---------- feed ---------- */
  function renderFeed() {
    const list = $('#feed-list'), i = S.idx;
    // busca: ignora maiúsculas e acentos; todos os termos digitados precisam aparecer
    const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const terms = fold(S.q).split(/\s+/).filter(Boolean);
    // casa o termo só no início de palavras (evita "irã" casar com "Silveira")
    const wordStart = (t) => new RegExp('(?<![a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const hay = (e) => fold(`${e.title} ${e.text} ${TYPES[e.type]?.n || e.type} ${MESES_L[+e.date.slice(5) - 1]} ${e.date.slice(0, 4)} ${host(e.url || '')}`);
    const items = D.evs.filter(e => (S.type === 'all' || e.type === S.type) && terms.every(t => wordStart(t).test(hay(e))))
      .map(e => ({ ...e, dist: Math.abs(e.i - i) })).sort((a, b) => a.dist - b.dist);
    $('#feed-sub').textContent = `${items.length} ${items.length === 1 ? 'registro' : 'registros'} · ${terms.length ? 'filtrados · ' : ''}mais próximos de ${D.label(i)}`;
    list.innerHTML = '';
    if (!items.length) { list.append(el('div', 'feed-empty', 'Nenhum registro encontrado para esta busca.')); return; }
    // destaca os termos encontrados (sobre texto escapado)
    const esc = (t) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const mark = (t) => {
      if (!terms.length) return esc(t);
      const f = fold(t), ranges = [];
      for (const term of terms) { const re = new RegExp(wordStart(term).source, 'g'); let mt; while ((mt = re.exec(f))) { ranges.push([mt.index, mt.index + term.length]); if (!term.length) break; } }
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = []; for (const r of ranges) { const l = merged.at(-1); if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
      let out = '', pos = 0;
      for (const [a, b] of merged) { out += esc(t.slice(pos, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>'; pos = b; }
      return out + esc(t.slice(pos));
    };
    for (const e of items) {
      const t = TYPES[e.type] || { n: e.type, c: '#999' };
      const [y, m] = e.date.split('-');
      const node = el('div', `ev${e.i > i ? ' future' : ''}${e.dist === 0 && !e.after ? ' near' : ''}`,
        `<h4>${mark(e.title)}</h4><p>${mark(e.text)}</p>
         <div class="meta"><span class="tag" style="--c:${t.c}">${t.n}</span><span>${e.day ? e.day + ' de ' : ''}${MESES_L[+m - 1]} de ${y}</span>${e.url ? `<a class="src-link" href="${e.url}" target="_blank" rel="noopener noreferrer" title="${host(e.url)}">${host(e.url).split('.').slice(-3, -1).join('.') || host(e.url)} ↗</a>` : ''}</div>`);
      node.style.setProperty('--c', t.c);
      node.tabIndex = 0;
      node.onclick = (ev) => { if (ev.target.closest('a')) return; stop(); setIdx(e.i); };
      node.onkeydown = (ev) => { if (ev.key === 'Enter') node.click(); };
      if (e.url) attachThumb(node, e, host(e.url));
      list.append(node);
    }
  }


  /* ---------- miniatura da matéria ao passar o mouse (O que aconteceu) ---------- */
  let thumbEl = null, thumbTimer = 0;
  function thumbNode() {
    if (thumbEl) return thumbEl;
    thumbEl = el('div', 'thumb'); thumbEl.id = 'thumb'; thumbEl.setAttribute('role', 'tooltip'); thumbEl.hidden = true;
    document.body.append(thumbEl);
    const hide = () => hideThumb(); addEventListener('scroll', hide, true); addEventListener('resize', hide);
    return thumbEl;
  }
  function hideThumb() { clearTimeout(thumbTimer); if (thumbEl) { thumbEl.hidden = true; thumbEl.innerHTML = ''; } }
  function showThumb(node, e, hostName) {
    const t = thumbNode(), esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fav = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostName)}&sz=64`;
    const fallback = `<div class="th-fb"><img src="${fav}" alt="" width="32" height="32" referrerpolicy="no-referrer"><span>${esc(hostName)}</span><small>prévia indisponível</small></div>`;
    t.innerHTML = `<div class="th-img">${e.img ? `<img alt="" referrerpolicy="no-referrer" decoding="async">` : fallback}</div>
      <div class="th-cap"><b>${esc(hostName)}</b><span>Abrir a matéria: clique em “${esc(hostName.split('.').slice(-3, -1).join('.') || hostName)} ↗”</span></div>`;
    if (e.img) {
      const im = t.querySelector('.th-img img');
      im.onerror = () => { t.querySelector('.th-img').innerHTML = fallback; };
      im.src = e.img;
    }
    t.hidden = false;
    const r = node.getBoundingClientRect(), w = 288, h = t.offsetHeight, M = 8;
    let left = r.right + 14, top = r.top;
    if (left + w > innerWidth - M) { left = Math.min(Math.max(M, r.left), innerWidth - w - M); top = r.bottom + 8; if (top + h > innerHeight - M) top = Math.max(M, r.top - h - 8); }
    top = Math.min(Math.max(M, top), innerHeight - h - M);
    t.style.left = `${left}px`; t.style.top = `${top}px`;
  }
  function attachThumb(node, e, hostName) {
    const on = () => { clearTimeout(thumbTimer); thumbTimer = setTimeout(() => showThumb(node, e, hostName), 160); };
    node.addEventListener('mouseenter', on); node.addEventListener('mouseleave', hideThumb);
    node.addEventListener('focus', on); node.addEventListener('blur', hideThumb);
  }

  /* ---------- infra de gráficos ---------- */
  const tip = $('#tip');
  function showTip(evt, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  function mount(host, H) {
    const W = Math.max(240, host.clientWidth);
    host.innerHTML = '';
    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    return { svg, W, H };
  }
  const legendItems = (fuels, withVal, i) => fuels.map(f =>
    `<span class="it"><i class="dot" style="background:${f.c}"></i>${f.n}${withVal ? ` <span class="v">${R$(ser(f.k)[i])}</span>` : ''}</span>`).join('');

  /* ---------- linha do tempo de preços ---------- */
  function drawLine() {
    const host = $('#chart-line'), fuels = shown(), i = S.idx;
    $('#t-line').textContent = S.uf === 'BR' ? 'Vinte e dois anos em uma linha' : `Para onde foi o preço · ${S.uf}`;
    $('#s-line').textContent = `${ufName(S.uf)} · ${D.label(0)} – ${D.label(D.N - 1)} · ${S.real ? `reais de ${D.label(D.N - 1)} (IPCA${D.ipca.aproximado ? ' aprox.' : ''})` : 'valores nominais'} · clique para ir ao mês`;
    $('#legend-line').innerHTML = legendItems(fuels, true, i);

    const W0 = host.clientWidth, H = Math.max(300, Math.min(400, W0 * 0.46));
    const { svg, W } = mount(host, H);
    const m = { l: 40, r: 12, t: 52, b: 26 };
    const x = d3.scaleLinear([0, D.N - 1], [m.l, W - m.r]);
    const all = fuels.flatMap(f => ser(f.k));
    const y = d3.scaleLinear([Math.max(0, d3.min(all) * 0.85), d3.max(all) * 1.05], [H - m.b, m.t]).nice(5);

    // grade + eixos
    const gy = svg.append('g').attr('class', 'axis');
    for (const t of y.ticks(5)) {
      gy.append('line').attr('class', 'gridl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      gy.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').text(`R$ ${f0.format(t)}`);
    }
    const gx = svg.append('g').attr('class', 'axis');
    const step = W < 520 ? 4 : 2;
    D.years.filter((yr, k) => k === 0 || (yr % step === 0)).forEach(yr => {
      const ix = Math.max(0, D.months.indexOf(`${yr}-01`));
      gx.append('text').attr('x', x(ix)).attr('y', H - 8).attr('text-anchor', 'middle').text(yr);
    });

    // eras de governo
    ERAS.forEach((e, k) => {
      const a = Math.max(0, D.months.findIndex(mm => mm >= e.from));
      let b = D.months.findIndex(mm => mm > e.to); if (b < 0) b = D.N; b = Math.min(D.N - 1, b - 1);
      if (a > b) return;
      if (k > 0) svg.append('line').attr('x1', x(a)).attr('x2', x(a)).attr('y1', 4).attr('y2', H - m.b).attr('stroke', '#e3e3e3').attr('stroke-dasharray', '2 3');
      if (x(b) - x(a) > 36)
        svg.append('text').attr('x', (x(a) + x(b)) / 2).attr('y', 12).attr('text-anchor', 'middle')
          .style('font', '400 9px var(--mono)').style('letter-spacing', '.12em').attr('fill', '#9a9a9a').text(e.n.toUpperCase());
    });

    // linhas
    for (const f of fuels) {
      svg.append('path').datum(ser(f.k)).attr('fill', 'none').attr('stroke', f.c).attr('stroke-width', 1.6)
        .attr('stroke-linejoin', 'round').attr('d', d3.line().x((_, k) => x(k)).y(v => y(v)));
    }

    // anotação do primeiro ponto
    const g0 = ser(fuels[0].k)[0];
    svg.append('text').attr('x', m.l + 4).attr('y', H - m.b - 8).style('font', '400 10px var(--mono)').attr('fill', '#777')
      .text(`${D.label(0)} · ${fuels[0].n.toLowerCase()} a ${R$(g0)}`);

    // eventos (marcadores no topo)
    const evg = svg.append('g');
    evg.selectAll('circle').data(D.evs.filter(e => !e.after)).join('circle')
      .attr('cx', d => x(d.i)).attr('cy', 32).attr('r', d => Math.abs(d.i - i) <= 1 ? 5.5 : 4)
      .attr('fill', d => (Math.abs(d.i - i) <= 1 ? (TYPES[d.type]?.c || '#999') : '#f8f8f8'))
      .attr('stroke', d => TYPES[d.type]?.c || '#999').attr('stroke-width', 1.6).style('cursor', 'pointer')
      .on('mousemove', (e, d) => showTip(e, `<b>${d.title}</b><br><span class="mono">${D.label(d.i)} · ${TYPES[d.type]?.n || d.type}</span><br>${d.text}`))
      .on('mouseleave', hideTip).on('click', (_, d) => { stop(); setIdx(d.i); });

    // cursor do mês selecionado
    const cur = svg.append('g');
    cur.append('line').attr('x1', x(i)).attr('x2', x(i)).attr('y1', 42).attr('y2', H - m.b).attr('stroke', '#8A5A00').attr('stroke-width', 1);
    for (const f of fuels)
      cur.append('circle').attr('cx', x(i)).attr('cy', y(ser(f.k)[i])).attr('r', 4).attr('fill', f.c).attr('stroke', '#fff').attr('stroke-width', 1.5);
    cur.append('text').attr('x', Math.min(W - m.r, Math.max(m.l + 20, x(i)))).attr('y', H - 8 - 12).attr('text-anchor', i > D.N * .85 ? 'end' : 'start')
      .style('font', '500 10px var(--mono)').attr('fill', '#8A5A00').text(`  ${D.label(i)}  `);

    // interação
    const guide = svg.append('line').attr('y1', 42).attr('y2', H - m.b).attr('stroke', '#bbb').attr('stroke-dasharray', '3 3').style('display', 'none');
    svg.append('rect').attr('class', 'hover-rect').attr('x', m.l).attr('y', 42).attr('width', W - m.l - m.r).attr('height', H - m.b - 42)
      .on('mousemove', (e) => {
        const k = Math.max(0, Math.min(D.N - 1, Math.round(x.invert(d3.pointer(e)[0]))));
        guide.style('display', null).attr('x1', x(k)).attr('x2', x(k));
        showTip(e, `<b>${D.label(k)}</b> · ${ufName(S.uf)}<br>` + fuels.map(f =>
          `<span class="mono" style="color:${f.c === '#1F4E79' ? '#7FB0E0' : f.c === '#2E7D4F' ? '#6FCF97' : f.c}">●</span> ${f.n} <span class="mono">${R$(ser(f.k)[k])}</span>`).join('<br>'));
      })
      .on('mouseleave', () => { guide.style('display', 'none'); hideTip(); })
      .on('click', (e) => { stop(); setIdx(Math.max(0, Math.min(D.N - 1, Math.round(x.invert(d3.pointer(e)[0]))))); });
  }

  /* ---------- halteres por região ---------- */
  function drawDumbbell() {
    const host = $('#chart-dumb'), fuels = shown(), i = S.idx;
    $('#s-dumb').textContent = `R$/litro · média por região · ${D.label(i)}`;
    const rows = REGIONS.map(r => {
      const us = D.states.filter(s => s.regiao === r).map(s => s.uf);
      return { r, us, vals: fuels.map(f => ({ f, v: d3.mean(us, u => DT()[f.k][u][i]) })) };
    });
    const selRegion = S.uf === 'BR' ? null : D.byUf[S.uf].regiao;
    const H = 40 + rows.length * 42;
    const { svg, W } = mount(host, H);
    const m = { l: 92, r: 14, t: 12, b: 26 };
    const vs = rows.flatMap(r => r.vals.map(o => o.v));
    const x = d3.scaleLinear([d3.min(vs) - .25, d3.max(vs) + .25], [m.l, W - m.r]).nice(5);
    const y = d3.scaleBand(REGIONS, [m.t, H - m.b]).padding(.4);
    const ax = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b + 4})`);
    for (const t of x.ticks(4)) {
      svg.append('line').attr('class', 'gridl').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b);
      ax.append('text').attr('x', x(t)).attr('y', 12).attr('text-anchor', 'middle').text(`R$ ${f2.format(t)}`);
    }
    for (const row of rows) {
      const cy = y(row.r) + y.bandwidth() / 2, sel = row.r === selRegion;
      svg.append('text').attr('x', m.l - 10).attr('y', cy + 3.5).attr('text-anchor', 'end')
        .style('font', `${sel ? 600 : 400} 11px var(--sans)`).attr('fill', sel ? '#8A5A00' : '#555').text(row.r);
      const [lo, hi] = d3.extent(row.vals, o => o.v);
      svg.append('line').attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', cy).attr('y2', cy).attr('stroke', sel ? '#d9b46a' : '#cfcfcf').attr('stroke-width', 2);
      svg.selectAll(null).data(row.vals).join('circle')
        .attr('cx', o => x(o.v)).attr('cy', cy).attr('r', sel ? 5 : 4).attr('fill', o => o.f.c).attr('stroke', '#fff').attr('stroke-width', 1.2)
        .on('mousemove', (e, o) => showTip(e, `<b>${row.r}</b><br>${o.f.n} <span class="mono">${R$(o.v)}</span>`)).on('mouseleave', hideTip);
      if (S.uf !== 'BR' && sel) {
        fuels.forEach(f => {
          const v = DT()[f.k][S.uf][i];
          svg.append('circle').attr('cx', x(v)).attr('cy', cy).attr('r', 7).attr('fill', 'none').attr('stroke', f.c).attr('stroke-width', 1.5)
            .on('mousemove', (e) => showTip(e, `<b>${S.uf}</b><br>${f.n} <span class="mono">${R$(v)}</span>`)).on('mouseleave', hideTip);
        });
      }
    }
  }

  /* ---------- barras: variação anual ---------- */
  function drawBars() {
    S._barsDrawn = true;
    const host = $('#chart-bars'), fuels = shown();
    $('#s-bars').textContent = `${ufName(S.uf)} · variação da média anual · o ano do período fica destacado`;
    $('#legend-bars').innerHTML = legendItems(fuels.map(f => ({ ...f })), false).replace(/dot/g, 'sw');
    const yrs = D.years.slice(1);
    const rows = yrs.map(yr => ({
      yr, vals: fuels.map(f => {
        const a = ser(f.k), cur = D.ym(a, yr), prev = D.ym(a, yr - 1);
        return { f, p: (cur / prev - 1) * 100 };
      }),
    }));
    const H = 250;
    const { svg, W } = mount(host, H);
    const m = { l: 40, r: 8, t: 10, b: 24 };
    const ext = d3.extent(rows.flatMap(r => r.vals.map(v => v.p)).concat(0));
    const y = d3.scaleLinear(ext, [H - m.b, m.t]).nice(5);
    const x0 = d3.scaleBand(yrs, [m.l, W - m.r]).paddingInner(.2);
    const x1 = d3.scaleBand(fuels.map(f => f.k), [0, x0.bandwidth()]).padding(.08);
    const gy = svg.append('g').attr('class', 'axis');
    for (const t of y.ticks(5)) {
      gy.append('line').attr('class', 'gridl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      gy.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').text(`${t > 0 ? '+' : ''}${t}%`);
    }
    svg.append('rect').attr('class', 'sel-year').attr('y', m.t - 4).attr('height', H - m.b - m.t + 4).attr('fill', '#f3d58b').attr('opacity', .55);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', '#bdbdbd');
    const g = svg.selectAll('g.yr').data(rows).join('g').attr('class', 'yr').attr('transform', d => `translate(${x0(d.yr)},0)`);
    g.selectAll('rect').data(d => d.vals.map(v => ({ ...v, yr: d.yr }))).join('rect')
      .attr('x', d => x1(d.f.k)).attr('width', x1.bandwidth())
      .attr('y', d => Math.min(y(0), y(d.p))).attr('height', d => Math.abs(y(d.p) - y(0)))
      .attr('fill', d => d.f.c).attr('opacity', .85);
    const gx = svg.append('g').attr('class', 'axis');
    yrs.forEach((yr, k) => { if (W > 560 || k % 2 === 0) gx.append('text').attr('x', x0(yr) + x0.bandwidth() / 2).attr('y', H - 8).attr('text-anchor', 'middle').text(`’${String(yr).slice(2)}`); });
    svg.selectAll('rect.hit').data(rows).join('rect').attr('class', 'hover-rect').attr('x', d => x0(d.yr) - 2).attr('width', x0.bandwidth() + 4)
      .attr('y', m.t).attr('height', H - m.t - m.b)
      .on('mousemove', (e, d) => showTip(e, `<b>${d.yr}</b> · ${ufName(S.uf)}<br>` + d.vals.map(v => `${v.f.n} <span class="mono">${pctTxt(v.p)}</span>`).join('<br>')))
      .on('mouseleave', hideTip)
      .on('click', (_, d) => {
        stop();
        const ix = D.yearIdx[d.yr]; const same = ix.find(k => D.monthOf(k) === D.monthOf(S.idx));
        setIdx(same ?? ix.at(-1));
      });
    S._bars = { x0 };
    markBars();
  }
  function markBars() {
    const b = S._bars; if (!b) return;
    const yr = D.yearOf(S.idx);
    const sel = d3.select('#chart-bars rect.sel-year');
    if (b.x0(yr) == null || yr === D.years[0]) { sel.attr('width', 0); return; }
    sel.attr('x', b.x0(yr) - 3).attr('width', b.x0.bandwidth() + 6);
  }

  /* ---------- dispersão: regra dos 70% ---------- */
  function drawScatter() {
    const host = $('#chart-scatter'), i = S.idx;
    const pts = D.ufs.map(u => ({ u, gas: DT().gasolina[u][i], r: D.ratio[u][i] * 100 }));
    const H = 250;
    const { svg, W } = mount(host, H);
    const m = { l: 36, r: 10, t: 14, b: 30 };
    const x = d3.scaleLinear(d3.extent(pts, p => p.gas), [m.l + 8, W - m.r - 8]).nice(4);
    const lo = Math.min(60, d3.min(pts, p => p.r) - 3), hi = Math.max(90, d3.max(pts, p => p.r) + 3);
    const y = d3.scaleLinear([lo, hi], [H - m.b, m.t]);
    svg.append('rect').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', y(THRESH * 100)).attr('height', y(lo) - y(THRESH * 100)).attr('fill', '#dbe7de').attr('opacity', .8);
    const ax = svg.append('g').attr('class', 'axis');
    for (const t of d3.range(Math.ceil(lo / 10) * 10, hi + 1, 10)) {
      ax.append('line').attr('class', 'gridl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t)).attr('opacity', t === 70 ? 0 : 1);
      ax.append('text').attr('x', m.l - 6).attr('y', y(t) + 3).attr('text-anchor', 'end').text(`${t}%`);
    }
    for (const t of x.ticks(5)) ax.append('text').attr('x', x(t)).attr('y', H - 14).attr('text-anchor', 'middle').text(`R$ ${f2.format(t)}`);
    ax.append('text').attr('x', (m.l + W - m.r) / 2).attr('y', H - 2).attr('text-anchor', 'middle').text('preço da gasolina →');
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(70)).attr('y2', y(70)).attr('stroke', '#2E7D4F').attr('stroke-dasharray', '4 3');
    svg.append('text').attr('x', m.l + 6).attr('y', y(70) + 12).style('font', '400 9.5px var(--mono)').attr('fill', '#4d7b5b').text('o etanol compensa');
    const dots = svg.selectAll('g.p').data(pts).join('g').attr('class', 'p').style('cursor', 'pointer')
      .attr('transform', d => `translate(${x(d.gas)},${y(d.r)})`)
      .on('mousemove', (e, d) => showTip(e, `<b>${d.u} — ${D.byUf[d.u].nome}</b><br>gasolina <span class="mono">${R$(d.gas)}</span><br>etanol/gasolina <span class="mono">${f1.format(d.r)}%</span><br>${d.r < 70 ? '✓ compensa' : '✗ não compensa'}`))
      .on('mouseleave', hideTip).on('click', (_, d) => setUf(S.uf === d.u ? 'BR' : d.u));
    const col = d => (d.r < 70 ? '#2E7D4F' : '#C0392B');
    dots.append('circle').attr('r', d => (d.u === S.uf ? 6.5 : 3.8)).attr('fill', col)
      .attr('stroke', d => (d.u === S.uf ? '#333' : 'none')).attr('stroke-width', 1.5).attr('opacity', d => (S.uf === 'BR' || d.u === S.uf ? 1 : .8));
    dots.append('text').attr('y', -7).attr('text-anchor', 'middle')
      .style('font', d => (d.u === S.uf || d.r < 70 ? '600 8.5px var(--mono)' : '400 8px var(--mono)')).attr('fill', d => (d.r < 70 ? '#2f6a43' : '#8a8a8a')).text(d => d.u);

    const n = pts.filter(p => p.r < 70).length;
    $('#n-scatter').innerHTML = `O etanol compensou em <b>${n} dos ${pts.length} estados</b> em ${D.label(i)}.`;
  }

  /* ---------- mapa do Brasil ---------- */
  function mapMetric() { return S.mapMetric || (S.fuel === 'all' ? 'gasolina' : S.fuel); }
  function drawMap() {
    const host = $('#chart-map'), i = S.idx, met = mapMetric();
    document.querySelectorAll('#map-metric button').forEach(b => b.classList.toggle('on', b.dataset.m === met));
    const isRatio = met === 'ratio';
    const val = (u) => (isRatio ? D.ratio[u][i] * 100 : DT()[met][u][i]);
    const vals = D.ufs.map(val), [lo, hi] = d3.extent(vals);
    const color = isRatio
      ? d3.scaleLinear().domain([Math.min(lo, 62), 70, 70.01, Math.max(hi, 80)]).range(['#2E7D4F', '#C9E1D0', '#F1CFC8', '#C0392B']).clamp(true)
      : d3.scaleSequential(d3.interpolateRgb(...RAMP[met])).domain([lo, hi]);
    const [, , vw, vh] = D.geo.viewBox.split(' ').map(Number);
    const W = Math.min(host.clientWidth, 560), H = W * vh / vw;
    host.innerHTML = '';
    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${vw} ${vh}`).style('margin', '0 auto');
    const unit = (v) => (isRatio ? `${f1.format(v)}%` : R$(v));
    const g = svg.append('g');
    g.selectAll('path').data(D.ufs).join('path').attr('d', u => D.geo.paths[u]).attr('fill', u => color(val(u)))
      .style('stroke', u => (u === S.uf ? '#222' : null)).style('stroke-width', u => (u === S.uf ? 2.2 : null))
      .on('mousemove', (e, u) => showTip(e, `<b>${u} — ${D.byUf[u].nome}</b><br>${isRatio ? 'etanol/gasolina' : FUEL[met].n} <span class="mono">${unit(val(u))}</span>${isRatio ? `<br>${val(u) < 70 ? '✓ compensa' : '✗ não compensa'}` : ''}`))
      .on('mouseleave', hideTip).on('click', (_, u) => setUf(S.uf === u ? 'BR' : u));
    // rótulos no centro de cada estado
    g.selectAll('path').each(function (u) {
      const b = this.getBBox();
      g.append('text').attr('x', b.x + b.width / 2).attr('y', b.y + b.height / 2 + 3).attr('text-anchor', 'middle').text(u);
    });
    if (S.uf !== 'BR') g.selectAll('path').filter(u => u === S.uf).raise();
    $('#s-map').textContent = `${isRatio ? 'Etanol ÷ gasolina' : FUEL[met].n + (S.real ? ' · R$ reais' : ' · R$/litro')} · ${D.label(i)} · clique num estado`;
    const grad = isRatio ? 'linear-gradient(90deg,#2E7D4F,#C9E1D0 50%,#F1CFC8 50%,#C0392B)' : `linear-gradient(90deg,${RAMP[met][0]},${RAMP[met][1]})`;
    $('#map-legend').innerHTML = `<span>${unit(lo)}</span><i style="background:${grad}"></i><span>${unit(hi)}</span>${isRatio ? '<span>· 70% = ponto de equilíbrio</span>' : ''}`;
  }

  /* ---------- ranking de municípios ---------- */
  function drawMunicipios() {
    const box = $('#mun-list'), fuelK = S.fuel === 'all' ? (mapMetric() === 'ratio' ? 'gasolina' : mapMetric()) : S.fuel;
    const win = D.munMonths, first = win[0], last = win.at(-1);
    const ci = Math.max(first, Math.min(last, S.idx)), k = win.indexOf(ci);
    const inWin = S.idx >= first && S.idx <= last;
    let scope = S.uf === 'BR' ? D.mun.items : D.mun.items.filter(m => m.uf === S.uf);
    const fallback = S.uf !== 'BR' && scope.length < 6;   // poucos municípios no estado: mostra o Brasil e destaca o estado
    if (fallback) scope = D.mun.items;
    $('#t-mun').textContent = `Municípios mais caros e mais baratos${S.uf === 'BR' || fallback ? '' : ' · ' + S.uf}`;
    $('#s-mun').textContent = `${FUEL[fuelK].n} · ${S.real ? 'R$ reais' : 'R$/litro'} · ${D.label(ci)} · ${scope.length} municípios`;
    const v = (m) => m[fuelK][k] * (S.real ? D.defl[ci] : 1);
    const sorted = [...scope].sort((a, b) => v(b) - v(a));
    const n = Math.min(7, Math.floor(sorted.length / 2));
    const top = sorted.slice(0, n), bot = sorted.slice(-n).reverse();
    const [lo, hi] = d3.extent(sorted, v), w = d3.scaleLinear([lo * .9, hi], [8, 100]);
    const row = (m, c) => `<div class="rw" data-uf="${m.uf}"${S.uf !== 'BR' && m.uf === S.uf ? ' style="background:#fdf3dc;border-radius:4px"' : ''}><span class="nm">${m.n}<small>${m.uf}</small></span><span><div class="bar" style="--c:${c};width:${w(v(m))}%"></div></span><span class="v">${R$(v(m))}</span></div>`;
    const avg = d3.mean(sorted, v);
    box.innerHTML = `<h4>Mais caros</h4>${top.map(m => row(m, '#C0392B')).join('')}<div class="gap"></div>
      <h4>Mais baratos</h4>${bot.map(m => row(m, '#2E7D4F')).join('')}
      <p class="note" style="margin-top:8px">Média do recorte: <b style="color:var(--ink)">${R$(avg)}</b> · diferença entre extremos: ${R$(v(top[0]) - v(bot[0]))}${fallback ? `<br>Poucos municípios de ${S.uf} nos dados: mostrando o Brasil, com ${S.uf} destacado.` : ''}${inWin ? '' : `<br>Ranking disponível só para ${D.label(first)} – ${D.label(last)}; mostrando ${D.label(ci)}.`}</p>`;
    box.querySelectorAll('.rw').forEach(r => r.onclick = () => setUf(S.uf === r.dataset.uf ? 'BR' : r.dataset.uf));
  }

  /* ---------- mapa de calor ---------- */
  function drawHeat() {
    S._heatDrawn = true;
    const host = $('#chart-heat');
    const yrs = D.years;
    const avg = (u, yr) => d3.mean(D.yearIdx[yr], k => D.ratio[u][k]);
    const order = [...D.ufs].sort((a, b) => d3.mean(yrs, yr => avg(a, yr)) - d3.mean(yrs, yr => avg(b, yr)));
    const rowH = host.clientWidth < 520 ? 13 : 15, H = order.length * rowH + 40;
    const { svg, W } = mount(host, H);
    const m = { l: 30, r: 4, t: 4, b: 30 };
    const x = d3.scaleBand(yrs, [m.l, W - m.r]).paddingInner(.04);
    const y = d3.scaleBand(order, [m.t, H - m.b]).paddingInner(.06);
    const color = d3.scaleLinear().domain([.55, .70, .7001, .88]).range(['#2E7D4F', '#C9E1D0', '#F1CFC8', '#C0392B']).clamp(true);
    const rowsG = svg.append('g');
    for (const u of order) {
      rowsG.append('text').attr('class', `hl-${u}`).attr('x', m.l - 5).attr('y', y(u) + y.bandwidth() / 2 + 3).attr('text-anchor', 'end')
        .style('font', '400 7.5px var(--mono)').attr('fill', '#777').style('cursor', 'pointer').text(u).on('click', () => setUf(S.uf === u ? 'BR' : u));
      for (const yr of yrs) {
        const v = avg(u, yr);
        rowsG.append('rect').attr('x', x(yr)).attr('y', y(u)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', color(v)).style('cursor', 'pointer')
          .on('mousemove', (e) => showTip(e, `<b>${u} · ${yr}</b><br>etanol/gasolina <span class="mono">${f1.format(v * 100)}%</span><br>${v < THRESH ? '✓ compensa' : '✗ não compensa'}`))
          .on('mouseleave', hideTip)
          .on('click', () => { stop(); setUf(u); const ix = D.yearIdx[yr]; setIdx(ix.find(k => D.monthOf(k) === D.monthOf(S.idx)) ?? ix.at(-1)); });
      }
    }
    const ax = svg.append('g').attr('class', 'axis');
    yrs.filter((yr, k) => k === 0 || yr === yrs.at(-1) || (yr - 2004) % (W < 520 ? 8 : 6) === 0)
      .forEach(yr => ax.append('text').attr('x', x(yr) + x.bandwidth() / 2).attr('y', H - 14).attr('text-anchor', 'middle').text(yr));
    svg.append('rect').attr('class', 'hm-col').attr('y', m.t - 2).attr('height', H - m.b - m.t + 4).attr('fill', 'none').attr('stroke', '#333').attr('stroke-width', 1.2).attr('rx', 2);
    svg.append('rect').attr('class', 'hm-row').attr('x', m.l - 1).attr('width', W - m.l - m.r + 2).attr('fill', 'none').attr('stroke', '#333').attr('stroke-width', 1.2).attr('rx', 2);
    S._heat = { x, y };
    $('#legend-heat').innerHTML = `<span class="it"><i class="sw" style="background:#8fbf9a"></i>compensa</span><span class="it"><i class="sw" style="background:#d58a77"></i>não compensa</span>`;
    const yearsGreen = yrs.filter(yr => d3.mean(D.ufs, u => avg(u, yr)) < THRESH);
    $('#n-heat').innerHTML = yearsGreen.length
      ? `Média do ano: abaixo de 70% em ${yearsGreen.length} dos ${yrs.length} anos${yearsGreen.at(-1) < yrs.at(-1) ? ` — o último foi ${yearsGreen.at(-1)}` : ''}. <span class="warn">O verde foi sumindo.</span>`
      : 'Média do ano: o etanol não compensou em média em nenhum ano.';
    markHeat();
  }
  function markHeat() {
    const h = S._heat; if (!h) return;
    const yr = D.yearOf(S.idx);
    d3.select('#chart-heat rect.hm-col').attr('x', h.x(yr) - 1).attr('width', h.x.bandwidth() + 2);
    const row = d3.select('#chart-heat rect.hm-row');
    if (S.uf === 'BR') row.attr('opacity', 0); else row.attr('opacity', 1).attr('y', h.y(S.uf) - 1).attr('height', h.y.bandwidth() + 2);
    d3.selectAll('#chart-heat text[class^="hl-"]').attr('fill', '#777').style('font-weight', 400);
    if (S.uf !== 'BR') d3.select(`#chart-heat text.hl-${S.uf}`).attr('fill', '#333').style('font-weight', 700);
  }
})();
