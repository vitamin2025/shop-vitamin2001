export const BE_BRIDGE_PLUGIN_OPTIONS = Symbol('BE_BRIDGE_PLUGIN_OPTIONS');

export const loggerCtx = 'BackendBridgePlugin';

/** The name of the AuthenticationStrategy, also stored on each login it creates. */
export const VITAMIN2001_AUTH_STRATEGY = 'vitamin2001';

export const PAYU_METHOD_CODE = 'payu';

/** The job queue that delivers events to the BE. */
export const BE_EVENTS_QUEUE = 'be-bridge-events';

export const BE_EVENT_RETRIES = 5;

/** Wait before retrying an event the BE did not accept: 10 s, 20 s, 40 s, 80 s, 160 s. */
export function beEventRetryDelayMs(attemptsMade: number): number {
    return 10_000 * 2 ** Math.max(attemptsMade - 1, 0);
}
