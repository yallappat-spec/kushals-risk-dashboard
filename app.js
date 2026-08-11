/* =============================================
   KUSHALS STORE RISK DASHBOARD — app.js
   All dashboard logic: risk scoring, CSV
   parsing, filters, charts, table rendering
   ============================================= */

/* ---- State ---- */
let activeStores  = [];
let issuesData    = [];
let shrinkageData = [];
let shortageData  = [];
let auditData     = [];
let enrollData    = [];
let enrollMonths  = [];
let opsScData     = [];
let opsScMonths   = [];
let excelData     = [];
let excelMonths   = [];
let excelIssuesData = [];
let excelAuditData = [];
let shortageHeaders = [];
let shortageColIdx  = { iItemName: -1, iStkVal: -1, iAdjQty: -1 };
let bChart = null;
let pChart = null;
let rmChart = null;
let clauseChart = null;
let excelCmChart = null;
let excelRmChart = null;
let cardFilter    = null; // 'high' | 'medium' | 'low' | 'shrinkage' | 'fraud' | 'ops' | null

/* Default Google Sheet — always loaded on page open */
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1T7BMVcRLxLOL6HA4FiJMHPHJch6d05xeWzWTx_XqDIw/edit?usp=sharing';

/* ============================================================
   RISK SCORING
   Rules defined by Yallappa Tenkappanavar — Loss Prevention
   
   Shrinkage > 0.075%     → +40 pts
   Ops score 80–89%       → +20 pts
   Ops score < 80%        → +40 pts
   Ops score >= 90%       → +0  pts
   Fraud occurred         → +20 pts
   
   Total >= 50  → High
   Total >= 20  → Medium
   Total <  20  → Low
   ============================================================ */
function calcRisk(s) {
  if (s.pending || s.opsScore === null) {
    return { ...s, shrinkPts: 0, opsPts: 0, fraudPts: 0, total: null, level: 'Pending' };
  }
  const shrinkPts = s.shrinkage < -0.075 ? 40 : 0;
  const opsPts    = s.opsScore >= 90 ? 0 : s.opsScore >= 80 ? 20 : 40;
  const fraudPts  = s.fraud ? 20 : 0;
  const total     = shrinkPts + opsPts + fraudPts;
  const level     = total >= 50 ? 'High' : total >= 20 ? 'Medium' : 'Low';
  return { ...s, shrinkPts, opsPts, fraudPts, total, level };
}

/* ============================================================
   CSV FILE UPLOAD
   ============================================================ */
function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showStatus('Please upload a .csv file only.', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const rows = parseCSV(e.target.result);
      activeStores = rows.map(calcRisk);
      rebuildRegionFilter();
      applyFilters();
      showStatus('&#10003; ' + rows.length + ' stores loaded from ' + file.name, 'ok');
      document.getElementById('clearBtn').style.display = 'inline-block';
    } catch (err) {
      showStatus('&#10007; ' + err.message, 'err');
    }
  };
  reader.readAsText(file);
}

