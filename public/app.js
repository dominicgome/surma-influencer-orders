'use strict';
/* Influencer Orders portal - front end (no build step, no dependencies) */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Works at the domain root AND under a sub-path (e.g. https://host/influencer-orders/)
const API = location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '') + '/api';
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

// crypto.randomUUID only exists on HTTPS/localhost; this works on plain http too
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Please sign in again'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.data = j; throw e; }
  return j;
}

// All times are shown in Indian Standard Time (IST) whatever the viewer's PC timezone is.
// The raw time from Shopify/database (UTC) is available as a hover tooltip.
const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(d); if (isNaN(t)) return '';
  return t.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST';
};
const utcTitle = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? 'UTC: ' + t.toISOString().replace('T', ' ').slice(0, 19) : ''; };
const tm = (d) => (d ? `<span title="${esc(utcTitle(d))}">${esc(fmtDate(d))}</span>` : '');
const label = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
function statusPill(s) {
  const cls = s === 'DELIVERED' ? 'ok' : (s === 'CANCELLED' || s === 'FAILED') ? 'bad' : (s === 'UNFULFILLED' || s === 'PENDING') ? 'neutral' : 'warn';
  return `<span class="pill ${cls}">${esc(label(s))}</span>`;
}
function trackingHtml(list) {
  if (!list || !list.length) return '<span class="muted">Awaiting dispatch</span>';
  return list.map((t) => {
    const txt = esc(`${t.company || 'Track'} ${t.number || ''}`.trim());
    return t.url ? `<div><a href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">${txt}</a></div>` : `<div>${txt}</div>`;
  }).join('');
}

// ------------------------------------------------------------------ login / tabs
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#pw').focus(); }
async function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const states = await api('/states');
  statesList = states;
  $('#stateList').innerHTML = states.map((s) => `<option value="${esc(s)}">`).join('');
  if (!rows.length) addRow();
  loadHistory();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/login', { method: 'POST', body: { password: $('#pw').value } }); $('#pw').value = ''; showApp(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $('#tab-new').classList.toggle('hidden', b.dataset.tab !== 'new');
  $('#tab-history').classList.toggle('hidden', b.dataset.tab !== 'history');
  if (b.dataset.tab === 'history') loadHistory();
}));

