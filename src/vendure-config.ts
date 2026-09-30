import {
    CurrencyCode,
    DefaultJobQueuePlugin,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    LanguageCode,
    VendureConfig,
    dummyPaymentHandler,
} from '@vendure/core';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { DataSourceOptions } from 'typeorm';
import 'dotenv/config';
import path from 'path';

const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-not-for-production';

// APP_ENV is the switch for this app. NODE_ENV is not: Vite sets NODE_ENV=production
// while it builds the dashboard, including on a developer machine.
export const IS_PRODUCTION = process.env.APP_ENV === 'production';

export const serverPort = Number(process.env.PORT || process.env.VENDURE_SERVER_PORT || 3000);

function requiredInProduction(name: string, value: string | undefined, fallback: string): string {
    if (value) {
        return value;
    }
    if (IS_PRODUCTION) {
        throw new Error(
            `Missing ${name}. Set it in the Hostinger environment variables before starting the app.`,
        );
    }
    return fallback;
}

export const superadminUsername = requiredInProduction(
    'SUPERADMIN_USERNAME',
    process.env.SUPERADMIN_USERNAME,
    'superadmin',
);
export const superadminPassword = requiredInProduction(
    'SUPERADMIN_PASSWORD',
    process.env.SUPERADMIN_PASSWORD,
    'superadmin',
);
export const cookieSecret = requiredInProduction('COOKIE_SECRET', process.env.COOKIE_SECRET, DEV_COOKIE_SECRET);

if (IS_PRODUCTION) {
    if (superadminPassword === 'superadmin' || superadminPassword.length < 12) {
        throw new Error(
            'SUPERADMIN_PASSWORD must be at least 12 characters and must not be the default "superadmin" when APP_ENV=production.',
        );
    }
    if (cookieSecret.length < 32 || cookieSecret === DEV_COOKIE_SECRET) {
        throw new Error(
            'COOKIE_SECRET must be a unique random string of at least 32 characters in production.',
        );
    }
}

type SupportedDbType = 'better-sqlite3' | 'mysql' | 'mariadb';

export function resolveDbType(): SupportedDbType {
    const raw = (process.env.DB_TYPE || (IS_PRODUCTION ? 'mysql' : 'sqlite')).toLowerCase();
    if (raw === 'sqlite' || raw === 'better-sqlite3') {
        if (IS_PRODUCTION) {
            throw new Error(
                'SQLite is only for local development. Set DB_TYPE=mysql (or mariadb) in production.',
            );
        }
        return 'better-sqlite3';
    }
    if (raw === 'mysql' || raw === 'mariadb') {
        return raw;
    }
    throw new Error(`Unsupported DB_TYPE "${raw}". Use sqlite, mysql, or mariadb.`);
}

function dbConnectionOptions(): DataSourceOptions {
    const dbType = resolveDbType();
    const logging = process.env.DB_LOGGING === 'true';
    if (dbType === 'better-sqlite3') {
        return {
            type: 'better-sqlite3',
            database: path.join(__dirname, '../vendure.sqlite'),
            // Local SQLite has no committed migration (those are MySQL/MariaDB).
            // Production never takes this branch.
            synchronize: process.env.DB_SYNCHRONIZE !== 'false',
            logging,
        };
    }

    for (const name of ['DB_HOST', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'] as const) {
        if (!process.env[name]) {
            throw new Error(`Missing ${name}. MySQL/MariaDB connections are configured only from environment variables.`);
        }
    }

    return {
        type: dbType,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        timezone: 'Z',
        supportBigNumbers: true,
        bigNumberStrings: false,
        // Shared hosting connection limits are small. Keep the pool tight.
        extra: {
            connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
        },
        // Never synchronize a production schema. Pending migrations run from
        // src/start-vendure.ts, after the public port is already open.
        synchronize: false,
        logging,
        migrations: [path.join(__dirname, './migrations/*.+(js|ts)')],
    };
}

function storefrontUrl(pathname: string): string {
    const base = (process.env.STOREFRONT_URL || 'http://localhost:3001').replace(/\/$/, '');
    return `${base}${pathname}`;
}

export const assetUploadDir =
    process.env.ASSET_UPLOAD_DIR || path.join(__dirname, '../static/assets');

function emailTemplatesDir(): string {
    // `npm run build` copies the templates into dist/static so they are found
    // even if Hostinger's runtime root is the output directory.
    if (__dirname.endsWith(`${path.sep}dist`)) {
        return path.join(__dirname, 'static/email/templates');
    }
    return path.join(__dirname, '../static/email/templates');
}

function emailPlugin() {
    const templateLoader = new FileBasedTemplateLoader(emailTemplatesDir());
    const globalTemplateVars = {
        fromAddress: process.env.EMAIL_FROM || '"Vitamin 2001" <noreply@vitamin2001.in>',
        // Paths match the official Vendure Next.js storefront starter.
        verifyEmailAddressUrl: storefrontUrl('/verify'),
        passwordResetUrl: storefrontUrl('/reset-password'),
        changeEmailAddressUrl: storefrontUrl('/account/verify-email'),
    };
    const handlers = defaultEmailHandlers;

    if (!IS_PRODUCTION) {
        return EmailPlugin.init({
            devMode: true,
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers,
            templateLoader,
            globalTemplateVars,
        });
    }

    if (process.env.SMTP_HOST) {
        return EmailPlugin.init({
            handlers,
            templateLoader,
            globalTemplateVars,
            transport: {
                type: 'smtp',
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER || '',
                    pass: process.env.SMTP_PASSWORD || '',
                },
            },
        });
    }

    console.warn(
        'SMTP_HOST is not set. Transactional email will not be sent until SMTP settings are added. No mailbox route is exposed.',
    );
    return EmailPlugin.init({
        handlers,
        templateLoader,
        globalTemplateVars,
        transport: { type: 'none' },
    });
}

