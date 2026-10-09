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
