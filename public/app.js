'use strict';
/* Influencer Orders portal - front end (no build step, no dependencies) */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

// crypto.randomUUID only exists on HTTPS/localhost; this works on plain http too
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
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

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
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

function addRow() {
  const r = { key: uuid(), f: {}, check: null, snapshot: '', busy: false, order: null, failed: false, els: {} };
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
  paint(r);
  return r;
}

function snapshotOf(r) { return `${r.f.products || ''}|${r.f.sizes || ''}`; }
function complete(r) { return REQUIRED.every((k) => String(r.f[k] || '').trim()); }

function paint(r) {
  const locked = !!r.order;
  for (const [name] of FIELDS) r.els[name].disabled = locked || r.busy;
  const fresh = r.check && r.check.ok && r.snapshot === snapshotOf(r);
  r.els.checkBtn.disabled = locked || r.busy || !String(r.f.products || '').trim();
  r.els.checkBtn.textContent = r.busy === 'check' ? 'Checking…' : 'Check availability';
  r.els.createBtn.disabled = locked || r.busy || !(fresh && complete(r));
  r.els.createBtn.textContent = r.busy === 'create' ? 'Creating…' : locked ? 'Created ✓' : 'Create order';
  r.els.createBtn.title = fresh ? (complete(r) ? '' : 'Fill all customer fields first') : 'Run "Check availability" first (all items must be in stock)';

  // detail line
  let html = '';
  if (r.error) html += `<div class="err">${esc(r.error)}</div>`;
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
  r.els.date.textContent = o ? fmtDate(o.orderDate) : '';
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
    <td>${esc(fmtDate(h.orderDate || h.createdAt))}</td>
    <td>${esc(h.customer)}<div class="muted">${esc(h.phone)}</div></td>
    <td>${esc(h.city)}</td>
    <td>${h.items.map((i) => `<div>${esc(i.title || '')} ${i.size ? '(' + esc(i.size) + ')' : ''}${i.qty > 1 ? ' ×' + i.qty : ''}</div>`).join('')}</td>
    <td>${statusPill(h.status)}${h.error ? `<div class="err">${esc(h.error)}</div>` : ''}</td>
    <td>${h.status === 'CREATED' || h.status === 'CANCELLED' ? statusPill(h.deliveryStatus) : ''}${h.deliveredAt ? `<div class="muted">${esc(fmtDate(h.deliveredAt))}</div>` : ''}</td>
    <td>${h.status === 'CREATED' ? trackingHtml(h.tracking) : ''}</td>
    <td class="muted">${esc(fmtDate(h.lastSyncedAt))}</td>
    <td>${h.status === 'CREATED' ? `<button class="btn" data-refresh="${h.id}">Refresh</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="10" class="muted" style="padding:16px">No orders yet.</td></tr>';
}
$('#histBody').addEventListener('click', async (e) => {
  const id = e.target.dataset && e.target.dataset.refresh;
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
