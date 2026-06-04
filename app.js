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
let shortageHeaders = [];
let shortageColIdx  = { iItemName: -1, iStkVal: -1, iAdjQty: -1 };
let bChart = null;
let pChart = null;
let rmChart = null;
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

  const iStore  = col(['store', 'storename']);
  const iRegion = col(['region']);
  const iCM     = col(['cmname', 'cm', 'clustermanager', 'cmname']);
  const iRM     = col(['rmname', 'rm', 'regionalmanager', 'rmname']);
  const iMonth  = col(['month', 'monthname']);
  /* Accept "Shrinakge" typo from real sheet alongside correct spelling */
  const iShrink = col(['shrinkage', 'shrinkage%', 'shrinkagepct', 'shrinakge', 'shrinakge%']);
  const iOps    = col(['opsscore', 'opscore', 'operationsscore', 'operationscore', 'operationscorecard', 'opsscore%']);
  /* Accept "Fraud Red flags" column from real sheet */
  const iFraud  = col(['fraud', 'fraudredflags', 'fraudredflag', 'fraudredflag(s)']);

  const missing = [
    ['Store', iStore],
    ['Shrinkage / Shrinakge', iShrink],
    ['OpsScore / Operation Scorecard', iOps],
  ].filter(([, v]) => v === -1).map(([k]) => k);

  if (missing.length) {
    throw new Error('Column(s) not found: ' + missing.join(', ') + '. Please check header names match the template.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map(x => x.trim());
    if (c.length < 3) continue;

    const storeName = c[iStore] || 'Store ' + i;
    const region    = (iRegion !== -1 && c[iRegion] && c[iRegion] !== '-')
      ? c[iRegion] : storeCodeToRegion(storeName);
    const cm    = iCM    !== -1 ? (c[iCM]    || '-') : '-';
    const rm    = iRM    !== -1 ? (c[iRM]    || '-') : '-';
    const month = iMonth !== -1 ? (c[iMonth] || '-') : '-';

    const shRaw = (c[iShrink] || '').replace(/\s/g, '');
    const opRaw = (c[iOps]    || '').replace(/\s/g, '');

    const fraudRaw = (iFraud !== -1 ? c[iFraud] || '' : '').trim().toLowerCase();
    const fraud = fraudRaw !== '' && fraudRaw !== '-' && fraudRaw !== 'no' && fraudRaw !== 'false' && fraudRaw !== '0';

    /* Rows with missing Ops Score are included as "Pending" */
    if (!opRaw || opRaw === '-') {
      rows.push({ store: storeName, region, cm, rm, month, shrinkage: 0, opsScore: null, fraud, pending: true });
      continue;
    }
    const opNum = parseFloat(opRaw.replace('%', ''));
    if (isNaN(opNum)) continue;

    /* Treat missing shrinkage as 0 (no shrinkage risk) */
    const shNum = (!shRaw || shRaw === '-') ? 0 : parseFloat(shRaw.replace('%', ''));
    if (isNaN(shNum)) continue;

    const shrinkage = (!shRaw || shRaw === '-') ? 0 :
      shRaw.includes('%') ? shNum : (Math.abs(shNum) < 0.01 ? shNum * 100 : shNum);
    const opsScore = opRaw.includes('%') ? opNum : (opNum <= 1 ? opNum * 100 : opNum);

    rows.push({ store: storeName, region, cm, rm, month, shrinkage, opsScore, fraud, pending: false });
  }

  if (!rows.length) {
    throw new Error('No valid data rows found. Check Shrinkage and OpsScore columns contain numbers.');
  }
  return rows;
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
    'Store,Region,Shrinkage,OpsScore,Fraud',
    'Store Name 1,Bangalore,-0.082%,85%,No',
    'Store Name 2,Hyderabad,-0.091%,72%,Yes',
    'Store Name 3,Chennai,-0.045%,93%,No',
    'Store Name 4,Mumbai,-0.031%,90%,No',
    'Store Name 5,Kerala,-0.078%,78%,Yes',
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
  rebuild('cmFilter',     [...new Set(activeStores.map(s => s.cm).filter(v => v && v !== '-'))].sort(), 'All');
  rebuild('rmFilter',     [...new Set(activeStores.map(s => s.rm).filter(v => v && v !== '-'))].sort(), 'All');
  rebuild('monthFilter',  [...new Set(activeStores.map(s => s.month).filter(v => v && v !== '-'))], 'All');
}

