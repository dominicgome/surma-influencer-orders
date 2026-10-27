-- Safe to run multiple times. Creates ONE new table; no existing tables are touched.
CREATE TABLE IF NOT EXISTS influencer_orders (
  id                       SERIAL PRIMARY KEY,
  request_key              UUID UNIQUE NOT NULL,            -- idempotency: double-click / retry can never create 2 orders
  created_by               TEXT NOT NULL DEFAULT 'portal',
  customer_name            TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  email                    TEXT NOT NULL,
  address1                 TEXT NOT NULL,
  city                     TEXT NOT NULL,
  state                    TEXT NOT NULL,
  pincode                  TEXT NOT NULL,
  country_code             TEXT NOT NULL DEFAULT 'IN',
  items                    JSONB NOT NULL,                  -- [{url, handle, size, qty, variantId, sku, title}]
  status                   TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | CREATED | FAILED | CANCELLED
  error                    TEXT,
  shopify_draft_id         TEXT,
  shopify_order_id         TEXT,
  shopify_order_name       TEXT,
  shopify_order_created_at TIMESTAMPTZ,
  delivery_status          TEXT NOT NULL DEFAULT 'UNFULFILLED', -- from Shopify fulfillment displayStatus
  tracking                 JSONB NOT NULL DEFAULT '[]',     -- [{company, number, url, status}]
  delivered_at             TIMESTAMPTZ,
  last_synced_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_orders_status  ON influencer_orders (status, delivery_status);
CREATE INDEX IF NOT EXISTS idx_influencer_orders_created ON influencer_orders (created_at DESC);

-- v2: cancellation support (idempotent; the server also runs this file at startup)
ALTER TABLE influencer_orders ADD COLUMN IF NOT EXISTS shopify_tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE influencer_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE influencer_orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