// ------------------------------------------------------------------ grid
const FIELDS = [
  ['name', 'text', 'Full name'], ['address', 'text', 'House / street / area'], ['city', 'text', ''],
  ['state', 'state', ''], ['pincode', 'text', '6 digits'], ['phone', 'text', '10-digit mobile'],
  ['email', 'text', ''], ['products', 'text', 'https://.../products/xyz, https://.../products/abc'], ['sizes', 'text', 'M, L'],
];
const REQUIRED = ['name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'products'];
const rows = [];
let statesList = [];
const LABELS = { name: 'Name', address: 'Address', city: 'City', state: 'State', pincode: 'Pin code', phone: 'Phone', email: 'Email', products: 'Products' };
const STATE_ALIASES = ['new delhi', 'nct of delhi', 'orissa', 'uttaranchal', 'pondicherry'];

function addRow(init) {
  const r = { key: uuid(), f: {}, check: null, snapshot: '', busy: false, order: null, failed: false, els: {}, imported: !!init, tr: null, dtr: null };
  rows.push(r);

  const tr = document.createElement('tr');
  for (const [name, type, ph] of FIELDS) {
    const td = document.createElement('td'); td.className = 'c-' + name;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = ph; inp.autocomplete = 'off';
    if (type === 'state') inp.setAttribute('list', 'stateList');
    inp.addEventListener('input', () => {
      r.f[name] = inp.value;
      if (r.failed) { r.key = uuid(); r.failed = false; } // edited after a failure -> treat as a fresh request
      paint(r);
    });
    r.els[name] = inp; td.appendChild(inp); tr.appendChild(td);
  }
  const tdCheck = document.createElement('td'); tdCheck.className = 'act';
  r.els.checkBtn = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Check availability' });
  r.els.checkBtn.addEventListener('click', () => doCheck(r));
  tdCheck.appendChild(r.els.checkBtn);

  const tdCreate = document.createElement('td'); tdCreate.className = 'act';
  r.els.createBtn = Object.assign(document.createElement('button'), { className: 'btn primary', textContent: 'Create order' });
  r.els.createBtn.addEventListener('click', () => doCreate(r));
  tdCreate.appendChild(r.els.createBtn);

  r.els.date = Object.assign(document.createElement('td'), { className: 'out' });
  r.els.num = Object.assign(document.createElement('td'), { className: 'out' });
  r.els.trk = Object.assign(document.createElement('td'), { className: 'out' });
  tr.append(tdCheck, tdCreate, r.els.date, r.els.num, r.els.trk);

  const dtr = document.createElement('tr'); dtr.className = 'detail hidden';
  const dtd = document.createElement('td'); dtd.colSpan = FIELDS.length + 5; dtr.appendChild(dtd);
  r.els.detail = dtd; r.els.detailRow = dtr;

  $('#gridBody').append(tr, dtr);
  r.tr = tr; r.dtr = dtr;
  if (init) for (const [name] of FIELDS) { const v = String(init[name] ?? '').trim(); r.f[name] = v; r.els[name].value = v; }
  paint(r);
  return r;
}

function removeRow(r) { r.tr.remove(); r.dtr.remove(); rows.splice(rows.indexOf(r), 1); }

function stateOk(v) {
  const x = String(v).trim().toLowerCase();
  return statesList.some((s) => s.toLowerCase() === x) || STATE_ALIASES.includes(x) || /^[a-z]{2}$/.test(x);
}

// quick client-side checks (the server re-validates everything before creating)
function issues(r) {
  const out = []; const v = (k) => String(r.f[k] || '').trim();
  for (const k of REQUIRED) if (!v(k)) out.push(LABELS[k] + ' missing');
  if (v('phone')) {
    let d = v('phone').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    if (!/^[6-9]\d{9}$/.test(d)) out.push('Phone must be a 10-digit Indian mobile');
  }
  if (v('pincode') && !/^[1-9]\d{5}$/.test(v('pincode').replace(/\D/g, ''))) out.push('Pin code must be 6 digits');
  if (v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) out.push('Email looks invalid');
  if (v('state') && statesList.length && !stateOk(v('state'))) out.push('State not recognised');
  return out;
}

function snapshotOf(r) { return `${r.f.products || ''}|${r.f.sizes || ''}`; }
function complete(r) { return issues(r).length === 0; }

function paint(r) {
  const locked = !!r.order;
  for (const [name] of FIELDS) r.els[name].disabled = locked || r.busy;
  const fresh = r.check && r.check.ok && r.snapshot === snapshotOf(r);
  r.els.checkBtn.disabled = locked || r.busy || !String(r.f.products || '').trim();
  r.els.checkBtn.textContent = r.busy === 'check' ? 'Checking…' : 'Check availability';
  r.els.createBtn.disabled = locked || r.busy || !(fresh && complete(r));
  r.els.createBtn.textContent = r.busy === 'create' ? 'Creating…' : locked ? 'Created ✓' : 'Create order';
  r.els.createBtn.title = !fresh ? 'Run "Check availability" first (all items must be in stock)' : complete(r) ? '' : issues(r).join('; ');

  // detail line
  let html = '';
  if (r.error) html += `<div class="err">${esc(r.error)}</div>`;
  const iss = (r.imported || r.check) && !r.order ? issues(r) : [];
  if (iss.length) html += '<div>' + iss.map((i) => `<span class="pill warn">${esc(i)}</span>`).join(' ') + '</div>';
  if (r.check && r.check.items) {
    const stale = r.snapshot !== snapshotOf(r);
    html += (stale ? '<div class="muted">Products/sizes changed - re-run the check.</div>' : '') +
      r.check.items.map((i) => `<div class="item">
        <span class="pill ${i.ok ? 'ok' : 'bad'}">${i.ok ? 'Available' : 'Not available'}</span>
        <span><b>${esc(i.title || i.url)}</b>${i.size ? ' &middot; ' + esc(i.size) : ''}${i.qty > 1 ? ' &times;' + i.qty : ''}
        ${i.ok ? '<span class="muted"> &middot; ' + i.available + ' in stock' + (i.sku ? ' &middot; ' + esc(i.sku) : '') + '</span>' : '<span class="err"> ' + esc(i.reason || '') + '</span>'}</span>
      </div>`).join('');
  }
  r.els.detail.innerHTML = html;
  r.els.detailRow.classList.toggle('hidden', !html);

  // order outputs
  const o = r.order;
  r.els.date.textContent = o ? fmtDate(o.orderDate) : ''; r.els.date.title = o ? utcTitle(o.orderDate) : '';
  r.els.num.innerHTML = o ? `<b>${esc(o.orderName)}</b><div>${statusPill(o.deliveryStatus)}</div>` : '';
  r.els.trk.innerHTML = o ? trackingHtml(o.tracking) : '';
}

async function doCheck(r) {
  r.busy = 'check'; r.error = ''; paint(r);
  try {
    r.check = await api('/check', { method: 'POST', body: { products: r.f.products, sizes: r.f.sizes } });
  } catch (e) { r.check = { ok: false, items: [] }; r.error = e.message; }
  r.snapshot = snapshotOf(r); r.busy = false; paint(r);
}

async function doCreate(r) {
  if (!confirm(`Create a 100% discounted INFLUENCER order for ${r.f.name}?\nThis creates a live order on Shopify.`)) return;
  r.busy = 'create'; r.error = ''; paint(r);
  try {
    r.order = await api('/orders', { method: 'POST', body: { key: r.key, ...r.f } });
  } catch (e) {
    r.failed = true; r.error = e.message;
    if (e.data && e.data.check) { r.check = e.data.check; r.snapshot = ''; }
  }
  r.busy = false; paint(r);
  if (r.order) loadHistory();
}

$('#addRow').addEventListener('click', addRow);

// ------------------------------------------------------------------ Excel / CSV import
// Header detection is tolerant: "Phone Number", "Mobile", "Pin code", "Products (Coma seperated)" etc. all map.
const IGNORE_HEADER = /order|track|date|awb|button|availab|status/i;
const HEADER_RULES = [
  ['products', /product|link|url/i], ['sizes', /size/i], ['pincode', /pin|zip|postal/i],
  ['phone', /phone|mobile|contact|whatsapp/i], ['email', /mail/i], ['city', /city|town/i],
  ['state', /state/i], ['address', /addr/i], ['name', /name/i],
];
function mapHeaders(headerRow) {
  const map = {}; const used = new Set();
  headerRow.forEach((h, idx) => {
    const t = String(h || '').trim(); if (!t || IGNORE_HEADER.test(t)) return;
    for (const [field, rx] of HEADER_RULES) if (!used.has(field) && rx.test(t)) { map[field] = idx; used.add(field); break; }
  });
  return map;
}
const MAX_IMPORT_ROWS = 100;

function parseSheetRows(wb) {
  for (const sheetName of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '', blankrows: false });
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      const map = mapHeaders(aoa[i]);
      if (Object.keys(map).length >= 4 && map.products !== undefined) return { aoa: aoa.slice(i + 1), map, sheetName };
    }
  }
  return null;
}

