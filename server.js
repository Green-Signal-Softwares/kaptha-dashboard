const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1zgf41qe7eIMj6jYKVoGZQB7J_mVcvRHXG7tIxvLSFEs';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

let dreCache      = { data: null, ts: 0 };
let clientesCache = { data: null, ts: 0 };
let metasCache    = { data: null, ts: 0 };

// ─── Utilitários ──────────────────────────────────────────────────────────────

function parseValue(str) {
  if (!str || typeof str !== 'string') return 0;
  const s = str.trim();
  if (!s) return 0;
  const negative = s.startsWith('-');
  const cleaned = s
    .replace(/R\$\s*/g, '')
    .replace(/%/g, '')
    .trim()
    .replace(/\./g, '')   // remove separadores de milhar
    .replace(',', '.');   // converte decimal BR → EN
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : (negative ? -Math.abs(val) : val);
}

function parseProgresso(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '-' || s === '–' || s.startsWith('#')) return null;
  const hasPercent = s.includes('%');
  const n = parseFloat(s.replace('%', '').replace(',', '.').replace(/\s/g, ''));
  if (isNaN(n) || n < 0) return null;
  if (hasPercent) return Math.round(n * 10) / 10;
  // Sem %: valores 0–1.99 são tratados como fração (ex: 0.75 → 75%)
  if (n < 2) return Math.round(n * 100 * 10) / 10;
  return Math.round(n * 10) / 10;
}

function getRow(rows, rowNum, cols) {
  const row = rows[rowNum - 1];
  return cols.map(i => parseValue(row ? (row[i] || '') : ''));
}

function getCell(rows, rowNum, col) {
  const row = rows[rowNum - 1];
  return row ? parseValue(row[col] || '') : 0;
}

// ─── Mapeamento de colunas (índice 0-based dentro do array da linha) ──────────
// Cabeçalho confirmado via exploração:
// Índices 1-13  → 13 meses Ano 1 (ago/25 → ago/26), col B→N
// Índice  14    → TOTAL Ano 1 (col O)
// Índice  15    → % Ano 1     (col P)
// Índices 16-28 → 13 meses Ano 2 (set/26 → set/27), col Q→AC
// Índice  29    → TOTAL Ano 2 (col AD)
// Índice  30    → % Ano 2     (col AE)

const ANO1_COLS  = [1,2,3,4,5,6,7,8,9,10,11,12,13];
const ANO2_COLS  = [16,17,18,19,20,21,22,23,24,25,26,27,28];
const TOT1_COL   = 14;
const TOT2_COL   = 29;
const PCT1_COL   = 15;
const PCT2_COL   = 30;

const ANO1_MONTHS = [
  { label:'ago/25', fullLabel:'Agosto 2025',    year:2025, month:8  },
  { label:'set/25', fullLabel:'Setembro 2025',  year:2025, month:9  },
  { label:'out/25', fullLabel:'Outubro 2025',   year:2025, month:10 },
  { label:'nov/25', fullLabel:'Novembro 2025',  year:2025, month:11 },
  { label:'dez/25', fullLabel:'Dezembro 2025',  year:2025, month:12 },
  { label:'jan/26', fullLabel:'Janeiro 2026',   year:2026, month:1  },
  { label:'fev/26', fullLabel:'Fevereiro 2026', year:2026, month:2  },
  { label:'mar/26', fullLabel:'Março 2026',     year:2026, month:3  },
  { label:'abr/26', fullLabel:'Abril 2026',     year:2026, month:4  },
  { label:'mai/26', fullLabel:'Maio 2026',      year:2026, month:5  },
  { label:'jun/26', fullLabel:'Junho 2026',     year:2026, month:6  },
  { label:'jul/26', fullLabel:'Julho 2026',     year:2026, month:7  },
  { label:'ago/26', fullLabel:'Agosto 2026',    year:2026, month:8  },
];

const ANO2_MONTHS = [
  { label:'set/26', fullLabel:'Setembro 2026',  year:2026, month:9  },
  { label:'out/26', fullLabel:'Outubro 2026',   year:2026, month:10 },
  { label:'nov/26', fullLabel:'Novembro 2026',  year:2026, month:11 },
  { label:'dez/26', fullLabel:'Dezembro 2026',  year:2026, month:12 },
  { label:'jan/27', fullLabel:'Janeiro 2027',   year:2027, month:1  },
  { label:'fev/27', fullLabel:'Fevereiro 2027', year:2027, month:2  },
  { label:'mar/27', fullLabel:'Março 2027',     year:2027, month:3  },
  { label:'abr/27', fullLabel:'Abril 2027',     year:2027, month:4  },
  { label:'mai/27', fullLabel:'Maio 2027',      year:2027, month:5  },
  { label:'jun/27', fullLabel:'Junho 2027',     year:2027, month:6  },
  { label:'jul/27', fullLabel:'Julho 2027',     year:2027, month:7  },
  { label:'ago/27', fullLabel:'Agosto 2027',    year:2027, month:8  },
  { label:'set/27', fullLabel:'Setembro 2027',  year:2027, month:9  },
];

