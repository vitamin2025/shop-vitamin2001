import { Asset, CustomFieldConfig, LanguageCode, Permission } from '@vendure/core';

import { PayoutStatus, SellerStatus } from './constants';
import { sellerSlugError } from './seller-slug';

const en = (value: string) => [{ languageCode: LanguageCode.en, value }];

export const sellerCustomFields: CustomFieldConfig[] = [
    {
        name: 'status',
        type: 'string',
        defaultValue: SellerStatus.Pending,
        nullable: false,
        public: false,
        label: en('Status'),
        description: en(
            'Set to Approved to open this seller shop and give the seller access to the dashboard. Rejected removes their login.',
        ),
        options: [
            { value: SellerStatus.Pending, label: en('Pending') },
            { value: SellerStatus.Approved, label: en('Approved') },
            { value: SellerStatus.Rejected, label: en('Rejected') },
        ],
    },
    {
        name: 'commissionPercent',
        type: 'float',
        nullable: true,
        public: false,
        min: 0,
        max: 100,
        label: en('Commission %'),
        description: en(
            "Commission taken from this seller's orders. Leave blank to use the default (MARKETPLACE_COMMISSION_PERCENT).",
        ),
    },
    { name: 'contactFirstName', type: 'string', nullable: true, public: false, label: en('Contact first name') },
    { name: 'contactLastName', type: 'string', nullable: true, public: false, label: en('Contact last name') },
    {
        name: 'contactEmail',
        type: 'string',
        nullable: true,
        public: false,
        label: en('Contact email'),
        description: en('Used as the seller login when you approve a seller you created yourself.'),
    },
    { name: 'contactPhone', type: 'string', nullable: true, public: false, label: en('Contact phone') },
    { name: 'gstin', type: 'string', nullable: true, public: false, label: en('GSTIN') },
    { name: 'fssaiLicenceNumber', type: 'string', nullable: true, public: false, label: en('FSSAI licence number') },
    {
        name: 'businessAddress',
        type: 'text',
        nullable: true,
        public: false,
        label: en('Business address'),
        description: en("Printed on this seller's invoices. Include the PIN code and state."),
    },
    {
        // Storefronts find a seller by this (marketplaceSeller(slug)), so it is unique and public.
        name: 'slug',
        type: 'string',
        nullable: true,
        unique: true,
        public: true,
        label: en('Slug'),
        description: en(
            "The seller's address on the storefront: lowercase letters, digits and hyphens. Set from the channel code when the shop opens.",
        ),
        validate: (value: string | null) => sellerSlugError(value),
    },
    {
        name: 'description',
        type: 'text',
        nullable: true,
        public: true,
        label: en('Description'),
        description: en("Shown on the seller's storefront."),
    },
    { name: 'logo', type: 'relation', entity: Asset, nullable: true, public: true, label: en('Logo') },
    { name: 'banner', type: 'relation', entity: Asset, nullable: true, public: true, label: en('Banner') },
    {
        // The Administrator who signs in for this seller. Set by the plugin, never through the API.
        name: 'administratorId',
        type: 'string',
        nullable: true,
        internal: true,
    },
    {
        // Marks the shop that holds the store's own products. Set by the plugin.
        name: 'isHouseShop',
        type: 'boolean',
        defaultValue: false,
        nullable: false,
        internal: true,
    },
];

export const orderCustomFields: CustomFieldConfig[] = [
    {
        name: 'commissionPercent',
        type: 'float',
        nullable: true,
        public: false,
        readonly: true,
        label: en('Commission %'),
    },
    {
        name: 'commissionAmount',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        label: en('Commission'),
        ui: { component: 'currency-form-input' },
    },
    {
        name: 'sellerPayoutAmount',
        type: 'int',
        nullable: true,
        public: false,
        readonly: true,
        label: en('Owed to seller'),
        description: en('The order total minus the commission.'),
        ui: { component: 'currency-form-input' },
    },
    {
        name: 'sellerPayoutStatus',
        type: 'string',
        nullable: true,
        public: false,
        // Sellers can update their own orders, so only marketplace staff may see or change this.
        requiresPermission: [Permission.UpdateSettings],
        label: en('Seller payout'),
        description: en('Set to Paid once you have paid the seller.'),
        options: [
            { value: PayoutStatus.Pending, label: en('Pending') },
            { value: PayoutStatus.Paid, label: en('Paid') },
        ],
    },
];