/* Keep old name as alias so existing calls still work */
function rebuildRegionFilter() { rebuildFilters(); }

/* ============================================================
   FILTERS & SORTING
   ============================================================ */
function getFiltered() {
  const reg   = document.getElementById('regionFilter').value;
  const cm    = document.getElementById('cmFilter').value;
  const rm    = document.getElementById('rmFilter').value;
  const month = document.getElementById('monthFilter').value;
  const risk  = document.getElementById('riskFilter').value;
  const sort  = document.getElementById('sortFilter').value;

  let data = activeStores.filter(s =>
    (reg   === 'all' || s.region === reg) &&
    (cm    === 'all' || s.cm    === cm) &&
    (rm    === 'all' || s.rm    === rm) &&
    (month === 'all' || s.month === month) &&
    (risk  === 'all' || s.level === risk) &&
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
      <td style="color:#6b6b68">${s.month || '-'}</td>
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
  document.getElementById('ptab-risk').classList.toggle('active',      tab === 'risk');
  document.getElementById('ptab-issues').classList.toggle('active',    tab === 'issues');
  document.getElementById('ptab-shrinkage').classList.toggle('active', tab === 'shrinkage');
  document.getElementById('ptab-shortage').classList.toggle('active',  tab === 'shortage');
  if (tab === 'issues'    && issuesData.length    === 0) loadIssuesSheet();
  if (tab === 'shrinkage' && shrinkageData.length === 0) loadShrinkageSheet();
  if (tab === 'shortage'  && shortageData.length  === 0) loadShortageSheet();
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

  const iStore   = col('store', 'storename');
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

  const iOutlet  = col('outletname', 'outlet', 'store', 'storename');
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
    shortageColIdx  = { iItemName: parsed.iItemName, iStkVal: parsed.iStkVal, iAdjQty: parsed.iAdjQty };
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

  const iStore    = col('storename', 'store', 'outletname', 'outlet');
  const iCategory = col('category', 'itemcategory', 'itemtype', 'type');
  const iPeriod   = col('period', 'month', 'quarter', 'date');
  const iItemName = col('itemname', 'item', 'itemdesc', 'description', 'productname', 'product');
  const iStkVal   = col('stkvalue(mrp)', 'stkvaluemrp', 'stkvalue', 'stockvalue', 'mrpvalue', 'mrp');
  const iAdjQty   = col('adjqty', 'adjustedqty', 'adjustedquantity', 'adjquantity');

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
    rows.push(row);
  }
  return { headers: rawHdrs, rows, iItemName, iStkVal, iAdjQty };
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
  rebuild('shortageCategoryFilter', [...new Set(shortageData.map(r => r._category).filter(v => v && v !== '-'))].sort());
  rebuild('shortagePeriodFilter',   [...new Set(shortageData.map(r => r._period).filter(v => v && v !== '-'))]);
}

function getFilteredShortage() {
  const store    = document.getElementById('shortageStoreFilter').value;
  const cm       = document.getElementById('shortageCmFilter').value;
  const rm       = document.getElementById('shortageRmFilter').value;
  const category = document.getElementById('shortageCategoryFilter').value;
  const period   = document.getElementById('shortagePeriodFilter').value;
  return shortageData.filter(r =>
    (store    === 'all' || r._store    === store)    &&
    (cm       === 'all' || r._cm       === cm)       &&
    (rm       === 'all' || r._rm       === rm)       &&
    (category === 'all' || r._category === category) &&
    (period   === 'all' || r._period   === period)
  );
}

function applyShortageFilters() {
  const data = getFilteredShortage();
  renderShortageAnalysis(data);
  renderShortageTable(data);
}

