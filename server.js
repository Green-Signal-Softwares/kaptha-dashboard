const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const XLSX    = require('xlsx');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID     = '1zgf41qe7eIMj6jYKVoGZQB7J_mVcvRHXG7tIxvLSFEs';
const OKR_SPREADSHEET_ID = '1OYYQXdYWIex7sIGM4rIBVMAmaR1tndtaq85utYqL-5o';
const COMERCIAL_SPREADSHEET_ID = process.env.COMERCIAL_SPREADSHEET_ID || '';
const COMERCIAL_XLSX_PATH = process.env.COMERCIAL_XLSX_PATH ||
  path.join(__dirname, 'base_estatica', 'Controle_Comercial_Kaptha_Lead.xlsx');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

let dreCache      = { data: null, ts: 0 };
let clientesCache = { data: null, ts: 0 };
let metasCache    = { data: null, ts: 0 };
let okrCache      = { data: null, ts: 0 };
let biCache       = { data: null, ts: 0 };
let comercialCache = { data: null, ts: 0 };

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

function normalizeKey(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').trim();
}

function parseFunnelCell(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    if (isNaN(val)) return null;
    if (Math.abs(val) <= 2) return Math.round(val * 1000) / 10;
    return Math.round(val * 10) / 10;
  }
  return parseFunnelValue(val);
}