/* Maps 3-letter store code prefix to city name */
function storeCodeToRegion(storeName) {
  const code = storeName.split(/\s*-\s*/)[0].trim().toUpperCase();
  const map = {
    'AHM': 'Ahmedabad',    'ATP': 'Anantapur',     'BGM': 'Belgaum',
    'BIM': 'Bijapur',      'BLR': 'Bangalore',     'BPL': 'Bhopal',
    'CBT': 'Coimbatore',   'CDR': 'Chandigarh',    'CHN': 'Chennai',
    'DEL': 'Delhi',        'ERD': 'Erode',          'GTR': 'Guntur',
    'GUR': 'Gurugram',     'GWT': 'Guwahati',       'HBL': 'Hubli',
    'HOS': 'Hosur',        'HSP': 'Hospet',         'HYD': 'Hyderabad',
    'IDR': 'Indore',       'KCH': 'Kochi',          'KHM': 'Khammam',
    'KKN': 'Kurnool',      'KPR': 'Kolhapur',       'KRL': 'Karimnagar',
    'KRM': 'Karimnagar',   'LUK': 'Lucknow',        'MDR': 'Madurai',
    'MGL': 'Mangalore',    'MUM': 'Mumbai',          'MYS': 'Mysore',
    'NLR': 'Nellore',      'NZM': 'Nizamabad',       'ONG': 'Ongole',
    'PDC': 'Pondicherry',  'PUN': 'Pune',            'RJM': 'Rajahmundry',
    'SLM': 'Salem',        'TIR': 'Tirupur',         'TPL': 'Tiruppur',
    'TRP': 'Tirupati',     'TRV': 'Trivandrum',      'UDP': 'Udupi',
    'VIG': 'Visakhapatnam','VJN': 'Vijayawada',      'VJW': 'Vijayawada',
    'WRL': 'Warangal',
  };
  return map[code] || code;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('File needs a header row and at least one data row.');

  const hdrs = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s%]/g, ''));

  function col(names) {
    for (const n of names) {
      const i = hdrs.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  }

  const iStore  = col(['store', 'storename', 'outlets', 'outlet', 'outletname', 'outletnames']);
  const iRegion = col(['region']);
  const iCM     = col(['cmname', 'cm', 'clustermanager', 'cmname']);
  const iRM     = col(['rmname', 'rm', 'regionalmanager', 'rmname']);
  const iMonth  = col(['month', 'monthname']);
  const iMarket = col(['market', 'marketname', 'markettype']);
  /* Accept "Shrinakge" typo from real sheet alongside correct spelling */
  const iShrink = col(['shrinkage', 'shrinkage%', 'shrinkagepct', 'shrinakge', 'shrinakge%']);
  const iOps    = col(['opsscore', 'opscore', 'operationsscore', 'operationscore', 'operationscorecard', 'opsscore%']);
  /* Accept "Fraud Red flags" column from real sheet */
  const iFraud  = col(['fraud', 'fraudredflags', 'fraudredflag', 'fraudredflag(s)']);

  const missing = [
    ['Store / Outlets', iStore],
    ['Shrinkage / Shrinakge', iShrink],
  ].filter(([, v]) => v === -1).map(([k]) => k);

  if (missing.length) {
    throw new Error('Column(s) not found: ' + missing.join(', ') + '. Please check header names match the template.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map(x => x.trim());
    if (c.length < 2) continue;

    const storeName = c[iStore] || 'Store ' + i;
    const region    = (iRegion !== -1 && c[iRegion] && c[iRegion] !== '-')
      ? c[iRegion] : storeCodeToRegion(storeName);
    const cm    = iCM    !== -1 ? (c[iCM]    || '-') : '-';
    const rm    = iRM    !== -1 ? (c[iRM]    || '-') : '-';
    const month  = iMonth  !== -1 ? (c[iMonth]  || '-') : '-';
    const market = iMarket !== -1 ? (c[iMarket] || '-') : '-';

    const shRaw = (c[iShrink] || '').replace(/\s/g, '');
    /* OpsScore column may not exist in data sheet — sourced from issues sheet instead */
    const opRaw = iOps !== -1 ? (c[iOps] || '').replace(/\s/g, '') : '';

    const fraudRaw = (iFraud !== -1 ? c[iFraud] || '' : '').trim().toLowerCase();
    const fraud = fraudRaw !== '' && fraudRaw !== '-' && fraudRaw !== 'no' && fraudRaw !== 'false' && fraudRaw !== '0';

    /* Treat missing shrinkage as 0 (no shrinkage risk) */
    const shNum = (!shRaw || shRaw === '-') ? 0 : parseFloat(shRaw.replace('%', ''));
    if (!shRaw || shRaw !== '-') {
      if (isNaN(shNum) && shRaw && shRaw !== '-') continue;
    }

    const shrinkage = (!shRaw || shRaw === '-') ? 0 :
      shRaw.includes('%') ? shNum : (Math.abs(shNum) < 0.01 ? shNum * 100 : shNum);

    /* If OpsScore present in data sheet use it; otherwise mark pending (will be filled from issues sheet) */
    if (!opRaw || opRaw === '-') {
      rows.push({ store: storeName, region, cm, rm, month, market, shrinkage, opsScore: null, fraud, pending: true });
      continue;
    }
    const opNum = parseFloat(opRaw.replace('%', ''));
    if (isNaN(opNum)) {
      rows.push({ store: storeName, region, cm, rm, month, market, shrinkage, opsScore: null, fraud, pending: true });
      continue;
    }
    const opsScore = opRaw.includes('%') ? opNum : (opNum <= 1 ? opNum * 100 : opNum);

    rows.push({ store: storeName, region, cm, rm, month, market, shrinkage, opsScore, fraud, pending: false });
  }

  if (!rows.length) {
    throw new Error('No valid data rows found. Check Shrinkage column contains numbers.');
  }
  return rows;
}

/* ============================================================
   OPS SCORE ENRICHMENT
   After issuesData is loaded, derive each store's latest
   monthly ops score and re-score risk.
   ============================================================ */
function parsePeriodToNum(p) {
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const lower = (p || '').toLowerCase().trim();
  for (let m = 0; m < months.length; m++) {
    if (lower.startsWith(months[m])) {
      const y = lower.match(/(\d{4})/);
      /* With year: "May 2025" → 202504; without year: "May" → 4 */
      return y ? parseInt(y[1]) * 100 + m : m;
    }
  }
  const ym = lower.match(/(\d{4})[- ](\d{1,2})/);
  if (ym) return parseInt(ym[1]) * 100 + parseInt(ym[2]);
  return 0;
}

function enrichStoresWithOpsScores(selectedPeriod) {
  if (!issuesData.length) return;
  selectedPeriod = selectedPeriod || 'latest';

  /* Build map: storeName → best matching { score, period } */
  const scoreMap = {};
  issuesData.forEach(r => {
    const scoreRaw = (r.score || '').toString().replace('%', '').trim();
    const scoreNum = parseFloat(scoreRaw);
    if (isNaN(scoreNum)) return;
    const score = scoreNum <= 1 ? scoreNum * 100 : scoreNum;
    const periodNum = parsePeriodToNum(r.period);

    if (selectedPeriod === 'latest') {
      const existing = scoreMap[r.store];
      if (!existing || periodNum > existing.periodNum) {
        scoreMap[r.store] = { score, period: r.period, periodNum };
      }
    } else {
      /* tolerant period match (case/space/year insensitive) */
      if (periodsMatch(r.period, selectedPeriod)) {
        scoreMap[r.store] = { score, period: r.period, periodNum };
      }
    }
  });

  activeStores = activeStores.map(s => {
    const match = scoreMap[s.store];
    if (!match) return { ...s, opsScore: null, opsMonth: null, pending: true };
    return { ...s, opsScore: match.score, opsMonth: match.period, pending: false };
  });

  activeStores = activeStores.map(calcRisk);
  applyFilters();
}

function applyOpsPeriodFilter() {
  const sel = document.getElementById('opsPeriodFilter');
  enrichStoresWithOpsScores(sel ? sel.value : 'latest');
}

function showStatus(msg, type) {
  const el = document.getElementById('uploadStatus');
  el.innerHTML = msg;
  el.className = 'upload-status ' + type;
}

function clearData() {
  stopAutoRefresh();
  setDsStatus('Sample data', false);
  activeStores = SAMPLE.map(calcRisk);
  document.getElementById('csvInput').value = '';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('sheetClearBtn').style.display = 'none';
  localStorage.removeItem('sheetUrl');
  history.replaceState(null, '', location.pathname);
  document.getElementById('uploadStatus').className = 'upload-status';
  document.getElementById('sheetStatus').className = 'upload-status';
  document.getElementById('sheetUrl').value = '';
  rebuildFilters();
  applyFilters();
  issuesData = [];
  renderIssuesTable([]);
  document.getElementById('issuesCount').textContent = '';
  document.getElementById('issuesStatus').className = 'upload-status';
  shrinkageData = [];
  renderShrinkageTable([]);
  document.getElementById('shrinkageCount').textContent = '';
  document.getElementById('shrinkageStatus').className = 'upload-status';
  auditData = [];
  renderAuditTable([]);
  document.getElementById('auditCount').textContent = '';
  document.getElementById('auditStatus').className = 'upload-status';
  enrollData = [];
  enrollMonths = [];
  renderEnrollTable([]);
  document.getElementById('enrollCount').textContent = '';
  document.getElementById('enrollStatus').className = 'upload-status';
  opsScData = [];
  opsScMonths = [];
  renderOpsScTable([]);
  document.getElementById('opsScCount').textContent = '';
  document.getElementById('opsScStatus').className = 'upload-status';
}

/* ============================================================
   DATA PANEL TOGGLE & STATUS BAR
   ============================================================ */
function toggleDataPanel() {
  const panel = document.getElementById('uploadPanel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function setDsStatus(text, connected) {
  document.getElementById('dsStatusText').textContent = text;
  const dot = document.getElementById('dsStatusDot');
  dot.className = 'ds-dot ' + (connected ? 'ds-dot-green' : 'ds-dot-grey');
}

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function switchTab(tab) {
  document.getElementById('paneCsv').style.display   = tab === 'csv'   ? '' : 'none';
  document.getElementById('paneSheet').style.display = tab === 'sheet' ? '' : 'none';
  document.getElementById('tabCsv').classList.toggle('active',   tab === 'csv');
  document.getElementById('tabSheet').classList.toggle('active', tab === 'sheet');
}

/* ============================================================
   GOOGLE SHEET LOADER
   ============================================================ */
function toCSVExportUrl(input) {
  input = input.trim();

  /* Already a published CSV URL */
  if (input.includes('/pub?') && input.includes('output=csv')) return input;
  if (input.includes('/pub?') && input.includes('output=csv')) return input;

  /* Published to web: /pub without output param */
  if (input.includes('/pub?')) {
    return input.includes('?') ? input + '&output=csv' : input + '?output=csv';
  }

  /* Regular sheet URL — extract sheet ID and optional gid */
  const idMatch  = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = input.match(/[#&?]gid=(\d+)/);
  if (!idMatch) return null;

  let url = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
  if (gidMatch) url += `&gid=${gidMatch[1]}`;
  return url;
}

function showSheetStatus(msg, type) {
  const el = document.getElementById('sheetStatus');
  el.innerHTML = msg;
  el.className = 'upload-status ' + type;
}

async function loadFromGoogleSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showSheetStatus('Please paste your Google Sheet link first.', 'err');
    return;
  }

  const csvUrl = toCSVExportUrl(raw);
  if (!csvUrl) {
    showSheetStatus('&#10007; That doesn\'t look like a valid Google Sheet URL. Please check and try again.', 'err');
    return;
  }

  const btn = document.getElementById('loadSheetBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  showSheetStatus('Fetching data from Google Sheet…', '');

  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status + '. Make sure the sheet is shared as "Anyone with the link can view".');
    const text = await res.text();
    const rows = parseCSV(text);
    activeStores = rows.map(calcRisk);
    rebuildRegionFilter();
    applyFilters();
    localStorage.setItem('sheetUrl', raw);
    history.replaceState(null, '', '?sheet=' + encodeURIComponent(raw));
    showSheetStatus('&#10003; ' + rows.length + ' stores loaded from Google Sheet', 'ok');
    document.getElementById('sheetClearBtn').style.display = 'inline-block';
    setDsStatus('Google Sheet · ' + rows.length + ' stores', true);
    document.getElementById('uploadPanel').style.display = 'none';
    startAutoRefresh();
    loadIssuesSheet();
    loadShrinkageSheet();
    loadShortageSheet();
    loadAuditSheet();
    loadEnrollSheet();
    loadOpsScSheet();
    loadExcelSheet();
  } catch (err) {
    showSheetStatus('&#10007; ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Load Data';
  }
}

/* ============================================================
   EXPORT CSV — exports current filtered data
   ============================================================ */
function exportCSV() {
  const data = getFiltered();
  if (!data.length) return;

  const headers = ['Store Name','Region','CM Name','RM Name','Month','Shrinkage %','Operation Scorecard','Fraud Red Flags','Risk Level','Risk Score'];
  const rows = data.map(s => [
    s.store,
    s.region,
    s.cm    || '-',
    s.rm    || '-',
    s.month || '-',
    s.pending ? '-' : s.shrinkage.toFixed(3) + '%',
    s.pending ? '-' : s.opsScore + '%',
    s.fraud ? 'Yes' : 'No',
    s.level,
    s.pending ? '-' : s.total + '%',
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));

  const csv  = [headers.join(','), ...rows].join('\n');
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_risk_' + date + '.csv';
  a.click();
}

/* ============================================================
   TEMPLATE DOWNLOAD
   ============================================================ */
function downloadTemplate() {
  const csv = [
    'Store,Region,CM Name,RM Name,Shrinkage,Fraud',
    'BLR - KORAMANGALA,Bangalore,Ambarish,Sathish Kumar,-0.082%,No',
    'HYD - BANJARA HILLS,Hyderabad,Chandu,Venkat,-0.091%,Yes',
    'CHN - ANNA NAGAR,Chennai,Ravindar,Raghavendra,-0.045%,No',
    'MUM - ANDHERI,Mumbai,Azra,Manirathnam,-0.031%,No',
    'BLR - INDIRANAGAR,Bangalore,Ambarish,Sathish Kumar,-0.078%,Yes',
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_risk_template.csv';
  a.click();
}

/* ============================================================
   DRAG & DROP
   ============================================================ */
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

/* ============================================================
   FILTERS — rebuild all dropdowns from loaded data
   ============================================================ */
function rebuildFilters() {
  function rebuild(id, values, allLabel) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="all">${allLabel}</option>` +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('regionFilter', [...new Set(activeStores.map(s => s.region))].sort(), 'All');
  rebuild('outletFilter', [...new Set(activeStores.map(s => s.store))].sort(), 'All');
  rebuildOpsPeriodFilter(); /* pick up months from the main sheet's Month column too */
  rebuild('marketFilter', [...new Set(activeStores.map(s => s.market).filter(v => v && v !== '-'))].sort(), 'All');
  rebuild('cmFilter',     [...new Set(activeStores.map(s => s.cm).filter(v => v && v !== '-'))].sort(), 'All');
  rebuild('rmFilter',     [...new Set(activeStores.map(s => s.rm).filter(v => v && v !== '-'))].sort(), 'All');
}

function rebuildOpsPeriodFilter() {
  const sel = document.getElementById('opsPeriodFilter');
  if (!sel) return;
  const cur = sel.value;
  /* Union of Period values from the issues sheet and Month values from the
     main data sheet, deduped case-insensitively so "april" / "April " merge */
  const seen = {};
  function add(raw) {
    const p = (raw || '').toString().trim();
    if (!p || p === '-') return;
    const key = p.toLowerCase();
    if (!seen[key]) seen[key] = p;
  }
  issuesData.forEach(r => add(r.period));
  activeStores.forEach(s => add(s.month));
  /* Drop year-less variants when a dated one for the same month exists,
     so "May" and "May 2026" don't appear as two options */
  let periods = Object.values(seen);
  periods = periods.filter(p =>
    /\d{4}/.test(p) || !periods.some(q => q !== p && /\d{4}/.test(q) && periodsMatch(p, q))
  );
  periods.sort((a, b) => parsePeriodToNum(b) - parsePeriodToNum(a)); /* newest first */
  sel.innerHTML = '<option value="latest">Latest</option>' +
    periods.map(v => `<option value="${v}">${v}</option>`).join('');
  if (periods.includes(cur)) sel.value = cur;
}

/* Tolerant period comparison: trims, ignores case, and treats
   "May" and "May 2026" as the same month when one side has no year */
function periodsMatch(a, b) {
  const pa = (a || '').toString().trim().toLowerCase();
  const pb = (b || '').toString().trim().toLowerCase();
  if (!pa || !pb) return false;
  if (pa === pb) return true;
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const ma = months.findIndex(m => pa.startsWith(m));
  const mb = months.findIndex(m => pb.startsWith(m));
  if (ma === -1 || mb === -1 || ma !== mb) return false;
  const ya = (pa.match(/(\d{4})/) || [])[1];
  const yb = (pb.match(/(\d{4})/) || [])[1];
  return !ya || !yb || ya === yb; /* same month; years must agree when both given */
}

/* Keep old name as alias so existing calls still work */
function rebuildRegionFilter() { rebuildFilters(); }

/* ============================================================
   FILTERS & SORTING
   ============================================================ */
function getFiltered() {
  const reg    = document.getElementById('regionFilter').value;
  const outlet = document.getElementById('outletFilter').value;
  const market = document.getElementById('marketFilter').value;
  const cm   = document.getElementById('cmFilter').value;
  const rm   = document.getElementById('rmFilter').value;
  const risk = document.getElementById('riskFilter').value;
  const sort = document.getElementById('sortFilter').value;

  let data = activeStores.filter(s =>
    (reg    === 'all' || s.region === reg) &&
    (outlet === 'all' || s.store  === outlet) &&
    (market === 'all' || s.market === market) &&
    (cm   === 'all' || s.cm    === cm) &&
    (rm   === 'all' || s.rm    === rm) &&
    (risk === 'all' || s.level === risk) &&
    (cardFilter === null          ||
     (cardFilter === 'high'      && s.level === 'High') ||
     (cardFilter === 'medium'    && s.level === 'Medium') ||
     (cardFilter === 'low'       && s.level === 'Low') ||
     (cardFilter === 'shrinkage' && s.shrinkPts > 0) ||
     (cardFilter === 'fraud'     && s.fraud) ||
     (cardFilter === 'ops'       && s.opsPts > 0))
  );

  if      (sort === 'risk')      data.sort((a, b) => b.total - a.total);
  else if (sort === 'shrinkage') data.sort((a, b) => a.shrinkage - b.shrinkage);
  else if (sort === 'opsScore')  data.sort((a, b) => a.opsScore - b.opsScore);
  else                           data.sort((a, b) => a.store.localeCompare(b.store));

  return data;
}

function setCardFilter(key) {
  cardFilter = (cardFilter === key) ? null : key;
  applyFilters();
  if (cardFilter !== null) {
    document.getElementById('storeCount')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function applyFilters() {
  const data = getFiltered();
  renderKPIs(data);
  renderTable(data);
  renderCharts(data);
  renderClauseChart(data);
}

/* ============================================================
   RENDER — KPI CARDS
   ============================================================ */
function renderKPIs(data) {
  const scored = data.filter(s => s.level !== 'Pending');
  const n  = scored.length || 1;
  const h  = scored.filter(s => s.level === 'High').length;
  const m  = scored.filter(s => s.level === 'Medium').length;
  const l  = scored.filter(s => s.level === 'Low').length;
  const sr = scored.filter(s => s.shrinkPts > 0).length;
  const fr = data.filter(s => s.fraud).length;
  const ow = scored.filter(s => s.opsPts > 0).length;

  const cf = cardFilter;
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card kpi-clickable${cf === null ? ' kpi-active' : ''}" onclick="setCardFilter(null)">
      <div class="kpi-label">Stores in view</div>
      <div class="kpi-val">${data.length}</div>
      <div class="kpi-sub">filtered selection</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'high' ? ' kpi-active' : ''}" onclick="setCardFilter('high')">
      <div class="kpi-label">High risk</div>
      <div class="kpi-val cr">${h}</div>
      <div class="kpi-sub cr">${Math.round(h / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'medium' ? ' kpi-active' : ''}" onclick="setCardFilter('medium')">
      <div class="kpi-label">Medium risk</div>
      <div class="kpi-val ca">${m}</div>
      <div class="kpi-sub" style="color:#6b6b68">${Math.round(m / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'low' ? ' kpi-active' : ''}" onclick="setCardFilter('low')">
      <div class="kpi-label">Low risk</div>
      <div class="kpi-val cg">${l}</div>
      <div class="kpi-sub" style="color:#6b6b68">${Math.round(l / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'shrinkage' ? ' kpi-active' : ''}" onclick="setCardFilter('shrinkage')">
      <div class="kpi-label">Shrinkage risk</div>
      <div class="kpi-val cr">${sr}</div>
      <div class="kpi-sub" style="color:#6b6b68">stores &gt; 0.075%</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'fraud' ? ' kpi-active' : ''}" onclick="setCardFilter('fraud')">
      <div class="kpi-label">Fraud cases</div>
      <div class="kpi-val ${fr > 5 ? 'cr' : fr > 2 ? 'ca' : 'cg'}">${fr}</div>
      <div class="kpi-sub" style="color:#6b6b68">stores affected</div>
    </div>
    <div class="kpi-card kpi-clickable${cf === 'ops' ? ' kpi-active' : ''}" onclick="setCardFilter('ops')">
      <div class="kpi-label">Ops below 90%</div>
      <div class="kpi-val ${ow > 10 ? 'cr' : ow > 5 ? 'ca' : 'cg'}">${ow}</div>
      <div class="kpi-sub" style="color:#6b6b68">need attention</div>
    </div>
  `;
}

/* ============================================================
   RENDER — STORE TABLE
   ============================================================ */
function renderTable(data) {
  document.getElementById('storeCount').textContent = data.length + ' stores';

  if (!data.length) {
    document.getElementById('storeBody').innerHTML =
      '<tr><td colspan="10"><div class="empty">No stores match the selected filters.</div></td></tr>';
    return;
  }

  document.getElementById('storeBody').innerHTML = data.map(s => {
    const isPending = s.level === 'Pending';
    const badge = isPending ? 'rp' : s.level === 'High' ? 'rh' : s.level === 'Medium' ? 'rm' : 'rl';
    const sh    = s.shrinkage ? s.shrinkage.toFixed(3) : '0.000';
    const shC   = s.shrinkPts > 0 ? '#a32d2d' : '#2a5c14';
    const opC   = s.opsPts === 30 ? '#a32d2d' : s.opsPts === 20 ? '#854f0b' : '#2a5c14';
    const parts = [
      s.shrinkPts > 0 ? 'S:+' + s.shrinkPts + '%' : '',
      s.opsPts    > 0 ? 'O:+' + s.opsPts    + '%' : '',
      s.fraudPts  > 0 ? 'F:+' + s.fraudPts  + '%' : '',
    ].filter(Boolean).join(' ') || 'no risk';

    return `<tr>
      <td><span class="store-link" onclick="toggleStoreIssues('${s.store.replace(/'/g, "\\'")}', this)">&#9654; ${s.store}</span></td>
      <td style="color:#6b6b68">${s.region}</td>
      <td style="color:#6b6b68">${s.cm || '-'}</td>
      <td style="color:#6b6b68">${s.rm || '-'}</td>
      <td style="color:#6b6b68">${s.opsMonth || s.month || '-'}</td>
      <td style="color:${isPending ? '#aaa' : shC};font-weight:600">${isPending ? '-' : sh + '%' + (s.shrinkPts > 0 ? ' &#9650;' : '')}</td>
      <td style="color:${isPending ? '#aaa' : opC};font-weight:600">${isPending ? '-' : s.opsScore + '%'}</td>
      <td style="color:${s.fraud ? '#a32d2d' : '#2a5c14'};font-weight:600">${s.fraud ? 'Yes' : 'No'}</td>
      <td><span class="rb ${badge}">${s.level}</span></td>
      <td style="font-weight:600">${isPending ? '-' : s.total + '%<span class="bkd">(' + parts + ')</span>'}</td>
    </tr>`;
  }).join('');
}

/* ============================================================
   RENDER — CHARTS
   ============================================================ */
function renderCharts(data) {
  const scored    = data.filter(s => s.level !== 'Pending');
  const top10     = [...scored].sort((a, b) => b.total - a.total).slice(0, 10);
  const barColors = top10.map(s =>
    s.level === 'High' ? '#e24b4a' : s.level === 'Medium' ? '#ef9f27' : '#639922'
  );
  const h     = scored.filter(s => s.level === 'High').length;
  const m     = scored.filter(s => s.level === 'Medium').length;
  const l     = scored.filter(s => s.level === 'Low').length;
  const total = scored.length || 1;

  if (bChart) { bChart.destroy(); bChart = null; }
  if (pChart) { pChart.destroy(); pChart = null; }

  bChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: top10.map(s => s.store),
      datasets: [{
        label: 'Risk %',
        data: top10.map(s => s.total),
        backgroundColor: barColors,
        borderWidth: 0,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: { callback: v => v + '%', font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });

  document.getElementById('pieLegend').innerHTML = `
    <span><span class="ld" style="background:#e24b4a"></span>High ${h} (${Math.round(h / total * 100)}%)</span>
    <span><span class="ld" style="background:#ef9f27"></span>Medium ${m} (${Math.round(m / total * 100)}%)</span>
    <span><span class="ld" style="background:#639922"></span>Low ${l} (${Math.round(l / total * 100)}%)</span>
  `;

  pChart = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: {
      labels: ['High', 'Medium', 'Low'],
      datasets: [{
        data: [h, m, l],
        backgroundColor: ['#e24b4a', '#ef9f27', '#639922'],
        borderWidth: 3,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
    },
  });
}

/* ============================================================
   RENDER — TOP 5 AUDIT CLAUSES (cluster / RM wise)
   Counts "Audit Clause" occurrences in the issues sheet for
   the stores currently in view, so the Region / Outlet /
   Market / CM (cluster) / RM / Month filters all apply.
   ============================================================ */
function renderClauseChart(data) {
  const canvas  = document.getElementById('clauseChart');
  const emptyEl = document.getElementById('clauseChartEmpty');
  const wrapEl  = document.getElementById('clauseChartWrap');
  if (!canvas || !emptyEl || !wrapEl) return;

  const storesInView = new Set(data.map(s => s.store));
  const period = document.getElementById('opsPeriodFilter')?.value || 'latest';

  const rows = issuesData.filter(r =>
    storesInView.has(r.store) &&
    (period === 'latest' || periodsMatch(r.period, period)) &&
    r.clause && r.clause !== '-'
  );

  const counts = {};
  rows.forEach(r => { counts[r.clause] = (counts[r.clause] || 0) + 1; });
  const top5 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (clauseChart) { clauseChart.destroy(); clauseChart = null; }

  if (!top5.length) {
    emptyEl.textContent = issuesData.length
      ? 'No audit clause issues match the current filter selection.'
      : 'Audit clause data loads from the "Operation scorecard issues" sheet…';
    emptyEl.style.display = '';
    wrapEl.style.display  = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  wrapEl.style.display  = '';

  const palette = ['#4a7fcb', '#ef9f27', '#e24b4a', '#639922', '#9b59b6'];
  clauseChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top5.map(([c]) => c.length > 60 ? c.slice(0, 57) + '…' : c),
      datasets: [{
        label: 'Issues',
        data: top5.map(([, n]) => n),
        backgroundColor: top5.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => top5[items[0].dataIndex][0] } },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });
}

/* ============================================================
   AUTO-REFRESH — re-fetches Google Sheet every 5 minutes
   ============================================================ */
let autoRefreshTimer = null;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    const url = document.getElementById('sheetUrl').value.trim();
    if (!url) return;
    const csvUrl = toCSVExportUrl(url);
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) return;
      const text = await res.text();
      const rows = parseCSV(text);
      activeStores = rows.map(calcRisk);
      rebuildFilters();
      applyFilters();
      const now = new Date().toLocaleTimeString();
      setDsStatus('Google Sheet · ' + rows.length + ' stores · refreshed ' + now, true);
      showSheetStatus('&#10003; Auto-refreshed at ' + now, 'ok');
      loadIssuesSheet();
      loadShrinkageSheet();
      loadShortageSheet();
      loadAuditSheet();
      loadEnrollSheet();
      loadOpsScSheet();
    } catch (_) { /* silently skip failed auto-refresh */ }
  }, AUTO_REFRESH_MS);
  updateRefreshBadge(true);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  updateRefreshBadge(false);
}

