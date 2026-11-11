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
    politica: { n: 'Política', c: '#5C6B7A' },
    petrobras: { n: 'Petrobras', c: '#0E7C86' },
    etanol: { n: 'Etanol', c: '#2E7D4F' },
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
  const S = { uf: 'BR', fuel: 'all', idx: 0, playing: false, type: 'all', q: '', real: false, mapMetric: null };
  let D = null;           // dados processados
  let timer = null;

  /* ---------- carga ---------- */
  Promise.all(['series', 'events', 'meta', 'brasil-uf', 'ipca', 'municipios'].map(n => fetch(`data/${n}.json`).then(r => {
    if (!r.ok) throw new Error(`${n}.json: ${r.status}`);
    return r.json();
  }))).then(([series, events, meta, geo, ipca, mun]) => init(series, events, meta, geo, ipca, mun))
    .catch(err => {
      document.querySelector('.layout').innerHTML =
        `<div class="card" style="grid-column:1/-1"><b>Não foi possível carregar os dados.</b><p class="sub">${err.message}</p></div>`;
      console.error(err);
    });

  function init(series, events, meta, geo, ipca, mun) {
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
    const evs = events.map(e => ({ ...e, i: Math.max(0, months.indexOf(e.date)) }))
      .filter(e => months.includes(e.date)).sort((a, b) => a.i - b.i);

    // preços reais: reais de hoje (último mês) via IPCA
    const defl = ipca.indice.map(v => ipca.indice[ipca.indice.length - 1] / v);
    const dataReal = {};
    for (const f of FUELS) { dataReal[f.k] = {}; for (const u of [...ufs, 'BR']) dataReal[f.k][u] = data[f.k][u].map((v, i) => v * defl[i]); }
    const munMonths = mun.months.map(m => months.indexOf(m));

    D = { dataNom: data, dataReal, defl, ipca, geo, mun, munMonths, months, N, states, ufs, byUf, ratio, years, yearIdx, yearOf, monthOf, label, ym, evs, meta };
    S.idx = N - 1;

    readHash();
    buildControls();
    hero();
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
    const mm = p.get('map'); if (['gasolina', 'etanol', 'diesel', 'ratio'].includes(mm)) S.mapMetric = mm;
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (S.uf !== 'BR') p.set('uf', S.uf);
    if (S.fuel !== 'all') p.set('fuel', S.fuel);
    if (S.idx !== D.N - 1) p.set('m', D.months[S.idx]);
    if (S.real) p.set('real', '1');
    if (S.mapMetric) p.set('map', S.mapMetric);
    const h = p.toString();
    history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  }

  /* ---------- controles ---------- */
  function buildControls() {
    const selUf = $('#sel-uf');
    selUf.append(new Option('Brasil (média)', 'BR'));
    for (const s of D.states) selUf.append(new Option(`${s.uf} — ${s.nome}`, s.uf));
    selUf.onchange = () => setUf(selUf.value);
    $('#sel-fuel').onchange = (e) => { S.fuel = e.target.value; renderAll(true); };

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
    document.querySelectorAll('#map-metric button').forEach(b => b.onclick = () => { S.mapMetric = b.dataset.m; renderAll(false); });
    if (D.meta.demo) $('#demo-flag').hidden = false;
    $('#src').textContent = `Fonte: ${D.meta.fonte || 'ANP'}`;
    $('#heat-range').textContent = `${D.years[0]} – ${D.years.at(-1)}`;
    $('#hero-range').textContent = `${D.years[0]} – ${D.years.at(-1)}`;
    $('#hero-caption').textContent = `coletas de preço na bomba, de ${D.years[0]} a ${D.years.at(-1)}.`;
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

  /* ---------- hero ---------- */
  function hero() {
    const target = D.meta.coletas || 0, node = $('#counter'), fill = $('#rule-fill');
    const fmt = (v) => f0.format(Math.round(v));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !target) {
      node.textContent = fmt(target); fill.style.width = '100%'; return;
    }
    const t0 = performance.now(), dur = 1800;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(target * e);
      fill.style.width = `${e * 100}%`;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------- render ---------- */
  function renderAll(full) {
    $('#lbl-month').textContent = D.label(S.idx);
    writeHash();
    renderKpis();
    renderFeed();
    renderCharts(full);
  }
  function renderCharts(full) {
    drawLine();
    drawDumbbell();
    drawScatter();
    drawMap();
    drawMunicipios();
    if (full || !S._barsDrawn) { drawBars(); }
    else markBars();
    if (full || !S._heatDrawn) drawHeat(); else markHeat();
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
    const hay = (e) => fold(`${e.title} ${e.text} ${TYPES[e.type]?.n || e.type} ${MESES_L[+e.date.slice(5) - 1]} ${e.date.slice(0, 4)}`);
    const items = D.evs.filter(e => (S.type === 'all' || e.type === S.type) && terms.every(t => hay(e).includes(t)))
      .map(e => ({ ...e, dist: Math.abs(e.i - i) })).sort((a, b) => a.dist - b.dist);
    $('#feed-sub').textContent = `${items.length} ${items.length === 1 ? 'registro' : 'registros'} · ${terms.length ? 'filtrados · ' : ''}mais próximos de ${D.label(i)}`;
    list.innerHTML = '';
    if (!items.length) { list.append(el('div', 'feed-empty', 'Nenhum registro encontrado para esta busca.')); return; }
    // destaca os termos encontrados (sobre texto escapado)
    const esc = (t) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const mark = (t) => {
      if (!terms.length) return esc(t);
      const f = fold(t), ranges = [];
      for (const term of terms) { let k = f.indexOf(term); while (k >= 0) { ranges.push([k, k + term.length]); k = f.indexOf(term, k + term.length); } }
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = []; for (const r of ranges) { const l = merged.at(-1); if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
      let out = '', pos = 0;
      for (const [a, b] of merged) { out += esc(t.slice(pos, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>'; pos = b; }
      return out + esc(t.slice(pos));
    };
    for (const e of items) {
      const t = TYPES[e.type] || { n: e.type, c: '#999' };
      const [y, m] = e.date.split('-');
      const node = el('div', `ev${e.i > i ? ' future' : ''}${e.dist <= 2 ? ' near' : ''}`,
        `<h4>${mark(e.title)}</h4><p>${mark(e.text)}</p>
         <div class="meta"><span class="tag" style="--c:${t.c}">${t.n}</span><span>${MESES_L[+m - 1]} de ${y}</span></div>`);
      node.style.setProperty('--c', t.c);
      node.tabIndex = 0;
      node.onclick = () => { stop(); setIdx(e.i); };
      node.onkeydown = (ev) => { if (ev.key === 'Enter') node.click(); };
      list.append(node);
    }
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
    evg.selectAll('circle').data(D.evs).join('circle')
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
