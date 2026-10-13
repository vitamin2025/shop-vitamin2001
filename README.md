# Vitamin 2001 shop server

Vendure 3.7.3 backend for VITAMIN SHOP, a small Indian store. It serves the Admin API, the Shop API, product images, and the admin dashboard from one Node process. There is no storefront in this repository.

Default channel settings on first boot are English (`en`) and Indian Rupees (`INR`), with tax-inclusive prices. Change those in the dashboard later; the server will not overwrite them.

## Local development

Requirements: Node.js 22.12 or newer (this repo is pinned to the Node 22 line). npm 10 is enough.

```bash
cp .env.example .env
npm install
npm run dev
```

`npm run dev` starts the API and the dashboard dev server. Open:

- Dashboard: http://localhost:3000/dashboard
- Admin API: http://localhost:3000/admin-api
- Shop API: http://localhost:3000/shop-api
- Dev mailbox: http://localhost:3000/mailbox

Sign in with `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD` from `.env`. The example file uses `superadmin` / `superadmin`, which is only acceptable while `APP_ENV=dev`.

Local development defaults to SQLite (`DB_TYPE=sqlite`), which creates `vendure.sqlite` in the project root. SQLite is not used in production. To point a local server at MariaDB or MySQL, set `DB_TYPE=mariadb` (Hostinger) or `DB_TYPE=mysql` (MySQL 8) plus `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, and `DB_PASSWORD`, then run migrations before the first start:

```bash
npm run migration:run
```

The public port opens immediately and is the only `listen()` call. Until Vendure has finished starting, requests get HTTP 503 with the body `starting` (including `/health`). The Nest app is initialized without a second `listen()`, and the open server then hands each request to it. Pending migrations run during that window unless `RUN_MIGRATIONS=false`. On Hostinger, leave migrations off except for a deploy that adds one. Schema synchronize is on for local SQLite only. It is off for MySQL, MariaDB, and any production boot.

Generate a new migration after a schema change (custom fields, plugins) against the MySQL database:

```bash
npm run migration:generate -- add-something
```

That is `vendure migrate -g add-something`. Review the file in `src/migrations/` before committing it.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API (with the job queue inside it) and the dashboard dev server |
| `npm run build` | Compile the server and build the dashboard into `dist/` |
| `npm start` | Run the compiled server: `node dist/index.js` |
| `npm test` | End-to-end tests (a throwaway SQLite database, no setup needed) |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:generate -- <name>` | Write a new migration |
| `npm run doctor` | Vendure project checks |

`npm run start:worker` is not part of the Hostinger setup. See [DEPLOY-HOSTINGER.md](./DEPLOY-HOSTINGER.md).

## Sellers

The marketplace plugin (`src/plugins/marketplace/`) lets other businesses sell through this store. It is built on Vendure's [multi-vendor example](https://github.com/vendure-ecommerce/vendure/tree/master/packages/dev-server/example-plugins/multivendor-plugin).

- **The marketplace** is the default channel. It lists every seller's products, and a customer can buy from several sellers in one checkout.
- **Each seller** gets their own shop: a channel with its own login, stock location and shipping method. Sellers sign in at the same `/dashboard` and see only their own shop.
- **The store's own products** belong to the "Vitamin 2001" seller shop, which the plugin creates on startup (once the default channel has a tax zone and a shipping zone). Staff manage it by switching to that channel in the dashboard.

### Adding a seller

A seller applies through the Shop API with the `applyAsSeller` mutation (shop name, name, email, password, and optionally phone, GSTIN and FSSAI licence number). That saves a Pending seller whose login has no access yet.

You can also add a seller yourself under Settings → Sellers. Fill in at least the contact email.

To approve or reject, open the seller under Settings → Sellers and change **Status**:

| Status | What happens |
| --- | --- |
| Approved | Creates the seller's channel, a role limited to it, a stock location and a shipping method (₹0 to start), and gives the login that role. A seller you added yourself gets a login with a random password: set it under Settings → Administrators. |
| Pending | The login stays but loses its access. |
| Rejected | The login is deleted. |

If approval fails, the reason is in the server log. The usual cause is a default channel without a tax zone and a shipping zone.

### Storefront details

Each seller also has a **Slug**, a **Description**, a **Logo** and a **Banner** (Settings → Sellers). Staff edit them; sellers cannot.

The slug names the seller's storefront and may become its subdomain, so it is 1 to 63 lowercase letters, digits and hyphens, starting and ending with a letter or digit. `www`, `api`, `shop`, `admin`, `dashboard`, `mail`, `app`, `static`, `assets`, `cdn`, `auth`, `vitamin2001` and `marketplace` are reserved. A shop that opens without a slug gets its channel code (`-2`, `-3`… when another seller has it), so the "Vitamin 2001" shop is `vitamin-2001`. Sellers that had a shop before slugs existed get theirs on the next start.

The Shop API's `marketplaceSellers` and `marketplaceSeller(slug)` return the approved sellers with an open shop, with these details and each shop's channel token, whichever channel the request is for.

They also return each seller's GSTIN, FSSAI licence number and **Business address** (Settings → Sellers), or null when one is not given. The BE prints them on that seller's invoices.

### Deleting a seller

