import { PermissionDefinition } from '@vendure/core';

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

/** Staff: see what every seller is owed, record payouts, and manage payout method types. */
export const manageSellerPayoutsPermission = new PermissionDefinition({
    name: 'ManageSellerPayouts',
    description: 'Allows seeing seller settlements, recording payouts to sellers and managing payout method types',
});

/** Sellers: see their own payouts and manage the accounts they are paid to. */
export const manageOwnPayoutsPermission = new PermissionDefinition({
    name: 'ManageOwnPayouts',
    description: "Allows a seller to see the marketplace's payouts to them and manage their payout methods",
});

/** Payout method types every store starts with. Staff can edit them and add more. */
export const DEFAULT_PAYOUT_METHOD_TYPES = [
    {
        code: 'upi',
        name: 'UPI',
        sortOrder: 10,
        fields: [
            { key: 'upiId', label: 'UPI ID', required: true, placeholder: 'name@bank' },
            { key: 'accountHolderName', label: 'Name on the account', required: true },
        ],
    },
    {
        code: 'neft',
        name: 'NEFT',
        sortOrder: 20,
        fields: [
            { key: 'accountHolderName', label: 'Account holder name', required: true },
            { key: 'accountNumber', label: 'Account number', required: true },
            { key: 'ifsc', label: 'IFSC code', required: true, placeholder: 'HDFC0001234' },
            { key: 'bankName', label: 'Bank and branch', required: false },
        ],
    },
    {
        code: 'imps',
        name: 'IMPS',
        sortOrder: 30,
        fields: [
            { key: 'accountHolderName', label: 'Account holder name', required: true },
            { key: 'accountNumber', label: 'Account number', required: true },
            { key: 'ifsc', label: 'IFSC code', required: true, placeholder: 'HDFC0001234' },
            { key: 'mobileNumber', label: 'Registered mobile number', required: false },
        ],
    },
    {
        code: 'other',
        name: 'Other',
        sortOrder: 40,
        fields: [{ key: 'details', label: 'How to pay you', required: true }],
    },
    {
        code: 'custom',
        name: 'Custom',
        sortOrder: 50,
        fields: [
            { key: 'methodName', label: 'Method name', required: true, placeholder: 'e.g. PayPal' },
            { key: 'details', label: 'Account details', required: true },
        ],
    },
];
