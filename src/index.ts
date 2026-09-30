import { bootstrap, JobQueueService, runMigrations } from '@vendure/core';
import fs from 'fs';

import { ensureStoreDefaults } from './ensure-store-defaults';
import { assetUploadDir, config, IS_PRODUCTION, serverPort } from './vendure-config';

async function startServer(): Promise<void> {
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

    const app = await bootstrap(config);

    // One process: the API server also drains the SQL job queue. See DEPLOY-HOSTINGER.md.
    if (process.env.RUN_JOB_QUEUE_IN_SERVER !== 'false') {
        await app.get(JobQueueService).start();
    }

    await ensureStoreDefaults(app);

    console.log(`Vendure is listening on port ${serverPort}`);
}

startServer().catch(err => {
    console.error(err);
    process.exit(1);
});
