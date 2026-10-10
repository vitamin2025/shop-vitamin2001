import { ID, RequestContext, Seller, VendureEvent } from '@vendure/core';

/**
 * Published after a seller was created or updated and their shop and login were brought in line
 * with their Status, so a listener sees the seller as provisioning left them (with a slug once
 * the shop is open).
 */
export class SellerShopSyncedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public seller: Seller,
    ) {
        super();
    }
}

/** Published once a deleted seller's login is gone and their products are disabled. */
export class SellerShopClosedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public sellerId: ID,
        public slug: string | null,
        public name: string,
    ) {
        super();
    }
}
