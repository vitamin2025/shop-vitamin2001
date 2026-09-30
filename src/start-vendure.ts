import type { INestApplication } from '@nestjs/common';
import { bootstrap, runMigrations, type VendureConfig } from '@vendure/core';
import fs from 'fs';

import { ensureStoreDefaults } from './ensure-store-defaults';
import { assetUploadDir, config, IS_PRODUCTION } from './vendure-config';

/**
 * Loads Vendure and binds it on 127.0.0.1 only. `src/index.ts` has already
 * called `listen()` on the public port; this function must not touch that port.
 */
export async function startVendure(): Promise<{ app: INestApplication; internalPort: number }> {
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

    const vendureConfig: VendureConfig = {
        ...config,
        apiOptions: {
            ...config.apiOptions,
            hostname: '127.0.0.1',
            port: 0,
        },
    };

    if (process.env.RUN_MIGRATIONS !== 'false') {
        await runMigrations(vendureConfig);
    }

    const app = await bootstrap(vendureConfig);
    await ensureStoreDefaults(app);

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
        throw new Error('Vendure did not bind a loopback TCP port');
    }

    // Cron tasks are registered during Nest bootstrap. Vendure does not expose
    // a way to start the scheduler later. Those tasks wait for their next cron
    // time, so they are not deferred here. The job queue is, in src/index.ts,
    // because JobQueueService.start() begins database polling immediately.
    return { app, internalPort: address.port };
}