function parseFunnelValue(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s || s === '-' || s === '–' || s === '—') return null;
  const negative = s.startsWith('-');
  const cleaned = s
    .replace(/R\$\s*/g, '')
    .replace(/%/g, '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  if (isNaN(val)) return null;
  const n = negative ? -Math.abs(val) : val;
  // Valores 0–1.99 sem % explícito → fração (ex: 0.22 → 22%)
  if (!s.includes('%') && Math.abs(n) <= 2) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
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

  // ── LTV (todos os clientes: ativos até curMi + inativos até churn) ──────────
  // Responde: "quanto um cliente deixa em R$ e por quanto tempo fica conosco"
  const ltvAllList = clients.map(c => {
    const vals = ALL_M.map((_, mi) => getVal(c, mi));
    const first = vals.findIndex(v => v > 0);
    if (first < 0) return null;

    const isActiveNow = vals[curMi] > 0;
    let last;
    if (isActiveNow) {
      last = curMi; // ativo: conta do primeiro mês até o mês atual
    } else {
      last = first;
      for (let mi = first + 1; mi <= curMi; mi++) {
        if (vals[mi] > 0) last = mi;
      }
    }

    const months  = last - first + 1;
    const revenue = vals.slice(first, last + 1).reduce((s, v) => s + v, 0);
    return { name: c.name, plan: c.plan, months, revenue, churned: !isActiveNow };
  }).filter(Boolean);

  const ltvMeses = ltvAllList.length > 0
    ? ltvAllList.reduce((s, l) => s + l.months, 0) / ltvAllList.length
    : null;
  const ltvReais = ltvAllList.length > 0
    ? ltvAllList.reduce((s, l) => s + l.revenue, 0) / ltvAllList.length
    : null;

  // LTV da lista somente churned (para churn rate e por plano)
  const ltvList = ltvAllList.filter(l => l.churned);

  // Churn rate mensal global: (nChurned / nTotal) / meses_decorridos × 100
  const nMesesDecorridos = curMi + 1;
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
      nTotal:   ltvAllList.length,
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

  const EMPTY = { metadata: { lastUpdated: new Date().toISOString(), currentMonthLabel: '', months: [] }, items: [], hasData: false };

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'METAS KAPTHA.AI'!A1:ZZ300",
    });
  } catch { return EMPTY; }

  const rows = res.data.values || [];
  if (!rows.length) return EMPTY;

  const nrm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const YEAR_RE = /20\d\d/;

  // ── Encontra TODOS os blocos de mês (uma coluna REALIZADO por mês) ─────────
  // Estrutura por mês: 7 colunas
  //   +0 → REALIZADO  |  +1 → META1 ALVO  |  +2 → META1 PCT (ignorado)
  //   +3 → META2 ALVO |  +4 → META2 PCT   |  +5 → META3 ALVO | +6 → META3 PCT
  const headerRow0 = rows[0] || [];
  const monthBlocks = []; // { label: "MAIO/2026", realCol: N }

  for (let ci = 0; ci < headerRow0.length; ci++) {
    const v = String(headerRow0[ci] || '').trim();
    if (!v) continue;
    const nu = nrm(v);
    if (!nu.includes('REALIZADO')) continue;
    if (!YEAR_RE.test(v)) continue;
    const label = v.replace(/REALIZADO\s*(META)?\s*/i, '').trim();
    if (label) monthBlocks.push({ label, realCol: ci });
  }
  monthBlocks.sort((a, b) => a.realCol - b.realCol);

  // ── Mês atual (para highlight padrão) ─────────────────────────────────────
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  const PT_SHORT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const PT_FULL  = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const mShort = PT_SHORT[cm - 1];
  const mFull  = PT_FULL[cm - 1];

  const matchMonthLabel = label => {
    const n = nrm(label);
    return (n.includes(mShort) || n.includes(mFull)) &&
           (n.includes(String(cy)) || n.includes(String(cy).slice(2)));
  };

  const currentMonthLabel =
    monthBlocks.find(mb => matchMonthLabel(mb.label))?.label ||
    monthBlocks[monthBlocks.length - 1]?.label ||
    `${mFull.charAt(0)}${mFull.slice(1).toLowerCase()}/${cy}`;

  // Fallback se não encontrou nenhum bloco
  if (monthBlocks.length === 0) monthBlocks.push({ label: currentMonthLabel, realCol: 2 });

  // ── Projetos (linha 3+, índice 2+) ────────────────────────────────────────
  const DATA_START = 2;
  const SKIP_DATA  = ['TOTAL','SUBTOTAL','MEDIA','MÉDIA','SOMA','RESUMO','CONTROLE','PROJETO','OBJETIVO'];
  const items = [];

  for (let ri = DATA_START; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    if (name.length < 2) continue;
    if (SKIP_DATA.some(k => nrm(name).startsWith(k))) continue;

    const objective = String(row[1] || '').trim();

    // Constrói monthData para todos os meses detectados
    const monthData = {};
    for (const mb of monthBlocks) {
      const realizado = parseValue(String(row[mb.realCol]     || ''));
      const alvo1     = parseValue(String(row[mb.realCol + 1] || ''));
      const alvo2     = parseValue(String(row[mb.realCol + 3] || ''));
      const alvo3     = parseValue(String(row[mb.realCol + 5] || ''));

      const calcPct = alvo => alvo > 0
        ? Math.min(100, Math.round(realizado / alvo * 1000) / 10)
        : null;

      monthData[mb.label] = {
        realizado,
        metas: [
          { alvo: alvo1, progresso: calcPct(alvo1) },
          { alvo: alvo2, progresso: calcPct(alvo2) },
          { alvo: alvo3, progresso: calcPct(alvo3) },
        ],
      };
    }

    // Exibe sempre — mesmo linhas zeradas (solicitado pelo usuário)
    items.push({ name, objective, monthData });
  }

  return {
    metadata: {
      lastUpdated: new Date().toISOString(),
      currentMonthLabel,
      months: monthBlocks.map(mb => mb.label),
    },
    items,
    hasData: items.length > 0,
  };
}

// ─── BI 2026 ─────────────────────────────────────────────────────────────────

