import { createHmac, timingSafeEqual } from 'crypto';

import { TokenPurpose, TokenTimes } from './types';

/** The BE issues tokens for 60 seconds; anything meant to last longer is refused. */
const MAX_LIFETIME_SECONDS = 300;
/** How far ahead of this server's clock the BE's clock may be. */
const MAX_CLOCK_SKEW_SECONDS = 30;

/**
 * Signs a token the way the BE does: `base64url(JSON payload).base64url(HMAC-SHA256)`, where the
 * HMAC covers `<purpose>.<payload>`, so a token for one purpose never passes for another.
 * Vendure only verifies tokens; this is here for tests and tools. `iat` and `exp` default to now
 * and a minute from now.
 */
export function signToken(
    secret: string,
    purpose: TokenPurpose,
    payload: Record<string, unknown> & Partial<TokenTimes>,
): string {
    const now = unixNow();
    const payloadB64 = Buffer.from(JSON.stringify({ iat: now, exp: now + 60, ...payload })).toString('base64url');
    return `${payloadB64}.${hmac(secret, purpose, payloadB64)}`;
}

/**
 * The token's payload when it was signed with this secret for this purpose and is current;
 * otherwise undefined. Without a secret nothing verifies.
 */
export function verifyToken<T extends TokenTimes>(
    secret: string | undefined,
    purpose: TokenPurpose,
    token: unknown,
): T | undefined {
    if (!secret || typeof token !== 'string') {
        return;
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
        return;
    }
    const [payloadB64, signature] = parts;
    const expected = Buffer.from(hmac(secret, purpose, payloadB64));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return;
    }
    if (!payload || typeof payload !== 'object') {
        return;
    }
    const { iat, exp } = payload as Partial<TokenTimes>;
    const now = unixNow();
    if (typeof iat !== 'number' || typeof exp !== 'number') {
        return;
    }
    if (exp < now || exp - iat > MAX_LIFETIME_SECONDS || iat > now + MAX_CLOCK_SKEW_SECONDS) {
        return;
    }
    return payload as T;
}

/** The `x-shop-signature` header of an event: hex HMAC-SHA256 of `<timestamp>.<raw body>`. */
export function signEventBody(secret: string, timestamp: string, rawBody: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function hmac(secret: string, purpose: TokenPurpose, payloadB64: string): string {
    return createHmac('sha256', secret).update(`${purpose}.${payloadB64}`).digest('base64url');
}

function unixNow(): number {
    return Math.floor(Date.now() / 1000);
}
