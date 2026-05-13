/* =============================================
   KUSHALS STORE RISK DASHBOARD — app.js
   All dashboard logic: risk scoring, CSV
   parsing, filters, charts, table rendering
   ============================================= */

/* ---- State ---- */
let activeStores = [];
let bChart = null;
let pChart = null;

/* ============================================================
   RISK SCORING
   Rules defined by Yallappa Tenkappanavar — Loss Prevention
   
   Shrinkage > 0.075%     → +30 pts
   Ops score 80–89%       → +20 pts
   Ops score < 80%        → +30 pts
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
  const shrinkPts = s.shrinkage < -0.075 ? 30 : 0;
  const opsPts    = s.opsScore >= 90 ? 0 : s.opsScore >= 80 ? 20 : 30;
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
  document.getElementById('uploadStatus').className = 'upload-status';
  document.getElementById('sheetStatus').className = 'upload-status';
  document.getElementById('sheetUrl').value = '';
  rebuildFilters();
  applyFilters();
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
    showSheetStatus('&#10003; ' + rows.length + ' stores loaded from Google Sheet', 'ok');
    document.getElementById('sheetClearBtn').style.display = 'inline-block';
    setDsStatus('Google Sheet · ' + rows.length + ' stores', true);
    document.getElementById('uploadPanel').style.display = 'none';
    startAutoRefresh();
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
    (risk  === 'all' || s.level === risk)
  );

  if      (sort === 'risk')      data.sort((a, b) => b.total - a.total);
  else if (sort === 'shrinkage') data.sort((a, b) => a.shrinkage - b.shrinkage);
  else if (sort === 'opsScore')  data.sort((a, b) => a.opsScore - b.opsScore);
  else                           data.sort((a, b) => a.store.localeCompare(b.store));

  return data;
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

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Stores in view</div>
      <div class="kpi-val">${data.length}</div>
      <div class="kpi-sub">filtered selection</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">High risk</div>
      <div class="kpi-val cr">${h}</div>
      <div class="kpi-sub cr">${Math.round(h / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Medium risk</div>
      <div class="kpi-val ca">${m}</div>
      <div class="kpi-sub" style="color:#6b6b68">${Math.round(m / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Low risk</div>
      <div class="kpi-val cg">${l}</div>
      <div class="kpi-sub" style="color:#6b6b68">${Math.round(l / n * 100)}% of stores</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Shrinkage risk</div>
      <div class="kpi-val cr">${sr}</div>
      <div class="kpi-sub" style="color:#6b6b68">stores &gt; 0.075%</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Fraud cases</div>
      <div class="kpi-val ${fr > 5 ? 'cr' : fr > 2 ? 'ca' : 'cg'}">${fr}</div>
      <div class="kpi-sub" style="color:#6b6b68">stores affected</div>
    </div>
    <div class="kpi-card">
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
      <td style="font-weight:600">${s.store}</td>
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
          max: 80,
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

/* Auto-load saved Google Sheet URL on page open */
(function autoLoad() {
  const saved = localStorage.getItem('sheetUrl');
  if (!saved) return;
  document.getElementById('sheetUrl').value = saved;
  switchTab('sheet');
  loadFromGoogleSheet();
})();