async function importFile(file) {
  const msg = $('#uploadMsg'); msg.textContent = 'Reading file…';
  try {
    const isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv ? XLSX.read(await file.text(), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const parsed = parseSheetRows(wb);
    if (!parsed) { msg.innerHTML = '<span class="err">Could not find the column headings. Use "Download template" and keep its headings (Name, Address, City, State, Pin code, Phone Number, Email ID, Products, Size).</span>'; return; }
    const { aoa, map } = parsed;
    const missing = ['name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'products'].filter((k) => map[k] === undefined);
    if (missing.length) { msg.innerHTML = `<span class="err">Missing column(s): ${esc(missing.map((k) => LABELS[k]).join(', '))}.</span>`; return; }

    const list = [];
    let skipped = 0;
    for (const line of aoa) {
      const get = (k) => (map[k] === undefined ? '' : String(line[map[k]] ?? '').trim());
      const rec = {
        name: get('name'), address: get('address'), city: get('city'), state: get('state'), pincode: get('pincode'),
        phone: get('phone'), email: get('email'),
        products: get('products').replace(/[\r\n;|]+/g, ',').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, ''),
        sizes: get('sizes').replace(/[\r\n;|]+/g, ',').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, ''),
      };
      if (!Object.values(rec).some(Boolean)) { skipped++; continue; }
      const st = statesList.find((s) => s.toLowerCase() === rec.state.toLowerCase()); if (st) rec.state = st;
      list.push(rec);
    }
    if (!list.length) { msg.innerHTML = '<span class="err">No data rows found under the headings.</span>'; return; }
    if (list.length > MAX_IMPORT_ROWS) { msg.innerHTML = `<span class="err">${list.length} rows found; max ${MAX_IMPORT_ROWS} per upload. Split the file.</span>`; return; }

    // drop the untouched blank starter row
    for (const r of [...rows]) if (!r.order && !Object.values(r.f).some((v) => String(v || '').trim())) removeRow(r);
    for (const rec of list) addRow(rec);
    const bad = rows.filter((r) => r.imported && !r.order && issues(r).length).length;
    msg.textContent = `Loaded ${list.length} row(s) from ${file.name}${skipped ? ` (${skipped} empty skipped)` : ''}${bad ? ` - ${bad} row(s) need fixing (see yellow tags)` : ''}. Nothing has been created yet: click "Check availability for all rows", review, then "Create order" per row.`;
  } catch (e) {
    msg.innerHTML = `<span class="err">Could not read the file: ${esc(e.message)}</span>`;
  }
}
$('#xlsFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });

$('#tplBtn').addEventListener('click', () => {
  const head = ['Name', 'Address', 'City', 'State', 'Pin code', 'Phone Number', 'Email ID', 'Products (comma separated links)', 'Size (comma separated, same order)'];
  const ex = ['Example Name', '12 MG Road, Indiranagar', 'Bengaluru', 'Karnataka', '560038', '9876543210', 'name@example.com',
    'https://YOUR-STORE/products/handle-one, https://YOUR-STORE/products/handle-two', 'M, L'];
  const help = [['How to fill'], ['One row = one order. Delete the example row before uploading.'],
    ['Products: product page links separated by commas (or one per line inside the cell).'],
    ['Size: sizes in the same order as the products, e.g. M, L. Add *2 for quantity 2 (M*2).'],
    ['Phone: 10-digit Indian mobile. Pin code: 6 digits. State: full state name.'],
    ['Uploading only fills the portal grid. Orders are created one by one with the Create order button.']];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([head, ex]);
  ws['!cols'] = [18, 34, 14, 16, 10, 14, 24, 60, 22].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'How to fill');
  XLSX.writeFile(wb, 'influencer-orders-template.xlsx');
});

