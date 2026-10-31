# Surma Influencer Orders Portal

Internal portal to create **100% discounted "INFLUENCER" orders** on Shopify (live Admin GraphQL API), with a stock check before creation and automatic tracking sync back from Shopify fulfilments.

## How it works

1. Enter Name, Address, City, State, Pin code, Phone, Email, **Products** (comma-separated product page links) and **Size** (comma-separated, same order; `M*2` = quantity 2).
2. **Check availability** - each link is resolved to its Shopify variant by size and live stock is read. Every item must be in stock.
3. **Create order** unlocks only when all items pass. The server re-checks stock itself, then:
   - `draftOrderCreate` with a 100% `appliedDiscount` titled **INFLUENCER** (shows on the order's Discount line, same as your sample order #241040), free shipping line. No tag and no note by default (`ORDER_TAG` / `ORDER_NOTE` can be set if ever needed)
   - safety guard: the draft total must be exactly **0** or nothing is completed
   - `draftOrderComplete` -> real order (e.g. `#12345`) appears in Shopify and flows to Unicommerce through your existing Shopify integration
4. Order No., Order Date and tracking links appear in the same row and in the **Order history** tab. A background job (every 30 min, set `TRACKING_SYNC_MINUTES`) reads Shopify fulfilments and updates **delivery status** until `Delivered`.

### Excel / CSV upload
- **Upload Excel / CSV** fills the grid from a file (.xlsx, .xls or .csv, max 100 rows). **Download template** gives the exact headings: Name, Address, City, State, Pin code, Phone Number, Email ID, Products (comma separated links), Size.
- Headings are matched loosely (e.g. "Mobile", "Pin", "Products (Coma seperated)"), and unrelated columns such as Order Date / Order Number / Tracking link are ignored, so your existing sheet layout can be uploaded as is.
- Multiple products in one cell can be comma-separated or on separate lines; sizes go in the same order (`M, L`, or `M*2` for quantity 2).
- **Uploading never creates orders.** It only fills rows. Problems (bad phone, 6-digit pin code, email, unknown state) show as yellow tags and block that row's Create button. Use **Check availability for all rows**, review, then click **Create order** on each row.
- The Excel reader (SheetJS 0.20.3, Apache-2.0) is bundled in `public/vendor/`, so nothing is loaded from the internet and the file is read in the browser only.

### Cancelling an order
- In **Order history & tracking**, each created order has a **Cancel order** button (hidden once delivered).
- **Rule:** an order can be cancelled only while Shopify shows the tag **`ON_HOLD_ORDER_CP`** on it. The server checks the tag **live in Shopify at the moment of the click** (not from cached data), so the rule cannot be bypassed from the browser. Orders without the tag, or already shipped, are refused with a clear message. Orders that currently have the tag show an "On hold (can cancel)" label (updated by the 30-minute sync).
- On success the order is cancelled in Shopify (the customer is **not** emailed; an internal note records who cancelled it) and the portal status changes to Cancelled. Cancellation is asynchronous in Shopify: if it is not confirmed within about 8 seconds, click Refresh a minute later.
- Settings (`.env`): `CANCEL_REQUIRED_TAG` (default `ON_HOLD_ORDER_CP`) and `CANCEL_RESTOCK` (default `false`, i.e. stock is **not** added back in Shopify because Unicommerce owns inventory; set `true` if you want Shopify to restock on cancel).
- The new database columns are added automatically when the server starts (`npm run db:init` also works).

### Times (IST)
- Every date/time in the portal is shown in **Indian Standard Time (IST)**, labelled "IST", regardless of the time zone of the viewer's PC. Hover over any time to see the raw UTC value received from Shopify/the database.
- The delivered time comes from the fulfilment record in Shopify (as pushed by the courier/Unicommerce integration). If it differs from what the courier shows, the difference is in the source value (compare with the hover tooltip), not in the portal's conversion.
- The server process (`TZ=Asia/Kolkata` in `ecosystem.config.js`) and its database connection also run in IST. Stored timestamps are absolute (`TIMESTAMPTZ`), so nothing shifts.

Safety built in: shared-password login (signed cookie), idempotency key per row (double-click/retry can never create 2 orders), resume of half-created drafts, max items/qty guards, everything logged in the `influencer_orders` table.

## Shopify app setup (one-time)

In the Shopify Dev Dashboard app **(Client ID `1b09915b818b38109708d16c0b026884`)**:

- Scopes: `read_products`, `read_inventory`, `write_draft_orders`, `read_draft_orders`, `write_orders`, `read_orders`, `read_fulfillments`  (add `read_locations` only if you set `SHOPIFY_LOCATION_ID`)
- Install the app on `344a51-89.myshopify.com`
- Copy the app's **Client secret** into `.env` as `SHOPIFY_CLIENT_SECRET` (the portal fetches/refreshes its own 24-hour token). If you already have a static `shpat_...` token, put it in `SHOPIFY_ADMIN_TOKEN` instead.

## Deploy - Windows PowerShell + Git

### A. Push the code to GitHub (on your Windows PC)

```powershell
cd C:\path\to\influencer-orders
git init
git add .
git commit -m "Influencer orders portal"
git branch -M main
git remote add origin https://github.com/dominicgome/surma-influencer-orders.git
git push -u origin main
```

Create the empty repo `surma-influencer-orders` under github.com/dominicgome first (set it **Private**). `.env` and `*.pem` are git-ignored - secrets never go to GitHub.

### B. Connect to the server (PowerShell)

```powershell
ssh -i "$HOME\Downloads\surma-backend-staging.pem" ec2-user@13.203.54.61
```

If Windows complains the key is "too open":

```powershell
icacls "$HOME\Downloads\surma-backend-staging.pem" /inheritance:r
icacls "$HOME\Downloads\surma-backend-staging.pem" /grant:r "$($env:USERNAME):(R)"
```

### C. On the server (one-time)

```bash
node -v            # need v18+ ; if missing:  sudo dnf install -y nodejs20   (Amazon Linux 2023)
sudo npm install -g pm2
git clone https://github.com/dominicgome/surma-influencer-orders.git
cd surma-influencer-orders
npm ci --omit=dev
cp .env.example .env
nano .env          # fill SHOPIFY_CLIENT_SECRET, DB_PASSWORD, PORTAL_PASSWORD, SESSION_SECRET
```

Generate a session secret: `openssl rand -hex 32`

```bash
npm run db:init                      # creates the influencer_orders table (safe to re-run)
pm2 start ecosystem.config.js
pm2 save
pm2 startup                          # run the sudo command it prints, so it survives reboots
curl localhost:3000/api/health       # -> {"ok":true}
```

### D. Network access

- **RDS**: the database security group must allow inbound 5432 from this EC2 instance's security group.
- **Portal port**: open TCP 3000 in the EC2 security group **only for your office/home IPs** (not 0.0.0.0/0). Then browse to `http://13.203.54.61:3000`.
- **Recommended**: put nginx + HTTPS (a domain such as `influencer.yourdomain.com`) in front, then set `COOKIE_SECURE=true`. The login password travels in clear text over plain HTTP.

### E. Updating later

```powershell
# Windows
git add . ; git commit -m "change" ; git push
```
```bash
# Server
cd ~/surma-influencer-orders && git pull && npm ci --omit=dev && pm2 restart surma-influencer-orders
```

## Things to verify on the first live test

| Check | Why |
|---|---|
| Create **one** order for an internal address first | Confirms scopes, address format and the 0-value guard |
| Order total is exactly 0 | If your store has tax-exclusive pricing, the guard blocks creation (nothing is created) |
| Tracking appears | Shopify only has tracking if Unicommerce/ClickPost push the fulfilment + AWB back to Shopify. If they don't, the portal shows "Awaiting dispatch" - see below |
| Order appears in Unicommerce | The order with discount INFLUENCER should import like any other Shopify order |

**If tracking does not reach Shopify:** the portal can instead read AWB/status from the Unicommerce / ClickPost data already in your `Inventory` database. Send me the table name that holds order number -> AWB -> status and I'll add that as a second source.

## Operational risks / notes

- 100% discount orders count as sales in Shopify reports - filter them on **Discount title = INFLUENCER** (there is no tag). Add a filter in your sales/COD reconciliation dashboards so they aren't treated as COD or prepaid revenue.
- Orders hit real inventory and get picked/packed like normal orders - good for stock accuracy, but make sure the warehouse knows these ship at no charge.
- Shopify's Orders API shows only the last 60 days without `read_all_orders`; the sync stops tracking orders older than that.
- `ecosystem.config.js` runs a single instance on purpose (the sync cron lives in the app).
- Suggested KPIs: influencer orders per week, cost of goods + freight per influencer order, delivery TAT, RTO % on gifted orders.
