'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { cfg, validate } = require('./config');
validate();

const { pool } = require('./db');
const orders = require('./orders');
const { syncAll, syncOne } = require('./trackingSync');
const { STATES } = require('./states');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  next();
});

// ------------------------------------------------------------- auth (shared password, signed cookie)
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (v) => crypto.createHmac('sha256', cfg.portal.secret).update(v).digest('hex');
const SESSION_MS = 12 * 3600 * 1000;

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
function authed(req) {
  const [exp, mac] = String(cookies(req).infl_sid || '').split('.');
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good));
}
const requireAuth = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Login required' }));

const attempts = new Map(); // ip -> [timestamps]
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const recent = (attempts.get(ip) || []).filter((t) => Date.now() - t < 15 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const ok = crypto.timingSafeEqual(sha(req.body.password || ''), sha(cfg.portal.password));
  if (!ok) { recent.push(Date.now()); attempts.set(ip, recent); return res.status(401).json({ error: 'Wrong password' }); }
  const exp = String(Date.now() + SESSION_MS);
  res.cookie('infl_sid', `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'strict', secure: cfg.portal.cookieSecure, maxAge: SESSION_MS, path: cfg.portal.cookiePath });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('infl_sid', { path: cfg.portal.cookiePath }); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: authed(req) }));
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false }); }
});

// ------------------------------------------------------------- API
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[api]', req.path, e.message);
    res.status(status).json({ error: e.message, ...(e.extra || {}) });
  }
};

app.get('/api/states', requireAuth, (req, res) => res.json(Object.keys(STATES)));
app.post('/api/check', requireAuth, wrap((req) => orders.check(req.body || {})));
app.post('/api/orders', requireAuth, wrap((req) => orders.createOrder(req.body || {}, 'portal')));
app.get('/api/orders', requireAuth, wrap(() => orders.list()));
app.post('/api/orders/:id/refresh', requireAuth, wrap(async (req) => {
  const r = await pool.query("SELECT * FROM influencer_orders WHERE id=$1 AND status IN ('CREATED','CANCELLED')", [Number(req.params.id) || 0]);
  if (!r.rows[0] || !r.rows[0].shopify_order_id) throw new orders.HttpError(404, 'Order not found');
  return orders.publicRow(await syncOne(r.rows[0]));
}));
app.post('/api/orders/:id/cancel', requireAuth, wrap((req) => orders.cancelOrder(Number(req.params.id) || 0, 'portal')));
app.post('/api/sync', requireAuth, wrap(() => syncAll()));

app.use(express.static(path.join(__dirname, '..', 'public')));

// ------------------------------------------------------------- boot
// make sure the table/columns exist (idempotent), then start listening
require('./db').pool.query(require('fs').readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'))
  .catch((e) => console.error('[schema] could not apply schema:', e.message))
  .finally(() => app.listen(cfg.portal.port, () => console.log(`[portal] listening on :${cfg.portal.port}`)));
setInterval(() => syncAll().catch((e) => console.error('[sync]', e.message)), cfg.rules.syncMinutes * 60 * 1000);
setTimeout(() => syncAll().catch((e) => console.error('[sync]', e.message)), 30 * 1000); // first run shortly after boot
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