// ─── Leitura da planilha ───────────────────────────────────────────────────────

async function fetchDRE() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'DRE GERENCIAL'!A1:AH200",
  });
  const rows = res.data.values || [];

  // Helper: extrai série mensal + total + pct de uma linha
  function buildSerie(rowNum) {
    return {
      ano1: getRow(rows, rowNum, ANO1_COLS),
      ano2: getRow(rows, rowNum, ANO2_COLS),
      total1: getCell(rows, rowNum, TOT1_COL),
      total2: getCell(rows, rowNum, TOT2_COL),
      pct1:   getCell(rows, rowNum, PCT1_COL),
      pct2:   getCell(rows, rowNum, PCT2_COL),
    };
  }

  const data = {
    faturamentoTotal:    buildSerie(3),
    faturamentoClientes: buildSerie(6),
    aporte:              buildSerie(5),
    custos:              buildSerie(7),
    // Categorias de custo
    pessoalTotal:        buildSerie(9),
    pessoalEstrategico:  buildSerie(10),
    pessoalTatico:       buildSerie(16),
    pessoalOperacional:  buildSerie(20),
    infraTecnologia:     buildSerie(36),
    estruturaAdm:        buildSerie(49),
    variaveis:           buildSerie(61),
    sistemas:            buildSerie(62),
    comissoesRepasses:   buildSerie(68),
    emprestimos:         buildSerie(88),
    marketing:           buildSerie(94),
    conhecimento:        buildSerie(101),
    // Resultados
    resultado:           buildSerie(104),
    resultadoFinal:      buildSerie(105),
    usoInvestimento:     buildSerie(108),
    capitalGiro:         buildSerie(109),
    fluxoCaixa:          buildSerie(122),
    fluxoCaixaInadimp:   buildSerie(123),
  };

  // ─── Mês atual ──────────────────────────────────────────────────────────────
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  let currentPeriod = null;

  ANO1_MONTHS.forEach((m, i) => {
    if (m.year === cy && m.month === cm)
      currentPeriod = { ano: 1, idx: i, label: m.label, fullLabel: m.fullLabel };
  });
  if (!currentPeriod) {
    ANO2_MONTHS.forEach((m, i) => {
      if (m.year === cy && m.month === cm)
        currentPeriod = { ano: 2, idx: i, label: m.label, fullLabel: m.fullLabel };
    });
  }

  // ─── Burn rate e runway ──────────────────────────────────────────────────────
  const allUso    = [...data.usoInvestimento.ano1, ...data.usoInvestimento.ano2];
  const allAporte = [...data.aporte.ano1, ...data.aporte.ano2];
  const startIdx  = currentPeriod
    ? (currentPeriod.ano === 1 ? currentPeriod.idx : 13 + currentPeriod.idx)
    : 0;

  // Média do uso do investimento nos últimos 3 meses (inclusive atual)
  const window    = allUso.slice(Math.max(0, startIdx - 2), startIdx + 1).filter(v => v > 0);
  const burnRate  = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;

  // Aporte restante a partir do mês atual (inclusive)
  const investRestante = allAporte.slice(startIdx).reduce((a, b) => a + b, 0);
  const runway = burnRate > 0 ? investRestante / burnRate : null;

  // ─── Break-even ──────────────────────────────────────────────────────────────
  const allFat  = [...data.faturamentoClientes.ano1, ...data.faturamentoClientes.ano2];
  const allCust = [...data.custos.ano1, ...data.custos.ano2];
  const allRes  = [...data.resultado.ano1, ...data.resultado.ano2];
  const allMonths = [...ANO1_MONTHS, ...ANO2_MONTHS];

  let breakEvenIdx = null;
  for (let i = 0; i < allMonths.length; i++) {
    if (allFat[i] >= allCust[i]) { breakEvenIdx = i; break; }
  }

  // Break-even sustentável: 3 meses consecutivos com resultado > 0
  let sustainableIdx = null;
  for (let i = 0; i < allRes.length - 2; i++) {
    if (allRes[i] > 0 && allRes[i+1] > 0 && allRes[i+2] > 0) { sustainableIdx = i; break; }
  }

  return {
    metadata: {
      lastUpdated:   new Date().toISOString(),
      currentPeriod,
    },
    months: { ano1: ANO1_MONTHS, ano2: ANO2_MONTHS },
    series: data,
    burnRunway: {
      burnRateMensal:   Math.round(burnRate),
      investRestante:   Math.round(investRestante),
      runwayMeses:      runway !== null ? Math.round(runway * 10) / 10 : null,
    },
    breakEven: {
      operacional: breakEvenIdx !== null ? {
        idx: breakEvenIdx,
        label: allMonths[breakEvenIdx].label,
        fullLabel: allMonths[breakEvenIdx].fullLabel,
        ano: breakEvenIdx < 13 ? 1 : 2,
        idxWithinAno: breakEvenIdx < 13 ? breakEvenIdx : breakEvenIdx - 13,
      } : null,
      sustentavel: sustainableIdx !== null ? {
        idx: sustainableIdx,
        label: allMonths[sustainableIdx].label,
        fullLabel: allMonths[sustainableIdx].fullLabel,
      } : null,
    },
  };
}