async function fetchBI() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const EMPTY = { metadata: { lastUpdated: new Date().toISOString() }, hasData: false };

  let rows;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'BI 2026'!A1:D20",
    });
    rows = res.data.values || [];
  } catch (e) {
    console.error('[BI]', e.message);
    return EMPTY;
  }

  // Normaliza "03/2026" ou "3/31/2026" → "Mar/26"
  const normMonth = s => {
    const pts = String(s).split('/');
    const m = parseInt(pts[0]);
    const y = pts[pts.length - 1].slice(-2);
    const ns = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return (ns[m - 1] || s) + '/' + y;
  };

  const parsePct = s => {
    if (!s) return null;
    const n = parseFloat(String(s).replace('%','').replace(',','.').trim());
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  };

  const parseNum = s => {
    if (!s) return null;
    const n = parseFloat(String(s).replace(',','.').trim());
    return isNaN(n) ? null : n;
  };

  const avg3 = arr => {
    const valid = arr.filter(v => v !== null && !isNaN(v));
    const last3 = valid.slice(-3);
    if (!last3.length) return null;
    return Math.round(last3.reduce((a, b) => a + b, 0) / last3.length * 100) / 100;
  };

  // ── Seção 1: Financeiros (R1:R6) ─────────────────────────────────────────
  const labels = ((rows[0] || []).slice(1).filter(Boolean)).map(normMonth);

  const financials = [];
  for (let ri = 1; ri <= 5; ri++) {
    const row = rows[ri];
    if (!row || !row[0]) continue;
    financials.push({
      name:   row[0],
      values: row.slice(1, labels.length + 1).map(v => parseValue(v)),
    });
  }

  // ── Seção 2: Taxas (R9:R12) ──────────────────────────────────────────────
  const churn      = (rows[9]  || []).slice(1, labels.length + 1).map(v => parsePct(v));
  const titulosVenc= (rows[10] || []).slice(1, labels.length + 1).map(v => parsePct(v));
  const liquidez   = (rows[11] || []).slice(1, labels.length + 1).map(v => parseNum(v));

  // ── Seção 3: Contratos (R16:R18) ─────────────────────────────────────────
  const ativos    = (rows[16] || []).slice(1, labels.length + 1).map(v => parseNum(v));
  const cancelados= (rows[17] || []).slice(1, labels.length + 1).map(v => parseNum(v));

  // Vendas = Δativos + cancelados  (requer mês anterior)
  const vendas = ativos.map((a, i) => {
    if (i === 0 || ativos[i - 1] === null) return null;
    return a - ativos[i - 1] + (cancelados[i] || 0);
  });

  return {
    metadata:   { lastUpdated: new Date().toISOString() },
    labels,
    financials,
    ratios: {
      churn, titulosVenc, liquidez,
      avgChurn:    avg3(churn),
      avgTitulos:  avg3(titulosVenc),
      avgLiquidez: avg3(liquidez),
    },
    contratos: { ativos, cancelados, vendas },
    hasData: financials.length > 0,
  };
}

// ─── OKR Tracker ─────────────────────────────────────────────────────────────

