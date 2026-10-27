'use strict';
require('dotenv').config();

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const bool = (v) => String(v || '').trim().toLowerCase() === 'true';

const locRaw = (process.env.SHOPIFY_LOCATION_ID || '').trim();

const cfg = {
  shopify: {
    domain: (process.env.SHOPIFY_SHOP_DOMAIN || '').trim(),
    version: (process.env.SHOPIFY_API_VERSION || '2025-10').trim(),
    // accepts either name so the original NEW_SHOPIFY_CLIENT_ID variable also works
    clientId: (process.env.SHOPIFY_CLIENT_ID || process.env.NEW_SHOPIFY_CLIENT_ID || '').trim(),
    clientSecret: (process.env.SHOPIFY_CLIENT_SECRET || '').trim(),
    adminToken: (process.env.SHOPIFY_ADMIN_TOKEN || '').trim(),
    locationGid: locRaw ? (locRaw.startsWith('gid://') ? locRaw : `gid://shopify/Location/${locRaw}`) : '',
  },
  db: {
    host: process.env.DB_HOST,
    port: num(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === undefined ? true : bool(process.env.DB_SSL),
  },
  portal: {
    port: num(process.env.PORT, 3000),
    password: process.env.PORTAL_PASSWORD || '',
    secret: process.env.SESSION_SECRET || '',
    cookieSecure: bool(process.env.COOKIE_SECURE),
  },
  rules: {
    maxItems: num(process.env.MAX_ITEMS_PER_ORDER, 6),
    maxQty: num(process.env.MAX_QTY_PER_LINE, 2),
    discountTitle: process.env.DISCOUNT_TITLE || 'INFLUENCER',
    orderTag: (process.env.ORDER_TAG || '').trim(),   // blank = no tag (default)
    orderNote: (process.env.ORDER_NOTE || '').trim(), // blank = no note (default)
    syncMinutes: num(process.env.TRACKING_SYNC_MINUTES, 30),
  },
};

function validate() {
  const missing = [];
  if (!cfg.shopify.domain) missing.push('SHOPIFY_SHOP_DOMAIN');
  if (!cfg.shopify.adminToken) {
    if (!cfg.shopify.clientId) missing.push('SHOPIFY_CLIENT_ID');
    if (!cfg.shopify.clientSecret) missing.push('SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)');
  }
  for (const k of ['host', 'database', 'user', 'password']) if (!cfg.db[k]) missing.push('DB_' + k.toUpperCase());
  if (!cfg.portal.password) missing.push('PORTAL_PASSWORD');
  if (cfg.portal.secret.length < 24) missing.push('SESSION_SECRET (min 24 chars)');
  if (missing.length) throw new Error('Missing/invalid env: ' + missing.join(', '));
}

module.exports = { cfg, validate };
