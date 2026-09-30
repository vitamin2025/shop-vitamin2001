import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
    BootstrappedEvent,
    DefaultLogger,
    EventBus,
    Logger,
    VENDURE_VERSION,
    configureSessionCookies,
    getCompatibility,
    getPluginStartupMessages,
    preBootstrapConfig,
    runMigrations,
    type VendureConfig,
} from '@vendure/core';
import { setProcessContext } from '@vendure/core/dist/process-context/process-context.js';
import fs from 'fs';

import { ensureStoreDefaults } from './ensure-store-defaults';
import { assetUploadDir, config, IS_PRODUCTION } from './vendure-config';

const nodeRequire = createRequire(__filename);

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Loads Vendure without calling `listen()`. `src/index.ts` has already bound
 * the public port, and Hostinger's lsnode wrapper ignores every later
 * `listen()` in the process. Nest still constructs an internal `http.Server`
 * while the application is created; nothing calls `listen()` on it. Requests
 * are handled by the Express app Nest registered during `app.init()`.
 */
export async function startVendure(): Promise<{ app: INestApplication; handler: RequestHandler }> {
    fs.mkdirSync(assetUploadDir, { recursive: true });

    if (IS_PRODUCTION && !process.env.ASSET_URL_PREFIX) {
        console.warn(
            'ASSET_URL_PREFIX is not set. Product image URLs may be wrong behind the Hostinger proxy. Set it to https://shop.vitamin2001.in/assets/',
        );
    }
    if (IS_PRODUCTION && !process.env.ASSET_UPLOAD_DIR) {
        console.warn(
            'ASSET_UPLOAD_DIR is not set. Uploaded images live inside the deploy folder and are deleted on the next Hostinger deploy. Point this at a directory outside hbuilds/.',
        );
    }

    if (process.env.RUN_MIGRATIONS !== 'false') {
        await runMigrations(config);
    }

    const app = await bootstrapWithoutListen(config);
    await ensureStoreDefaults(app);

    const expressApp = app.getHttpAdapter().getInstance() as RequestHandler;
    if (typeof expressApp !== 'function') {
        throw new Error('Vendure did not produce an Express request handler');
    }

    // Cron tasks are registered during Nest init. Vendure does not expose a
    // way to start the scheduler later. Those tasks wait for their next cron
    // time, so they are not deferred here. The job queue is, in src/index.ts,
    // because JobQueueService.start() begins database polling immediately.
    return { app, handler: expressApp };
}

/**
 * The same steps as `@vendure/core` `bootstrap()`, with `app.init()` in place
 * of `app.listen()`. Plugin middleware, GraphQL, the asset server, and the
 * dashboard register during init; they do not need a listening socket.
 */
async function bootstrapWithoutListen(userConfig: VendureConfig): Promise<INestApplication> {
    const vendureConfig = await preBootstrapConfig(userConfig);
    Logger.useLogger(vendureConfig.logger);
    Logger.info(`Bootstrapping Vendure Server (pid: ${process.pid})...`);
    const { warnAboutInsecureApiConfig } = await import('@vendure/core/dist/get-api-security-warnings.js');
    warnAboutInsecureApiConfig(vendureConfig);
    assertPluginCompatibility(vendureConfig.plugins);

    // AppModule reads the global config when its decorator runs, so it has to
    // be imported after preBootstrapConfig().
    const { AppModule } = await import('@vendure/core/dist/app.module.js');
    setProcessContext('server');
    const { port, cors, middleware, trustProxy, shopApiPath, adminApiPath } = vendureConfig.apiOptions;
    DefaultLogger.hideNestBoostrapLogs();
    const app = await NestFactory.create(AppModule, {
        cors,
        logger: new Logger(),
    });
    DefaultLogger.restoreOriginalLogLevel();
    app.useLogger(new Logger());
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
    if (tokenMethodIncludes(vendureConfig.authOptions.tokenMethod, 'cookie')) {
        configureSessionCookies(app, vendureConfig);
    }
    const { wrapEarlyMiddlewareHandler } = await import('@vendure/core/dist/wrap-early-middleware-handler.js');
    for (const mid of (middleware ?? []).filter(item => item.beforeListen)) {
        app.use(mid.route, wrapEarlyMiddlewareHandler(mid));
    }
    await app.init();
    app.enableShutdownHooks();
    logReady(port, shopApiPath, adminApiPath);
    await app.get(EventBus).publish(new BootstrappedEvent());
    return app;
}

function tokenMethodIncludes(tokenMethod: VendureConfig['authOptions']['tokenMethod'], method: 'cookie' | 'bearer'): boolean {
    if (tokenMethod === method) {
        return true;
    }
    return Array.isArray(tokenMethod) && tokenMethod.includes(method);
}

function assertPluginCompatibility(plugins: VendureConfig['plugins']): void {
    const semver = nodeRequire('semver') as {
        satisfies: (version: string, range: string, options?: { loose?: boolean; includePrerelease?: boolean }) => boolean;
    };
    for (const plugin of plugins ?? []) {
        const compatibility = getCompatibility(plugin);
        const pluginName = 'name' in plugin && plugin.name ? String(plugin.name) : 'plugin';
        if (!compatibility) {
            Logger.info(
                `The plugin "${pluginName}" does not specify a compatibility range, so it is not guaranteed to be compatible with this version of Vendure.`,
            );
            continue;
        }
        if (!semver.satisfies(VENDURE_VERSION, compatibility, { loose: true, includePrerelease: true })) {
            const message =
                `Plugin "${pluginName}" is not compatible with this version of Vendure. ` +
                `It specifies a semver range of "${compatibility}" but the current version is "${VENDURE_VERSION}".`;
            Logger.error(message);
            throw new Error(message);
        }
    }
}

function logReady(port: number, shopApiPath: string, adminApiPath: string): void {
    Logger.info(`Vendure is listening on the already-open port ${port}`);
    Logger.info(`Shop API: /${shopApiPath}`);
    Logger.info(`Admin API: /${adminApiPath}`);
    for (const message of getPluginStartupMessages()) {
        Logger.info(`${message.label}: ${message.path}`);
    }
}