function renderShortageAnalysis(data) {
  const el = document.getElementById('shortageAnalysis');
  if (!el) return;

  const hasItem   = shortageColIdx.iItemName !== -1;
  const hasStkVal = shortageColIdx.iStkVal   !== -1;
  const hasAdjQty = shortageColIdx.iAdjQty   !== -1;

  if (!hasItem || (!hasStkVal && !hasAdjQty) || !data.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  /* Group by item name, sum Stk Value (MRP) and Adj Qty */
  const map = {};
  data.forEach(r => {
    const item = r._itemName !== '-' ? r._itemName : '(Unknown)';
    if (!map[item]) map[item] = { stkVal: 0, adjQty: 0 };
    const sv = parseFloat(String(r._stkVal).replace(/,/g, ''));
    const aq = parseFloat(String(r._adjQty).replace(/,/g, ''));
    if (!isNaN(sv)) map[item].stkVal += sv;
    if (!isNaN(aq)) map[item].adjQty += aq;
  });

  /* Sort by Stk Value descending */
  const items = Object.entries(map).sort((a, b) => b[1].stkVal - a[1].stkVal);

  const totalStkVal = items.reduce((s, [, v]) => s + v.stkVal, 0);
  const totalAdjQty = items.reduce((s, [, v]) => s + v.adjQty, 0);

  const fmtVal = v => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = v => v.toLocaleString('en-IN', { minimumFractionDigits: 0,  maximumFractionDigits: 2 });
  const qtyColor = v => v < 0 ? '#a32d2d' : v > 0 ? '#2a5c14' : '#1a1a1a';

  el.innerHTML = `
    <div class="sec-hdr" style="margin-bottom:12px">
      <div class="sec-title">Item-wise Analysis — Stk Value (MRP) &amp; Adj Qty</div>
      <div style="display:flex;gap:16px;font-size:13px;font-weight:600">
        <span style="color:#4a7fcb">Total Stk Value: ₹${fmtVal(totalStkVal)}</span>
        <span style="color:${qtyColor(totalAdjQty)}">Total Adj Qty: ${fmtQty(totalAdjQty)}</span>
      </div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Item Name</th>
          ${hasStkVal ? '<th style="text-align:right">Stk Value (MRP) ₹</th>' : ''}
          ${hasAdjQty ? '<th style="text-align:right">Adj Qty</th>' : ''}
        </tr></thead>
        <tbody>
          ${items.map(([item, v]) => `<tr>
            <td style="font-weight:600">${item}</td>
            ${hasStkVal ? `<td style="text-align:right;font-weight:600;color:#4a7fcb">${fmtVal(v.stkVal)}</td>` : ''}
            ${hasAdjQty ? `<td style="text-align:right;font-weight:600;color:${qtyColor(v.adjQty)}">${fmtQty(v.adjQty)}</td>` : ''}
          </tr>`).join('')}
          <tr style="background:#f5f4f0;font-weight:700;border-top:2px solid #ccc">
            <td>TOTAL</td>
            ${hasStkVal ? `<td style="text-align:right;color:#4a7fcb">₹${fmtVal(totalStkVal)}</td>` : ''}
            ${hasAdjQty ? `<td style="text-align:right;color:${qtyColor(totalAdjQty)}">${fmtQty(totalAdjQty)}</td>` : ''}
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderShortageTable(data) {
  document.getElementById('shortageCount').textContent = data.length + ' rows';

  const thead = document.getElementById('shortageHead');
  if (shortageHeaders.length) {
    thead.innerHTML = '<tr>' + shortageHeaders.map(h => `<th>${h}</th>`).join('') + '</tr>';
  }

  if (!data.length) {
    document.getElementById('shortageBody').innerHTML =
      `<tr><td colspan="${shortageHeaders.length || 1}"><div class="empty">No data matches the selected filters.</div></td></tr>`;
    return;
  }
  document.getElementById('shortageBody').innerHTML = data.map(r =>
    '<tr>' + shortageHeaders.map((h, i) =>
      `<td${i === 0 ? ' style="font-weight:600"' : ''}>${r[h] !== undefined ? r[h] : '-'}</td>`
    ).join('') + '</tr>'
  ).join('');
}

function exportShortageCSV() {
  const data = getFilteredShortage();
  if (!data.length) return;
  const rows = data.map(r =>
    shortageHeaders.map(h => '"' + String(r[h] !== undefined ? r[h] : '').replace(/"/g, '""') + '"').join(',')
  );
  const csv = [shortageHeaders.map(h => '"' + h + '"').join(','), ...rows].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'kushals_shortage_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}
