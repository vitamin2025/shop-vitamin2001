export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            APP_ENV?: string;
            NODE_ENV?: string;
            PORT?: string;
            VENDURE_SERVER_PORT?: string;
            COOKIE_SECRET?: string;
            SUPERADMIN_USERNAME?: string;
            SUPERADMIN_PASSWORD?: string;
            CORS_ORIGINS?: string;
            DB_TYPE?: string;
            DB_HOST?: string;
            DB_PORT?: string;
            DB_NAME?: string;
            DB_USERNAME?: string;
            DB_PASSWORD?: string;
            DB_POOL_SIZE?: string;
            DB_LOGGING?: string;
            DB_SYNCHRONIZE?: string;
            ASSET_UPLOAD_DIR?: string;
            ASSET_URL_PREFIX?: string;
            STOREFRONT_URL?: string;
            EMAIL_FROM?: string;
            SMTP_HOST?: string;
            SMTP_PORT?: string;
            SMTP_USER?: string;
            SMTP_PASSWORD?: string;
            SMTP_SECURE?: string;
            DEFAULT_CURRENCY?: string;
            DEFAULT_LANGUAGE_CODE?: string;
            PRICES_INCLUDE_TAX?: string;
            APPLY_STORE_DEFAULTS?: string;
            ALLOW_DUMMY_PAYMENTS?: string;
            RUN_MIGRATIONS?: string;
            RUN_JOB_QUEUE_IN_SERVER?: string;
            RUN_TASKS_IN_WORKER_ONLY?: string;
            JOB_QUEUE_POLL_INTERVAL_MS?: string;
        }
    }
}