function updateRefreshBadge(active) {
  const badge = document.getElementById('refreshBadge');
  if (!badge) return;
  badge.textContent = active ? '&#128257; Auto-refresh ON (5 min)' : '';
  badge.innerHTML   = active ? '&#128257; Auto-refresh ON (5 min)' : '';
}

/* ============================================================
   INITIALISE — runs when page loads
   ============================================================ */
activeStores = SAMPLE.map(calcRisk);
rebuildRegionFilter();
applyFilters();

/* Auto-load on page open — URL param > localStorage > default hardcoded sheet */
(function autoLoad() {
  const param = new URLSearchParams(location.search).get('sheet');
  const url   = param
    ? decodeURIComponent(param)
    : (localStorage.getItem('sheetUrl') || DEFAULT_SHEET_URL);
  document.getElementById('sheetUrl').value = url;
  switchTab('sheet');
  loadFromGoogleSheet();
})();

/* ============================================================
   PAGE TAB SWITCHING
   ============================================================ */
function switchPageTab(tab) {
  document.getElementById('pageRisk').style.display      = tab === 'risk'      ? '' : 'none';
  document.getElementById('pageIssues').style.display    = tab === 'issues'    ? '' : 'none';
  document.getElementById('pageShrinkage').style.display = tab === 'shrinkage' ? '' : 'none';
  document.getElementById('pageShortage').style.display  = tab === 'shortage'  ? '' : 'none';
  document.getElementById('pageAudit').style.display     = tab === 'audit'     ? '' : 'none';
  document.getElementById('pageEnroll').style.display    = tab === 'enroll'    ? '' : 'none';
  document.getElementById('pageOpsSc').style.display     = tab === 'opssc'     ? '' : 'none';
  document.getElementById('pageExcel').style.display     = tab === 'excel'     ? '' : 'none';
  document.getElementById('ptab-risk').classList.toggle('active',      tab === 'risk');
  document.getElementById('ptab-issues').classList.toggle('active',    tab === 'issues');
  document.getElementById('ptab-shrinkage').classList.toggle('active', tab === 'shrinkage');
  document.getElementById('ptab-shortage').classList.toggle('active',  tab === 'shortage');
  document.getElementById('ptab-audit').classList.toggle('active',     tab === 'audit');
  document.getElementById('ptab-enroll').classList.toggle('active',    tab === 'enroll');
  document.getElementById('ptab-opssc').classList.toggle('active',     tab === 'opssc');
  document.getElementById('ptab-excel').classList.toggle('active',     tab === 'excel');
  if (tab === 'issues'    && issuesData.length    === 0) loadIssuesSheet();
  if (tab === 'shrinkage' && shrinkageData.length === 0) loadShrinkageSheet();
  if (tab === 'shortage'  && shortageData.length  === 0) loadShortageSheet();
  if (tab === 'audit'     && auditData.length     === 0) loadAuditSheet();
  if (tab === 'enroll') {
    if (enrollData.length === 0) loadEnrollSheet();
    else applyEnrollFilters(); /* re-render charts now that the tab is visible */
  }
  if (tab === 'opssc') {
    if (opsScData.length === 0) loadOpsScSheet();
    else applyOpsScFilters(); /* re-render charts now that the tab is visible */
  }
  if (tab === 'excel') {
    if (excelData.length === 0) loadExcelSheet();
    else applyExcelFilters(); /* re-render charts now that the tab is visible */
  }
}

function toggleStoreIssues(storeName, el) {
  const tr = el.closest('tr');
  const next = tr.nextElementSibling;

  /* collapse if already open */
  if (next && next.classList.contains('issues-expand-row') && next.dataset.store === storeName) {
    next.remove();
    el.innerHTML = '&#9654; ' + storeName;
    el.classList.remove('store-link-open');
    return;
  }

  /* close any other open row */
  document.querySelectorAll('.issues-expand-row').forEach(r => r.remove());
  document.querySelectorAll('.store-link-open').forEach(s => {
    s.innerHTML = '&#9654; ' + s.dataset.store;
    s.classList.remove('store-link-open');
  });

  el.dataset.store = storeName;
  el.innerHTML = '&#9660; ' + storeName;
  el.classList.add('store-link-open');

  if (issuesData.length === 0) {
    const loadTr = document.createElement('tr');
    loadTr.className = 'issues-expand-row';
    loadTr.dataset.store = storeName;
    loadTr.innerHTML = '<td colspan="10" class="issues-expand-cell" style="padding:12px;color:#6b6b68;font-style:italic">Loading issues…</td>';
    tr.after(loadTr);
    loadIssuesSheet().then(() => { loadTr.remove(); insertIssuesRow(storeName, tr, el); });
    return;
  }

  insertIssuesRow(storeName, tr, el);
}

function insertIssuesRow(storeName, tr, el) {
  const storeIssues = issuesData.filter(r => r.store === storeName);
  const expandTr = document.createElement('tr');
  expandTr.className = 'issues-expand-row';
  expandTr.dataset.store = storeName;

  if (!storeIssues.length) {
    expandTr.innerHTML = '<td colspan="10" class="issues-expand-cell" style="padding:12px;color:#9b9b98;font-style:italic">No issues recorded for this store.</td>';
  } else {
    const bodyRows = storeIssues.map(r => {
      const badge = r.risk === 'High' ? 'rh' : r.risk === 'Medium' ? 'rm' : r.risk === 'Low' ? 'rl' : 'rp';
      return `<tr>
        <td style="color:#6b6b68">${r.section}</td>
        <td><span class="rb ${badge}">${r.risk}</span></td>
        <td style="color:#555">${r.clause}</td>
        <td>${r.obs !== '-' ? r.obs : '<span style="color:#aaa">—</span>'}</td>
      </tr>`;
    }).join('');
    expandTr.innerHTML = `<td colspan="10" class="issues-expand-cell">
      <table class="issues-sub-table">
        <thead><tr><th>Section</th><th>Risk</th><th>Audit Clause</th><th>Observation</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </td>`;
  }
  tr.after(expandTr);
}

/* ============================================================
   STORE ISSUES — load from "Operation scorecard issues" sheet
   ============================================================ */
function toIssuesCSVUrl(mainUrl) {
  const idMatch = mainUrl.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  /* gviz/tq endpoint reliably selects a sheet by name; /export?sheet= does not */
  return 'https://docs.google.com/spreadsheets/d/' + idMatch[1] +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('Operation scorecard issues');
}

function showIssuesStatus(msg, type) {
  const el = document.getElementById('issuesStatus');
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadIssuesSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showIssuesStatus('Issues data requires a Google Sheet. Please load data via the Google Sheet tab first.', 'err');
    return;
  }
  const csvUrl = toIssuesCSVUrl(raw);
  if (!csvUrl) return;
  showIssuesStatus('Loading issues data…', '');
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const storeMap = {};
    activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
    issuesData = parseIssuesCSV(text).map(r => ({
      ...r,
      cm: storeMap[r.store]?.cm || '-',
      rm: storeMap[r.store]?.rm || '-',
    }));
    rebuildIssuesFilters();
    applyIssuesFilters();
    rebuildOpsPeriodFilter();
    enrichStoresWithOpsScores(document.getElementById('opsPeriodFilter')?.value || 'latest');
    showIssuesStatus('', '');
  } catch (err) {
    showIssuesStatus('&#10007; Could not load issues sheet: ' + err.message, 'err');
  }
}

/* CSV line splitter that handles quoted fields with commas inside */
function splitCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += line[i]; }
  }
  result.push(cur.trim());
  return result;
}

/* Full CSV parser — handles quoted fields that contain commas AND newlines */
function parseFullCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }  /* escaped "" */
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(cur.trim()); cur = ''; }
      else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(cur.trim()); if (row.some(c => c)) rows.push(row); row = []; cur = ''; i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(cur.trim()); if (row.some(c => c)) rows.push(row); row = []; cur = '';
      } else { cur += ch; }
    }
  }
  if (cur || row.length) { row.push(cur.trim()); if (row.some(c => c)) rows.push(row); }
  return rows;
}

function parseIssuesCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return [];

  /* normalise header names: lowercase, strip spaces / % / dots */
  const hdrs = allRows[0].map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  const iStore   = col('store', 'storename', 'outlets', 'outlet', 'outletname');
  const iPeriod  = col('period', 'month');
  const iScore   = col('score', 'scorepct');
  const iSection = col('section');
  const iClause  = col('auditclause', 'clause');
  const iRisk    = col('risk', 'risklevel');
  const iWtMax   = col('wtmax', 'weightmax');
  const iRating  = col('rating');
  const iPoints  = col('pointslost', 'lostpoints');
  const iObs     = col('observation', 'observations');

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const store = iStore !== -1 ? (c[iStore] || '').trim() : '';
    if (!store) continue;
    rows.push({
      store:      store,
      period:     iPeriod  !== -1 ? c[iPeriod]  || '-' : '-',
      score:      iScore   !== -1 ? c[iScore]   || '-' : '-',
      section:    iSection !== -1 ? c[iSection] || '-' : '-',
      clause:     iClause  !== -1 ? c[iClause]  || '-' : '-',
      risk:       iRisk    !== -1 ? c[iRisk]    || '-' : '-',
      wtMax:      iWtMax   !== -1 ? c[iWtMax]   || '-' : '-',
      rating:     iRating  !== -1 ? c[iRating]  || '-' : '-',
      pointsLost: iPoints  !== -1 ? c[iPoints]  || '-' : '-',
      obs:        iObs     !== -1 ? c[iObs]     || '-' : '-',
    });
  }
  return rows;
}

function rebuildIssuesFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('issueStoreFilter',   [...new Set(issuesData.map(r => r.store))].sort());
  rebuild('issueCmFilter',      [...new Set(issuesData.map(r => r.cm).filter(v => v && v !== '-'))].sort());
  rebuild('issueRmFilter',      [...new Set(issuesData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
  rebuild('issuePeriodFilter',  [...new Set(issuesData.map(r => r.period).filter(v => v !== '-'))]);
  rebuild('issueSectionFilter', [...new Set(issuesData.map(r => r.section).filter(v => v !== '-'))].sort());
}

function getFilteredIssues() {
  const store   = document.getElementById('issueStoreFilter').value;
  const cm      = document.getElementById('issueCmFilter').value;
  const rm      = document.getElementById('issueRmFilter').value;
  const period  = document.getElementById('issuePeriodFilter').value;
  const section = document.getElementById('issueSectionFilter').value;
  const risk    = document.getElementById('issueRiskFilter').value;
  return issuesData.filter(r =>
    (store   === 'all' || r.store   === store)   &&
    (cm      === 'all' || r.cm      === cm)      &&
    (rm      === 'all' || r.rm      === rm)      &&
    (period  === 'all' || r.period  === period)  &&
    (section === 'all' || r.section === section) &&
    (risk    === 'all' || r.risk    === risk)
  );
}

function applyIssuesFilters() {
  renderIssuesTable(getFilteredIssues());
}

/* ============================================================
   SHRINKAGE % TAB
   ============================================================ */
function toShrinkageCSVUrl(mainUrl) {
  const idMatch = mainUrl.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  return 'https://docs.google.com/spreadsheets/d/' + idMatch[1] +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('Shrinkage %');
}

function showShrinkageStatus(msg, type) {
  const el = document.getElementById('shrinkageStatus');
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadShrinkageSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) return;
  const csvUrl = toShrinkageCSVUrl(raw);
  if (!csvUrl) return;
  showShrinkageStatus('Loading shrinkage data…', '');
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const storeMap = {};
    activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
    shrinkageData = parseShrinkageCSV(text).map(r => ({
      ...r,
      cm: storeMap[r.outlet]?.cm || '-',
      rm: storeMap[r.outlet]?.rm || '-',
    }));
    rebuildShrinkageFilters();
    applyShrinkageFilters();
    showShrinkageStatus('', '');
  } catch (err) {
    showShrinkageStatus('&#10007; Could not load Shrinkage sheet: ' + err.message, 'err');
  }
}

function parseShrinkageCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return [];

  const hdrs = allRows[0].map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  const iOutlet  = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  const iQtr     = col('quarter', 'qtr');
  const iShrPct  = col('shrinkage', 'shrinkagepct');  /* Shrinkage % → 'shrinkage' */
  const iShrVal  = col('shrinkagevalue', 'shrinkageval');
  const iShrQty  = col('shrinkageqty', 'shrinkagequantity');
  const iSale    = col('storesale', 'sale', 'sales');

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = iOutlet !== -1 ? (c[iOutlet] || '').trim() : '';
    if (!outlet) continue;
    rows.push({
      outlet:    outlet,
      quarter:   iQtr    !== -1 ? c[iQtr]    || '-' : '-',
      shrPct:    iShrPct !== -1 ? c[iShrPct] || '-' : '-',
      shrVal:    iShrVal !== -1 ? c[iShrVal] || '-' : '-',
      shrQty:    iShrQty !== -1 ? c[iShrQty] || '-' : '-',
      sale:      iSale   !== -1 ? c[iSale]   || '-' : '-',
    });
  }
  return rows;
}

function rebuildShrinkageFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('shrinkageQuarterFilter', [...new Set(shrinkageData.map(r => r.quarter).filter(v => v !== '-'))]);
  rebuild('shrinkageCmFilter',      [...new Set(shrinkageData.map(r => r.cm).filter(v => v && v !== '-'))].sort());
  rebuild('shrinkageRmFilter',      [...new Set(shrinkageData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
  rebuild('shrinkageOutletFilter',  [...new Set(shrinkageData.map(r => r.outlet))].sort());
}

function getFilteredShrinkage() {
  const qtr    = document.getElementById('shrinkageQuarterFilter').value;
  const cm     = document.getElementById('shrinkageCmFilter').value;
  const rm     = document.getElementById('shrinkageRmFilter').value;
  const outlet = document.getElementById('shrinkageOutletFilter').value;
  const pctF   = document.getElementById('shrinkagePctFilter').value;
  return shrinkageData.filter(r => {
    if (qtr    !== 'all' && r.quarter !== qtr)    return false;
    if (cm     !== 'all' && r.cm      !== cm)     return false;
    if (rm     !== 'all' && r.rm      !== rm)     return false;
    if (outlet !== 'all' && r.outlet  !== outlet) return false;
    if (pctF   !== 'all') {
      const v = parseFloat(r.shrPct);
      if (isNaN(v)) return false;
      if (pctF === 'pos'   && v <  0)      return false;
      if (pctF === 'neg'   && v >= 0)      return false;
      if (pctF === 'lt005' && v >= -0.05)  return false;
      if (pctF === 'lt010' && v >= -0.10)  return false;
      if (pctF === 'lt015' && v >= -0.15)  return false;
    }
    return true;
  });
}

function applyShrinkageFilters() {
  const data = getFilteredShrinkage();
  renderShrinkageChart(data);
  renderShrinkageTable(data);
}

function renderShrinkageChart(data) {
  /* Group by RM, compute average shrinkage % */
  const rmMap = {};
  data.forEach(r => {
    const rm = r.rm !== '-' ? r.rm : 'Unassigned';
    const v  = parseFloat(r.shrPct);
    if (isNaN(v)) return;
    if (!rmMap[rm]) rmMap[rm] = { sum: 0, count: 0 };
    rmMap[rm].sum   += v;
    rmMap[rm].count += 1;
  });

  const labels = Object.keys(rmMap).sort();
  const avgs   = labels.map(rm => parseFloat((rmMap[rm].sum / rmMap[rm].count).toFixed(4)));
  const absVals = avgs.map(v => Math.abs(v));  /* donut slices use absolute size */
  const total  = absVals.reduce((a, b) => a + b, 0) || 1;

  const palette = ['#4a7fcb','#ef9f27','#e24b4a','#639922','#9b59b6',
                   '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
  const colors  = labels.map((_, i) => palette[i % palette.length]);

  if (rmChart) { rmChart.destroy(); rmChart = null; }

  rmChart = new Chart(document.getElementById('shrinkageRmChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: absVals,
        backgroundColor: colors,
        borderWidth: 3,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const avg = avgs[ctx.dataIndex];
              const pct = ((absVals[ctx.dataIndex] / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${avg.toFixed(3)}%  (${pct}% share)`;
            },
          },
        },
      },
    },
  });

  /* Custom legend with actual shrinkage % values */
  document.getElementById('shrinkageRmLegend').innerHTML = labels.map((rm, i) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:12px;color:#444">
      <span style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;display:inline-block"></span>
      <strong>${rm}</strong>&nbsp;${avgs[i].toFixed(3)}%
      &nbsp;<span style="color:#9b9b98">(${((absVals[i]/total)*100).toFixed(1)}%)</span>
    </span>`
  ).join('');
}

function renderShrinkageTable(data) {
  document.getElementById('shrinkageCount').textContent = data.length + ' rows';
  if (!data.length) {
    document.getElementById('shrinkageBody').innerHTML =
      '<tr><td colspan="6"><div class="empty">No data matches the selected filters.</div></td></tr>';
    return;
  }
  document.getElementById('shrinkageBody').innerHTML = data.map(r => {
    const pct   = parseFloat(r.shrPct);
    const pctColor = !isNaN(pct) ? (pct < 0 ? '#a32d2d' : '#2a5c14') : '#1a1a1a';
    const val   = parseFloat(r.shrVal);
    const valColor = !isNaN(val) ? (val < 0 ? '#a32d2d' : '#2a5c14') : '#1a1a1a';
    const qty   = parseFloat(r.shrQty);
    const qtyColor = !isNaN(qty) ? (qty < 0 ? '#a32d2d' : '#2a5c14') : '#1a1a1a';
    const saleNum = parseFloat(r.sale);
    const saleStr = !isNaN(saleNum) ? saleNum.toLocaleString('en-IN') : r.sale;
    return `<tr>
      <td style="font-weight:600">${r.outlet}</td>
      <td style="color:#6b6b68">${r.quarter}</td>
      <td style="color:${pctColor};font-weight:600">${r.shrPct}</td>
      <td style="color:${valColor};font-weight:600">${r.shrVal}</td>
      <td style="color:${qtyColor};font-weight:600">${r.shrQty}</td>
      <td style="font-weight:600">${saleStr}</td>
    </tr>`;
  }).join('');
}

function exportShrinkageCSV() {
  const data = getFilteredShrinkage();
  if (!data.length) return;
  const headers = ['Outlet Name','Quarter','Shrinkage %','Shrinkage Value','Shrinkage Qty','Store Sale'];
  const rows = data.map(r =>
    [r.outlet, r.quarter, r.shrPct, r.shrVal, r.shrQty, r.sale]
      .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_shrinkage_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

function renderIssuesTable(data) {
  document.getElementById('issuesCount').textContent = data.length + ' issues';
  if (!data.length) {
    document.getElementById('issuesBody').innerHTML =
      '<tr><td colspan="3"><div class="empty">No issues match the selected filters.</div></td></tr>';
    return;
  }
  document.getElementById('issuesBody').innerHTML = data.map(r => `<tr>
      <td style="font-weight:600;white-space:nowrap">${r.store}</td>
      <td style="color:#6b6b68;white-space:nowrap">${r.period}</td>
      <td class="issues-obs">${r.obs}</td>
    </tr>`).join('');
}

function exportIssuesCSV() {
  const data = getFilteredIssues();
  if (!data.length) return;
  const headers = ['Store','Period','Score%','Section','Audit Clause','Risk','Wt.Max','Rating','Points Lost','Observation'];
  const rows = data.map(r =>
    [r.store, r.period, r.score, r.section, r.clause, r.risk, r.wtMax, r.rating, r.pointsLost, r.obs]
      .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_issues_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

/* ============================================================
   SHORTAGE ITEMS TAB
   ============================================================ */
function toShortageCSVUrl(mainUrl) {
  const idMatch = mainUrl.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  return 'https://docs.google.com/spreadsheets/d/' + idMatch[1] +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('Shortage items');
}

function showShortageStatus(msg, type) {
  const el = document.getElementById('shortageStatus');
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadShortageSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) return;
  const csvUrl = toShortageCSVUrl(raw);
  if (!csvUrl) return;
  showShortageStatus('Loading shortage items data…', '');
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const storeMap = {};
    activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
    const parsed = parseShortageCSV(text, storeMap);
    shortageData    = parsed.rows;
    shortageHeaders = parsed.headers;
    shortageColIdx  = { iItemName: parsed.iItemName, iStkVal: parsed.iStkVal, iAdjQty: parsed.iAdjQty,
                        iStyle: parsed.iStyle, iBrand: parsed.iBrand, iOutlet: parsed.iOutlet };
    rebuildShortageFilters();
    applyShortageFilters();
    showShortageStatus('', '');
  } catch (err) {
    showShortageStatus('&#10007; Could not load Shortage Items sheet: ' + err.message, 'err');
  }
}

function parseShortageCSV(text, storeMap) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return { headers: [], rows: [] };

  const rawHdrs = allRows[0];
  const hdrs    = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  const iStore    = col('storename', 'store', 'outletname', 'outlet', 'outlets');
  const iCategory = col('category', 'itemcategory', 'itemtype', 'type');
  const iPeriod   = col('period', 'month', 'quarter', 'date', 'qtr');
  const iItemName = col('itemname', 'item', 'itemdesc', 'description', 'productname', 'product');
  const iStkVal   = col('stkvalue(mrp)', 'stkvaluemrp', 'stkvalue', 'stockvalue', 'mrpvalue', 'mrp');
  const iAdjQty   = col('adjqty', 'adjustedqty', 'adjustedquantity', 'adjquantity');
  const iStyle    = col('style', 'stylename', 'styletype');
  const iBrand    = col('brand', 'brandname');
  const iOutlet   = col('outletname', 'outlet', 'outlets', 'storename', 'store');

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    if (c.every(v => !v.trim())) continue;
    const store = iStore !== -1 ? (c[iStore] || '').trim() : '';
    const info  = storeMap[store] || { cm: '-', rm: '-' };
    const row   = { _store: store, _cm: info.cm, _rm: info.rm };
    rawHdrs.forEach((h, idx) => { row[h] = c[idx] !== undefined ? c[idx] : '-'; });
    row._category = iCategory !== -1 ? (c[iCategory] || '-') : '-';
    row._period   = iPeriod   !== -1 ? (c[iPeriod]   || '-') : '-';
    row._itemName = iItemName !== -1 ? (c[iItemName] || '-') : '-';
    row._stkVal   = iStkVal   !== -1 ? c[iStkVal]   : null;
    row._adjQty   = iAdjQty   !== -1 ? c[iAdjQty]   : null;
    row._style    = iStyle    !== -1 ? (c[iStyle]    || '-') : '-';
    row._brand    = iBrand    !== -1 ? (c[iBrand]    || '-') : '-';
    row._outlet   = iOutlet   !== -1 ? (c[iOutlet]   || '-') : '-';
    rows.push(row);
  }
  return { headers: rawHdrs, rows, iItemName, iStkVal, iAdjQty, iStyle, iBrand, iOutlet };
}

function rebuildShortageFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('shortageStoreFilter',    [...new Set(shortageData.map(r => r._store).filter(v => v))].sort());
  rebuild('shortageCmFilter',       [...new Set(shortageData.map(r => r._cm).filter(v => v && v !== '-'))].sort());
  rebuild('shortageRmFilter',       [...new Set(shortageData.map(r => r._rm).filter(v => v && v !== '-'))].sort());
  rebuild('shortageItemFilter',     [...new Set(shortageData.map(r => r._itemName).filter(v => v && v !== '-'))].sort());
  rebuild('shortagePeriodFilter',   [...new Set(shortageData.map(r => r._period).filter(v => v && v !== '-'))]);
}

function getFilteredShortage() {
  const store    = document.getElementById('shortageStoreFilter').value;
  const cm       = document.getElementById('shortageCmFilter').value;
  const rm       = document.getElementById('shortageRmFilter').value;
  const category = document.getElementById('shortageItemFilter').value;
  const period   = document.getElementById('shortagePeriodFilter').value;
  return shortageData.filter(r =>
    (store    === 'all' || r._store    === store)    &&
    (cm       === 'all' || r._cm       === cm)       &&
    (rm       === 'all' || r._rm       === rm)       &&
    (category === 'all' || r._itemName === category) &&
    (period   === 'all' || r._period   === period)
  );
}

function applyShortageFilters() {
  renderShortageAnalysis(getFilteredShortage());
}

function _parseNum(val) {
  if (val === null || val === undefined) return NaN;
  const s = String(val).trim().replace(/,/g, '').replace(/\s/g, '');
  /* handle parentheses for negatives e.g. (123) → -123 */
  if (/^\([\d.]+\)$/.test(s)) return -parseFloat(s.slice(1, -1));
  return parseFloat(s);
}

function _shortageGroup(data, keyFn) {
  const map = {};
  data.forEach(r => {
    const key = keyFn(r) || '(Unknown)';
    if (!map[key]) map[key] = { stkVal: 0, adjQty: 0, count: 0 };
    const sv = _parseNum(r._stkVal);
    const aq = _parseNum(r._adjQty);
    if (!isNaN(sv)) map[key].stkVal += sv;
    if (!isNaN(aq)) map[key].adjQty += aq;
    map[key].count++;
  });
  return Object.entries(map).sort((a, b) => a[1].stkVal - b[1].stkVal);
}

function _shortageAnalysisTable(title, rows, totalStkVal, totalAdjQty, labelHeader) {
  const fmtVal  = v => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty  = v => v.toLocaleString('en-IN', { minimumFractionDigits: 0,  maximumFractionDigits: 2 });
  const valCol  = v => v < 0 ? '#a32d2d' : v > 0 ? '#2a5c14' : '#555';
  const qtyCol  = v => v < 0 ? '#a32d2d' : v > 0 ? '#2a5c14' : '#555';
  const pctBar  = (v, total) => {
    const pct = total !== 0 ? Math.abs(v / total) * 100 : 0;
    const color = v < 0 ? '#e24b4a' : '#639922';
    return `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;background:#eee;border-radius:3px;height:6px;min-width:60px">
        <div style="width:${Math.min(pct,100).toFixed(1)}%;background:${color};height:6px;border-radius:3px"></div>
      </div>
      <span style="font-size:11px;color:#888;min-width:36px">${pct.toFixed(1)}%</span>
    </div>`;
  };

  return `
    <div class="sec-hdr" style="margin-bottom:10px">
      <div class="sec-title">${title}</div>
      <div style="display:flex;gap:16px;font-size:13px;font-weight:600">
        <span style="color:${valCol(totalStkVal)}">Total: ₹${fmtVal(totalStkVal)}</span>
        <span style="color:${qtyCol(totalAdjQty)}">Adj Qty: ${fmtQty(totalAdjQty)}</span>
      </div>
    </div>
    <div class="tbl-wrap" style="margin-bottom:0">
      <table>
        <thead><tr>
          <th>${labelHeader}</th>
          <th style="text-align:right">Stk Value (MRP) ₹</th>
          <th style="text-align:right">Adj Qty</th>
          <th>Share of Loss</th>
          <th style="text-align:right">Count</th>
        </tr></thead>
        <tbody>
          ${rows.map(([label, v]) => `<tr>
            <td style="font-weight:600">${label}</td>
            <td style="text-align:right;font-weight:600;color:${valCol(v.stkVal)}">${fmtVal(v.stkVal)}</td>
            <td style="text-align:right;font-weight:600;color:${qtyCol(v.adjQty)}">${fmtQty(v.adjQty)}</td>
            <td>${pctBar(v.stkVal, totalStkVal)}</td>
            <td style="text-align:right;color:#888">${v.count}</td>
          </tr>`).join('')}
          <tr style="background:#f5f4f0;font-weight:700;border-top:2px solid #ccc">
            <td>TOTAL</td>
            <td style="text-align:right;color:${valCol(totalStkVal)}">₹${fmtVal(totalStkVal)}</td>
            <td style="text-align:right;color:${qtyCol(totalAdjQty)}">${fmtQty(totalAdjQty)}</td>
            <td></td>
            <td style="text-align:right;color:#888">${rows.reduce((s,[,v])=>s+v.count,0)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderShortageAnalysis(data) {
  const hasStkVal = shortageColIdx.iStkVal  !== -1;
  const hasAdjQty = shortageColIdx.iAdjQty  !== -1;
  const hasItem   = shortageColIdx.iItemName !== -1;
  const hasStyle  = shortageColIdx.iStyle    !== -1;
  const hasBrand  = shortageColIdx.iBrand    !== -1;
  const hasOutlet = shortageColIdx.iOutlet   !== -1;

  /* KPI strip */
  const kpiEl = document.getElementById('shortageKpis');
  if (kpiEl) {
    if (!data.length) { kpiEl.style.display = 'none'; }
    else {
      let totalStkVal = 0, totalAdjQty = 0;
      data.forEach(r => {
        const sv = _parseNum(r._stkVal);
        const aq = _parseNum(r._adjQty);
        if (!isNaN(sv)) totalStkVal += sv;
        if (!isNaN(aq)) totalAdjQty += aq;
      });
      const fmtVal = v => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const valCol = v => v < 0 ? '#a32d2d' : v > 0 ? '#2a5c14' : '#555';
      const uniqueItems   = new Set(data.map(r => r._itemName)).size;
      const uniqueStores  = new Set(data.map(r => r._outlet || r._store)).size;
      kpiEl.style.display = '';
      kpiEl.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:4px">
        <div class="kpi-card" style="flex:1;min-width:160px;cursor:default">
          <div class="kpi-label">Total Stk Value (MRP)</div>
          <div class="kpi-val" style="color:${valCol(totalStkVal)}">₹${fmtVal(totalStkVal)}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:160px;cursor:default">
          <div class="kpi-label">Total Adj Qty</div>
          <div class="kpi-val" style="color:${valCol(totalAdjQty)}">${totalAdjQty.toLocaleString('en-IN')}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:160px;cursor:default">
          <div class="kpi-label">Total Records</div>
          <div class="kpi-val">${data.length.toLocaleString('en-IN')}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:160px;cursor:default">
          <div class="kpi-label">Unique Items</div>
          <div class="kpi-val">${uniqueItems}</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:160px;cursor:default">
          <div class="kpi-label">Stores Affected</div>
          <div class="kpi-val">${uniqueStores}</div>
        </div>
      </div>`;
    }
  }

  const el = document.getElementById('shortageAnalysis');
  const el2 = document.getElementById('shortageAnalysis2');
  if (!el || (!hasStkVal && !hasAdjQty) || !data.length) {
    if (el)  el.style.display  = 'none';
    if (el2) el2.style.display = 'none';
    return;
  }

  /* Item-wise analysis */
  if (hasItem) {
    const rows = _shortageGroup(data, r => r._itemName);
    const totalStkVal = rows.reduce((s,[,v])=>s+v.stkVal,0);
    const totalAdjQty = rows.reduce((s,[,v])=>s+v.adjQty,0);
    el.style.display = '';
    el.innerHTML = _shortageAnalysisTable('Item-wise Analysis — Stk Value (MRP) &amp; Adj Qty', rows, totalStkVal, totalAdjQty, 'Item Name');
  } else {
    el.style.display = 'none';
  }

  /* Cluster-wise & RM-wise side-by-side */
  if (el2) {
    el2.style.display = '';
    let panels = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">';

    const cmRows = _shortageGroup(data, r => r._cm !== '-' ? r._cm : '(Unassigned)');
    const cmTot  = cmRows.reduce((s,[,v])=>s+v.stkVal,0);
    const cmTotQ = cmRows.reduce((s,[,v])=>s+v.adjQty,0);
    panels += `<div>${_shortageAnalysisTable('Cluster-wise Breakdown', cmRows, cmTot, cmTotQ, 'Cluster Manager')}</div>`;

    const rmRows = _shortageGroup(data, r => r._rm !== '-' ? r._rm : '(Unassigned)');
    const rmTot  = rmRows.reduce((s,[,v])=>s+v.stkVal,0);
    const rmTotQ = rmRows.reduce((s,[,v])=>s+v.adjQty,0);
    panels += `<div>${_shortageAnalysisTable('RM-wise Breakdown', rmRows, rmTot, rmTotQ, 'Regional Manager')}</div>`;

    panels += '</div>';
    el2.innerHTML = panels;
  }
}

/* ============================================================
   AUDIT TYPES TAB — load from "Audit Types" sheet
   Filters: Date / Month / Quarter / Audit Type / RM Name
   Table columns: Outlet Name, Audit Type, Remarks

   Uses the gviz JSON endpoint (not CSV): the Remarks/Checklist cells
   contain line breaks and dirty characters that corrupt CSV parsing
   (header + first records collapse into one row). JSON is structured and
   immune to those in-cell line breaks / quotes / encoding issues.
   ============================================================ */
function toAuditJSONUrl(mainUrl) {
  const idMatch = mainUrl.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  return 'https://docs.google.com/spreadsheets/d/' + idMatch[1] +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent('Audit Types');
}

function showAuditStatus(msg, type) {
  const el = document.getElementById('auditStatus');
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

/* Clean up common UTF-8-read-as-Windows-1252 mojibake found in the sheet */
function fixMojibake(s) {
  return s
    .replace(/â€”/g, '—')  /* â€" → em dash */
    .replace(/â€“/g, '–')  /* â€" → en dash */
    .replace(/â€™/g, '’')  /* â€™ → ’        */
    .replace(/â€˜/g, '‘')  /* â€˜ → ‘        */
    .replace(/â€œ/g, '“')  /* â€œ → “        */
    .replace(/Â /g, ' ');            /* Â  → space     */
}

async function loadAuditSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showAuditStatus('Audit Types data requires a Google Sheet. Please load data via the Google Sheet tab first.', 'err');
    return;
  }
  const url = toAuditJSONUrl(raw);
  if (!url) return;
  showAuditStatus('Loading audit types…', '');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    /* gviz wraps the JSON in google.visualization.Query.setResponse(...) */
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const storeMap = {};
    activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
    auditData = parseAuditTable(json.table).map(r => ({
      ...r,
      rm: storeMap[r.outlet]?.rm || '-',
    }));
    rebuildAuditFilters();
    applyAuditFilters();
    showAuditStatus('', '');
  } catch (err) {
    showAuditStatus('&#10007; Could not load Audit Types sheet: ' + err.message, 'err');
  }
}

function parseAuditTable(table) {
  if (!table || !table.cols) return [];

  const norm = s => (s || '').toLowerCase().replace(/[\s%.]/g, '');
  const hdrs = table.cols.map(c => norm(c.label));

  /* Match by header label (exact, then contains); fall back to the known
     fixed column order if a label can't be matched. */
  function col(names, fallback) {
    for (const n of names) {
      let i = hdrs.indexOf(n);
      if (i !== -1) return i;
      i = hdrs.findIndex(h => h && (h.startsWith(n) || h.includes(n)));
      if (i !== -1) return i;
    }
    return fallback;
  }
  const iOutlet  = col(['outletname', 'outlet', 'outlets', 'store', 'storename'], 0);
  const iDate    = col(['date'], 1);
  const iMonth   = col(['month'], 2);
  const iQuarter = col(['quarter', 'qtr'], 3);
  const iType    = col(['audittype', 'type'], 4);
  const iChecklist = col(['checklistpoint', 'checklist', 'checkpoint', 'point'], 5);
  const iRemarks = col(['remarks', 'remark', 'observation', 'observations'], 6);

  const cell = (r, i) => {
    if (i < 0 || !r.c || !r.c[i]) return '-';
    const c = r.c[i];
    const v = (c.f != null ? c.f : c.v);
    if (v == null) return '-';
    return fixMojibake(String(v)).trim() || '-';
  };

  const rows = [];
  for (const r of (table.rows || [])) {
    const outlet = cell(r, iOutlet);
    const type   = cell(r, iType);
    const remarks = cell(r, iRemarks);
    if (outlet === '-' && type === '-' && remarks === '-') continue;  /* skip blanks */
    rows.push({
      outlet, type, remarks,
      checklist: cell(r, iChecklist),
      date:    cell(r, iDate),
      month:   cell(r, iMonth),
      quarter: cell(r, iQuarter),
    });
  }
  return rows;
}

function rebuildAuditFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('auditDateFilter',    [...new Set(auditData.map(r => r.date).filter(v => v !== '-'))]);
  rebuild('auditMonthFilter',   [...new Set(auditData.map(r => r.month).filter(v => v !== '-'))]);
  rebuild('auditQuarterFilter', [...new Set(auditData.map(r => r.quarter).filter(v => v !== '-'))]);
  rebuild('auditTypeFilter',    [...new Set(auditData.map(r => r.type).filter(v => v !== '-'))].sort());
  rebuild('auditRmFilter',      [...new Set(auditData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
}

function getFilteredAudit() {
  const date    = document.getElementById('auditDateFilter').value;
  const month   = document.getElementById('auditMonthFilter').value;
  const quarter = document.getElementById('auditQuarterFilter').value;
  const type    = document.getElementById('auditTypeFilter').value;
  const rm      = document.getElementById('auditRmFilter').value;
  return auditData.filter(r =>
    (date    === 'all' || r.date    === date)    &&
    (month   === 'all' || r.month   === month)   &&
    (quarter === 'all' || r.quarter === quarter) &&
    (type    === 'all' || r.type    === type)    &&
    (rm      === 'all' || r.rm      === rm)
  );
}

function applyAuditFilters() {
  renderAuditTable(getFilteredAudit());
}

function renderAuditTable(data) {
  document.getElementById('auditCount').textContent = data.length + ' rows';
  if (!data.length) {
    document.getElementById('auditBody').innerHTML =
      '<tr><td colspan="4"><div class="empty">No data matches the selected filters.</div></td></tr>';
    return;
  }
  document.getElementById('auditBody').innerHTML = data.map(r => `<tr>
      <td style="font-weight:600;white-space:nowrap">${r.outlet}</td>
      <td style="white-space:nowrap">${r.type}</td>
      <td>${r.checklist}</td>
      <td class="issues-obs">${r.remarks}</td>
    </tr>`).join('');
}

function exportAuditCSV() {
  const data = getFilteredAudit();
  if (!data.length) return;
  const headers = ['Outlet Name','Audit Type','Checklist Point','Remarks'];
  const rows = data.map(r =>
    [r.outlet, r.type, r.checklist, r.remarks]
      .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_audit_types_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

/* ============================================================
   CUSTOMER ENROLLMENT TAB
   Loads the "Customer Enrollment" sheet and shows each outlet's
   enrollment % month on month, filterable by RM / Cluster (CM) /
   Outlet / Market, with trend and RM-comparison charts.
   Accepts two sheet layouts:
     WIDE : Outlet | [Market] | Apr | May | Jun ...
     LONG : Outlet | [Market] | Month | Enrollment %
   ============================================================ */
let enrollTrendChartObj = null;
let enrollRmChartObj    = null;

const ENROLL_SHEET_NAMES = [
  'Customer Enrollment', 'Customer enrollment', 'customer enrollment',
  'CUSTOMER ENROLLMENT', 'Customer Enrolment', 'Customer enrolment',
  'Enrollment', 'Enrolment',
];
const ENROLL_MONTH_NAMES = ['january','february','march','april','may','june',
                            'july','august','september','october','november','december'];

/* "Apr", "April", "April 2026", "apr-25" → sortable key; 0 = not a month */
function enrollMonthKey(p) {
  const lower = (p || '').toString().toLowerCase().trim();
  const mi = ENROLL_MONTH_NAMES.findIndex(m => m.slice(0, 3) === lower.slice(0, 3));
  if (mi === -1) return 0;
  const y = (lower.match(/(\d{4})/) || [])[1];
  return (y ? parseInt(y) * 100 : 0) + mi + 1;
}

function toEnrollCSVUrl(mainUrl, sheetName) {
  const idMatch = mainUrl.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  return 'https://docs.google.com/spreadsheets/d/' + idMatch[1] +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName);
}

function showEnrollStatus(msg, type) {
  const el = document.getElementById('enrollStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadEnrollSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showEnrollStatus('Enrollment data requires a Google Sheet. Please load data via the Google Sheet tab first.', 'err');
    return;
  }
  showEnrollStatus('Loading customer enrollment data…', '');

  for (const name of ENROLL_SHEET_NAMES) {
    const csvUrl = toEnrollCSVUrl(raw, name);
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseEnrollCSV(text);
      if (!parsed.rows.length) continue;

      const storeMap = {};
      activeStores.forEach(s => {
        storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-', market: s.market || '-' };
      });
      enrollMonths = parsed.months;
      enrollData = parsed.rows.map(r => ({
        ...r,
        cm:     storeMap[r.outlet]?.cm || '-',
        rm:     storeMap[r.outlet]?.rm || '-',
        market: (r.market && r.market !== '-') ? r.market : (storeMap[r.outlet]?.market || '-'),
      }));
      rebuildEnrollFilters();
      applyEnrollFilters();
      showEnrollStatus('', '');
      return;
    } catch (_) { /* try the next candidate tab name */ }
  }
  showEnrollStatus('&#10007; Could not find a "Customer Enrollment" tab in the Google Sheet. ' +
    'Please check the tab name (tried: ' + ENROLL_SHEET_NAMES.slice(0, 4).join(', ') + '…).', 'err');
}

function parseEnrollCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return { rows: [], months: [] };

  const rawHdrs = allRows[0];
  const hdrs = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  let iOutlet = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  if (iOutlet === -1) iOutlet = 0; /* fall back to first column */
  const iMarket = col('market', 'marketname', 'markettype');
  const iMonth  = col('month', 'period', 'monthname');
  const iVal    = col('enrollment', 'enrolment', 'enrollmentpct', 'enrolmentpct',
                      'enrollmentpercentage', 'enrolmentpercentage', 'percentage', 'pct', 'value');

  const num = raw => {
    const v = parseFloat((raw || '').toString().replace(/[%,\s]/g, ''));
    return isNaN(v) ? null : v;
  };

  /* LONG layout: one row per outlet per month */
  if (iMonth !== -1 && iVal !== -1) {
    const map = {}, monthsSeen = {};
    for (let i = 1; i < allRows.length; i++) {
      const c = allRows[i];
      const outlet = (c[iOutlet] || '').trim();
      const month  = (c[iMonth]  || '').trim();
      if (!outlet || !month) continue;
      monthsSeen[month] = true;
      if (!map[outlet]) {
        map[outlet] = { outlet, market: iMarket !== -1 ? (c[iMarket] || '-') : '-', values: {} };
      }
      map[outlet].values[month] = num(c[iVal]);
    }
    const months = Object.keys(monthsSeen).sort((a, b) => enrollMonthKey(a) - enrollMonthKey(b));
    return { rows: Object.values(map), months };
  }

  /* WIDE layout: month columns across the header */
  const monthCols = [];
  rawHdrs.forEach((h, i) => {
    if (i === iOutlet || i === iMarket) return;
    if (enrollMonthKey(h) > 0) monthCols.push({ i, label: h.trim() });
  });
  if (!monthCols.length) return { rows: [], months: [] };

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = (c[iOutlet] || '').trim();
    if (!outlet) continue;
    const values = {};
    monthCols.forEach(mc => { values[mc.label] = num(c[mc.i]); });
    rows.push({ outlet, market: iMarket !== -1 ? (c[iMarket] || '-') : '-', values });
  }
  return { rows, months: monthCols.map(mc => mc.label) };
}

function rebuildEnrollFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('enrollRmFilter',     [...new Set(enrollData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
  rebuild('enrollCmFilter',     [...new Set(enrollData.map(r => r.cm).filter(v => v && v !== '-'))].sort());
  rebuild('enrollOutletFilter', [...new Set(enrollData.map(r => r.outlet))].sort());
  rebuild('enrollMarketFilter', [...new Set(enrollData.map(r => r.market).filter(v => v && v !== '-'))].sort());
}

function getFilteredEnroll() {
  const rm     = document.getElementById('enrollRmFilter').value;
  const cm     = document.getElementById('enrollCmFilter').value;
  const outlet = document.getElementById('enrollOutletFilter').value;
  const market = document.getElementById('enrollMarketFilter').value;
  return enrollData.filter(r =>
    (rm     === 'all' || r.rm     === rm)     &&
    (cm     === 'all' || r.cm     === cm)     &&
    (outlet === 'all' || r.outlet === outlet) &&
    (market === 'all' || r.market === market)
  ).sort((a, b) => a.outlet.localeCompare(b.outlet));
}

function applyEnrollFilters() {
  const data = getFilteredEnroll();
  renderEnrollCharts(data);
  renderEnrollTable(data);
}

function renderEnrollTable(data) {
  const head  = document.getElementById('enrollHeadRow');
  const body  = document.getElementById('enrollBody');
  const count = document.getElementById('enrollCount');
  if (!head || !body) return;
  count.textContent = data.length ? data.length + ' outlets' : '';

  head.innerHTML = '<th>Outlet Name</th><th>Market</th><th>Cluster (CM)</th><th>RM Name</th>' +
    enrollMonths.map(m => `<th>${m}</th>`).join('');

  if (!data.length) {
    body.innerHTML = `<tr><td colspan="${4 + enrollMonths.length}">` +
      '<div class="empty">No enrollment data matches the selected filters.</div></td></tr>';
    return;
  }

  body.innerHTML = data.map(r => {
    const cells = enrollMonths.map((m, idx) => {
      const v = r.values[m];
      if (v === null || v === undefined) return '<td style="color:#aaa">-</td>';
      /* month-on-month delta vs the previous month that has a value */
      let delta = '';
      for (let j = idx - 1; j >= 0; j--) {
        const pv = r.values[enrollMonths[j]];
        if (pv !== null && pv !== undefined) {
          const d     = v - pv;
          const color = d >= 0 ? '#2a5c14' : '#a32d2d';
          const arrow = d >= 0 ? '&#9650;' : '&#9660;';
          delta = ` <span style="color:${color};font-size:11px">${arrow}${Math.abs(d).toFixed(1)}</span>`;
          break;
        }
      }
      return `<td style="font-weight:600">${v.toFixed(1)}%${delta}</td>`;
    }).join('');
    return `<tr>
      <td>${r.outlet}</td>
      <td style="color:#6b6b68">${r.market || '-'}</td>
      <td style="color:#6b6b68">${r.cm || '-'}</td>
      <td style="color:#6b6b68">${r.rm || '-'}</td>
      ${cells}
    </tr>`;
  }).join('');
}

function renderEnrollCharts(data) {
  const trendEl = document.getElementById('enrollTrendChart');
  const rmEl    = document.getElementById('enrollRmChart');
  if (!trendEl || !rmEl) return;

  /* Trend: average enrollment % per month across the filtered outlets */
  const avgs = enrollMonths.map(m => {
    let sum = 0, n = 0;
    data.forEach(r => {
      const v = r.values[m];
      if (v !== null && v !== undefined) { sum += v; n++; }
    });
    return n ? parseFloat((sum / n).toFixed(2)) : null;
  });

  if (enrollTrendChartObj) { enrollTrendChartObj.destroy(); enrollTrendChartObj = null; }
  enrollTrendChartObj = new Chart(trendEl, {
    type: 'line',
    data: {
      labels: enrollMonths,
      datasets: [{
        label: 'Avg enrollment %',
        data: avgs,
        borderColor: '#4a7fcb',
        backgroundColor: 'rgba(74,127,203,0.12)',
        fill: true,
        tension: 0.3,
        spanGaps: true,
        pointRadius: 4,
        pointBackgroundColor: '#4a7fcb',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  /* Latest month: average enrollment % by RM */
  const latest = enrollMonths[enrollMonths.length - 1];
  const lbl = document.getElementById('enrollRmChartLabel');
  if (lbl) lbl.innerHTML = 'Avg enrollment % by RM &mdash; ' + (latest || 'latest month');

  const rmMap = {};
  data.forEach(r => {
    const v = r.values[latest];
    if (v === null || v === undefined) return;
    const rm = r.rm && r.rm !== '-' ? r.rm : 'Unassigned';
    if (!rmMap[rm]) rmMap[rm] = { sum: 0, n: 0 };
    rmMap[rm].sum += v;
    rmMap[rm].n   += 1;
  });
  const labels  = Object.keys(rmMap)
    .sort((a, b) => rmMap[b].sum / rmMap[b].n - rmMap[a].sum / rmMap[a].n);
  const vals    = labels.map(rm => parseFloat((rmMap[rm].sum / rmMap[rm].n).toFixed(2)));
  const palette = ['#4a7fcb','#ef9f27','#e24b4a','#639922','#9b59b6',
                   '#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];

  if (enrollRmChartObj) { enrollRmChartObj.destroy(); enrollRmChartObj = null; }
  enrollRmChartObj = new Chart(rmEl, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg enrollment %',
        data: vals,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderWidth: 0,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });
}

function exportEnrollCSV() {
  const data = getFilteredEnroll();
  if (!data.length) return;
  const headers = ['Outlet Name', 'Market', 'Cluster (CM)', 'RM Name', ...enrollMonths];
  const rows = data.map(r => [
    r.outlet, r.market || '-', r.cm || '-', r.rm || '-',
    ...enrollMonths.map(m => {
      const v = r.values[m];
      return (v === null || v === undefined) ? '-' : v.toFixed(1) + '%';
    }),
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_customer_enrollment_' + date + '.csv';
  a.click();
}

/* ============================================================
   OPERATION SCORECARD TAB
   Loads the "Operation scorecard" sheet and shows each store's
   scorecard % month on month, filterable by RM / Cluster (CM) /
   Outlet, with cluster-wise and RM-wise average score charts.
   Accepts two sheet layouts:
     WIDE : Outlet | Apr | May | Jun ...
     LONG : Outlet | Month | Score %
   ============================================================ */
let opsScCmChartObj = null;
let opsScRmChartObj = null;

const OPSSC_SHEET_NAMES = [
  'Operation scorecard', 'Operation Scorecard', 'operation scorecard',
  'OPERATION SCORECARD', 'Operations scorecard', 'Operations Scorecard',
  'Operation score card', 'Ops scorecard', 'Ops Scorecard',
];

function showOpsScStatus(msg, type) {
  const el = document.getElementById('opsScStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadOpsScSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showOpsScStatus('Operation scorecard data requires a Google Sheet. Please load data via the Google Sheet tab first.', 'err');
    return;
  }
  showOpsScStatus('Loading operation scorecard data…', '');

  for (const name of OPSSC_SHEET_NAMES) {
    const csvUrl = toEnrollCSVUrl(raw, name); /* same gviz-by-sheet-name URL builder */
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseOpsScCSV(text);
      if (!parsed.rows.length) continue;

      const storeMap = {};
      activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
      opsScMonths = parsed.months;
      opsScData = parsed.rows.map(r => ({
        ...r,
        cm: (r.cm && r.cm !== '-') ? r.cm : (storeMap[r.outlet]?.cm || '-'),
        rm: (r.rm && r.rm !== '-') ? r.rm : (storeMap[r.outlet]?.rm || '-'),
      }));
      rebuildOpsScFilters();
      applyOpsScFilters();
      showOpsScStatus('', '');
      return;
    } catch (_) { /* try the next candidate tab name */ }
  }
  showOpsScStatus('&#10007; Could not find an "Operation scorecard" tab in the Google Sheet. ' +
    'Please check the tab name (tried: ' + OPSSC_SHEET_NAMES.slice(0, 4).join(', ') + '…).', 'err');
}

/* Score values: "85%", "85", or fraction "0.85" → 85 */
function opsScNum(raw) {
  const s = (raw || '').toString().trim();
  if (!s || s === '-') return null;
  const v = parseFloat(s.replace(/[%,\s]/g, ''));
  if (isNaN(v)) return null;
  return (!s.includes('%') && v > 0 && v <= 1) ? v * 100 : v;
}

function parseOpsScCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return { rows: [], months: [] };

  const rawHdrs = allRows[0];
  const hdrs = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  let iOutlet = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  if (iOutlet === -1) iOutlet = 0; /* fall back to first column */
  const iCM    = col('cmname', 'cm', 'clustermanager', 'cluster');
  const iRM    = col('rmname', 'rm', 'regionalmanager');
  const iMonth = col('month', 'period', 'monthname');
  const iVal   = col('score', 'scorepct', 'scorecard', 'opsscore', 'opscore',
                     'operationscorecard', 'operationsscorecard', 'operationscore',
                     'operationsscore', 'percentage', 'pct', 'value');

  /* LONG layout: one row per store per month */
  if (iMonth !== -1 && iVal !== -1) {
    const map = {}, monthsSeen = {};
    for (let i = 1; i < allRows.length; i++) {
      const c = allRows[i];
      const outlet = (c[iOutlet] || '').trim();
      const month  = (c[iMonth]  || '').trim();
      if (!outlet || !month) continue;
      const v = opsScNum(c[iVal]);
      monthsSeen[month] = true;
      if (!map[outlet]) {
        map[outlet] = {
          outlet,
          cm: iCM !== -1 ? (c[iCM] || '-') : '-',
          rm: iRM !== -1 ? (c[iRM] || '-') : '-',
          values: {},
        };
      }
      if (v !== null || map[outlet].values[month] === undefined) map[outlet].values[month] = v;
    }
    const months = Object.keys(monthsSeen).sort((a, b) => enrollMonthKey(a) - enrollMonthKey(b));
    return { rows: Object.values(map), months };
  }

  /* WIDE layout: month columns across the header */
  const monthCols = [];
  rawHdrs.forEach((h, i) => {
    if (i === iOutlet || i === iCM || i === iRM) return;
    if (enrollMonthKey(h) > 0) monthCols.push({ i, label: h.trim() });
  });
  if (!monthCols.length) return { rows: [], months: [] };

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = (c[iOutlet] || '').trim();
    if (!outlet) continue;
    const values = {};
    monthCols.forEach(mc => { values[mc.label] = opsScNum(c[mc.i]); });
    rows.push({
      outlet,
      cm: iCM !== -1 ? (c[iCM] || '-') : '-',
      rm: iRM !== -1 ? (c[iRM] || '-') : '-',
      values,
    });
  }
  return { rows, months: monthCols.map(mc => mc.label) };
}

function rebuildOpsScFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('opsScRmFilter',     [...new Set(opsScData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
  rebuild('opsScCmFilter',     [...new Set(opsScData.map(r => r.cm).filter(v => v && v !== '-'))].sort());
  rebuild('opsScOutletFilter', [...new Set(opsScData.map(r => r.outlet))].sort());

  const monthSel = document.getElementById('opsScMonthFilter');
  if (monthSel) {
    const cur = monthSel.value;
    monthSel.innerHTML = '<option value="latest">Latest</option>' +
      [...opsScMonths].reverse().map(m => `<option value="${m}">${m}</option>`).join('');
    if (opsScMonths.includes(cur)) monthSel.value = cur;
  }
}

function getFilteredOpsSc() {
  const rm     = document.getElementById('opsScRmFilter').value;
  const cm     = document.getElementById('opsScCmFilter').value;
  const outlet = document.getElementById('opsScOutletFilter').value;
  return opsScData.filter(r =>
    (rm     === 'all' || r.rm     === rm)     &&
    (cm     === 'all' || r.cm     === cm)     &&
    (outlet === 'all' || r.outlet === outlet)
  ).sort((a, b) => a.outlet.localeCompare(b.outlet));
}

function applyOpsScFilters() {
  const data = getFilteredOpsSc();
  renderOpsScCharts(data);
  renderOpsScTable(data);
}

/* Colour by the same thresholds as risk scoring: >=90 green, 80–89 amber, <80 red */
function opsScColor(v) {
  return v >= 90 ? '#2a5c14' : v >= 80 ? '#854f0b' : '#a32d2d';
}

function renderOpsScTable(data) {
  const head  = document.getElementById('opsScHeadRow');
  const body  = document.getElementById('opsScBody');
  const count = document.getElementById('opsScCount');
  if (!head || !body) return;
  count.textContent = data.length ? data.length + ' stores' : '';

  head.innerHTML = '<th>Store Name</th><th>Cluster (CM)</th><th>RM Name</th>' +
    opsScMonths.map(m => `<th>${m}</th>`).join('');

  if (!data.length) {
    body.innerHTML = `<tr><td colspan="${3 + opsScMonths.length}">` +
      '<div class="empty">No operation scorecard data matches the selected filters.</div></td></tr>';
    return;
  }

  body.innerHTML = data.map(r => {
    const cells = opsScMonths.map((m, idx) => {
      const v = r.values[m];
      if (v === null || v === undefined) return '<td style="color:#aaa">-</td>';
      /* month-on-month delta vs the previous month that has a value */
      let delta = '';
      for (let j = idx - 1; j >= 0; j--) {
        const pv = r.values[opsScMonths[j]];
        if (pv !== null && pv !== undefined) {
          const d     = v - pv;
          const color = d >= 0 ? '#2a5c14' : '#a32d2d';
          const arrow = d >= 0 ? '&#9650;' : '&#9660;';
          delta = ` <span style="color:${color};font-size:11px">${arrow}${Math.abs(d).toFixed(1)}</span>`;
          break;
        }
      }
      return `<td style="font-weight:600;color:${opsScColor(v)}">${v.toFixed(1)}%${delta}</td>`;
    }).join('');
    return `<tr>
      <td style="font-weight:600">${r.outlet}</td>
      <td style="color:#6b6b68">${r.cm || '-'}</td>
      <td style="color:#6b6b68">${r.rm || '-'}</td>
      ${cells}
    </tr>`;
  }).join('');
}

function renderOpsScCharts(data) {
  const cmEl = document.getElementById('opsScCmChart');
  const rmEl = document.getElementById('opsScRmChart');
  if (!cmEl || !rmEl) return;

  const sel   = document.getElementById('opsScMonthFilter');
  const pick  = sel && sel.value !== 'latest' && opsScMonths.includes(sel.value)
    ? sel.value : opsScMonths[opsScMonths.length - 1];

  const cmLbl = document.getElementById('opsScCmChartLabel');
  if (cmLbl) cmLbl.innerHTML = 'Avg scorecard % by Cluster (CM) &mdash; ' + (pick || 'latest month');
  const rmLbl = document.getElementById('opsScRmChartLabel');
  if (rmLbl) rmLbl.innerHTML = 'Avg scorecard % by RM &mdash; ' + (pick || 'latest month');

  function groupAvg(keyFn) {
    const map = {};
    data.forEach(r => {
      const v = r.values[pick];
      if (v === null || v === undefined) return;
      const key = keyFn(r);
      if (!map[key]) map[key] = { sum: 0, n: 0 };
      map[key].sum += v;
      map[key].n   += 1;
    });
    const labels = Object.keys(map).sort((a, b) => map[b].sum / map[b].n - map[a].sum / map[a].n);
    const vals   = labels.map(k => parseFloat((map[k].sum / map[k].n).toFixed(2)));
    return { labels, vals };
  }

  function barChart(el, existing, group) {
    if (existing) existing.destroy();
    return new Chart(el, {
      type: 'bar',
      data: {
        labels: group.labels,
        datasets: [{
          label: 'Avg scorecard %',
          data: group.vals,
          backgroundColor: group.vals.map(opsScColor),
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y: { ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  opsScCmChartObj = barChart(cmEl, opsScCmChartObj, groupAvg(r => r.cm && r.cm !== '-' ? r.cm : 'Unassigned'));
  opsScRmChartObj = barChart(rmEl, opsScRmChartObj, groupAvg(r => r.rm && r.rm !== '-' ? r.rm : 'Unassigned'));
}

function exportOpsScCSV() {
  const data = getFilteredOpsSc();
  if (!data.length) return;
  const headers = ['Store Name', 'Cluster (CM)', 'RM Name', ...opsScMonths];
  const rows = data.map(r => [
    r.outlet, r.cm || '-', r.rm || '-',
    ...opsScMonths.map(m => {
      const v = r.values[m];
      return (v === null || v === undefined) ? '-' : v.toFixed(1) + '%';
    }),
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_operation_scorecard_' + date + '.csv';
  a.click();
}

/* ============================================================
   CUSTOMER EXCELLENCE SCORECARD
   ============================================================ */
const EXCEL_SHEET_NAMES = [
  'Customer Excellence Scorecard', 'Customer excellence scorecard',
  'customer excellence scorecard', 'CUSTOMER EXCELLENCE SCORECARD',
  'Excellence Scorecard', 'Excellence scorecard',
];

const EXCEL_ISSUES_SHEET_NAMES = [
  'Customer Handling Issue', 'Customer handling issue',
  'customer handling issue', 'CUSTOMER HANDLING ISSUE',
  'Handling Issue', 'Customer Issues', 'Issues',
];

const EXCEL_AUDIT_SHEET_NAMES = [
  'Audit Clause', 'Audit clause', 'audit clause',
  'AUDIT CLAUSE', 'Audit', 'Audit Clauses', 'Audit clauses',
];

function showExcelStatus(msg, type) {
  const el = document.getElementById('excelStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'upload-status' + (type ? ' ' + type : '');
}

async function loadExcelSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) {
    showExcelStatus('Customer excellence scorecard data requires a Google Sheet. Please load data via the Google Sheet tab first.', 'err');
    return;
  }
  showExcelStatus('Loading customer excellence scorecard data…', '');

  for (const name of EXCEL_SHEET_NAMES) {
    const csvUrl = toEnrollCSVUrl(raw, name);
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseExcelCSV(text);
      if (!parsed.rows.length) continue;

      const storeMap = {};
      activeStores.forEach(s => { storeMap[s.store] = { cm: s.cm || '-', rm: s.rm || '-' }; });
      excelMonths = parsed.months;
      excelData = parsed.rows.map(r => ({
        ...r,
        cm: (r.cm && r.cm !== '-') ? r.cm : (storeMap[r.outlet]?.cm || '-'),
        rm: (r.rm && r.rm !== '-') ? r.rm : (storeMap[r.outlet]?.rm || '-'),
      }));
      rebuildExcelFilters();
      applyExcelFilters();
      loadExcelIssuesSheet();
      loadExcelAuditSheet();
      showExcelStatus('', '');
      return;
    } catch (_) { /* try the next candidate tab name */ }
  }
  showExcelStatus('&#10007; Could not find a "Customer Excellence Scorecard" tab in the Google Sheet. ' +
    'Please check the tab name (tried: ' + EXCEL_SHEET_NAMES.slice(0, 3).join(', ') + '…).', 'err');
}

async function loadExcelIssuesSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) return;

  for (const name of EXCEL_ISSUES_SHEET_NAMES) {
    const csvUrl = toEnrollCSVUrl(raw, name);
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseExcelIssuesCSV(text);
      if (!parsed.length) continue;

      excelIssuesData = parsed;
      return;
    } catch (_) { /* try the next candidate tab name */ }
  }
}

function parseExcelIssuesCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return [];

  const rawHdrs = allRows[0];
  const hdrs = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.,]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  let iOutlet = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  if (iOutlet === -1) iOutlet = 0;
  const iIssue    = col('issue', 'issuedescription', 'description', 'observation', 'remarks');
  const iCategory = col('category', 'type', 'issuetype', 'issuecategory');
  const iDate     = col('date', 'dateidentified', 'reporteddate');
  const iStatus   = col('status', 'issuestatus');

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = (c[iOutlet] || '').trim();
    if (!outlet) continue;

    rows.push({
      outlet,
      issue: iIssue !== -1 ? (c[iIssue] || '') : '',
      category: iCategory !== -1 ? (c[iCategory] || '') : '',
      date: iDate !== -1 ? (c[iDate] || '') : '',
      status: iStatus !== -1 ? (c[iStatus] || '') : '',
    });
  }

  return rows;
}

async function loadExcelAuditSheet() {
  const raw = document.getElementById('sheetUrl').value.trim();
  if (!raw) return;

  for (const name of EXCEL_AUDIT_SHEET_NAMES) {
    const csvUrl = toEnrollCSVUrl(raw, name);
    if (!csvUrl) return;
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseExcelAuditCSV(text);
      if (!parsed.length) continue;

      excelAuditData = parsed;
      return;
    } catch (_) { /* try the next candidate tab name */ }
  }
}

function parseExcelAuditCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return [];

  const rawHdrs = allRows[0];
  const hdrs = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.,]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  let iOutlet = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  if (iOutlet === -1) iOutlet = 0;
  const iClause   = col('auditclause', 'clause', 'observation', 'checkpoint', 'requirement');
  const iScore    = col('score', 'scorepct', 'scorecard', 'rating', 'status');
  const iRemarks  = col('remarks', 'comments', 'notes', 'observation');

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = (c[iOutlet] || '').trim();
    if (!outlet) continue;

    rows.push({
      outlet,
      clause: iClause !== -1 ? (c[iClause] || '') : '',
      score: iScore !== -1 ? (c[iScore] || '') : '',
      remarks: iRemarks !== -1 ? (c[iRemarks] || '') : '',
    });
  }

  return rows;
}

function excelScNum(raw) {
  const s = (raw || '').toString().trim();
  if (!s || s === '-') return null;
  const v = parseFloat(s.replace(/[%,\s]/g, ''));
  if (isNaN(v)) return null;
  return (!s.includes('%') && v > 0 && v <= 1) ? v * 100 : v;
}

function parseExcelCSV(text) {
  const allRows = parseFullCSV(text);
  if (allRows.length < 2) return { rows: [], months: [] };

  const rawHdrs = allRows[0];
  const hdrs = rawHdrs.map(h => h.toLowerCase().replace(/[\s%.]/g, ''));

  function col(...names) {
    for (const n of names) { const i = hdrs.indexOf(n); if (i !== -1) return i; }
    return -1;
  }

  let iOutlet = col('outletname', 'outlet', 'outlets', 'store', 'storename');
  if (iOutlet === -1) iOutlet = 0;
  const iCM    = col('cmname', 'cm', 'clustermanager', 'cluster');
  const iRM    = col('rmname', 'rm', 'regionalmanager');
  const iMonth = col('month', 'period', 'monthname');
  const iVal   = col('score', 'scorepct', 'scorecard', 'excellencescore', 'excellencescorecard',
                     'customerexcellence', 'excellence', 'percentage', 'pct', 'value');

  /* LONG layout: one row per store per month */
  if (iMonth !== -1 && iVal !== -1) {
    const map = {}, monthsSeen = {};
    for (let i = 1; i < allRows.length; i++) {
      const c = allRows[i];
      const outlet = (c[iOutlet] || '').trim();
      const month  = (c[iMonth]  || '').trim();
      if (!outlet || !month) continue;
      const v = excelScNum(c[iVal]);
      monthsSeen[month] = true;
      if (!map[outlet]) {
        map[outlet] = {
          outlet,
          cm: iCM !== -1 ? (c[iCM] || '-') : '-',
          rm: iRM !== -1 ? (c[iRM] || '-') : '-',
          values: {},
        };
      }
      if (v !== null || map[outlet].values[month] === undefined) map[outlet].values[month] = v;
    }
    const months = Object.keys(monthsSeen).sort((a, b) => enrollMonthKey(a) - enrollMonthKey(b));
    return { rows: Object.values(map), months };
  }

  /* WIDE layout: month columns across the header */
  const monthCols = [];
  rawHdrs.forEach((h, i) => {
    if (i === iOutlet || i === iCM || i === iRM) return;
    if (enrollMonthKey(h) > 0) monthCols.push({ i, label: h.trim() });
  });
  if (!monthCols.length) return { rows: [], months: [] };

  const rows = [];
  for (let i = 1; i < allRows.length; i++) {
    const c = allRows[i];
    const outlet = (c[iOutlet] || '').trim();
    if (!outlet) continue;
    const values = {};
    monthCols.forEach(mc => { values[mc.label] = excelScNum(c[mc.i]); });
    rows.push({
      outlet,
      cm: iCM !== -1 ? (c[iCM] || '-') : '-',
      rm: iRM !== -1 ? (c[iRM] || '-') : '-',
      values,
    });
  }
  return { rows, months: monthCols.map(mc => mc.label) };
}

function rebuildExcelFilters() {
  function rebuild(id, values) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All</option>' +
      values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  rebuild('excelRmFilter',     [...new Set(excelData.map(r => r.rm).filter(v => v && v !== '-'))].sort());
  rebuild('excelCmFilter',     [...new Set(excelData.map(r => r.cm).filter(v => v && v !== '-'))].sort());
  rebuild('excelOutletFilter', [...new Set(excelData.map(r => r.outlet))].sort());

  const monthSel = document.getElementById('excelMonthFilter');
  if (monthSel) {
    const cur = monthSel.value;
    monthSel.innerHTML = '<option value="latest">Latest</option>' +
      [...excelMonths].reverse().map(m => `<option value="${m}">${m}</option>`).join('');
    if (excelMonths.includes(cur)) monthSel.value = cur;
  }
}

function getScoreRange(value) {
  if (value === null || value === undefined) return null;
  if (value >= 90) return 'green';
  if (value >= 80) return 'yellow';
  return 'red';
}

function getFilteredExcel() {
  const rm        = document.getElementById('excelRmFilter').value;
  const cm        = document.getElementById('excelCmFilter').value;
  const outlet    = document.getElementById('excelOutletFilter').value;
  const scoreFilter = document.getElementById('excelScoreFilter').value;
  const month = document.getElementById('excelMonthFilter').value;
  const targetMonth = month === 'latest' ? excelMonths[excelMonths.length - 1] : month;

  return excelData.filter(r => {
    if (rm !== 'all' && r.rm !== rm) return false;
    if (cm !== 'all' && r.cm !== cm) return false;
    if (outlet !== 'all' && r.outlet !== outlet) return false;

    if (scoreFilter !== 'all') {
      const v = r.values[targetMonth];
      const range = getScoreRange(v);
      if (range !== scoreFilter) return false;
    }

    return true;
  }).sort((a, b) => a.outlet.localeCompare(b.outlet));
}

function applyExcelFilters() {
  const data = getFilteredExcel();
  renderExcelTable(data);
  renderExcelCharts(data);
}

function excelScColor(v) {
  return v >= 90 ? '#2a5c14' : v >= 80 ? '#854f0b' : '#a32d2d';
}

function getScoreColor(value) {
  if (value === null || value === undefined) return '';
  return `background:${excelScColor(value)}22;color:${excelScColor(value)};font-weight:600;`;
}

function toggleExcelIssues(storeName, el) {
  const tr = el.closest('tr');
  const next = tr.nextElementSibling;

  if (next && next.classList.contains('excel-issues-row') && next.dataset.store === storeName) {
    next.remove();
    el.innerHTML = '▶ ' + storeName;
    el.classList.remove('store-link-open');
    return;
  }

  const issues = excelIssuesData.filter(issue => issue.outlet === storeName);
  const audits = excelAuditData.filter(audit => audit.outlet === storeName);

  const issuesHtml = issues.length ?
    `<div style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px;color:#2a5c14;padding:8px;background:#d4edda;border-radius:3px">📋 Customer Handling Issues (${issues.length})</div>
      ${issues.map(issue => `
        <div style="margin-bottom:8px;padding:10px;background:#fff;border-radius:3px;border-left:3px solid #7cb342">
          <div><strong>Issue:</strong> ${issue.issue || '-'}</div>
          ${issue.category ? `<div style="font-size:12px;color:#666"><strong>Category:</strong> ${issue.category}</div>` : ''}
          ${issue.date ? `<div style="font-size:12px;color:#666"><strong>Date:</strong> ${issue.date}</div>` : ''}
          ${issue.status ? `<div style="font-size:12px;color:#666"><strong>Status:</strong> ${issue.status}</div>` : ''}
        </div>
      `).join('')}
    </div>` :
    '<div style="margin-bottom:16px;padding:12px;background:#f9f9f7;color:#999;font-style:italic">No customer handling issues recorded</div>';

  const auditsHtml = audits.length ?
    `<div>
      <div style="font-weight:600;margin-bottom:8px;color:#2a5c14;padding:8px;background:#d4edda;border-radius:3px">✅ Audit Clauses (${audits.length})</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f5f5f5;border-bottom:1px solid #ddd">
            <th style="padding:8px;text-align:left;border-right:1px solid #ddd"><strong>Audit Clause</strong></th>
            <th style="padding:8px;text-align:center;width:100px;border-right:1px solid #ddd"><strong>Score</strong></th>
            <th style="padding:8px;text-align:left"><strong>Remarks</strong></th>
          </tr>
        </thead>
        <tbody>
          ${audits.map(audit => `
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:8px;border-right:1px solid #eee">${audit.clause || '-'}</td>
              <td style="padding:8px;text-align:center;border-right:1px solid #eee;font-weight:600;color:${
                audit.score.toLowerCase().includes('average') ? '#854f0b' :
                audit.score.toLowerCase().includes('not following') ? '#a32d2d' : '#666'
              }">${audit.score || '-'}</td>
              <td style="padding:8px">${audit.remarks || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` :
    '<div style="padding:12px;background:#f9f9f7;color:#999;font-style:italic">No audit clauses recorded</div>';

  const expandRow = document.createElement('tr');
  expandRow.className = 'excel-issues-row';
  expandRow.dataset.store = storeName;
  const monthCount = el.closest('tr').querySelectorAll('td').length - 3;
  expandRow.innerHTML = `<td colspan="${monthCount + 3}" style="padding:16px;border:none;background:#f9f9f7">${issuesHtml}${auditsHtml}</td>`;
  tr.insertAdjacentElement('afterend', expandRow);

  el.innerHTML = '▼ ' + storeName;
  el.classList.add('store-link-open');
}

function renderExcelTable(data) {
  const headRow = document.getElementById('excelHeadRow');
  const body = document.getElementById('excelBody');
  if (!headRow || !body) return;

  const month = document.getElementById('excelMonthFilter').value;
  const displayMonth = month === 'latest' ? (excelMonths[excelMonths.length - 1] || '') : month;
  const months = month === 'latest' ? excelMonths : [month];

  /* Build header */
  headRow.innerHTML = '<th>Store Name</th><th>Cluster (CM)</th><th>RM Name</th>' +
    months.map(m => `<th>${m}</th>`).join('') +
    (month === 'latest' ? '' : '');

  /* Build rows */
  body.innerHTML = data.map(r => {
    const cells = [
      `<td><span class="store-link" onclick="toggleExcelIssues('${r.outlet.replace(/'/g, "\\'")}', this)" style="cursor:pointer;color:#0066cc;text-decoration:underline">▶ ${r.outlet}</span></td>`,
      `<td>${r.cm || '-'}</td>`,
      `<td>${r.rm || '-'}</td>`,
      ...months.map(m => {
        const v = r.values[m];
        const html = (v === null || v === undefined) ? '-' : v.toFixed(1) + '%';
        const style = getScoreColor(v);
        return `<td style="${style}">${html}</td>`;
      }),
    ];
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  document.getElementById('excelCount').textContent = data.length + ' outlet' + (data.length !== 1 ? 's' : '');
}

function renderExcelCharts(data) {
  const month = document.getElementById('excelMonthFilter').value;
  const displayMonth = month === 'latest' ? (excelMonths[excelMonths.length - 1] || 'latest') : month;

  document.getElementById('excelCmChartLabel').textContent = `Avg scorecard % by Cluster (CM) — ${displayMonth}`;
  document.getElementById('excelRmChartLabel').textContent = `Avg scorecard % by RM — ${displayMonth}`;

  const cmEl = document.getElementById('excelCmChart');
  const rmEl = document.getElementById('excelRmChart');
  if (!cmEl || !rmEl) return;

  function barChart(el, chartObj, grouping) {
    const groups = {};
    data.forEach(r => {
      const key = grouping(r);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const labels = Object.keys(groups).sort();
    const vals = labels.map(label => {
      const rows = groups[label];
      let total = 0, count = 0;
      rows.forEach(r => {
        const v = month === 'latest' ? r.values[excelMonths[excelMonths.length - 1]] : r.values[month];
        if (v !== null && v !== undefined) { total += v; count++; }
      });
      return count ? total / count : 0;
    });

    if (chartObj) chartObj.destroy();
    chartObj = new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Avg Scorecard %',
          data: vals,
          backgroundColor: '#7cb342',
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
          y: { ticks: { font: { size: 11 } } },
        },
      },
    });
    return chartObj;
  }

  excelCmChart = barChart(cmEl, excelCmChart, r => r.cm && r.cm !== '-' ? r.cm : 'Unassigned');
  excelRmChart = barChart(rmEl, excelRmChart, r => r.rm && r.rm !== '-' ? r.rm : 'Unassigned');
}

function exportExcelCSV() {
  const data = getFilteredExcel();
  if (!data.length) return;
  const headers = ['Store Name', 'Cluster (CM)', 'RM Name', ...excelMonths];
  const rows = data.map(r => [
    r.outlet, r.cm || '-', r.rm || '-',
    ...excelMonths.map(m => {
      const v = r.values[m];
      return (v === null || v === undefined) ? '-' : v.toFixed(1) + '%';
    }),
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_customer_excellence_scorecard_' + date + '.csv';
  a.click();
}
