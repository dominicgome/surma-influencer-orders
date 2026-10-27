'use strict';
const { cfg } = require('./config');
const { resolveState } = require('./states');

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? '+91' + d : null;
}

/** "url1, url2" + "M, L*2"  ->  [{url, size, qty}] (sizes matched by position) */
function parseItems(productsRaw, sizesRaw) {
  const errors = [];
  const urls = String(productsRaw || '').split(',').map(clean).filter(Boolean);
  const sizes = String(sizesRaw || '').split(',').map(clean);
  while (sizes.length && !sizes[sizes.length - 1]) sizes.pop();
  if (!urls.length) errors.push('Add at least one product link');
  if (urls.length > cfg.rules.maxItems) errors.push(`Max ${cfg.rules.maxItems} products per order`);
  if (sizes.length && sizes.length !== urls.length) {
    errors.push(`${urls.length} product link(s) but ${sizes.length} size(s) - sizes must match the products one-to-one, in order`);
  }
  const items = urls.map((url, i) => {
    let size = sizes[i] || '';
    let qty = 1;
    const m = size.match(/^(.*?)\s*[*xX]\s*(\d+)$/); // "M*2" or "M x2"
    if (m) { size = clean(m[1]); qty = parseInt(m[2], 10); }
    if (qty < 1 || qty > cfg.rules.maxQty) errors.push(`Quantity per line must be 1-${cfg.rules.maxQty} (line ${i + 1})`);
    return { url, size, qty };
  });
  return { items, errors };
}

function validateOrder(b) {
  const errors = [];
  const name = clean(b.name);
  const address1 = clean(b.address);
  const city = clean(b.city);
  const pincode = String(b.pincode || '').replace(/\D/g, '');
  const email = clean(b.email).toLowerCase();
  const phone = normPhone(b.phone);
  const state = resolveState(b.state);
  if (name.length < 2) errors.push('Name is required');
  if (address1.length < 6) errors.push('Address is required');
  if (!city) errors.push('City is required');
  if (!state) errors.push('State not recognised (use the dropdown)');
  if (!/^[1-9]\d{5}$/.test(pincode)) errors.push('Pin code must be 6 digits');
  if (!phone) errors.push('Phone must be a valid 10-digit Indian mobile number');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is invalid');
  const { items, errors: itemErrors } = parseItems(b.products, b.sizes);
  errors.push(...itemErrors);
  const parts = name.split(' ');
  return {
    errors,
    value: {
      customer: {
        name, firstName: parts[0], lastName: parts.slice(1).join(' ') || '.',
        address1, city, stateName: state && state.name, stateCode: state && state.code, pincode, phone, email,
      },
      items,
    },
  };
}

module.exports = { validateOrder, parseItems, normPhone };
