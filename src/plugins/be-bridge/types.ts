export interface BackendBridgePluginOptions {
    /**
     * SHOP_BRIDGE_SECRET, shared with the BE. Without it every token from the BE is refused
     * and no events are sent.
     */
    secret: string | undefined;
    /** BE_EVENTS_URL, where events are POSTed. Without it no events are sent. */
    eventsUrl: string | undefined;
}

export type TokenPurpose = 'login' | 'payment';

/** Every token carries when it was issued and when it expires, in unix seconds. */
export interface TokenTimes {
    iat: number;
    exp: number;
}

/** What the BE knows about the customer who signed in there. */
export interface LoginToken extends TokenTimes {
    sub: string | number;
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    verified: boolean;
}

/** The BE's confirmation that PayU took the money for an order. */
export interface PaymentToken extends TokenTimes {
    orderCode: string;
    txnid: string;
    mihpayid: string;
    /** The order total with tax, in paise. */
    amountMinor: number;
}

export type BackendEventType = 'seller.updated' | 'seller.deleted' | 'order.shipped' | 'order.delivered';

export type SellerUpdatedData = {
    sellerId: string;
    slug: string | null;
    name: string;
    status: string;
    isHouseShop: boolean;
    contactEmail: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    contactPhone: string | null;
};

export type SellerDeletedData = {
    sellerId: string;
    slug: string | null;
    name: string;
};

export type OrderShippingData = {
    orderCode: string;
    aggregateOrderCode: string | null;
    state: string;
    seller: { slug: string | null; name: string } | null;
    customer: { emailAddress: string; firstName: string; lastName: string };
    trackingCodes: string[];
    lines: Array<{ name: string; quantity: number }>;
};

/** The body POSTed to BE_EVENTS_URL. */
export type BackendEvent = {
    id: string;
    type: BackendEventType;
    occurredAt: string;
    data: SellerUpdatedData | SellerDeletedData | OrderShippingData;
};