// ─── Clientes Assinados ───────────────────────────────────────────────────────

async function fetchClientes() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'CLIENTES ASSINADOS'!A1:AH300",
  });
  const rows = res.data.values || [];

  // Plan header keywords (normalized, sem acento)
  const PLAN_KW  = ['STARTER', 'ESSENCIAL', 'VENDER', 'AVANCADO', 'AVANÇADO'];
  const SKIP_KW  = ['TOTAL', 'SUBTOTAL', 'MEDIA', 'MÉDIA', 'SOMA', 'RESUMO', 'CONTROLE'];
  const normalize = s => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const clients = [];
  let currentPlan = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    const cellA = String(row[0]).trim();
    const upper = normalize(cellA);

    // Plan header?
    if (PLAN_KW.some(kw => upper.startsWith(kw))) {
      currentPlan = cellA;
      continue;
    }
    if (!currentPlan || cellA.length < 2) continue;

    // Ignora linhas de totais/cabeçalhos internos
    if (SKIP_KW.some(kw => upper.startsWith(kw))) continue;

    const ano1 = ANO1_COLS.map(ci => parseValue(row[ci] || ''));
    const ano2 = ANO2_COLS.map(ci => parseValue(row[ci] || ''));
    if (![...ano1, ...ano2].some(v => v > 0)) continue;

    clients.push({ name: cellA, plan: currentPlan, ano1, ano2 });
  }

  const ALL_M = [...ANO1_MONTHS, ...ANO2_MONTHS];
  const N = ALL_M.length;

  // Mês atual → índice 0-25
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  let curMi = ALL_M.findIndex(m => m.year === cy && m.month === cm);
  if (curMi < 0) curMi = 12; // fallback: último mês do Ano 1

  const getVal = (c, mi) => mi < 13 ? c.ano1[mi] : c.ano2[mi - 13];

  // ── Séries mensais ─────────────────────────────────────────────────────────
  const ticketMedioSeries = ALL_M.map((_, mi) => {
    const act = clients.filter(c => getVal(c, mi) > 0);
    if (!act.length) return 0;
    return act.reduce((s, c) => s + getVal(c, mi), 0) / act.length;
  });

  const clientCountSeries = ALL_M.map((_, mi) =>
    clients.filter(c => getVal(c, mi) > 0).length
  );

  const churnSeries = ALL_M.map((_, mi) => {
    if (mi === 0) return 0;
    const prevAct = clients.filter(c => getVal(c, mi - 1) > 0).length;
    if (!prevAct) return 0;
    const churned = clients.filter(c => getVal(c, mi - 1) > 0 && getVal(c, mi) === 0).length;
    return (churned / prevAct) * 100;
  });

  // ── Resumo mês atual ───────────────────────────────────────────────────────
  const activos = clients.filter(c => getVal(c, curMi) > 0);
  const qtdAtual = activos.length;
  const mrr = activos.reduce((s, c) => s + getVal(c, curMi), 0);
  const ticketAtual = qtdAtual > 0 ? mrr / qtdAtual : 0;

  // Churn rate mensal global: (churned / total) / meses_decorridos
  // Calculado APÓS ltvList ser definido — placeholder aqui, final abaixo

  // ── TOP 10 por receita acumulada até mês atual ─────────────────────────────
  const top10 = clients
    .map(c => ({
      name: c.name,
      plan: c.plan,
      total: ALL_M.slice(0, curMi + 1).reduce((s, _, mi) => s + getVal(c, mi), 0),
    }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // ── LTV (apenas clientes que já churnaram) ─────────────────────────────────
  const ltvList = clients.map(c => {
    const vals = ALL_M.map((_, mi) => getVal(c, mi));
    const first = vals.findIndex(v => v > 0);
    if (first < 0) return null;

    // Encontra o último mês ativo até curMi
    let last = first;
    for (let mi = first + 1; mi <= curMi; mi++) {
      if (vals[mi] > 0) last = mi;
    }

    // Churnou se não está ativo agora (ou último ativo < curMi)
    const isActiveNow = vals[curMi] > 0;
    if (isActiveNow) return null; // ativo → não entra no LTV de churned

    const months = last - first + 1;
    const revenue = vals.slice(first, last + 1).reduce((s, v) => s + v, 0);
    return { name: c.name, plan: c.plan, months, revenue };
  }).filter(Boolean);

  const ltvMeses = ltvList.length > 0
    ? ltvList.reduce((s, l) => s + l.months, 0) / ltvList.length
    : null;
  const ltvReais = ltvList.length > 0
    ? ltvList.reduce((s, l) => s + l.revenue, 0) / ltvList.length
    : null;

  // Churn rate mensal global: (nChurned / nTotal) / meses_decorridos × 100
  const nMesesDecorridos = curMi + 1; // ago/25=0 … curMi = meses inclusivos
  const churnRateMensal = clients.length > 0 && nMesesDecorridos > 0
    ? (ltvList.length / clients.length) / nMesesDecorridos * 100
    : 0;

  // LTV médio por plano (somente churned)
  const plans = [...new Set(clients.map(c => c.plan))];
  const ltvPorPlano = plans.map(plan => {
    const planLtv = ltvList.filter(l => l.plan === plan);
    return {
      plan,
      nChurned: planLtv.length,
      avgMonths: planLtv.length > 0 ? planLtv.reduce((s, l) => s + l.months, 0) / planLtv.length : 0,
      avgReais:  planLtv.length > 0 ? planLtv.reduce((s, l) => s + l.revenue, 0) / planLtv.length : 0,
    };
  }).filter(p => p.nChurned > 0);

  return {
    metadata: {
      lastUpdated: new Date().toISOString(),
      curMi,
      currentPeriod: ALL_M[curMi],
    },
    months: { ano1: ANO1_MONTHS, ano2: ANO2_MONTHS },
    summary: { qtdAtual, mrr, ticketAtual, churnRateMensal },
    series: {
      labels:       ALL_M.map(m => m.label),
      ticketMedio:  ticketMedioSeries,
      clientCount:  clientCountSeries,
      churn:        churnSeries,
    },
    top10,
    ltv: {
      meses:    ltvMeses !== null ? Math.round(ltvMeses * 10) / 10 : null,
      reais:    ltvReais !== null ? Math.round(ltvReais) : null,
      nChurned: ltvList.length,
      nTotal:   clients.length,
      porPlano: ltvPorPlano,
    },
  };
}

// ─── Metas Kaptha.AI ──────────────────────────────────────────────────────────

async function fetchMetas() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'METAS KAPTHA.AI'!A1:ZZ300",
    });
  } catch {
    return { metadata: { lastUpdated: new Date().toISOString(), currentMonthLabel: '' }, items: [], hasData: false };
  }

  const rows = res.data.values || [];
  if (!rows.length) return { metadata: { lastUpdated: new Date().toISOString(), currentMonthLabel: '' }, items: [], hasData: false };

  // ── Mês atual ─────────────────────────────────────────────────────────────
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  const PT_SHORT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const PT_FULL  = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const mShort = PT_SHORT[cm - 1];
  const mFull  = PT_FULL[cm - 1];
  const yFull  = String(cy);
  const yShort = String(cy).slice(2);

  const nrm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const matchMonth = c => {
    const n = nrm(c);
    return (n.includes(mShort) || n.includes(mFull)) && (n.includes(yFull) || n.includes(yShort));
  };

  // ── Estrutura da planilha (confirmada):
  // Linha 1: "REALIZADO META MÊS/ANO" | "META 1 MÊS/ANO" | "" | "META 2 MÊS/ANO" | "" | "META 3 MÊS/ANO" | "" | (próximo mês...)
  // Linha 2: "PROJETO" | "OBJETIVO" | "REALIZADO" | "VALOR ALVO" | "PROGRESSO" | "VALOR ALVO" | "PROGRESSO" | "VALOR ALVO" | "PROGRESSO" | ...
  // Linhas 3+: dados
  //
  // Por mês: 7 colunas
  //   offset 0 → REALIZADO
  //   offset 1 → META1 ALVO
  //   offset 2 → META1 PROGRESSO (calculado na planilha – ignoramos, recalculamos)
  //   offset 3 → META2 ALVO
  //   offset 4 → META2 PROGRESSO
  //   offset 5 → META3 ALVO
  //   offset 6 → META3 PROGRESSO

  // ── Encontra a coluna REALIZADO do mês atual ──────────────────────────────
  let realCol = null;
  let currentMonthLabel = `${mFull.charAt(0)}${mFull.slice(1).toLowerCase()}/${cy}`;

  const headerRow0 = rows[0] || [];
  for (let ci = 0; ci < headerRow0.length; ci++) {
    const v = String(headerRow0[ci] || '').trim();
    if (!v || !matchMonth(v)) continue;
    const nu = nrm(v);
    // Preferir célula que contém "REALIZADO" (ex: "REALIZADO META MAIO/2026")
    if (nu.includes('REALIZADO')) {
      realCol = ci;
      currentMonthLabel = v
        .replace(/REALIZADO\s*(META)?\s*/i, '')
        .trim();
      break;
    }
  }

  // Fallback: busca qualquer célula com mês (ex: "META 1 MAIO/2026") e subtrai 1
  if (realCol === null) {
    for (let ci = 0; ci < headerRow0.length; ci++) {
      const v = String(headerRow0[ci] || '').trim();
      if (!v || !matchMonth(v)) continue;
      realCol = Math.max(2, ci - 1);
      currentMonthLabel = v.replace(/META\s*\d+\s*/i, '').trim();
      break;
    }
  }

  if (realCol === null) realCol = 2; // último fallback: coluna C

  // Limpa label (remove eventuais prefixos residuais)
  if (!currentMonthLabel) currentMonthLabel = `${mFull.charAt(0)}${mFull.slice(1).toLowerCase()}/${cy}`;

  // ── Dados começam na linha 3 (índice 2) ───────────────────────────────────
  const DATA_START = 2;
  const SKIP_DATA  = ['TOTAL','SUBTOTAL','MEDIA','MÉDIA','SOMA','RESUMO','CONTROLE','PROJETO','OBJETIVO'];
  const items = [];

  for (let ri = DATA_START; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    if (name.length < 2) continue;
    const nu = nrm(name);
    if (SKIP_DATA.some(k => nu.startsWith(k))) continue;

    const objective = String(row[1] || '').trim();

    // Lê realizado e alvos
    const realizado = parseValue(String(row[realCol]     || ''));
    const alvo1     = parseValue(String(row[realCol + 1] || ''));
    const alvo2     = parseValue(String(row[realCol + 3] || ''));
    const alvo3     = parseValue(String(row[realCol + 5] || ''));

    // Calcula progresso: min(100, realizado / alvo × 100)
    // Se realizado >= alvo2, então meta1 e meta2 estão em 100% automaticamente
    const calcPct = alvo => alvo > 0
      ? Math.min(100, Math.round(realizado / alvo * 1000) / 10)  // 1 casa decimal
      : null;

    const metas = [
      { alvo: alvo1, progresso: calcPct(alvo1) },
      { alvo: alvo2, progresso: calcPct(alvo2) },
      { alvo: alvo3, progresso: calcPct(alvo3) },
    ];

    // Filtra linhas sem nenhum alvo definido para o mês atual
    if (!alvo1 && !alvo2 && !alvo3 && !realizado) continue;

    items.push({ name, objective, realizado, metas });
  }

  return {
    metadata: { lastUpdated: new Date().toISOString(), currentMonthLabel },
    items,
    hasData: items.length > 0,
  };
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

app.get('/api/dre', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && dreCache.data && now - dreCache.ts < CACHE_TTL) return res.json(dreCache.data);
  try {
    dreCache.data = await fetchDRE();
    dreCache.ts = now;
    res.json(dreCache.data);
  } catch (err) {
    console.error('[DRE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clientes', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && clientesCache.data && now - clientesCache.ts < CACHE_TTL) return res.json(clientesCache.data);
  try {
    clientesCache.data = await fetchClientes();
    clientesCache.ts = now;
    res.json(clientesCache.data);
  } catch (err) {
    console.error('[Clientes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/metas', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && metasCache.data && now - metasCache.ts < CACHE_TTL) return res.json(metasCache.data);
  try {
    metasCache.data = await fetchMetas();
    metasCache.ts = now;
    res.json(metasCache.data);
  } catch (err) {
    console.error('[Metas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`✓ Kaptha Dashboard → http://localhost:${PORT}`);
  console.log(`  Cache: ${CACHE_TTL / 60000} min | Planilha: ${SPREADSHEET_ID}`);
});
