'use strict';
const { pool } = require('./db');
const { cfg } = require('./config');
const shopify = require('./shopify');
const { validateOrder } = require('./validate');

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));

function publicRow(r) {
  return {
    id: r.id,
    key: r.request_key,
    status: r.status,
    error: r.error,
    orderName: r.shopify_order_name,
    orderDate: r.shopify_order_created_at || (r.status === 'CREATED' ? r.updated_at : null),
    customer: r.customer_name,
    phone: r.phone,
    city: r.city,
    items: (r.items || []).map((i) => ({ title: i.title, size: i.size, qty: i.qty, sku: i.sku })),
    deliveryStatus: r.delivery_status,
    tracking: r.tracking || [],
    deliveredAt: r.delivered_at,
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
  };
}

/** Availability check only (no writes). */
async function check(body) {
  const { parseItems } = require('./validate');
  const { items, errors } = parseItems(body.products, body.sizes);
  if (errors.length) throw new HttpError(400, errors.join('. '));
  return shopify.checkItems(items);
}

/** Claim the idempotency key. Returns { row, already }. */
async function claim(key, v, user) {
  const c = v.customer;
  const ins = await pool.query(
    `INSERT INTO influencer_orders (request_key, created_by, customer_name, phone, email, address1, city, state, pincode, items, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'PENDING')
     ON CONFLICT (request_key) DO NOTHING RETURNING *`,
    [key, user, c.name, c.phone, c.email, c.address1, c.city, c.stateName, c.pincode, JSON.stringify(v.items)]);
  if (ins.rows[0]) return { row: ins.rows[0], already: false };

  const ex = (await pool.query('SELECT * FROM influencer_orders WHERE request_key=$1', [key])).rows[0];
  if (ex.status === 'CREATED') return { row: ex, already: true };
  const upd = await pool.query(
    `UPDATE influencer_orders SET status='PENDING', error=NULL, updated_at=now()
     WHERE request_key=$1 AND (status='FAILED' OR (status='PENDING' AND updated_at < now() - interval '2 minutes'))
     RETURNING *`, [key]);
  if (upd.rows[0]) return { row: upd.rows[0], already: false };
  throw new HttpError(409, 'This order is already being processed - wait a few seconds and refresh.');
}

async function fail(id, message) {
  await pool.query(`UPDATE influencer_orders SET status='FAILED', error=$2, updated_at=now() WHERE id=$1`, [id, String(message).slice(0, 500)]);
}

/**
 * Create the 100% discounted order. Safe to retry with the same key:
 *  - CREATED rows are returned as-is (no duplicate)
 *  - a draft that was already created/completed on Shopify is resumed, never recreated
 */
async function createOrder(body, user = 'portal') {
  if (!isUuid(body.key)) throw new HttpError(400, 'Missing request key - reload the page');
  const { errors, value } = validateOrder(body);
  if (errors.length) throw new HttpError(400, errors.join('. '));

  const { row, already } = await claim(body.key, value, user);
  if (already) return publicRow(row);

  try {
    let draftId = row.shopify_draft_id;

    if (!draftId) {
      // Server-side re-check: never trust the browser's "available" state
      const chk = await shopify.checkItems(value.items);
      if (!chk.ok) {
        const why = chk.items.filter((i) => !i.ok).map((i) => `${i.title || i.url} (${i.size || '-'}): ${i.reason}`).join(' | ');
        throw new HttpError(422, 'Stock check failed - ' + why, { check: chk });
      }
      const draft = await shopify.createDraft({
        customer: value.customer,
        items: chk.items,
        note: cfg.rules.orderNote,
      });
      draftId = draft.id;
      const enriched = chk.items.map((i) => ({ url: i.url, handle: i.handle, size: i.size, qty: i.qty, variantId: i.variantId, sku: i.sku, title: i.title }));
      await pool.query(`UPDATE influencer_orders SET shopify_draft_id=$2, items=$3::jsonb, updated_at=now() WHERE id=$1`, [row.id, draftId, JSON.stringify(enriched)]);
    }

    let draft = await shopify.getDraft(draftId);
    if (!draft) throw new Error('Draft order disappeared on Shopify');

    if (draft.status !== 'COMPLETED') {
      // Hard safety: only ever complete a ZERO-value order
      const total = parseFloat(draft.totalPriceSet.shopMoney.amount);
      if (total !== 0) {
        await shopify.deleteDraft(draftId);
        await pool.query(`UPDATE influencer_orders SET shopify_draft_id=NULL WHERE id=$1`, [row.id]);
        throw new Error(`Draft total is ${total}, not 0 (check tax/shipping settings). Nothing was created.`);
      }
      draft = await shopify.completeDraft(draftId);
    }

    const order = draft.order;
    if (!order) throw new Error('Draft completed but no order returned - check Shopify admin');
    const done = await pool.query(
      `UPDATE influencer_orders SET status='CREATED', error=NULL, shopify_order_id=$2, shopify_order_name=$3,
         shopify_order_created_at=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id, order.id, order.name, order.createdAt]);
    return publicRow(done.rows[0]);
  } catch (e) {
    await fail(row.id, e.message);
    throw e instanceof HttpError ? e : new HttpError(502, e.message);
  }
}

async function list(limit = 200) {
  const r = await pool.query('SELECT * FROM influencer_orders ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows.map(publicRow);
}

module.exports = { createOrder, check, list, publicRow, HttpError };
