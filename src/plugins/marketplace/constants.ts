export const MARKETPLACE_PLUGIN_OPTIONS = Symbol('MARKETPLACE_PLUGIN_OPTIONS');

export const loggerCtx = 'MarketplacePlugin';

/** Payment method that marks a seller order as paid by the marketplace. Never offered to customers. */
export const SELLER_PAYOUT_METHOD_CODE = 'marketplace-seller-payout';

export enum SellerStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected',
}

export enum PayoutStatus {
    Pending = 'pending',
    Paid = 'paid',
}

/** The suffix of the Role created for each seller shop: `<channel code>-seller`. */
export const SELLER_ROLE_SUFFIX = '-seller';

/** A seller's slug may become their storefront's subdomain, so it follows the rules for a DNS label. */
export const SELLER_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Subdomains the store keeps for itself, and words the storefront backend (BE) gives a meaning of its own. */
export const RESERVED_SELLER_SLUGS = [
    'www',
    'api',
    'shop',
    'admin',
    'dashboard',
    'mail',
    'app',
    'static',
    'assets',
    'cdn',
    'auth',
    'vitamin2001',
    'marketplace',
];
