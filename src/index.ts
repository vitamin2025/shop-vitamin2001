import http from 'node:http';
import dotenv from 'dotenv';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

type VendureProxy = InstanceType<typeof import('http-proxy')>;

/**
 * Passenger on Hostinger kills the process unless `listen(PORT)` happens within
 * 3 seconds. Importing Vendure and opening the database takes longer than that,
 * so this file binds the public port before it loads anything else.
 *
 * Until `start-vendure` finishes, every path (including `/health`) answers
 * `503` with the body `starting`. After that, requests and WebSocket upgrades
 * are streamed to Vendure on 127.0.0.1. The body is not parsed here, so
 * multipart admin uploads, cookies, and CORS stay intact.
 */
dotenv.config();

const port = Number(process.env.PORT || process.env.VENDURE_SERVER_PORT || 3000);
const bootStartedAt = Date.now();

if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid PORT "${process.env.PORT}". Expected an integer.`);
    process.exit(1);
}

let vendureOrigin: string | null = null;
let proxy: VendureProxy | null = null;

function sendStarting(req: http.IncomingMessage, res: ServerResponse): void {
    req.resume();
    res.writeHead(503, {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': '5',
        'cache-control': 'no-store',
    });
    res.end('starting');
}

const server = http.createServer((req, res) => {
    if (!vendureOrigin || !proxy) {
        sendStarting(req, res);
        return;
    }
    proxy.web(req, res, { target: vendureOrigin });
});

server.on('upgrade', (req, socket, head) => {
    if (!vendureOrigin || !proxy) {
        socket.destroy();
        return;
    }
    proxy.ws(req, socket, head, { target: vendureOrigin });
});

server.on('error', err => {
    console.error(err);
    process.exit(1);
});

// Nest closes its own internal server on SIGTERM. Close this public socket too,
// or Passenger will wait until it SIGKILLs the process.
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
        const [{ startVendure }, httpProxy] = await Promise.all([
            import('./start-vendure.js'),
            import('http-proxy'),
        ]);
        proxy = httpProxy.default.createProxyServer({
            // Keep Host and X-Forwarded-* from Hostinger. Adding another hop would
            // make trustProxy read the wrong client address and protocol.
            xfwd: false,
            ws: true,
        });
        proxy.on('error', (err: Error, _req: unknown, res: unknown) => {
            console.error(`[startup] proxy error: ${err.message}`);
            if (isServerResponse(res)) {
                if (!res.headersSent) {
                    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
                    res.end('bad gateway');
                }
                return;
            }
            if (isSocket(res)) {
                res.destroy();
            }
        });

        const { app, internalPort } = await startVendure();
        vendureOrigin = `http://127.0.0.1:${internalPort}`;
        console.log(
            `[startup] ready in ${Date.now() - bootStartedAt}ms; proxying to ${vendureOrigin}`,
        );
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

function isServerResponse(res: unknown): res is ServerResponse {
    return typeof res === 'object' && res !== null && typeof (res as ServerResponse).writeHead === 'function';
}

function isSocket(res: unknown): res is Socket {
    return typeof res === 'object' && res !== null && typeof (res as Socket).destroy === 'function';
}