async function fetchOKR() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const EMPTY = { metadata: { lastUpdated: new Date().toISOString() }, objectives: [], hasData: false };

  // Get actual tab names from spreadsheet metadata
  let tabs;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: OKR_SPREADSHEET_ID });
    tabs = meta.data.sheets.map(s => s.properties.title);
  } catch (e) {
    console.error('[OKR meta]', e.message);
    return EMPTY;
  }
  if (!tabs || !tabs.length) return EMPTY;

  // ── 1. Dashboard tab (tabs[0]): objectives + overall progress ─────────────
  let dashRows = [];
  try {
    const dashRes = await sheets.spreadsheets.values.get({
      spreadsheetId: OKR_SPREADSHEET_ID,
      range: `'${tabs[0]}'!A1:Z30`,
    });
    dashRows = dashRes.data.values || [];
  } catch (e) {
    console.error('[OKR dash]', e.message);
  }

  // Objectives appear in rows 10-15 (0-indexed 9-14): col[1]=name, col[2]=progress%
  const dashObjectives = [];
  for (let ri = 9; ri <= 15; ri++) {
    const row = dashRows[ri];
    if (!row) continue;
    const name = String(row[1] || '').trim();
    if (!name || name.length < 3) continue;
    dashObjectives.push({ name, progress: parseProgresso(String(row[2] || '')) });
  }

  // ── 2. OBJ tabs (tabs[1..N]): parse KRs ───────────────────────────────────
  const objectives = [];

  for (let ti = 1; ti < tabs.length; ti++) {
    const tabName = tabs[ti];
    const dashObj = dashObjectives[ti - 1] || null;

    // Human-readable display name
    const displayName = dashObj?.name ||
      tabName.replace(/^OBJ\s+\d+\s*[–—-]\s*/u, '').replace(/^🔧\s*/u, '').trim();

    let tabRows = [];
    try {
      const tabRes = await sheets.spreadsheets.values.get({
        spreadsheetId: OKR_SPREADSHEET_ID,
        range: `'${tabName}'!A1:H120`,
      });
      tabRows = tabRes.data.values || [];
    } catch (e) {
      console.error(`[OKR ${tabName}]`, e.message);
    }

    // ── Parse KRs: each starts with a row where col[1] contains 📌 ──────────
    const krs = [];
    for (let ri = 0; ri < tabRows.length; ri++) {
      const row = tabRows[ri];
      if (!row) continue;
      const col1 = String(row[1] || '').trim();
      if (!col1.includes('📌')) continue;

      const krName = col1.replace(/📌\s*/gu, '').trim();
      if (!krName) continue;

      let alvo = null, atual = null, progresso = null, acaoPct = null;

      // Data row at ri+2: col[3]=alvo, col[4]=atual, col[5]=progress%
      const dataRow = tabRows[ri + 2];
      if (dataRow) {
        const dc1 = String(dataRow[1] || '').trim().toUpperCase();
        const c3  = String(dataRow[3] || '').trim();
        const c4  = String(dataRow[4] || '').trim();
        const c5  = String(dataRow[5] || '').trim();
        // Only use if it's not a RESP/action/header row
        if (!dc1.includes('RESP') && !dc1.includes('PROGRESSO') &&
            c3 !== 'Alvo' && c3 !== 'ALVO' && c3 !== '#') {
          if (c3 || c4 || c5) {
            alvo      = c3 || null;
            atual     = c4 || null;
            progresso = parseProgresso(c5);
          }
        }
      }

      // Scan ri+1 to ri+8 for action-progress and responsável rows
      let responsavel = null;
      for (let si = ri + 1; si < Math.min(ri + 9, tabRows.length); si++) {
        const sr = tabRows[si];
        if (!sr) continue;
        // Stop at the next KR block
        if (si > ri + 1 && String(sr[1] || '').includes('📌')) break;

        const sc1raw = String(sr[1] || '').trim();
        const sc1    = sc1raw.toLowerCase();

        // Action progress row
        if (sc1.includes('progresso das a')) {
          const c3 = String(sr[3] || '').trim();
          const c4 = String(sr[4] || '').trim();
          let p = parseProgresso(c3);
          if (p === null) {
            p = parseProgresso(c4.replace(/[░█▒▓\s]/g, ''));
          }
          acaoPct = p;
          break;
        }

        // Responsável row: starts with 👤 or contains RESP
        if (!responsavel && (sc1raw.includes('👤') || sc1.includes('resp'))) {
          let name = sc1raw.replace(/^👤\s*/u, '').replace(/^RESP\s*/iu, '').trim();
          if (!name) name = String(sr[2] || '').trim();
          if (name) responsavel = name;
        }
      }

      krs.push({ name: krName, alvo, atual, progresso, acaoPct, responsavel });
    }

    objectives.push({
      name:     displayName,
      progress: dashObj?.progress ?? null,
      krs,
    });
  }

  return {
    metadata:   { lastUpdated: new Date().toISOString() },
    objectives,
    hasData:    objectives.length > 0,
  };
}

// ─── Comercial · Funis por Cliente ────────────────────────────────────────────

function normalizeEtapa(s) {
  return normalizeKey(s).replace(/[^A-Z0-9→]/g, '');
}

