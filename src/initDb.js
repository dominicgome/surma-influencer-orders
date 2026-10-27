'use strict';
// Usage: npm run db:init   (creates the influencer_orders table; safe to re-run)
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const r = await pool.query("SELECT count(*)::int AS n FROM influencer_orders");
  console.log('influencer_orders ready. rows =', r.rows[0].n);
  await pool.end();
})().catch((e) => { console.error('DB init failed:', e.message); process.exit(1); });
