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
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:generate -- <name>` | Write a new migration |
| `npm run doctor` | Vendure project checks |

`npm run start:worker` is not part of the Hostinger setup. See [DEPLOY-HOSTINGER.md](./DEPLOY-HOSTINGER.md).

## Production build

```bash
npm run build
npm start
```

`npm start` binds `PORT` (or 3000) immediately, answers `503 starting` while Vendure boots, then hands requests to the initialized Nest app. The compiled dashboard is at `/dashboard`. Hostinger's process manager ignores any second `listen()`, so this process never calls it again.

## Adding a storefront later

Leave this app as the commerce API. A Next.js storefront can be a second project (the [official Vendure Next.js starter](https://github.com/vendurehq/nextjs-starter-vendure) is the one the email links in this config already match). Point it at `https://shop.vitamin2001.in/shop-api` and add its origin to `CORS_ORIGINS`. Host it as its own site, not inside this process. Deployment steps for this API are in [DEPLOY-HOSTINGER.md](./DEPLOY-HOSTINGER.md).
