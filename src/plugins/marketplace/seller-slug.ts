import { RESERVED_SELLER_SLUGS, SELLER_SLUG_PATTERN } from './constants';

/** Why a slug is not allowed, or undefined when it is. A blank slug is allowed: the shop gets one when it opens. */
export function sellerSlugError(slug: string | null | undefined): string | undefined {
    if (slug == null) {
        return;
    }
    if (!SELLER_SLUG_PATTERN.test(slug)) {
        return 'A slug is 1 to 63 lowercase letters, digits and hyphens, and starts and ends with a letter or digit.';
    }
    if (RESERVED_SELLER_SLUGS.includes(slug)) {
        return `The slug "${slug}" is reserved. Choose another.`;
    }
}

/**
 * The channel code itself when it is a valid slug. Channel codes come from shop names and may hold
 * other characters, which become hyphens.
 */
export function slugFromChannelCode(code: string): string {
    const slug = code
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .slice(0, 63)
        .replace(/^-+|-+$/g, '');
    return slug || 'seller';
}
