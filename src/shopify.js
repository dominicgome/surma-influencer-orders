'use strict';
const { cfg } = require('./config');

const S = cfg.shopify;
const GQL_URL = () => `https://${S.domain}/admin/api/${S.version}/graphql.json`;

// ---------------------------------------------------------------- auth
// Dev Dashboard apps use the client-credentials grant (token valid ~24h). A static shpat_ token also works.
let tokenCache = { token: null, exp: 0 };

async function getToken(force = false) {
  if (S.adminToken) return S.adminToken;
  if (!force && tokenCache.token && Date.now() < tokenCache.exp - 120000) return tokenCache.token;
  const res = await fetch(`https://${S.domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: S.clientId, client_secret: S.clientSecret }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`Shopify auth failed (${res.status}): ${j.error_description || j.error || 'check client id/secret and that the app is installed on the store'}`);
  }
  tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86400) * 1000 };
  return tokenCache.token;
}

// ---------------------------------------------------------------- graphql
async function gql(query, variables = {}, attempt = 0) {
  const token = await getToken();
  const res = await fetch(GQL_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 && attempt < 1 && !S.adminToken) { await getToken(true); return gql(query, variables, attempt + 1); }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    return gql(query, variables, attempt + 1);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  if (j.errors && j.errors.length) {
    const throttled = j.errors.some((e) => e.extensions && e.extensions.code === 'THROTTLED');
    if (throttled && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); return gql(query, variables, attempt + 1); }
    throw new Error('Shopify: ' + j.errors.map((e) => e.message).join('; '));
  }
  return j.data;
}

const userErr = (errs) => (errs || []).map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ');

// ---------------------------------------------------------------- product lookup
function parseProductUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  const m = u.pathname.match(/\/products\/([^/?#]+)/i);
  if (!m) return null;
  const variant = u.searchParams.get('variant');
  return { handle: decodeURIComponent(m[1]).toLowerCase(), variantId: variant && /^\d+$/.test(variant) ? variant : null };
}

const normSize = (s) => String(s || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');

function productQuery() {
  const levels = S.locationGid
    ? `inventoryLevels(first: 50) { nodes { location { id } quantities(names: ["available"]) { name quantity } } }`
    : '';
  return `query($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id title handle status
      variants(first: 100) { nodes {
        id title sku inventoryQuantity inventoryPolicy
        selectedOptions { name value }
        inventoryItem { id tracked ${levels} }
      } }
    }
  }`;
}

async function fetchProduct(handle) {
  const d = await gql(productQuery(), { handle });
  return d.productByIdentifier || null;
}

function availableQty(variant) {
  if (S.locationGid) {
    const lvl = (variant.inventoryItem?.inventoryLevels?.nodes || []).find((n) => n.location.id === S.locationGid);
    const q = lvl && lvl.quantities.find((x) => x.name === 'available');
    return q ? q.quantity : 0;
  }
  return variant.inventoryQuantity ?? 0;
}

function pickVariant(product, size, urlVariantId) {
  const vs = product.variants.nodes;
  if (size) {
    const want = normSize(size);
    const sizeOpt = vs.filter((v) => v.selectedOptions.some((o) => /^size$/i.test(o.name) && normSize(o.value) === want));
    const any = vs.filter((v) => v.selectedOptions.some((o) => normSize(o.value) === want));
    return (sizeOpt[0] || any[0]) || null;
  }
  if (urlVariantId) return vs.find((v) => v.id.endsWith('/' + urlVariantId)) || null;
  return vs.length === 1 ? vs[0] : null;
}

/**
 * items: [{ url, size, qty }]  ->  { ok, items: [{... ok, reason, available}] }
 * Stock is aggregated per variant so the same SKU listed twice cannot oversell.
 */
async function checkItems(items) {
  const cache = new Map();
  const out = [];
  for (const it of items) {
    const row = { url: it.url, size: it.size || '', qty: it.qty || 1, ok: false };
    const p = parseProductUrl(it.url);
    if (!p) { row.reason = 'Not a valid Shopify product link (/products/...)'; out.push(row); continue; }
    row.handle = p.handle;
    if (!cache.has(p.handle)) cache.set(p.handle, await fetchProduct(p.handle));
    const product = cache.get(p.handle);
    if (!product) { row.reason = 'Product not found on store'; out.push(row); continue; }
    row.title = product.title;
    if (product.status !== 'ACTIVE') { row.reason = `Product is ${product.status.toLowerCase()}, not live`; out.push(row); continue; }
    const v = pickVariant(product, it.size, p.variantId);
    if (!v) {
      const sizes = [...new Set(product.variants.nodes.flatMap((x) => x.selectedOptions.filter((o) => /^size$/i.test(o.name)).map((o) => o.value)))];
      row.reason = it.size ? `Size "${it.size}" not found${sizes.length ? ' (available sizes: ' + sizes.join(', ') + ')' : ''}` : 'Size required for this product';
      out.push(row); continue;
    }
    row.variantId = v.id; row.sku = v.sku || ''; row.variantTitle = v.title; row.available = availableQty(v);
    out.push(row);
  }
  const demand = {};
  for (const r of out) if (r.variantId) demand[r.variantId] = (demand[r.variantId] || 0) + r.qty;
  for (const r of out) {
    if (!r.variantId) continue;
    if (r.available >= demand[r.variantId]) r.ok = true;
    else r.reason = r.available <= 0 ? 'Out of stock' : `Only ${r.available} in stock (need ${demand[r.variantId]})`;
  }
  return { ok: out.length > 0 && out.every((r) => r.ok), items: out };
}

// ---------------------------------------------------------------- draft order -> order
async function createDraft({ customer, items, note }) {
  const addr = {
    firstName: customer.firstName, lastName: customer.lastName, address1: customer.address1,
    city: customer.city, province: customer.stateName, provinceCode: customer.stateCode,
    zip: customer.pincode, countryCode: 'IN', phone: customer.phone,
  };
  const input = {
    email: customer.email,
    phone: customer.phone,
    ...(note ? { note } : {}),
    ...(cfg.rules.orderTag ? { tags: [cfg.rules.orderTag] } : {}),
    customAttributes: [{ key: 'source', value: 'influencer-portal' }],
    lineItems: items.map((i) => ({ variantId: i.variantId, quantity: i.qty })),
    appliedDiscount: { title: cfg.rules.discountTitle, description: cfg.rules.discountTitle, value: 100, valueType: 'PERCENTAGE' },
    shippingLine: { title: 'Free Shipping', price: '0.00' },
    shippingAddress: addr,
    billingAddress: addr,
  };
  const d = await gql(
    `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name status totalPriceSet { shopMoney { amount } } }
        userErrors { field message }
      }
    }`, { input });
  const r = d.draftOrderCreate;
  if (r.userErrors.length) throw new Error('Draft order rejected: ' + userErr(r.userErrors));
  return r.draftOrder;
}

async function getDraft(id) {
  const d = await gql(
    `query($id: ID!) { draftOrder(id: $id) { id name status totalPriceSet { shopMoney { amount } } order { id name createdAt } } }`, { id });
  return d.draftOrder;
}

async function deleteDraft(id) {
  try {
    await gql(`mutation($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { message } } }`, { input: { id } });
  } catch (e) { console.error('[shopify] draft delete failed', e.message); }
}

async function completeDraft(id) {
  const d = await gql(
    `mutation($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { id status order { id name createdAt } }
        userErrors { field message }
      }
    }`, { id });
  const r = d.draftOrderComplete;
  if (r.userErrors.length) throw new Error('Could not complete draft: ' + userErr(r.userErrors));
  return r.draftOrder;
}

// ---------------------------------------------------------------- fulfilment / tracking
async function getOrderTracking(orderGid) {
  const d = await gql(
    `query($id: ID!) {
      order(id: $id) {
        id name tags cancelledAt displayFulfillmentStatus
        fulfillments(first: 10) { status displayStatus deliveredAt trackingInfo { company number url } }
      }
    }`, { id: orderGid });
  return d.order;
}

async function cancelOrder(orderGid, staffNote) {
  const d = await gql(
    `mutation($id: ID!, $restock: Boolean!, $note: String) {
      orderCancel(orderId: $id, reason: OTHER, restock: $restock, notifyCustomer: false, staffNote: $note) {
        job { id done }
        orderCancelUserErrors { field message code }
      }
    }`, { id: orderGid, restock: cfg.rules.cancelRestock, note: String(staffNote || '').slice(0, 250) });
  const r = d.orderCancel;
  if (r.orderCancelUserErrors.length) throw new Error('Shopify refused the cancellation: ' + userErr(r.orderCancelUserErrors));
  return r.job;
}

module.exports = {
  cancelOrder, gql, parseProductUrl, normSize, checkItems, createDraft, getDraft, deleteDraft, completeDraft, getOrderTracking, getToken,
};
