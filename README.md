# Vitamin 2001 shop server

Vendure 3.7.3 backend for a small Indian store. It serves the Admin API, the Shop API, product images, and the admin dashboard from one Node process. There is no storefront in this repository.

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

The server also runs pending migrations on startup unless `RUN_MIGRATIONS=false`. Schema synchronize is on for local SQLite only. It is off for MySQL, MariaDB, and any production boot.

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

### What a seller can do

In their own shop: products, variants, prices, stock and images; their shipping methods and rates; their stock locations; their orders, including the buyer's delivery address, and marking them shipped or delivered. Every shipping method a seller creates applies only to their own items.

They cannot see other sellers' products or orders, create promotions, change payment methods, change their commission or status, or create or delete customers. Promotions stay with the store because a seller's discount would also apply to other sellers' items in the marketplace.

### Orders, commission and payouts

When a marketplace order is paid, it is split into one order per seller. Each seller ships their part, and the marketplace order moves to Shipped or Delivered once every seller has.

Customers pay the store. Each seller order records:

- **Commission %**: the seller's own **Commission %** (Settings → Sellers), or `MARKETPLACE_COMMISSION_PERCENT` when that is blank.
- **Commission**: that percentage of the order's items, including GST and after discounts, without shipping.
- **Owed to seller**: the order total minus the commission.
- **Seller payout**: Pending until you pay the seller and set it to Paid. Only staff with the Update Settings permission see this field, so sellers cannot mark themselves paid.

### Seller storefronts

A storefront that sends a seller's channel token (the `vendure-token` header; the token is on the channel under Settings → Channels) shows only that seller's products. Its orders are not split, and the commission is recorded the same way. Add each storefront's origin to `CORS_ORIGINS`.

## Production build

```bash
npm run build
npm start
```

`npm start` listens on `PORT` (or 3000). The compiled dashboard is served at `/dashboard`.

## Adding a storefront later

Leave this app as the commerce API. A Next.js storefront can be a second project (the [official Vendure Next.js starter](https://github.com/vendurehq/nextjs-starter-vendure) is the one the email links in this config already match). Point it at `https://shop.vitamin2001.in/shop-api` and add its origin to `CORS_ORIGINS`. Host it as its own site, not inside this process. Deployment steps for this API are in [DEPLOY-HOSTINGER.md](./DEPLOY-HOSTINGER.md).
