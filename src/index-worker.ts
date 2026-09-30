import { bootstrapWorker } from '@vendure/core';

import { config } from './vendure-config';

/**
 * Separate worker process. Do not use this as the Hostinger entry file.
 * Shared hosting only keeps the server process alive. This file is for a
 * later move to a VPS, where you can run `node dist/index-worker.js` beside
 * the server and set RUN_JOB_QUEUE_IN_SERVER=false.
 */
bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
