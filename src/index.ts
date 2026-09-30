import http from 'node:http';
import dotenv from 'dotenv';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Passenger on Hostinger kills the process unless `listen(PORT)` happens within
 * 3 seconds. Importing Vendure and opening the database takes longer than that,
 * so this file binds the public port before it loads anything else.
 *
 * LiteSpeed's lsnode wrapper patches `http.Server.prototype.listen`: only the
 * first call in the process is bound to Hostinger's socket. A later call logs
 * `http.Server.listen() was called more than once, ignore.` and returns without
 * opening a port or running the callback. This server is therefore the only
 * `listen()`. Vendure is initialized with `app.init()` and never listens.
 * Until that finishes, every path (including `/health`) answers `503` with the
 * body `starting`. After that, the same requests are passed to Nest's Express
 * handler. The body is not read here, so multipart uploads stay intact.
 */
dotenv.config();

const port = Number(process.env.PORT || process.env.VENDURE_SERVER_PORT || 3000);
const bootStartedAt = Date.now();

if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid PORT "${process.env.PORT}". Expected an integer.`);
    process.exit(1);
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let vendureHandler: RequestHandler | null = null;

function sendStarting(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    res.writeHead(503, {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': '5',
        'cache-control': 'no-store',
    });
    res.end('starting');
}

const server = http.createServer((req, res) => {
    if (!vendureHandler) {
        sendStarting(req, res);
        return;
    }
    vendureHandler(req, res);
});

server.on('error', err => {
    console.error(err);
    process.exit(1);
});

// Nest closes the unused server it constructed internally. Close this public
// socket too, or Passenger will wait until it SIGKILLs the process.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
        server.close();
    });
}

server.listen(port, () => {
    const address = server.address();
    const where = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(port);
    const threadpool = process.env.UV_THREADPOOL_SIZE ?? 'unset';
    console.log(
        `[startup] listening on ${where} in ${Date.now() - bootStartedAt}ms (UV_THREADPOOL_SIZE=${threadpool})`,
    );
    void boot();
});

async function boot(): Promise<void> {
    try {
        const { startVendure } = await import('./start-vendure.js');
        const { app, handler } = await startVendure();
        vendureHandler = handler;
        console.log(`[startup] Vendure is ready in ${Date.now() - bootStartedAt}ms`);
        scheduleJobQueue(app);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

function scheduleJobQueue(app: import('@nestjs/common').INestApplication): void {
    if (process.env.RUN_JOB_QUEUE_IN_SERVER === 'false') {
        console.log('[startup] job queue left stopped (RUN_JOB_QUEUE_IN_SERVER=false)');
        return;
    }
    const delay = jobQueueDelayMs();
    console.log(`[startup] job queue will start in ${delay}ms`);
    setTimeout(() => {
        // Dynamic import keeps `@vendure/core` off the path that runs before listen().
        void import('@vendure/core')
            .then(({ JobQueueService }) => app.get(JobQueueService).start())
            .then(() => {
                console.log('[startup] job queue started');
            })
            .catch(err => {
                console.error('[startup] job queue failed to start', err);
            });
    }, delay);
}

function jobQueueDelayMs(): number {
    const raw = process.env.JOB_QUEUE_START_DELAY_MS;
    if (raw === undefined || raw === '') {
        return 5000;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        return 5000;
    }
    return value;
}