const allowDummyPayments = !IS_PRODUCTION || process.env.ALLOW_DUMMY_PAYMENTS === 'true';

export function parseCurrency(value: string | undefined): CurrencyCode {
    const code = (value || 'INR').toUpperCase();
    if (!Object.values(CurrencyCode).includes(code as CurrencyCode)) {
        throw new Error(`DEFAULT_CURRENCY "${code}" is not a Vendure CurrencyCode.`);
    }
    return code as CurrencyCode;
}

export function parseLanguage(value: string | undefined): LanguageCode {
    const code = (value || 'en').toLowerCase();
    if (!Object.values(LanguageCode).includes(code as LanguageCode)) {
        throw new Error(`DEFAULT_LANGUAGE_CODE "${code}" is not a Vendure LanguageCode.`);
    }
    return code as LanguageCode;
}

export const config: VendureConfig = {
    defaultLanguageCode: parseLanguage(process.env.DEFAULT_LANGUAGE_CODE),
    apiOptions: {
        port: serverPort,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        // Hostinger terminates TLS in front of the Node process.
        trustProxy: IS_PRODUCTION ? 1 : false,
        // Cookie sessions are enabled. Require a preflight header so a foreign
        // site cannot submit a login form into this API. The Vendure dashboard sends it.
        csrfPrevention: true,
        introspection: !IS_PRODUCTION,
        cors: {
            origin: IS_PRODUCTION
                ? (process.env.CORS_ORIGINS || '')
                      .split(',')
                      .map(origin => origin.trim())
                      .filter(Boolean)
                : true,
            credentials: true,
        },
        ...(IS_PRODUCTION
            ? {}
            : {
                  adminApiDebug: true,
                  shopApiDebug: true,
              }),
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: superadminUsername,
            password: superadminPassword,
        },
        cookieOptions: {
            secret: cookieSecret,
        },
    },
    dbConnectionOptions: dbConnectionOptions(),
    paymentOptions: {
        paymentMethodHandlers: allowDummyPayments ? [dummyPaymentHandler] : [],
    },
    customFields: {},
    // Scheduled tasks (job cleanup and similar) run in this process. A second
    // always-on worker is not available on Hostinger shared hosting.
    schedulerOptions: {
        runTasksInWorkerOnly: process.env.RUN_TASKS_IN_WORKER_ONLY === 'true',
    },
    plugins: [
        ...(IS_PRODUCTION ? [] : [GraphiqlPlugin.init()]),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir,
            assetUrlPrefix: process.env.ASSET_URL_PREFIX || undefined,
        }),
        DefaultSchedulerPlugin.init(),
        DefaultJobQueuePlugin.init({
            useDatabaseForBuffer: true,
            concurrency: 1,
            // Default polling is 200ms per queue, which is noisy on a shared MySQL server.
            pollInterval: Number(process.env.JOB_QUEUE_POLL_INTERVAL_MS || 5000),
        }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        emailPlugin(),
        DashboardPlugin.init({
            route: 'dashboard',
            // ts-node runs from src/; the compiled server runs from dist/ and serves dist/dashboard.
            appDir: __dirname.endsWith(`${path.sep}dist`)
                ? path.join(__dirname, 'dashboard')
                : path.join(__dirname, '../dist/dashboard'),
        }),
    ],
};
