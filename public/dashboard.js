/* ═══════════════════════════════════════════════════════════════════════════
   KAPTHA DASHBOARD · dashboard.js  v4
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── Registra plugin de data labels globalmente ────────────────────────────────
Chart.register(ChartDataLabels);

// ── Estado ────────────────────────────────────────────────────────────────────
const state = {
  dre: null,
  clientes: null,
  metas: null,
  okr: null,
  bi: null,
  comercial: null,
  metasSelectedMonths: [], // [] = usa mês atual por padrão
  range: { from: 0, to: 12 },
  activePreset: 'ano1',
  charts: {},   // keyed by canvas id
};

// ── Paleta ────────────────────────────────────────────────────────────────────
const C = {
  green:  '#10b981', greenL: '#34d399',
  red:    '#ef4444', redL:   '#f87171',
  blue:   '#3b82f6', blueL:  '#60a5fa',
  amber:  '#f59e0b', amberL: '#fbbf24',
  teal:   '#06b6d4',
  purple: '#8b5cf6', purpleL:'#a78bfa',
  grid:   'rgba(255,255,255,0.05)',
};

const PIE_COLORS = [
  '#8b5cf6','#6d28d9','#a78bfa',
  '#3b82f6','#1d4ed8',
  '#06b6d4',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#10b981',
];

const TOP10_COLORS = [
  '#10b981','#34d399','#06b6d4','#3b82f6','#60a5fa',
  '#8b5cf6','#a78bfa','#f59e0b','#fbbf24','#ef4444',
];

// ── Metas anuais ──────────────────────────────────────────────────────────────
const META1 = 1_400_000;
const META2 = 2_800_000;

// ── Meses (preenchido após fetch) ─────────────────────────────────────────────
let ALL_MONTHS = [];

// ── Formatadores ──────────────────────────────────────────────────────────────
const fmt = v => {
  if (v == null || isNaN(v)) return '–';
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (v < 0 ? '-R$ ' : 'R$ ') + s;
};

const fmtShort = v => {
  if (v == null || isNaN(v)) return '–';
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? (abs/1_000_000).toFixed(1)+'M'
           : abs >= 1_000    ? (abs/1_000).toFixed(0)+'k'
           : abs.toFixed(0);
  return (v < 0 ? '-R$ ' : 'R$ ') + s;
};

const fmtLabel = v => {
  if (v == null || isNaN(v)) return '';
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? (abs/1_000_000).toFixed(1)+'M'
           : abs >= 1_000    ? (abs/1_000).toFixed(0)+'k'
           : abs.toFixed(0);
  return (v < 0 ? '-' : '') + s;
};

const fmtPct = v => (v == null || isNaN(v)) ? '–' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

// ── Fetch ──────────────────────────────────────────────────────────────────────
const fetchDRE      = () => fetch('/api/dre').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const fetchClientes = () => fetch('/api/clientes').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const fetchMetas    = () => fetch('/api/metas').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const fetchOKR      = () => fetch('/api/okr').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const fetchBI       = () => fetch('/api/bi').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const fetchComercial = () => fetch('/api/comercial').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

// ── Série no intervalo [from, to] ─────────────────────────────────────────────
const getInRange = (serie, from, to) => [...serie.ano1, ...serie.ano2].slice(from, to + 1);

const getCurrentRelIdx = (data, from, to) => {
  const cp = data.metadata.currentPeriod;
  if (!cp) return null;
  const abs = cp.ano === 1 ? cp.idx : 13 + cp.idx;
  return (abs >= from && abs <= to) ? abs - from : null;
};

// ── Utilitários DOM ───────────────────────────────────────────────────────────
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
const esc     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const showError = msg => { const el = document.getElementById('errorOverlay'); if(el){ el.textContent=msg; el.style.display='block'; } };
const hideError =  () => { const el = document.getElementById('errorOverlay'); if(el) el.style.display='none'; };

function updateTimestamp(iso, ids) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  ids.forEach(id => setText(id, `atualizado às ${t}`));
}

// ── Chart helper ──────────────────────────────────────────────────────────────
function makeChart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
  return state.charts[id];
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 0 · DRE
// ─────────────────────────────────────────────────────────────────────────────

function populateDateSelects(data) {
  ALL_MONTHS = [...data.months.ano1, ...data.months.ano2];
  const fromSel = document.getElementById('dateFrom');
  const toSel   = document.getElementById('dateTo');
  const opts    = ALL_MONTHS.map((m, i) => `<option value="${i}">${m.label}</option>`).join('');
  fromSel.innerHTML = opts;
  toSel.innerHTML   = opts;
  fromSel.value = '0';
  toSel.value   = '12';
}

function renderKPIs(data) {
  const cp = data.metadata.currentPeriod;
  if (!cp) return;
  const s = data.series, a = `ano${cp.ano}`, i = cp.idx;

  const fat    = s.faturamentoClientes[a][i];
  const cust   = s.custos[a][i];
  const res    = s.resultado[a][i];
  const resFin = s.resultadoFinal[a][i];
  const flux   = s.fluxoCaixa[a][i];
  const margem = fat > 0 ? (res / fat) * 100 : 0;
  const m1mrg  = s.faturamentoClientes.total1 > 0 ? (s.resultado.total1 / s.faturamentoClientes.total1) * 100 : 0;

  setText('valReceita',  fmt(fat));
  setText('valCustos',   fmt(cust));
  setText('valFluxo',    fmt(flux));
  setValWithSign('valResultado',      res);
  setValWithSign('valResultadoFinal', resFin);
  setText('valMargem', fmtPct(margem));
  document.getElementById('valMargem').style.color = margem >= 0 ? 'var(--green-l)' : 'var(--red-l)';

  const m1El = document.getElementById('valMargemAno1');
  m1El.textContent = fmtPct(m1mrg);
  m1El.className   = 'kpi-value ' + (m1mrg >= 0 ? 'positive' : 'negative');

  if (i > 0) {
    const prev = s.faturamentoClientes[a][i - 1];
    const delta = prev > 0 ? ((fat - prev) / prev) * 100 : 0;
    setText('metaReceita', `vs mês anterior: ${fmtPct(delta)}`);
  }
  setText('currentMonthLabel', `Mês atual: ${cp.fullLabel}`);
}

function setValWithSign(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmt(val);
  el.className   = 'kpi-value ' + (val >= 0 ? 'positive' : 'negative');
}

function renderMetaProgress(data) {
  const s  = data.series.faturamentoClientes;
  const cp = data.metadata.currentPeriod;
  let idxAno1 = 12;
  if (cp?.ano === 1) idxAno1 = cp.idx;
  const realizadoAno1 = s.ano1.slice(0, idxAno1 + 1).reduce((a, b) => a + b, 0);
  const projetadoAno1 = s.total1;

  let idxAno2 = -1;
  if (cp?.ano === 2) idxAno2 = cp.idx;
  const realizadoAno2 = idxAno2 >= 0 ? s.ano2.slice(0, idxAno2 + 1).reduce((a, b) => a + b, 0) : 0;
  const projetadoAno2 = s.total2 || s.ano2.reduce((a, b) => a + b, 0);

  updateMetaCard('1', realizadoAno1, projetadoAno1, META1);
  updateMetaCard('2', realizadoAno2, projetadoAno2, META2);
}

function updateMetaCard(num, realizado, projetado, meta) {
  const pctReal = (realizado / meta) * 100;
  const pctProj = (projetado / meta) * 100;
  const falta   = meta - projetado;
  setText(`metaProj${num}`,    fmt(projetado));
  setText(`metaReal${num}`,    realizado > 0 ? fmt(realizado) : '–');
  setText(`metaPctReal${num}`, pctReal > 0 ? pctReal.toFixed(1) + '%' : '–');
  setText(`metaPctProj${num}`, pctProj.toFixed(1) + '%');
  const badge = document.getElementById(`metaBadge${num}`);
  if (badge) {
    badge.textContent = pctProj.toFixed(1) + '%';
    badge.className   = 'meta-pct-badge' + (pctProj >= 100 ? ' over' : pctProj < 60 ? ' under' : '');
  }
  const faltaEl = document.getElementById(`metaFalta${num}`);
  if (faltaEl) {
    if (falta <= 0) { faltaEl.textContent = `✓ Meta superada em ${fmt(Math.abs(falta))}`; faltaEl.className = 'meta-falta achieved'; }
    else            { faltaEl.textContent = `Falta ${fmt(falta)}`; faltaEl.className = 'meta-falta'; }
  }
  const setWidth = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.min(Math.max(pct, 0), 100) + '%'; };
  setWidth(`progressProj${num}`, pctProj);
  setWidth(`progressReal${num}`, pctReal);
}

function renderEvolutionChart(data, from, to) {
  const s          = data.series;
  const labels     = ALL_MONTHS.slice(from, to + 1).map(m => m.label);
  const currRelIdx = getCurrentRelIdx(data, from, to);

  const fat    = getInRange(s.faturamentoClientes, from, to);
  const cust   = getInRange(s.custos,              from, to);
  const res    = getInRange(s.resultado,            from, to);
  const resFin = getInRange(s.resultadoFinal,       from, to);
  const flux   = getInRange(s.fluxoCaixa,           from, to);

  const showLabels = ctx => {
    const w = ctx.chart.chartArea?.width;
    if (!w) return false;
    return (w / ctx.dataset.data.length) > 48;
  };

  const vLinePlugin = {
    id: 'vLine',
    afterDraw({ ctx, scales: { x, y } }) {
      if (currRelIdx === null) return;
      const px = x.getPixelForValue(currRelIdx);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(16,185,129,0.45)'; ctx.setLineDash([4,4]); ctx.stroke();
      ctx.font = '10px Inter,sans-serif'; ctx.fillStyle = 'rgba(52,211,153,0.75)'; ctx.textAlign = 'center';
      ctx.fillText('hoje', px, y.top - 6);
      ctx.restore();
    },
  };

  const datasets = [
    { label:'Faturamento', data:fat, borderColor:C.green, backgroundColor:'rgba(16,185,129,0.07)', borderWidth:2, pointRadius:3, pointHoverRadius:6, tension:0.3, fill:true,
      datalabels:{ display:showLabels, anchor:'end', align:'top', offset:4, font:{size:9,weight:'700'}, color:C.greenL, formatter:fmtLabel, clamp:true } },
    { label:'Custos', data:cust, borderColor:C.red, backgroundColor:'rgba(239,68,68,0.04)', borderWidth:2, pointRadius:3, pointHoverRadius:6, tension:0.3, fill:false,
      datalabels:{ display:false } },
    { label:'Res. Operacional', data:res, borderColor:C.blue, backgroundColor:'rgba(59,130,246,0.06)', borderWidth:2, pointRadius:3, pointHoverRadius:6, tension:0.3, fill:true,
      datalabels:{ display:showLabels, anchor:'start', align:'bottom', offset:4, font:{size:9,weight:'700'}, color:C.blueL, formatter:fmtLabel, clamp:true } },
    { label:'Res. Final (c/ aporte)', data:resFin, borderColor:C.purple, backgroundColor:'rgba(139,92,246,0.05)', borderWidth:2, pointRadius:3, pointHoverRadius:6, tension:0.3, fill:false, borderDash:[5,3],
      datalabels:{ display:false } },
    { label:'Fluxo de Caixa', data:flux, borderColor:C.amber, borderWidth:2, pointRadius:3, pointHoverRadius:6, tension:0.3, fill:false, borderDash:[3,2],
      datalabels:{
        display: showLabels,
        anchor: ctx => ctx.raw >= 0 ? 'end' : 'start',
        align:  ctx => ctx.raw >= 0 ? 'top'  : 'bottom',
        offset: 4,
        font: { size:9, weight:'700' }, color: C.amberL,
        formatter: fmtLabel, clamp: true,
      }},
  ];

  makeChart('evolutionChart', {
    type: 'line',
    data: { labels, datasets },
    plugins: [vLinePlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 8 } },
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display:false },
        datalabels: { display:false },
        tooltip: {
          backgroundColor:'#0f1623', borderColor:'rgba(255,255,255,0.1)', borderWidth:1, padding:10,
          titleFont:{size:11,weight:'600'}, bodyFont:{size:11},
          callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid:{color:C.grid}, ticks:{font:{size:10},maxRotation:0} },
        y: {
          grid:{ color: ctx => ctx.tick.value===0 ? 'rgba(255,255,255,0.18)' : C.grid, lineWidth: ctx => ctx.tick.value===0 ? 1.5 : 1 },
          ticks:{ font:{size:10}, callback: v => fmtShort(v) },
        },
      },
    },
  });

  document.getElementById('chartLegend').innerHTML = datasets.map(ds => {
    const val = currRelIdx !== null ? ds.data[currRelIdx] : null;
    return `<div class="legend-item"><div class="legend-dot" style="background:${ds.borderColor}"></div><span>${ds.label}</span>${val != null ? `<span class="legend-val">${fmtShort(val)}</span>` : ''}</div>`;
  }).join('');
}

function renderCostPieChart(data, from, to) {
  const s        = data.series;
  const sumRange = serie => getInRange(serie, from, to).reduce((a, b) => a + b, 0);
  const cats = [
    { label:'Pessoal Estratégico', value:sumRange(s.pessoalEstrategico) },
    { label:'Pessoal Tático',      value:sumRange(s.pessoalTatico)      },
    { label:'Pessoal Operacional', value:sumRange(s.pessoalOperacional) },
    { label:'Infra + Tecnologia',  value:sumRange(s.infraTecnologia)    },
    { label:'Estrutura + ADM',     value:sumRange(s.estruturaAdm)       },
    { label:'Sistemas',            value:sumRange(s.sistemas)           },
    { label:'Comissões/Repasses',  value:sumRange(s.comissoesRepasses)  },
    { label:'Empréstimos',         value:sumRange(s.emprestimos)        },
    { label:'Marketing',           value:sumRange(s.marketing)          },
    { label:'Conhecimento',        value:sumRange(s.conhecimento)       },
  ].filter(c => c.value > 0);

  const total = cats.reduce((a, c) => a + c.value, 0);
  const fromLbl = ALL_MONTHS[from]?.label || '';
  const toLbl   = ALL_MONTHS[to]?.label   || '';
  setText('pieRangeLabel', fromLbl === toLbl ? fromLbl : `${fromLbl} – ${toLbl}`);

  document.getElementById('pieLegend').innerHTML = cats.map((c, i) => {
    const pct = total > 0 ? ((c.value / total) * 100).toFixed(1) : '0.0';
    return `<div class="pie-legend-item"><div class="pie-legend-color" style="background:${PIE_COLORS[i]}"></div><div class="pie-legend-info"><div class="pie-legend-name">${esc(c.label)}</div><div class="pie-legend-pct">${pct}%</div></div></div>`;
  }).join('');

  makeChart('costPieChart', {
    type: 'doughnut',
    data: { labels:cats.map(c=>c.label), datasets:[{ data:cats.map(c=>c.value), backgroundColor:PIE_COLORS.slice(0,cats.length), borderColor:'#0f1623', borderWidth:2, hoverOffset:5 }] },
    options: {
      responsive:true, maintainAspectRatio:false, cutout:'58%',
      plugins: {
        legend:{ display:false }, datalabels:{ display:false },
        tooltip:{ backgroundColor:'#0f1623', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          callbacks:{ label: ctx => { const t=ctx.dataset.data.reduce((a,b)=>a+b,0); const pct=t>0?((ctx.raw/t)*100).toFixed(1):0; return ` ${fmt(ctx.raw)}  (${pct}%)`; } } },
      },
    },
  });
}

function renderDRE(data, from, to) {
  renderKPIs(data);
  renderMetaProgress(data);
  renderEvolutionChart(data, from, to);
  renderCostPieChart(data, from, to);
  updateTimestamp(data.metadata.lastUpdated, ['lastUpdate']);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 1 · CLIENTES ASSINADOS
// ─────────────────────────────────────────────────────────────────────────────

function renderClientesPage(data) {
  const { summary, series, top10, metadata } = data;
  const cp = metadata.currentPeriod;

  // KPIs
  setText('cliMonthLabel', cp ? `Mês atual: ${cp.fullLabel}` : '–');
  setText('cliQtd',    summary.qtdAtual);
  setText('cliTicket', fmt(summary.ticketAtual));
  setText('cliMrr',    fmt(summary.mrr));

  const churnEl = document.getElementById('cliChurn');
  if (churnEl) {
    // Usa média de churn da aba BI 2026 quando disponível
    const cr = (state.bi?.ratios?.avgChurn !== null && state.bi?.ratios?.avgChurn !== undefined)
      ? state.bi.ratios.avgChurn
      : summary.churnRateMensal;
    churnEl.textContent = cr.toFixed(2) + '%';
    churnEl.className   = 'kpi-value ' + (cr > 5 ? 'negative' : cr > 2 ? '' : 'positive');
  }

  // LTV KPIs
  const { ltv } = data;
  setText('cliLtvReais',  ltv.reais  !== null ? fmt(ltv.reais)              : 'N/A');
  setText('cliLtvMeses',  ltv.meses  !== null ? ltv.meses.toFixed(1) + ' m' : 'N/A');

  updateTimestamp(metadata.lastUpdated, ['cliLastUpdate']);

  const labels = series.labels;
  const curMi  = metadata.curMi;

  // ── Chart: Ticket Médio ──────────────────────────────────────────────────
  const showTkLabels = ctx => {
    const w = ctx.chart.chartArea?.width;
    return w ? (w / ctx.dataset.data.length) > 44 : false;
  };

  const ticketDatasets = [
    {
      label: 'Ticket Médio',
      data: series.ticketMedio,
      borderColor: C.blue,
      backgroundColor: 'rgba(59,130,246,0.08)',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 6,
      tension: 0.3, fill: true,
      datalabels: {
        display: showTkLabels,
        anchor: 'end', align: 'top', offset: 3,
        font: { size: 9, weight: '700' }, color: C.blueL,
        formatter: fmtLabel, clamp: true,
      },
    },
    {
      label: 'Nº Clientes',
      data: series.clientCount,
      borderColor: C.teal,
      backgroundColor: 'rgba(6,182,212,0.05)',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 6,
      tension: 0.3, fill: false,
      yAxisID: 'y2',
      datalabels: {
        display: showTkLabels,
        anchor: 'start', align: 'bottom', offset: 3,
        font: { size: 9, weight: '700' }, color: C.teal,
        formatter: v => v,
      },
    },
  ];

  makeChart('ticketMedioChart', {
    type: 'line',
    data: { labels, datasets: ticketDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, bottom: 10 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#0f1623', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ctx.datasetIndex === 0 ? ` Ticket: ${fmt(ctx.raw)}` : ` Clientes: ${ctx.raw}` },
        },
      },
      scales: {
        x: { grid: { color: C.grid }, ticks: { font: { size: 10 }, maxRotation: 0 } },
        y:  { grid: { color: C.grid }, ticks: { font: { size: 10 }, callback: v => fmtShort(v) } },
        y2: { position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, color: C.teal } },
      },
    },
  });

  // Legenda HTML do ticket médio
  const tkLegend = document.getElementById('ticketLegend');
  if (tkLegend) {
    tkLegend.innerHTML = ticketDatasets.map(ds => {
      const val = curMi >= 0 && curMi < ds.data.length ? ds.data[curMi] : null;
      const fmtVal = ds.yAxisID === 'y2'
        ? (val != null ? val + ' cli.' : '')
        : (val != null ? fmtShort(val) : '');
      return `<div class="legend-item"><div class="legend-dot" style="background:${ds.borderColor}"></div><span>${ds.label}</span>${fmtVal ? `<span class="legend-val">${fmtVal}</span>` : ''}</div>`;
    }).join('');
  }

  // ── Chart: TOP 10 Horizontal Bar ─────────────────────────────────────────
  const t10Labels = top10.map(c => c.name.length > 22 ? c.name.slice(0, 20) + '…' : c.name);
  makeChart('top10Chart', {
    type: 'bar',
    data: {
      labels: t10Labels,
      datasets: [{
        label: 'Receita Acumulada',
        data: top10.map(c => c.total),
        backgroundColor: TOP10_COLORS.slice(0, top10.length).map(c => c + 'cc'),
        borderColor:     TOP10_COLORS.slice(0, top10.length),
        borderWidth: 1,
        borderRadius: 4,
        datalabels: {
          display: true,
          anchor: 'end', align: 'right', offset: 4,
          font: { size: 9, weight: '700' }, color: '#94a3b8',
          formatter: fmtLabel,
        },
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 56 } },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#0f1623', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ` ${fmt(ctx.raw)}`, title: tt => top10[tt[0].dataIndex].name },
        },
      },
      scales: {
        x: { grid: { color: C.grid }, ticks: { font: { size: 9 }, callback: v => fmtShort(v) } },
        y: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#cbd5e1' } },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 2 · LTV & RETENÇÃO
// ─────────────────────────────────────────────────────────────────────────────

function renderLTVPage(data) {
  const { ltv, summary, series, metadata } = data;
  const cp = metadata.currentPeriod;

  setText('ltvMonthLabel', cp ? `Mês atual: ${cp.fullLabel}` : '–');
  updateTimestamp(metadata.lastUpdated, ['ltvLastUpdate']);

  // KPIs
  setText('ltvMeses',   ltv.meses !== null ? ltv.meses + ' meses' : 'N/A');
  setText('ltvReais',   ltv.reais !== null ? fmt(ltv.reais) : 'N/A');
  setText('ltvTotal',   ltv.nTotal);
  setText('ltvChurned', ltv.nChurned);
  setText('ltvTicket',  fmt(summary.ticketAtual));

  // ── Chart: Churn Mensal (movido da página 2) ─────────────────────────────
  makeChart('churnChart', {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [{
        label: 'Churn %',
        data: series.churn,
        backgroundColor: series.churn.map(v => v > 5 ? 'rgba(239,68,68,0.7)' : v > 0 ? 'rgba(245,158,11,0.6)' : 'rgba(16,185,129,0.3)'),
        borderColor:     series.churn.map(v => v > 5 ? C.red : v > 0 ? C.amber : C.green),
        borderWidth: 1, borderRadius: 3,
        datalabels: {
          display: ctx => ctx.raw > 0,
          anchor: 'end', align: 'top', offset: 1,
          font: { size: 9, weight: '700' },
          color: ctx => ctx.raw > 5 ? C.redL : C.amberL,
          formatter: v => v.toFixed(1) + '%',
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: '#0f1623', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          callbacks: { label: ctx => ` Churn: ${ctx.raw.toFixed(1)}%` },
        },
      },
      scales: {
        x: { grid: { color: C.grid }, ticks: { font: { size: 10 }, maxRotation: 0 } },
        y: { grid: { color: C.grid }, ticks: { font: { size: 10 }, callback: v => v.toFixed(0)+'%' }, min: 0 },
      },
    },
  });

  // ── Chart: LTV por plano ─────────────────────────────────────────────────
  if (ltv.porPlano && ltv.porPlano.length > 0) {
    const planos  = ltv.porPlano.map(p => p.plan);
    const mesesPl = ltv.porPlano.map(p => Math.round(p.avgMonths * 10) / 10);
    const PLAN_COLORS = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#06b6d4'];

    makeChart('ltvPlanoChart', {
      type: 'bar',
      data: {
        labels: planos,
        datasets: [{
          label: 'LTV Médio (meses)',
          data: mesesPl,
          backgroundColor: PLAN_COLORS.slice(0, planos.length).map(c => c + 'bb'),
          borderColor:     PLAN_COLORS.slice(0, planos.length),
          borderWidth: 1,
          borderRadius: 5,
          datalabels: {
            display: true,
            anchor: 'end', align: 'top', offset: 3,
            font: { size: 11, weight: '700' }, color: '#f1f5f9',
            formatter: v => v + ' m',
          },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 28 } },
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            backgroundColor: '#0f1623', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
            callbacks: { label: ctx => ` LTV médio: ${ctx.raw} meses` },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#cbd5e1' } },
          y: { grid: { color: C.grid }, ticks: { font: { size: 10 }, callback: v => v + ' m' }, min: 0 },
        },
      },
    });
  } else {
    const ctx = document.getElementById('ltvPlanoChart');
    if (ctx) {
      const c = ctx.getContext('2d');
      c.fillStyle = 'rgba(148,163,184,0.3)';
      c.font = '13px Inter';
      c.textAlign = 'center';
      c.fillText('Sem dados de LTV por plano ainda', ctx.width / 2, ctx.height / 2);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 0 · METAS KAPTHA.AI
// ─────────────────────────────────────────────────────────────────────────────

// Agrega realizado e alvos de múltiplos meses selecionados
function aggregateMetasForMonths(data, selectedMonths) {
  const months = selectedMonths.length > 0
    ? selectedMonths
    : (data.metadata.currentMonthLabel ? [data.metadata.currentMonthLabel] : []);

  return data.items.map(item => {
    let totalRealizado = 0;
    const alvoSums = [0, 0, 0];

    for (const month of months) {
      const md = item.monthData?.[month];
      if (!md) continue;
      totalRealizado += md.realizado || 0;
      md.metas.forEach((m, i) => { alvoSums[i] += m.alvo || 0; });
    }

    const calcPct = alvo => alvo > 0
      ? Math.min(100, Math.round(totalRealizado / alvo * 1000) / 10)
      : null;

    return {
      name: item.name,
      objective: item.objective,
      realizado: totalRealizado,
      metas: alvoSums.map(alvo => ({ alvo, progresso: calcPct(alvo) })),
    };
  });
}

// Renderiza as pills de seleção de mês
function renderMetasMonthFilter(data) {
  const container = document.getElementById('metasMonthFilter');
  if (!container) return;

  const months = data.metadata.months || [];
  if (!months.length) { container.innerHTML = ''; return; }

  const current  = data.metadata.currentMonthLabel;
  const selected = state.metasSelectedMonths;

  const shortLabel = label => {
    const parts = label.split('/');
    if (parts.length !== 2) return label;
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1, 3).toLowerCase() + '/' + parts[1].slice(2);
  };

  container.innerHTML = months.map(month => {
    const isActive = selected.length === 0
      ? month === current
      : selected.includes(month);
    return `<button class="metas-month-pill${isActive ? ' active' : ''}" data-month="${esc(month)}">${shortLabel(month)}</button>`;
  }).join('');

  container.querySelectorAll('.metas-month-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const month = btn.dataset.month;
      const idx = state.metasSelectedMonths.indexOf(month);
      if (idx >= 0) {
        state.metasSelectedMonths.splice(idx, 1);
      } else {
        state.metasSelectedMonths.push(month);
      }
      if (state.metas) renderMetasPage(state.metas);
    });
  });
}

function renderMetasPage(data) {
  const { metadata } = data;

  // Label do badge de mês
  const sel = state.metasSelectedMonths;
  const labelText = sel.length === 0
    ? (metadata.currentMonthLabel ? `Mês: ${metadata.currentMonthLabel}` : '–')
    : sel.length === 1
    ? `Mês: ${sel[0]}`
    : `${sel.length} meses selecionados`;
  setText('metasMonthLabel', labelText);
  updateTimestamp(metadata.lastUpdated, ['metasLastUpdate']);

  // Renders das pills de mês
  renderMetasMonthFilter(data);

  const grid = document.getElementById('metasGrid');
  if (!grid) return;

  if (!data.hasData || !data.items.length) {
    grid.innerHTML = '<div class="metas-empty">Sem dados de metas para o mês atual.<br>Verifique se a aba "METAS KAPTHA.AI" está preenchida.</div>';
    return;
  }

  // Agrega os dados dos meses selecionados
  const items = aggregateMetasForMonths(data, state.metasSelectedMonths);

  const barClass = pct => {
    if (pct === null || pct === 0) return 'critical';
    if (pct >= 100) return 'achieved';
    if (pct >= 75)  return 'good';
    if (pct >= 50)  return 'mid';
    if (pct >= 25)  return 'low';
    return 'critical';
  };

  const pctLabel = pct =>
    pct === null ? 'N/A' : pct >= 100 ? '100%' : pct.toFixed(1) + '%';

  const fmtMeta = v => {
    if (v == null) return '–';
    if (v === 0)   return '0';
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return 'R$ ' + (v / 1_000_000).toFixed(1) + 'M';
    if (abs >= 1_000)     return 'R$ ' + (v / 1_000).toFixed(0) + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };

  const META_LABELS = ['Meta 1', 'Meta 2', 'Meta 3'];
  const META_BAR_COLORS = {
    achieved: 'var(--green)',
    good:     'var(--teal)',
    mid:      'var(--amber)',
    low:      '#f97316',
    critical: 'var(--red)',
  };

  grid.innerHTML = items.map(item => {
    const realStr = fmtMeta(item.realizado);

    const barsHtml = item.metas.map((meta, mi) => {
      if (!meta.alvo) return '';
      const pct    = meta.progresso;
      const pctVis = Math.min(pct !== null ? pct : 0, 100);
      const cls    = barClass(pct);

      return `
        <div class="mic-bar-row">
          <div class="mic-bar-header">
            <span class="mic-meta-label">${META_LABELS[mi]}</span>
            <span class="mic-alvo-tag">Alvo ${fmtMeta(meta.alvo)}</span>
            <span class="mic-pct ${cls}">${pctLabel(pct)}</span>
          </div>
          <div class="mic-bar-track">
            <div class="mic-bar-fill" style="width:${pctVis}%; background:${META_BAR_COLORS[cls]}"></div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="mic">
        <div class="mic-head">
          <div class="mic-head-main">
            <span class="mic-name">${esc(item.name)}</span>
            ${item.objective ? `<span class="mic-obj">${esc(item.objective)}</span>` : ''}
          </div>
          <div class="mic-realizado">
            <span class="mic-real-label">Realizado</span>
            <span class="mic-real-val">${realStr}</span>
          </div>
        </div>
        <div class="mic-bars">${barsHtml}</div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  OKR — SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const okrBarCls = pct => {
  if (pct === null || pct === undefined) return 'critical';
  if (pct >= 100) return 'achieved';
  if (pct >= 70)  return 'good';
  if (pct >= 40)  return 'mid';
  if (pct >= 15)  return 'low';
  return 'critical';
};

const okrPctLbl = pct => (pct === null || pct === undefined) ? '–' : pct.toFixed(1) + '%';

const okrBar = (pct, cls, trackClass = 'okr-bar-track') => {
  const w = (pct !== null && pct !== undefined) ? Math.min(100, Math.max(0, pct)) : 0;
  return `<div class="${trackClass}"><div class="okr-bar-fill ${cls}" style="width:${w}%"></div></div>`;
};

const okrObjBadge = i => i < 5 ? `OBJ ${i + 1}` : 'INFRA';

function okrTimestamp(data) {
  return new Date(data.metadata.lastUpdated)
    .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 0 · BI 2026
// ─────────────────────────────────────────────────────────────────────────────

function renderBIPage(data) {
  const { labels, financials, ratios, contratos, metadata } = data;
  setText('biLastUpdate', `atualizado às ${new Date(metadata.lastUpdated).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`);
  if (!data.hasData) return;

  // ── Helpers compartilhados ─────────────────────────────────────────────────
  const FIN_COLORS = [C.green, C.teal, C.red, C.amber, C.blue];

  const lineDs = (label, vals, color, extra = {}) => ({
    label, data: vals,
    borderColor: color, backgroundColor: color + '14',
    borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 8,
    tension: 0.2, fill: false,
    ...extra,
  });

  const dlOpts = (color, alignV = 'top', suf = '', sz = 11) => ({
    display: true,
    anchor: 'end', align: alignV, offset: 4, clamp: true,
    font: { size: sz, weight: '700' }, color,
    formatter: v => (v !== null && v !== undefined) ? v + suf : '',
  });

  const baseOpts = (scales, tipCb) => ({
    responsive: true, maintainAspectRatio: false,
    layout: { padding: { top: 22, right: 8 } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false }, datalabels: { display: false },
      tooltip: {
        backgroundColor: '#0f1623', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 9,
        titleFont: { size: 11, weight: '600' }, bodyFont: { size: 11 },
        callbacks: { label: tipCb },
      },
    },
    scales,
  });

  const xSc  = { grid: { color: C.grid }, ticks: { font: { size: 10 }, maxRotation: 0 } };
  const ySc  = { grid: { color: C.grid }, ticks: { font: { size: 10 } } };

  const mkLeg = (id, datasets) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = datasets.map(ds =>
      `<div class="legend-item"><div class="legend-dot" style="background:${ds.borderColor}"></div><span>${ds.label}</span></div>`
    ).join('');
  };

  // ── 1 · Financeiro Mensal ──────────────────────────────────────────────────
  const finDs = financials.map((f, i) => ({
    ...lineDs(f.name, f.values, FIN_COLORS[i], { fill: i === 0, backgroundColor: FIN_COLORS[i] + (i === 0 ? '10' : '00') }),
    datalabels: { ...dlOpts(FIN_COLORS[i]), formatter: v => fmtShort(v) },
  }));

  makeChart('biFinChart', {
    type: 'line', data: { labels, datasets: finDs },
    options: baseOpts(
      { x: xSc, y: { ...ySc, ticks: { ...ySc.ticks, callback: v => fmtShort(v) } } },
      ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`
    ),
  });
  mkLeg('biFinLegend', finDs);

  // ── 2 · Índice de Liquidez ────────────────────────────────────────────────
  const liqDs = [{
    ...lineDs('Índice de Liquidez', ratios.liquidez, C.blue, { fill: true, backgroundColor: 'rgba(59,130,246,0.08)' }),
    datalabels: { ...dlOpts(C.blueL, 'top', '', 11), formatter: v => (v !== null && v !== undefined) ? v.toFixed(2) : '' },
  }];

  makeChart('biLiqChart', {
    type: 'line', data: { labels, datasets: liqDs },
    options: baseOpts(
      { x: xSc, y: { ...ySc, ticks: { ...ySc.ticks, callback: v => v.toFixed(2) } } },
      ctx => ` Liquidez: ${ctx.raw !== null ? ctx.raw.toFixed(2) : '–'}`
    ),
  });

  // KPI médias
  const kpiEl = document.getElementById('biLiqKPIs');
  if (kpiEl) {
    const fk = (v, s) => v !== null ? v.toFixed(2) + s : 'N/A';
    kpiEl.innerHTML = `<div class="bi-kpi-chip">Méd. 3m: <strong>${fk(ratios.avgLiquidez, '')}</strong></div>`;
  }

  // ── 3 · Taxas de Churn e Inadimplência ────────────────────────────────────
  const taxasDs = [
    { ...lineDs('Taxa de Churn', ratios.churn, C.red),
      datalabels: { ...dlOpts(C.redL,   'top',    '%', 11), formatter: v => v !== null ? v.toFixed(1)+'%' : '' } },
    { ...lineDs('Taxa de Inadimplência', ratios.titulosVenc, C.amber),
      datalabels: { ...dlOpts(C.amberL, 'bottom', '%', 11), formatter: v => v !== null ? v.toFixed(2)+'%' : '' } },
  ];

  makeChart('biTaxasChart', {
    type: 'line', data: { labels, datasets: taxasDs },
    options: baseOpts(
      { x: xSc, y: { ...ySc, ticks: { ...ySc.ticks, callback: v => v + '%' } } },
      ctx => ` ${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw+'%' : '–'}`
    ),
  });
  mkLeg('biTaxasLegend', taxasDs);

  // KPI médias taxas
  const taxasKpi = document.getElementById('biTaxasKPIs');
  if (taxasKpi) {
    const fk = (v, s) => v !== null ? v.toFixed(2) + s : 'N/A';
    taxasKpi.innerHTML = [
      { l: 'Churn méd. 3m',        v: fk(ratios.avgChurn,   '%') },
      { l: 'Inadimpl. méd. 3m',    v: fk(ratios.avgTitulos, '%') },
    ].map(k => `<div class="bi-kpi-chip">${k.l}: <strong>${k.v}</strong></div>`).join('');
  }

  // ── 4 · Contratos Ativos vs Cancelados ────────────────────────────────────
  // Eixo esquerdo: Ativos (escala ~45–60)
  // Eixo direito:  Cancelados (escala 0–5)
  const contDs = [
    { ...lineDs('Contratos Ativos',    contratos.ativos,    C.teal, { fill: true, backgroundColor: 'rgba(6,182,212,0.08)', yAxisID: 'y' }),
      datalabels: { ...dlOpts(C.teal,  'top',    '', 12), formatter: v => v !== null ? v : '' } },
    { ...lineDs('Contratos Cancelados', contratos.cancelados, C.red, { yAxisID: 'y2' }),
      datalabels: { ...dlOpts(C.redL, 'bottom', '', 12), formatter: v => v !== null ? v : '' } },
  ];

  makeChart('biContratosChart', {
    type: 'line', data: { labels, datasets: contDs },
    options: baseOpts(
      {
        x:  xSc,
        y:  { ...ySc, position: 'left',  ticks: { ...ySc.ticks, stepSize: 2 } },
        y2: { grid: { display: false }, position: 'right', ticks: { font: { size: 10 }, color: C.redL, stepSize: 1 } },
      },
      ctx => ` ${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw : '–'}`
    ),
  });
  mkLeg('biContratosLegend', contDs);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 1 · OKR OBJETIVOS  — big overview cards
// ─────────────────────────────────────────────────────────────────────────────

function renderOKRObjPage(data) {
  const { objectives, metadata } = data;
  const t = okrTimestamp(data);
  setText('okrObjLastUpdate', `atualizado às ${t}`);

  const grid = document.getElementById('okrObjGrid');
  if (!grid) return;

  if (!data.hasData || !objectives.length) {
    grid.innerHTML = '<div class="okr-empty">Sem dados de OKR disponíveis.</div>';
    return;
  }

  grid.innerHTML = objectives.map((obj, oi) => {
    const cls      = okrBarCls(obj.progress);
    const pctText  = okrPctLbl(obj.progress);
    const krCount  = obj.krs.length;
    const w        = obj.progress != null ? Math.min(100, Math.max(0, obj.progress)) : 0;

    return `
      <div class="okr-big-card ${cls}">
        <div class="okr-big-top">
          <span class="okr-big-badge">${okrObjBadge(oi)}</span>
          <span class="okr-big-kr-count">${krCount} KR${krCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="okr-big-name">${esc(obj.name)}</div>
        <div class="okr-big-bottom">
          <div class="okr-big-pct-row">
            <span class="okr-big-pct okr-c-${cls}">${pctText}</span>
            <span class="okr-big-pct-label">progresso geral</span>
          </div>
          <div class="okr-big-bar-track">
            <div class="okr-big-bar-fill ${cls}" style="width:${w}%"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 1 · OKR KEY RESULTS — tabela plana (60 s)
//  Colunas: Key Result | Alvo | % KR | % Ações
// ─────────────────────────────────────────────────────────────────────────────

function renderOKRKrPage(data) {
  const { objectives, metadata } = data;
  setText('okrKrLastUpdate', `atualizado às ${okrTimestamp(data)}`);

  const wrap = document.getElementById('okrKrGrid');
  if (!wrap) return;

  if (!data.hasData || !objectives.length) {
    wrap.innerHTML = '<div class="okr-empty">Sem dados de OKR disponíveis.</div>';
    return;
  }

  // Flatten: one row per KR across all objectives
  const rows = [];
  for (const obj of objectives) {
    for (const kr of obj.krs) {
      rows.push(kr);
    }
  }

  const rowsHtml = rows.map((kr, i) => {
    const krCls = okrBarCls(kr.progresso);
    const even  = i % 2 === 1 ? ' okr-row-alt' : '';
    return `
      <div class="okr-tbl-row${even}">
        <div class="okr-tbl-kr">${esc(kr.name)}</div>
        <div class="okr-tbl-alvo">${kr.alvo ? esc(kr.alvo) : '–'}</div>
        <div class="okr-tbl-pct okr-c-${krCls}">${okrPctLbl(kr.progresso)}</div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="okr-tbl">
      <div class="okr-tbl-head">
        <div class="okr-tbl-h-kr">Key Result</div>
        <div class="okr-tbl-h-alvo">Alvo</div>
        <div class="okr-tbl-h-pct">% KR</div>
      </div>
      <div class="okr-tbl-body">${rowsHtml}</div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SLIDE 6 · FUNIL COMERCIAL
// ─────────────────────────────────────────────────────────────────────────────

const funnelBarCls = (pct, isMeta) => {
  if (pct === null || pct === undefined) return 'critical';
  if (isMeta) {
    if (pct >= 100) return 'achieved';
    if (pct >= 70)  return 'good';
    if (pct >= 40)  return 'mid';
    return 'critical';
  }
  if (pct >= 70)  return 'achieved';
  if (pct >= 40)  return 'good';
  if (pct >= 20)  return 'mid';
  if (pct >= 10)  return 'low';
  return 'critical';
};

const funnelPctLbl = pct => (pct === null || pct === undefined) ? '–' : pct.toFixed(1) + '%';

const FUNNEL_BAR_COLORS = {
  achieved: 'var(--green)',
  good:     'var(--teal)',
  mid:      'var(--amber)',
  low:      '#f97316',
  critical: 'var(--red)',
};

function renderComercialPage(data) {
  const { metadata, clients } = data;
  updateTimestamp(metadata.lastUpdated, ['comercialLastUpdate']);

  const grid = document.getElementById('comercialGrid');
  if (!grid) return;

  if (!data.hasData || !clients.length) {
    grid.innerHTML = '<div class="comercial-empty">Sem dados de funil comercial.<br>Verifique a aba DATASET em Controle_Comercial_Kaptha_Lead.xlsx.</div>';
    return;
  }

  grid.innerHTML = clients.map(client => {
    const n = client.stages.length;
    const stepsHtml = client.stages.map((stage, i) => {
      const isMeta = stage.label.startsWith('META');
      const cls    = funnelBarCls(stage.value, isMeta);
      const pctVis = stage.value !== null ? Math.min(stage.value, 100) : 0;
      const width  = Math.max(55, 100 - i * (40 / Math.max(n - 1, 1)));

      return `
        <div class="comercial-step">
          <div class="comercial-step-meta" style="--step-width:${width}%">
            <span class="comercial-step-label">${esc(stage.label)}</span>
            <span class="comercial-step-val okr-c-${cls}">${funnelPctLbl(stage.value)}</span>
          </div>
          <div class="comercial-step-bar-wrap" style="--step-width:${width}%">
            <div class="comercial-step-bar">
              <div class="comercial-step-fill ${cls}" style="width:${pctVis}%; background:${FUNNEL_BAR_COLORS[cls]}"></div>
            </div>
          </div>
        </div>`;
    }).join('');

    const overallCls = funnelBarCls(client.overall, false);

    return `
      <div class="comercial-card">
        <div class="comercial-card-head">
          <div>
            <div class="comercial-client-name">${esc(client.name)}</div>
            <span class="comercial-client-badge">${n} etapas</span>
          </div>
          <div class="comercial-overall">
            <span class="comercial-overall-label">Conv. média</span>
            <span class="comercial-overall-val okr-c-${overallCls}">${funnelPctLbl(client.overall)}</span>
          </div>
        </div>
        <div class="comercial-funnel">${stepsHtml}</div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAROUSEL
// ─────────────────────────────────────────────────────────────────────────────

// Per-slide durations (ms): todas as telas = 60s
const SLIDE_INTERVALS = [60000, 60000, 60000, 60000, 60000, 60000, 60000];
let carouselIndex   = 0;
let carouselTimer   = null;
let progressTimer   = null;
let progressStart   = 0;

const track = () => document.getElementById('carouselTrack');
const dots  = () => document.querySelectorAll('.c-dot');
const bar   = () => document.getElementById('carouselProgressBar');

function goToSlide(idx) {
  const n = document.querySelectorAll('.slide').length;
  carouselIndex = ((idx % n) + n) % n;

  track().style.transform = `translateX(-${carouselIndex * 100}vw)`;

  dots().forEach((d, i) => d.classList.toggle('active', i === carouselIndex));

  // Re-render pages when they become visible (ensures chart sizing)
  if (carouselIndex === 0 && state.bi)       renderBIPage(state.bi);
  if (carouselIndex === 1 && state.dre)      renderDRE(state.dre, state.range.from, state.range.to);
  if (carouselIndex === 2 && state.clientes) renderClientesPage(state.clientes);
  if (carouselIndex === 3 && state.okr)      renderOKRObjPage(state.okr);
  if (carouselIndex === 4 && state.okr)      renderOKRKrPage(state.okr);
  if (carouselIndex === 5 && state.metas)     renderMetasPage(state.metas);
  if (carouselIndex === 6 && state.comercial) renderComercialPage(state.comercial);

  // Re-arm the auto-advance timer with this slide's duration
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), currentInterval());

  resetProgress();
}

function currentInterval() {
  return SLIDE_INTERVALS[carouselIndex] || 60000;
}

function resetProgress() {
  clearInterval(progressTimer);
  progressStart = Date.now();
  bar().style.width = '0%';
  progressTimer = setInterval(() => {
    const elapsed = Date.now() - progressStart;
    const pct     = Math.min((elapsed / currentInterval()) * 100, 100);
    bar().style.width = pct + '%';
  }, 100);
}

function startCarousel() {
  clearInterval(carouselTimer);
  carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), currentInterval());
  resetProgress();
}

function setupCarousel() {
  dots().forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.slide);
      goToSlide(idx);
      // Restart timer with the new slide's interval
      clearInterval(carouselTimer);
      carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), currentInterval());
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  FILTROS (DRE)
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS = {
  ano1:  { from:0,  to:12 },
  ano2:  { from:13, to:25 },
  ambos: { from:0,  to:25 },
};

function setActivePreset(preset) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.filter-btn[data-preset="${preset}"]`);
  if (btn) btn.classList.add('active');
  state.activePreset = preset;
}

function applyRange(from, to) {
  from = Math.max(0, Math.min(from, 25));
  to   = Math.max(from, Math.min(to, 25));
  if (from === state.range.from && to === state.range.to) return;
  state.range = { from, to };
  document.getElementById('dateFrom').value = from;
  document.getElementById('dateTo').value   = to;
  if (state.dre) {
    renderEvolutionChart(state.dre, from, to);
    renderCostPieChart(state.dre, from, to);
  }
}

function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      setActivePreset(p);
      const { from, to } = PRESETS[p];
      applyRange(from, to);
    });
  });

  const onSelectChange = () => {
    const from = parseInt(document.getElementById('dateFrom').value);
    const to   = parseInt(document.getElementById('dateTo').value);
    const hit  = Object.entries(PRESETS).find(([, v]) => v.from === from && v.to === to);
    hit ? setActivePreset(hit[0]) : setActivePreset('');
    applyRange(from, to);
  };

  document.getElementById('dateFrom').addEventListener('change', onSelectChange);
  document.getElementById('dateTo').addEventListener('change', onSelectChange);
}

// ─────────────────────────────────────────────────────────────────────────────
//  REFRESH MANUAL
// ─────────────────────────────────────────────────────────────────────────────

async function refreshAll() {
  const btn = document.getElementById('globalRefreshBtn');
  if (btn) btn.classList.add('spinning');
  try {
    await Promise.all([
      fetch('/api/dre?force=1').then(r => { if (!r.ok) throw new Error(`DRE ${r.status}`); return r.json(); }).then(data => {
        state.dre = data;
        if (ALL_MONTHS.length === 0) populateDateSelects(data);
        renderDRE(data, state.range.from, state.range.to);
      }),
      fetch('/api/clientes?force=1').then(r => { if (!r.ok) throw new Error(`Clientes ${r.status}`); return r.json(); }).then(data => {
        state.clientes = data;
        renderClientesPage(data);
      }),
      fetch('/api/metas?force=1').then(r => { if (!r.ok) throw new Error(`Metas ${r.status}`); return r.json(); }).then(data => {
        state.metas = data;
        renderMetasPage(data);
      }),
      fetch('/api/okr?force=1').then(r => { if (!r.ok) throw new Error(`OKR ${r.status}`); return r.json(); }).then(data => {
        state.okr = data;
        renderOKRObjPage(data);
        renderOKRKrPage(data);
      }),
      fetch('/api/bi?force=1').then(r => { if (!r.ok) throw new Error(`BI ${r.status}`); return r.json(); }).then(data => {
        state.bi = data;
        renderBIPage(data);
      }),
      fetch('/api/comercial?force=1').then(r => { if (!r.ok) throw new Error(`Comercial ${r.status}`); return r.json(); }).then(data => {
        state.comercial = data;
        renderComercialPage(data);
      }),
    ]);
    hideError();
  } catch (err) {
    console.error('[Refresh manual]', err);
    showError('Erro ao atualizar: ' + err.message);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function setupRefreshBtn() {
  const btn = document.getElementById('globalRefreshBtn');
  if (btn) btn.addEventListener('click', refreshAll);
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATA LOADING
// ─────────────────────────────────────────────────────────────────────────────

async function loadDRE() {
  try {
    const data = await fetchDRE();
    state.dre  = data;
    if (ALL_MONTHS.length === 0) populateDateSelects(data);
    renderDRE(data, state.range.from, state.range.to);
    hideError();
  } catch (err) {
    console.error('[DRE]', err);
    showError('Erro ao carregar DRE: ' + err.message);
  }
}

async function loadClientes() {
  try {
    const data     = await fetchClientes();
    state.clientes = data;
    renderClientesPage(data);
  } catch (err) {
    console.error('[Clientes]', err);
  }
}

async function loadMetas() {
  try {
    const data  = await fetchMetas();
    state.metas = data;
    renderMetasPage(data);
  } catch (err) {
    console.error('[Metas]', err);
  }
}

async function loadOKR() {
  try {
    const data = await fetchOKR();
    state.okr  = data;
    renderOKRObjPage(data);
    renderOKRKrPage(data);
  } catch (err) {
    console.error('[OKR]', err);
  }
}

async function loadBI() {
  try {
    const data = await fetchBI();
    state.bi   = data;
    renderBIPage(data);
  } catch (err) {
    console.error('[BI]', err);
  }
}

async function loadComercial() {
  try {
    const data = await fetchComercial();
    state.comercial = data;
    renderComercialPage(data);
  } catch (err) {
    console.error('[Comercial]', err);
  }
}

function updateFooterClock() {
  const t = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  setText('footerTime',       t);
  setText('metasFooterTime',  t);
  setText('cliFooterTime',    t);
  setText('okrObjFooterTime', t);
  setText('okrKrFooterTime',  t);
  setText('biFooterTime',     t);
  setText('comercialFooterTime', t);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupFilters();
  setupCarousel();
  setupRefreshBtn();
  startCarousel();

  await Promise.all([loadDRE(), loadClientes(), loadMetas(), loadOKR(), loadBI(), loadComercial()]);

  setInterval(() => { loadDRE(); loadClientes(); loadMetas(); loadOKR(); loadBI(); loadComercial(); }, 5 * 60 * 1000);

  updateFooterClock();
  setInterval(updateFooterClock, 1000);
});