$('#checkAll').addEventListener('click', async () => {
  const todo = rows.filter((r) => !r.order && String(r.f.products || '').trim() && !(r.check && r.snapshot === snapshotOf(r)));
  if (!todo.length) { $('#uploadMsg').textContent = 'Nothing to check.'; return; }
  $('#checkAll').disabled = true;
  let i = 0;
  for (const r of todo) { $('#uploadMsg').textContent = `Checking row ${++i} of ${todo.length}…`; await doCheck(r); }
  $('#checkAll').disabled = false;
  const ready = rows.filter((r) => !r.order && r.check && r.check.ok && r.snapshot === snapshotOf(r) && complete(r)).length;
  $('#uploadMsg').textContent = `Checked ${todo.length} row(s): ${ready} ready to create. Review, then click "Create order" on each row.`;
});

$('#clearRows').addEventListener('click', () => {
  const pending = rows.filter((r) => !r.order);
  if (!pending.length) return;
  if (!confirm(`Remove ${pending.length} row(s) that have not been created? Created orders stay in Order history.`)) return;
  pending.forEach(removeRow); if (!rows.length) addRow();
  $('#uploadMsg').textContent = '';
});

// ------------------------------------------------------------------ history + live tracking
let history = [];
async function loadHistory() {
  try { history = await api('/orders'); } catch { return; }
  // reflect latest tracking on rows created in this session
  for (const r of rows) {
    if (!r.order) continue;
    const fresh = history.find((h) => h.key === r.key);
    if (fresh) { r.order = fresh; paint(r); }
  }
  $('#histBody').innerHTML = history.map((h) => `<tr>
    <td><b>${esc(h.orderName || '—')}</b></td>
    <td>${tm(h.orderDate || h.createdAt)}</td>
    <td>${esc(h.customer)}<div class="muted">${esc(h.phone)}</div></td>
    <td>${esc(h.city)}</td>
    <td>${h.items.map((i) => `<div>${esc(i.title || '')} ${i.size ? '(' + esc(i.size) + ')' : ''}${i.qty > 1 ? ' ×' + i.qty : ''}</div>`).join('')}</td>
    <td>${statusPill(h.status)}${h.error ? `<div class="err">${esc(h.error)}</div>` : ''}</td>
    <td>${h.status === 'CREATED' || h.status === 'CANCELLED' ? statusPill(h.deliveryStatus) : ''}${h.deliveredAt ? `<div class="muted">${tm(h.deliveredAt)}</div>` : ''}</td>
    <td>${h.status === 'CREATED' ? trackingHtml(h.tracking) : ''}</td>
    <td class="muted">${tm(h.lastSyncedAt)}</td>
    <td>${h.status === 'CREATED' ? `<button class="btn" data-refresh="${h.id}">Refresh</button>${h.deliveryStatus !== 'DELIVERED' ? ` <button class="btn" data-cancel="${h.id}" data-name="${esc(h.orderName)}" title="Allowed only when the order has the tag ON_HOLD_ORDER_CP in Shopify">Cancel order</button>` : ''}` : ''}${h.onHold && h.status === 'CREATED' ? '<div><span class="pill warn">On hold (can cancel)</span></div>' : ''}</td>
  </tr>`).join('') || '<tr><td colspan="10" class="muted" style="padding:16px">No orders yet.</td></tr>';
}
$('#histBody').addEventListener('click', async (e) => {
  const d = e.target.dataset || {};
  if (d.cancel) {
    if (!confirm(`Cancel order ${d.name} on Shopify?\n\nThis only works if the order has the tag ON_HOLD_ORDER_CP in Shopify. It cannot be undone.`)) return;
    e.target.disabled = true; e.target.textContent = 'Cancelling…';
    try {
      const r = await api(`/orders/${d.cancel}/cancel`, { method: 'POST' });
      if (r.cancelRequested) alert('Cancellation was sent to Shopify and is still processing. Click Refresh in a minute to see the final status.');
    } catch (err) { alert(err.message); }
    await loadHistory(); return;
  }
  const id = d.refresh;
  if (!id) return;
  e.target.disabled = true;
  try { await api(`/orders/${id}/refresh`, { method: 'POST' }); await loadHistory(); } catch (err) { alert(err.message); e.target.disabled = false; }
});
$('#syncAll').addEventListener('click', async () => {
  $('#syncMsg').textContent = 'Syncing…';
  try { const r = await api('/sync', { method: 'POST' }); $('#syncMsg').textContent = r.skipped ? 'A sync is already running.' : `Synced ${r.ok} order(s), ${r.failed} failed.`; await loadHistory(); }
  catch (err) { $('#syncMsg').textContent = err.message; }
});
setInterval(() => { if (!document.hidden && !$('#app').classList.contains('hidden')) loadHistory(); }, 60000);

// ------------------------------------------------------------------ boot
api('/me').then((m) => (m.authed ? showApp() : showLogin())).catch(showLogin);