function cleanStageLabel(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s*→\s*/g, ' → ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseComercialRows(rows) {
  const EMPTY = {
    metadata: { lastUpdated: new Date().toISOString() },
    clients: [],
    hasData: false,
  };
  if (!rows || rows.length < 2) return EMPTY;

  const byClient = {};
  const clientOrder = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row) continue;
    const clientRaw = String(row[0] || '').trim();
    const etapaRaw  = cleanStageLabel(row[1] || '');
    if (!clientRaw || !etapaRaw) continue;

    const clientKey = normalizeKey(clientRaw);
    if (!byClient[clientKey]) {
      byClient[clientKey] = {
        id: clientKey,
        name: clientRaw,
        stagesMap: {},
        stages: [],
      };
      clientOrder.push(clientKey);
    }

    const stageKey = normalizeEtapa(etapaRaw);
    const value = parseFunnelCell(row[2]);

    if (byClient[clientKey].stagesMap[stageKey] !== undefined) {
      const idx = byClient[clientKey].stagesMap[stageKey];
      byClient[clientKey].stages[idx].value = value;
    } else {
      byClient[clientKey].stagesMap[stageKey] = byClient[clientKey].stages.length;
      byClient[clientKey].stages.push({
        label: etapaRaw,
        value,
      });
    }
  }

  const clients = clientOrder.map(clientKey => {
    const cfg = byClient[clientKey];
    const stages = cfg.stages;
    const withData = stages.filter(s => s.value !== null);
    const overall = withData.length
      ? Math.round(withData.reduce((sum, s) => sum + s.value, 0) / withData.length * 10) / 10
      : null;

    return {
      id: cfg.id,
      name: cfg.name,
      stages,
      overall,
    };
  });

  return {
    metadata: { lastUpdated: new Date().toISOString() },
    clients,
    hasData: clients.some(c => c.stages.some(s => s.value !== null)),
  };
}

function readComercialDatasetFromWorkbook(wb) {
  const ws = wb.Sheets['DATASET'];
  if (!ws) return parseComercialRows([]);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return parseComercialRows(rows);
}

async function fetchComercialFromXlsx() {
  if (!fs.existsSync(COMERCIAL_XLSX_PATH)) {
    return { metadata: { lastUpdated: new Date().toISOString() }, clients: [], hasData: false };
  }
  const wb = XLSX.readFile(COMERCIAL_XLSX_PATH);
  return readComercialDatasetFromWorkbook(wb);
}

async function fetchComercialFromSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: COMERCIAL_SPREADSHEET_ID,
    range: 'DATASET!A1:C50',
  });
  return parseComercialRows(res.data.values || []);
}

async function fetchComercial() {
  try {
    if (fs.existsSync(COMERCIAL_XLSX_PATH)) {
      const xlsxData = await fetchComercialFromXlsx();
      if (xlsxData.clients.length) return xlsxData;
    }
  } catch (e) {
    console.error('[Comercial XLSX]', e.message);
  }

  if (COMERCIAL_SPREADSHEET_ID) {
    try {
      return await fetchComercialFromSheets();
    } catch (e) {
      console.error('[Comercial Sheets]', e.message);
    }
  }

  return { metadata: { lastUpdated: new Date().toISOString() }, clients: [], hasData: false };
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

app.get('/api/bi', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && biCache.data && now - biCache.ts < CACHE_TTL) return res.json(biCache.data);
  try {
    biCache.data = await fetchBI();
    biCache.ts = now;
    res.json(biCache.data);
  } catch (err) {
    console.error('[BI]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/okr', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && okrCache.data && now - okrCache.ts < CACHE_TTL) return res.json(okrCache.data);
  try {
    okrCache.data = await fetchOKR();
    okrCache.ts = now;
    res.json(okrCache.data);
  } catch (err) {
    console.error('[OKR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comercial', async (req, res) => {
  const now = Date.now();
  const force = req.query.force === '1';
  if (!force && comercialCache.data && now - comercialCache.ts < CACHE_TTL) return res.json(comercialCache.data);
  try {
    comercialCache.data = await fetchComercial();
    comercialCache.ts = now;
    res.json(comercialCache.data);
  } catch (err) {
    console.error('[Comercial]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`✓ Kaptha Dashboard → http://localhost:${PORT}`);
  console.log(`  Cache: ${CACHE_TTL / 60000} min | Planilha: ${SPREADSHEET_ID}`);
});
