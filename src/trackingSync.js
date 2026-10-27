'use strict';
const { pool } = require('./db');
const shopify = require('./shopify');

const RANK = ['UNFULFILLED', 'SCHEDULED', 'ON_HOLD', 'OPEN', 'PENDING_FULFILLMENT', 'IN_PROGRESS', 'LABEL_PRINTED', 'LABEL_PURCHASED', 'CONFIRMED',
  'FULFILLED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPTED_DELIVERY', 'DELIVERED'];

function summarise(order) {
  if (order.cancelledAt) return { delivery: 'CANCELLED', cancelled: true, tracking: [], deliveredAt: null };
  const fs = order.fulfillments || [];
  if (!fs.length) return { delivery: order.displayFulfillmentStatus || 'UNFULFILLED', tracking: [], deliveredAt: null };
  const tracking = [];
  for (const f of fs) for (const t of f.trackingInfo || []) tracking.push({ company: t.company, number: t.number, url: t.url, status: f.displayStatus });
  const allDelivered = fs.every((f) => f.displayStatus === 'DELIVERED');
  // headline = the least advanced shipment, so a split order is not shown "Delivered" early
  const worst = fs.map((f) => f.displayStatus || 'FULFILLED').sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
  const deliveredAt = allDelivered ? fs.map((f) => f.deliveredAt).filter(Boolean).sort().pop() || null : null;
  return { delivery: allDelivered ? 'DELIVERED' : worst, tracking, deliveredAt };
}

async function syncOne(row) {
  const order = await shopify.getOrderTracking(row.shopify_order_id);
  if (!order) throw new Error('Order not visible via API');
  const s = summarise(order);
  const r = await pool.query(
    `UPDATE influencer_orders SET delivery_status=$2, tracking=$3::jsonb, delivered_at=$4,
       status = CASE WHEN $5 THEN 'CANCELLED' ELSE status END, last_synced_at=now(), updated_at=now()
     WHERE id=$1 RETURNING *`,
    [row.id, s.delivery, JSON.stringify(s.tracking), s.deliveredAt, !!s.cancelled]);
  return r.rows[0];
}

let running = false;
async function syncAll() {
  if (running) return { skipped: true };
  running = true;
  let ok = 0, failed = 0;
  try {
    // Orders API only exposes the last 60 days without read_all_orders -> stay inside that window
    const { rows } = await pool.query(
      `SELECT * FROM influencer_orders
       WHERE status='CREATED' AND shopify_order_id IS NOT NULL
         AND delivery_status NOT IN ('DELIVERED','CANCELLED')
         AND created_at > now() - interval '60 days'
       ORDER BY last_synced_at NULLS FIRST LIMIT 150`);
    for (const row of rows) {
      try { await syncOne(row); ok++; } catch (e) { failed++; console.error('[sync]', row.shopify_order_name, e.message); }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally { running = false; }
  console.log(`[sync] done ok=${ok} failed=${failed}`);
  return { ok, failed };
}

module.exports = { syncOne, syncAll, summarise };