Delete the seller under Settings → Sellers. Their login is deleted and every product in their shop is disabled, so nothing of theirs stays on sale. Their channel, products and orders are kept, without a seller, so past orders stay intact. The "Vitamin 2001" shop cannot be deleted. To stop a seller for a while, set **Status** to Pending instead.

### What a seller can do

In their own shop: products, variants, prices, stock and images; their shipping methods and rates; their stock locations; their orders, including the buyer's delivery address, and marking them shipped or delivered. Every shipping method a seller creates applies only to their own items.

They cannot see other sellers' products or orders, create promotions, change payment methods, change their commission or status, or create or delete customers. Promotions stay with the store because a seller's discount would also apply to other sellers' items in the marketplace.

### Orders, commission and payouts

When a marketplace order is paid, it is split into one order per seller. Each seller ships their part, and the marketplace order moves to Shipped or Delivered once every seller has.

Customers pay the store. Each seller order records:

- **Commission %**: the seller's own **Commission %** (Settings → Sellers), or `MARKETPLACE_COMMISSION_PERCENT` when that is blank.
- **Commission**: that percentage of the order's items, including GST and after discounts, without shipping.
- **Owed to seller**: the order total minus the commission.
- **Seller payout**: Pending until the payments recorded under Settlements cover the order, then Paid. Payments settle a seller's oldest orders first. Only staff with the Update Settings permission see this field, and nobody edits it by hand.

### Settlements and payouts

Pay sellers outside the shop (UPI, bank transfer), then record each payment in the dashboard:

- **Settlements → Seller settlements** lists every seller with their sales, commission, what they earned, what you paid and what is still pending, plus totals for the store. Open a seller for their payments, monthly sales, orders and payout methods, and **Record payment**: choose the amount (all pending, or only delivered orders), the seller's payout method (its account details are shown so you can pay to them), the date, the transaction ID and any details. A payment entered by mistake can be edited, or voided with a reason; it stays on record.
- **Settlements → Payout methods** lists the methods sellers can choose. UPI, NEFT, IMPS, Other and Custom come built in. Add your own with the details a seller must fill in, mark each detail required or optional, or turn a method off.
- Sellers see **Payments** in their own dashboard: what they earned and are owed, every payment with the account it went to and its transaction ID, and their payout methods, which they add and edit themselves.

Pending is what a seller earned on paid, uncancelled orders minus the payments recorded. Refunds don't lower it; edit or void a payment if a refund changes what you owe. The house shop is the store's own, so it is not listed.

Staff need the **ManageSellerPayouts** permission (the superadmin has it). Seller roles get **ManageOwnPayouts**; roles created before this release get it on the next start, and a seller who is signed in sees Payments after signing in again. Orders already marked Paid before this release become one "Recorded before settlements" payment per seller, so their pending amount stays right.

### Seller storefronts

A storefront that sends a seller's channel token (the `vendure-token` header; the token is on the channel under Settings → Channels, and in `marketplaceSellers`) shows only that seller's products. The BE sends it for a seller's own storefront. Its orders are not split, and the commission is recorded the same way.

### Dashboard branding

The dashboard is branded VITAMIN SHOP: the logo and welcome text on the sign-in page, the logo in the top bar and the tab title come from `src/plugins/branding/`; the favicon (`static/dashboard/`) and the blue theme are set in `vite.config.mts`. The small "Vendure" version badge under the sign-in form and in the user menu stays: Vendure's dashboard keeps it on purpose as its attribution.

## Storefront backend

Storefronts do not call this API themselves. They call the vitamin2001.in backend (the BE), which calls the Shop API from its own server. `src/plugins/be-bridge/` is this end of that link. Both apps share `SHOP_BRIDGE_SECRET` (the same value, at least 32 characters).

- **Sign-in.** The BE signs a customer in with `authenticate(input: { vitamin2001: { token } })`, a token signed with the shared secret that lasts a minute. The first sign-in creates the customer. Later ones, on the marketplace or a seller's channel, reuse it and take the name and phone number from the BE. A guest basket moves into the customer's order.
- **Payment.** The `payu` payment method is created on startup and shared with every seller shop. It settles an order only with a payment confirmation the BE signed for that order's code and total. Anything else is declined with "Payment confirmation is invalid". Refunds are not sent to PayU: refund in the PayU dashboard, then record the refund on the order.
- **Events.** The server POSTs signed events to `BE_EVENTS_URL`: `seller.updated`, `seller.deleted`, `order.shipped` and `order.delivered`. They go through the job queue and are retried 5 times (after 10 s, 20 s, 40 s, 80 s and 160 s) when the BE does not answer 2xx. Without `SHOP_BRIDGE_SECRET` or `BE_EVENTS_URL` no events are sent, and the log says so at startup.

## Production build

```bash
npm run build
npm start
```

`npm start` binds `PORT` (or 3000) immediately, answers `503 starting` while Vendure boots, then hands requests to the initialized Nest app. The compiled dashboard is at `/dashboard`. Hostinger's process manager ignores any second `listen()`, so this process never calls it again.

## Adding a storefront later

Leave this app as the commerce API. Storefronts are separate sites that go through the BE (see "Storefront backend"); host them on their own, not inside this process. A storefront that calls `https://shop.vitamin2001.in/shop-api` from the browser needs its origin in `CORS_ORIGINS`. Deployment steps for this API are in [DEPLOY-HOSTINGER.md](./DEPLOY-HOSTINGER.md).
