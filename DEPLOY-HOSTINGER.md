# Deploy this shop on Hostinger

This is the Vendure server only: admin dashboard, Admin API, Shop API, and product images. Deploy it as **one** Node.js web app.

Recommended hostname: **`shop.vitamin2001.in`**.

Keep the API on that same host (`/admin-api`, `/shop-api`, `/assets`, `/dashboard`). A second app such as `shop-api.vitamin2001.in` would be another always-on Node process and another web-app slot, talking to the same database. Hostinger Business hosting allows a small number of web apps (5 on the current Business plan). One subdomain is the right fit.

A future storefront (for example the [Vendure Next.js starter](https://github.com/vendurehq/nextjs-starter-vendure)) should be a separate site on `vitamin2001.in` or `www.vitamin2001.in`, calling `https://shop.vitamin2001.in/shop-api`. Add that origin to `CORS_ORIGINS`.

## Plan check before you start

Current Hostinger docs (September 2026) say Node.js web apps are available on **Business Web Hosting** and the **Cloud** plans (Startup, Professional, Enterprise, Enterprise Plus). They are not on the Premium or Single plans.

The Business plan is the one marketed with unlimited websites. If hPanel has no "Node.js web app" / Web Apps entry, the plan needs an upgrade before this project can run there. Postgres, Redis, and Docker are not available on these plans. This project does not use them.

Vendure 3.7 needs **Node.js 22.12+** (20.19+ and 24 also work upstream). This repo's `engines` field is `>=22.12.0 <23`, and Hostinger offers Node 22. Select **22**. Do not select 18.

## What to enter in hPanel

Websites → Add Website → Node.js web app → Import the GitHub repository.

| Field | Value |
| --- | --- |
| Framework preset | **Other**. Do not use the NestJS preset. That preset expects `dist/main.js` from the Nest CLI. This app compiles with `tsc` to `dist/index.js`. |
| Branch | The branch you want live (usually `main` after this pull request is merged) |
| Node.js version | **22** |
| Root directory | `/` (the repository root; `package.json` is there) |
| Package manager | **npm** |
| Build command | `build` |
| Output directory | Leave empty. For the Other preset, Hostinger ignores it when an entry file is set. If the field is required, use `dist`. |
| Entry file | `dist/index.js` |

If a deploy fails because it looked for `dist/dist/index.js`, the panel treated the entry file as relative to the output directory. In that case set the output directory to `dist` and the entry file to `index.js`. The build copies email templates into `dist/static/email/templates`, so that layout can still find them.

Set the environment variables in the same screen, **before** the first deploy. The dashboard build loads the Vendure config, and a production config refuses to load without them. Hostinger does not read a committed `.env`. Do not commit real secrets.

`PORT` is injected by Hostinger. Leave it unset unless the form requires a value. The server binds to `process.env.PORT`.

## Environment variables

Generate two secrets locally before you paste them in:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run that twice. One value is `COOKIE_SECRET`, the other is `SUPERADMIN_PASSWORD`.

| Name | Value |
| --- | --- |
| `APP_ENV` | `production` |
| `NODE_ENV` | `production` |
| `SUPERADMIN_USERNAME` | `superadmin` (or another username you will remember) |
| `SUPERADMIN_PASSWORD` | the long random password from above. `superadmin` is rejected. |
| `COOKIE_SECRET` | the other random string, at least 32 characters |
| `DB_TYPE` | `mariadb` |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `DB_NAME` | the database name hPanel shows, like `u123456789_shop` |
| `DB_USERNAME` | the database user hPanel shows |
| `DB_PASSWORD` | the database user's password |
| `DB_POOL_SIZE` | `5` |
| `ASSET_URL_PREFIX` | `https://shop.vitamin2001.in/assets/` |
| `ASSET_UPLOAD_DIR` | a directory **outside** `hbuilds/` and `public_html/`. See below. |
| `CORS_ORIGINS` | `https://vitamin2001.in,https://www.vitamin2001.in` |
| `STOREFRONT_URL` | `https://vitamin2001.in` |
| `EMAIL_FROM` | `"Vitamin 2001" <noreply@vitamin2001.in>` |
| `DEFAULT_CURRENCY` | `INR` |
| `DEFAULT_LANGUAGE_CODE` | `en` |
| `PRICES_INCLUDE_TAX` | `true` |
| `APPLY_STORE_DEFAULTS` | `true` |
| `RUN_MIGRATIONS` | `true` |
| `RUN_JOB_QUEUE_IN_SERVER` | `true` |
| `RUN_TASKS_IN_WORKER_ONLY` | `false` |
| `JOB_QUEUE_POLL_INTERVAL_MS` | `5000` |
| `ALLOW_DUMMY_PAYMENTS` | `false` |

Optional, when you have SMTP (Hostinger email or another provider):

| Name | Value |
| --- | --- |
| `SMTP_HOST` | your SMTP host |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | the mailbox user |
| `SMTP_PASSWORD` | the mailbox password |
| `SMTP_SECURE` | `false` for port 587, `true` for port 465 |

Until `SMTP_HOST` is set, the app starts but does not send mail, and it does not expose the dev mailbox.

Changing `SUPERADMIN_PASSWORD` after the first successful boot does not change the existing administrator. Set the password in the dashboard (Settings → Administrators), or set the env var correctly before the first start.

## Create the MySQL database

Hostinger's shared plans provide MySQL only. On current accounts that server is MariaDB, which Vendure supports. This project's migration was generated with the MariaDB driver against MariaDB 10.11.

1. hPanel → Databases → MySQL Databases → Create database.
2. A user is created with the database. Copy the database name, username, and password into the env vars above.
3. Set `DB_HOST=127.0.0.1`, not `localhost`.

Hostinger's database docs (updated August 2026) say PHP can use `localhost` because it connects through a socket. Node.js connects over TCP, resolves `localhost` to IPv6 `::1`, and then fails with `Access denied for user ... @'::1'`. `127.0.0.1` forces IPv4. You do **not** need Remote MySQL for an app on the same hosting account.

You do not need to import a SQL file. The app creates the tables itself.

## Migrations

`synchronize` is off whenever `DB_TYPE` is `mysql` or `mariadb`, and it is off whenever `APP_ENV=production`.

On startup, `dist/index.js` runs any pending migrations and then listens. That is the production path, because Business and Cloud plans run `npm install` and the build command during deploy, and they do not give you a shell in which to run `npm run migration:run`.

Locally, against a MySQL or MariaDB database:

```bash
npm run migration:run
```

To add a migration after a schema change:

```bash
npm run migration:generate -- describe-the-change
```

Review `src/migrations/`, commit it, and deploy. The next boot applies it.

MySQL and MariaDB cannot roll a failed DDL statement back inside a transaction. Export the database from phpMyAdmin before you deploy a new migration.

The first boot also sets the default channel to INR and English if it is still the stock USD channel Vendure creates. Later edits in the dashboard are left alone.

Use `DB_TYPE=mariadb` on Hostinger. A boot against MariaDB 10.11 with that driver applies this migration and does not report a schema mismatch. `DB_TYPE=mysql` against the same MariaDB server still runs, but TypeORM then logs a false "schema does not match" warning because MariaDB stores `json` as `longtext`. Do not turn synchronize on to clear that warning. Switch the driver to `mariadb` instead.

## How the admin dashboard is served

`npm run build` writes the dashboard to `dist/dashboard`. The same Node process serves it at:

https://shop.vitamin2001.in/dashboard

There is no second static site and no separate admin subdomain. Log in with `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD`.

Other paths on the same host:

| Path | Purpose |
| --- | --- |
| `/admin-api` | Admin GraphQL API |
| `/shop-api` | Shop GraphQL API (for a future storefront) |
| `/assets/...` | Product images |
| `/health` | Process health check (built into Vendure) |

GraphiQL and the dev mailbox are not mounted when `APP_ENV=production`.

## Product images

The default directory is `static/assets` inside the app. Hostinger keeps only the live build under `~/domains/shop.vitamin2001.in/hbuilds/versions/<id>/` and deletes the previous one after a successful deploy. Files inside that tree, including uploaded images, disappear on the next deploy. The database rows remain, and the images 404.

Set `ASSET_UPLOAD_DIR` to a folder next to `hbuilds`, not inside it. For example:

```text
/home/<hPanel username>/vitamin2001-shop-assets
```

The Node process has to be allowed to create that directory. After the first boot, upload a test image in the dashboard, redeploy, and confirm the file is still there. If the directory is not writable, keep the default for now and copy `static/assets` out before every deploy, or move images to object storage later.

`ASSET_URL_PREFIX` must be `https://shop.vitamin2001.in/assets/` so the API returns public image URLs.

## One process, and the job queue

Hostinger runs the entry file as a single Node process and stops it after a period with no requests. A second always-on worker is not available, and `npm` scripts cannot be started over SSH.

This app uses Vendure's `DefaultJobQueuePlugin`, which stores jobs in MySQL (`job_record`). `dist/index.js` calls `JobQueueService.start()` in the same process, and scheduled tasks are allowed to run there (`runTasksInWorkerOnly` is false unless you set `RUN_TASKS_IN_WORKER_ONLY=true`). Nothing uses Redis. The search index is the built-in database index, not Elasticsearch.

Trade-off: Vendure's own guidance is to run a separate worker so a long job does not share the API process, and so jobs keep moving while the API is busy. On this plan that second process does not stay up. Jobs and scheduled tasks run only while this process is awake. They survive a sleep or a restart because they are rows in MySQL, and they resume on the next request. Polling is every 5 seconds instead of the default 200ms, so a quiet shop does not hammer the shared database. For a small catalog that is a reasonable compromise. It will feel slow if you later import thousands of products or send large bursts of email.

If you move to a VPS later:

1. Run `node dist/index.js` for HTTP.
2. Run `node dist/index-worker.js` as a second service.
3. Set `RUN_JOB_QUEUE_IN_SERVER=false` and `RUN_TASKS_IN_WORKER_ONLY=true` on the HTTP process.

Do not point Hostinger's entry file at `dist/index-worker.js`. That process has no HTTP port, so the site will not come up.

## Resource limits

Vendure's docs put a small idle server around 200–300 MB of RAM, and about 512 MB as a practical minimum under light traffic. Combining the worker into the server avoids a second process of that size. It is still a large app for shared hosting. Watch the CPU and RAM graphs in the Node.js dashboard. If the process is killed, or the dashboard is too slow to use, a Cloud plan or a VPS is the next step. Horizontal scaling (several Node processes) is not a fit for this hosting product.

`sharp` (image previews) and `mysql2` ship prebuilt binaries for Node 22. A failed build that mentions those packages is a Node version mismatch. Stay on 22.

Vendure 3.7 has an experimental prebundled dashboard (`useExperimentalBundle`). It is left off. With the dashboard mounted at `/dashboard`, that mode fails to detect the base path and the UI renders "Not Found". The normal Vite build is what this project ships.

## After the first deploy

1. Open https://shop.vitamin2001.in/health and expect HTTP 200.
2. Open https://shop.vitamin2001.in/dashboard and sign in.
3. Settings → Channels: confirm the default channel is INR and English. Add India as a tax zone and your GST rates before taking orders.
4. Payments: dummy payments are disabled in production. Checkout needs a real handler (Razorpay is the usual choice in India) before the shop can charge customers. That plugin is not included yet.
5. Settings → Administrators: change the password if it was ever written down in a ticket, then update `SUPERADMIN_PASSWORD` so a future empty database would recreate the same user.

## What will not work on this plan

- Postgres, Redis, BullMQ, or a Docker Compose stack.
- A separate always-on worker or cron started from SSH.
- Node 18.
- Storing product images only inside the deploy directory across redeploys.
- Assuming `localhost` as the database host.
