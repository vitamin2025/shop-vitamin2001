import { LanguageCode, mergeConfig } from '@vendure/core';
import {
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    registerInitializer,
    SimpleGraphQLClient,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import { createHmac } from 'crypto';
import fs from 'fs';
import gql from 'graphql-tag';
import http from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BackendBridgePlugin } from '../src/plugins/be-bridge/be-bridge.plugin';
import { signToken } from '../src/plugins/be-bridge/bridge-token';
import { BackendBridgePluginOptions } from '../src/plugins/be-bridge/types';
import { MarketplacePlugin } from '../src/plugins/marketplace/marketplace.plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

const SECRET = 'e2e-bridge-secret-0123456789abcdef0123';

// The events URL is filled in once the receiver below is listening, before the server starts.
const bridgeOptions: BackendBridgePluginOptions = { secret: SECRET, eventsUrl: undefined };

const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
        plugins: [
            MarketplacePlugin.init({
                defaultCommissionPercent: 10,
                applicationsOpen: true,
                houseShopName: 'Vitamin 2001',
            }),
            BackendBridgePlugin.init(bridgeOptions),
        ],
    }),
);

/** Stands in for the BE's events endpoint. */
interface ReceivedEvent {
    status: number;
    timestamp: string;
    signature: string;
    rawBody: string;
    body: any;
}
const received: ReceivedEvent[] = [];
let failNextRequests = 0;
const receiver = http.createServer((req, res) => {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', chunk => (rawBody += chunk));
    req.on('end', () => {
        const status = failNextRequests > 0 ? 503 : 200;
        failNextRequests = Math.max(failNextRequests - 1, 0);
        received.push({
            status,
            timestamp: String(req.headers['x-shop-timestamp']),
            signature: String(req.headers['x-shop-signature']),
            rawBody,
            body: JSON.parse(rawBody),
        });
        res.writeHead(status).end();
    });
});

const PASSWORD = 'seller-password-1';
const CUSTOMER = { sub: 'be-user-1', email: 'priya@example.com', firstName: 'Priya', lastName: 'Nair' };

describe('Storefront backend bridge', () => {
    const alpha = { shopName: 'Alpha Nutrition', email: 'alpha@example.com', id: '', channelToken: '' };
    let houseShopId: string;
    let alphaProductId: string;
    let alphaVariantId: string;
    let customerUserId: string;
    let marketplaceOrder: { id: string; code: string; totalWithTax: number };
    let sellerOrder: { id: string; code: string; lines: Array<{ id: string; quantity: number }> };

    beforeAll(async () => {
        await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
        bridgeOptions.eventsUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/events`;
        await server.init({
            initialData: {
                defaultLanguage: LanguageCode.en,
                defaultZone: 'Asia',
                taxRates: [{ name: 'GST', percentage: 18 }],
                shippingMethods: [],
                paymentMethods: [],
                countries: [{ name: 'India', code: 'IN', zone: 'Asia' }],
                collections: [],
            },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
        await new Promise(resolve => receiver.close(resolve));
    });

    describe('sellers in the Shop API', () => {
        it('lists the house shop with its slug', async () => {
            const { marketplaceSellers } = await shopClient.query(MARKETPLACE_SELLERS);
            expect(marketplaceSellers).toEqual([
                expect.objectContaining({ slug: 'vitamin-2001', name: 'Vitamin 2001', isHouseShop: true }),
            ]);
            houseShopId = marketplaceSellers[0].id;
        });

        it('hides a pending seller and tells the BE about it', async () => {
            const { applyAsSeller } = await shopClient.query(APPLY_AS_SELLER, {
                input: {
                    shopName: alpha.shopName,
                    firstName: 'Asha',
                    lastName: 'Rao',
                    emailAddress: alpha.email,
                    password: PASSWORD,
                    phoneNumber: '+91 98765 43210',
                    gstin: '27abcde1234f1z5',
                },
            });
            alpha.id = applyAsSeller.id;

            const event = await waitForEvent(e => e.type === 'seller.updated' && e.data.sellerId === alpha.id);
            expect(event.data).toEqual({
                sellerId: alpha.id,
                slug: null,
                name: alpha.shopName,
                status: 'pending',
                isHouseShop: false,
                contactEmail: alpha.email,
                contactFirstName: 'Asha',
                contactLastName: 'Rao',
                contactPhone: '+91 98765 43210',
            });

            const { marketplaceSellers } = await shopClient.query(MARKETPLACE_SELLERS);
            expect(marketplaceSellers.map((s: any) => s.name)).toEqual(['Vitamin 2001']);
        });

        it('lists an approved seller with a slug from the channel code, and sends a signed seller.updated', async () => {
            await adminClient.query(UPDATE_SELLER, { input: { id: alpha.id, customFields: { status: 'approved' } } });
            const event = await waitForEvent(
                e => e.type === 'seller.updated' && e.data.sellerId === alpha.id && e.data.status === 'approved',
            );
            expect(event.data.slug).toBe('alpha-nutrition');
            expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
            expectSignedByShop(received.find(r => r.body.id === event.id)!);

            const { channels } = await adminClient.query(GET_CHANNELS);
            const channel = channels.items.find((c: any) => c.seller?.id === alpha.id);
            alpha.channelToken = channel.token;

            const { marketplaceSellers } = await shopClient.query(MARKETPLACE_SELLERS);
            expect(marketplaceSellers.find((s: any) => s.id === alpha.id)).toEqual({
                id: alpha.id,
                slug: 'alpha-nutrition',
                name: alpha.shopName,
                description: null,
                logo: null,
                banner: null,
                isHouseShop: false,
                gstin: '27ABCDE1234F1Z5',
                fssaiLicenceNumber: null,
                channelCode: 'alpha-nutrition',
                channelToken: alpha.channelToken,
            });
        });

        it("finds a seller by slug with its storefront fields, whatever the request's channel", async () => {
            const logo = await uploadAsset(adminClient);
            await adminClient.query(UPDATE_SELLER, {
                input: {
                    id: alpha.id,
                    customFields: { description: 'Vitamins from Pune', logoId: logo.id, bannerId: logo.id },
                },
            });
            shopClient.setChannelToken(alpha.channelToken);
            const { marketplaceSeller } = await shopClient.query(MARKETPLACE_SELLER, { slug: 'alpha-nutrition' });
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            expect(marketplaceSeller).toMatchObject({
                id: alpha.id,
                description: 'Vitamins from Pune',
                logo: { id: logo.id, preview: logo.preview },
                banner: { id: logo.id },
            });

            const { marketplaceSeller: unknown } = await shopClient.query(MARKETPLACE_SELLER, { slug: 'nobody' });
            expect(unknown).toBeNull();
        });

        it('refuses invalid, reserved and taken slugs', async () => {
            for (const slug of ['Alpha', '-alpha', 'alpha-', 'alpha_nutrition', 'a'.repeat(64), '']) {
                await expect(
                    adminClient.query(UPDATE_SELLER, { input: { id: alpha.id, customFields: { slug } } }),
                ).rejects.toThrow('lowercase letters, digits and hyphens');
            }
            for (const slug of ['www', 'admin', 'vitamin2001', 'marketplace']) {
                await expect(
                    adminClient.query(UPDATE_SELLER, { input: { id: alpha.id, customFields: { slug } } }),
                ).rejects.toThrow(`The slug "${slug}" is reserved`);
            }
            await expect(
                adminClient.query(UPDATE_SELLER, { input: { id: alpha.id, customFields: { slug: 'vitamin-2001' } } }),
            ).rejects.toThrow();

            await adminClient.query(UPDATE_SELLER, { input: { id: alpha.id, customFields: { slug: 'alpha' } } });
            const { marketplaceSeller } = await shopClient.query(MARKETPLACE_SELLER, { slug: 'alpha' });
            expect(marketplaceSeller.id).toBe(alpha.id);
            await adminClient.query(UPDATE_SELLER, {
                input: { id: alpha.id, customFields: { slug: 'alpha-nutrition' } },
            });
        });

        it('hides a seller that is set back to pending', async () => {
            const { createSeller } = await adminClient.query(CREATE_SELLER, {
                input: { name: 'Beta Herbs', customFields: { status: 'approved', contactEmail: 'beta@example.com' } },
            });
            await waitForEvent(e => e.data.sellerId === createSeller.id && e.data.slug === 'beta-herbs');
            await adminClient.query(UPDATE_SELLER, {
                input: { id: createSeller.id, customFields: { status: 'pending' } },
            });
            await waitForEvent(e => e.data.sellerId === createSeller.id && e.data.status === 'pending');

            const { marketplaceSeller } = await shopClient.query(MARKETPLACE_SELLER, { slug: 'beta-herbs' });
            expect(marketplaceSeller).toBeNull();
            const { marketplaceSellers } = await shopClient.query(MARKETPLACE_SELLERS);
            expect(marketplaceSellers.map((s: any) => s.slug)).toEqual(['alpha-nutrition', 'vitamin-2001']);
        });
    });

    describe('vitamin2001 sign-in', () => {
        it('creates a customer on the first sign-in', async () => {
            await shopClient.asAnonymousUser();
            const { authenticate } = await shopClient.query(AUTHENTICATE, {
                token: signToken(SECRET, 'login', { ...CUSTOMER, phone: '+91 90000 00001', verified: true }),
            });
            expect(authenticate.identifier).toBe(CUSTOMER.email);
            customerUserId = authenticate.id;

            const { activeCustomer } = await shopClient.query(ACTIVE_CUSTOMER);
            expect(activeCustomer).toMatchObject({
                emailAddress: CUSTOMER.email,
                firstName: 'Priya',
                lastName: 'Nair',
                phoneNumber: '+91 90000 00001',
            });
        });

        it("signs the same customer in on a seller's storefront, with the BE's latest details", async () => {
            await shopClient.asAnonymousUser();
            shopClient.setChannelToken(alpha.channelToken);
            const { authenticate } = await shopClient.query(AUTHENTICATE, {
                token: signToken(SECRET, 'login', { ...CUSTOMER, lastName: 'Menon', verified: true }),
            });
            expect(authenticate.id).toBe(customerUserId);
            const { activeCustomer } = await shopClient.query(ACTIVE_CUSTOMER);
            expect(activeCustomer).toMatchObject({ lastName: 'Menon', phoneNumber: '+91 90000 00001' });
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { customers } = await adminClient.query(GET_CUSTOMERS, { email: CUSTOMER.email });
            expect(customers.totalItems).toBe(1);
            expect(customers.items[0].user.authenticationMethods.map((m: any) => m.strategy)).toEqual(['vitamin2001']);

            // The customer is now known to the seller's channel too.
            adminClient.setChannelToken(alpha.channelToken);
            const { customers: inSellerChannel } = await adminClient.query(GET_CUSTOMERS, { email: CUSTOMER.email });
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            expect(inSellerChannel.totalItems).toBe(1);
        });

        it('refuses a token that is forged, expired, too long-lived, not yet issued, for payments or incomplete', async () => {
            const now = Math.floor(Date.now() / 1000);
            const login = { ...CUSTOMER, verified: true };
            const tokens = [
                signToken('another-secret-0123456789abcdef0123456', 'login', login),
                signToken(SECRET, 'login', { ...login, iat: now - 120, exp: now - 60 }),
                signToken(SECRET, 'login', { ...login, iat: now, exp: now + 3600 }),
                signToken(SECRET, 'login', { ...login, iat: now + 120, exp: now + 180 }),
                signToken(SECRET, 'payment', login),
                signToken(SECRET, 'login', { email: CUSTOMER.email, verified: true }),
                'not-a-token',
            ];
            for (const token of tokens) {
                await shopClient.asAnonymousUser();
                const { authenticate } = await shopClient.query(AUTHENTICATE, { token });
                expect(authenticate.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
            }
        });

        it("moves the guest's basket into the customer's order on sign-in", async () => {
            adminClient.setChannelToken(alpha.channelToken);
            ({ productId: alphaProductId, variantId: alphaVariantId } = await createProduct(
                adminClient,
                'Alpha Multivitamin',
                50000,
            ));
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            await shopClient.asAnonymousUser();
            await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: alphaVariantId, quantity: 1 });
            await shopClient.query(AUTHENTICATE, {
                token: signToken(SECRET, 'login', { ...CUSTOMER, verified: true }),
            });
            const { activeOrder } = await shopClient.query(ACTIVE_ORDER);
            expect(activeOrder.customer.emailAddress).toBe(CUSTOMER.email);
            expect(activeOrder.lines.map((l: any) => [l.productVariant.id, l.quantity])).toEqual([[alphaVariantId, 1]]);
        });
    });

    describe('payu payments', () => {
        beforeAll(async () => {
            await shopClient.query(SET_SHIPPING_ADDRESS, { input: SHIPPING_ADDRESS });
            const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING_METHODS);
            await shopClient.query(SET_SHIPPING_METHOD, { ids: eligibleShippingMethods.map((m: any) => m.id) });
            const { transitionOrderToState } = await shopClient.query(TRANSITION_TO_STATE, {
                state: 'ArrangingPayment',
            });
            marketplaceOrder = transitionOrderToState;
        });

        it('is offered in the marketplace and in seller shops', async () => {
            const { eligiblePaymentMethods } = await shopClient.query(ELIGIBLE_PAYMENT_METHODS);
            expect(eligiblePaymentMethods.find((m: any) => m.code === 'payu')).toMatchObject({
                name: 'PayU',
                isEligible: true,
            });
            adminClient.setChannelToken(alpha.channelToken);
            const { paymentMethods } = await adminClient.query(GET_PAYMENT_METHODS);
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            expect(paymentMethods.items.map((m: any) => m.code)).toContain('payu');
        });

        it('declines a confirmation for another amount, another order or another purpose', async () => {
            const wrong = [
                { orderCode: marketplaceOrder.code, amountMinor: marketplaceOrder.totalWithTax - 1 },
                { orderCode: 'SOMEONE-ELSES', amountMinor: marketplaceOrder.totalWithTax },
            ];
            for (const confirmation of wrong) {
                const token = signToken(SECRET, 'payment', { ...confirmation, txnid: 'TXN1', mihpayid: '403993715' });
                const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
                    input: { method: 'payu', metadata: { token } },
                });
                expect(addPaymentToOrder).toMatchObject({
                    errorCode: 'PAYMENT_DECLINED_ERROR',
                    paymentErrorMessage: 'Payment confirmation is invalid',
                });
            }
            const loginToken = signToken(SECRET, 'login', {
                orderCode: marketplaceOrder.code,
                amountMinor: marketplaceOrder.totalWithTax,
                txnid: 'TXN1',
                mihpayid: '403993715',
            });
            const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
                input: { method: 'payu', metadata: { token: loginToken } },
            });
            expect(addPaymentToOrder.errorCode).toBe('PAYMENT_DECLINED_ERROR');
        });

        it('settles the order with a valid confirmation, and the order is split per seller', async () => {
            const token = signToken(SECRET, 'payment', {
                orderCode: marketplaceOrder.code,
                amountMinor: marketplaceOrder.totalWithTax,
                txnid: 'TXN1',
                mihpayid: '403993715',
            });
            const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
                input: { method: 'payu', metadata: { token } },
            });
            expect(addPaymentToOrder.state).toBe('PaymentSettled');

            const { order } = await adminClient.query(GET_ORDER, { id: marketplaceOrder.id });
            expect(order.type).toBe('Aggregate');
            expect(order.sellerOrders).toHaveLength(1);
            expect(order.sellerOrders[0].state).toBe('PaymentSettled');
            const settled = order.payments.find((p: any) => p.state === 'Settled');
            expect(settled).toMatchObject({
                method: 'payu',
                amount: marketplaceOrder.totalWithTax,
                transactionId: '403993715',
                metadata: { txnid: 'TXN1', mihpayid: '403993715', public: { txnid: 'TXN1' } },
            });
        });
    });

    describe('order events', () => {
        let fulfillmentId: string;

        it('sends order.shipped when the seller ships, and nothing for the marketplace order', async () => {
            adminClient.setChannelToken(alpha.channelToken);
            const { orders } = await adminClient.query(GET_ORDERS);
            sellerOrder = orders.items[0];
            const { addFulfillmentToOrder } = await adminClient.query(ADD_FULFILLMENT, {
                input: {
                    lines: sellerOrder.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    handler: {
                        code: 'manual-fulfillment',
                        arguments: [
                            { name: 'method', value: 'Courier' },
                            { name: 'trackingCode', value: 'TRACK-1' },
                        ],
                    },
                },
            });
            fulfillmentId = addFulfillmentToOrder.id;
            await adminClient.query(TRANSITION_FULFILLMENT, { id: fulfillmentId, state: 'Shipped' });
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const event = await waitForEvent(e => e.type === 'order.shipped' && e.data.orderCode === sellerOrder.code);
            expectSignedByShop(received.find(r => r.body.id === event.id)!);
            expect(event.data).toEqual({
                orderCode: sellerOrder.code,
                aggregateOrderCode: marketplaceOrder.code,
                state: 'Shipped',
                seller: { slug: 'alpha-nutrition', name: alpha.shopName },
                customer: { emailAddress: CUSTOMER.email, firstName: 'Priya', lastName: 'Nair' },
                trackingCodes: ['TRACK-1'],
                lines: [{ name: 'Alpha Multivitamin', quantity: 1 }],
            });

            const { order } = await adminClient.query(GET_ORDER, { id: marketplaceOrder.id });
            expect(order.state).toBe('Shipped');
            expect(received.some(r => r.body.data.orderCode === marketplaceOrder.code)).toBe(false);
        });

        it('sends order.delivered when the seller delivers', async () => {
            adminClient.setChannelToken(alpha.channelToken);
            await adminClient.query(TRANSITION_FULFILLMENT, { id: fulfillmentId, state: 'Delivered' });
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const event = await waitForEvent(
                e => e.type === 'order.delivered' && e.data.orderCode === sellerOrder.code,
            );
            expect(event.data.state).toBe('Delivered');
            expect(received.some(r => r.body.data.orderCode === marketplaceOrder.code)).toBe(false);
        });

        it('sends an event again when the BE does not accept it', async () => {
            const start = received.length;
            failNextRequests = 1;
            await adminClient.query(UPDATE_SELLER, {
                input: { id: alpha.id, customFields: { description: 'Vitamins and minerals from Pune' } },
            });
            const attempts = await waitFor(async () => {
                const sent = received.slice(start);
                return sent.some(r => r.status === 200) && sent;
            }, 15_000);
            expect(attempts.map(r => [r.body.type, r.status])).toEqual([
                ['seller.updated', 503],
                ['seller.updated', 200],
            ]);
            expect(attempts[1].body.id).toBe(attempts[0].body.id);
        });
    });

    describe('deleting a seller', () => {
        it('refuses to delete the house shop', async () => {
            await expect(adminClient.query(DELETE_SELLER, { id: houseShopId })).rejects.toThrow(
                "holds the store's own products and cannot be deleted",
            );
        });

        it('deletes a seller with an open shop: their login goes, their products are disabled, the BE is told', async () => {
            const { deleteSeller } = await adminClient.query(DELETE_SELLER, { id: alpha.id });
            expect(deleteSeller.result).toBe('DELETED');

            const event = await waitForEvent(e => e.type === 'seller.deleted');
            expect(event.data).toEqual({ sellerId: alpha.id, slug: 'alpha-nutrition', name: alpha.shopName });

            const { product } = await adminClient.query(GET_PRODUCT, { id: alphaProductId });
            expect(product.enabled).toBe(false);
            const result = await adminClient.asUserWithCredentials(alpha.email, PASSWORD);
            expect(result).toMatchObject({ errorCode: 'INVALID_CREDENTIALS_ERROR' });
            await adminClient.asSuperAdmin();

            const { marketplaceSellers } = await shopClient.query(MARKETPLACE_SELLERS);
            expect(marketplaceSellers.map((s: any) => s.slug)).toEqual(['vitamin-2001']);

            // The shop's channel and its orders stay, without a seller.
            const { channels } = await adminClient.query(GET_CHANNELS);
            expect(channels.items.find((c: any) => c.code === 'alpha-nutrition').seller).toBeNull();
            const { order } = await adminClient.query(GET_ORDER, { id: marketplaceOrder.id });
            expect(order.sellerOrders[0].code).toBe(sellerOrder.code);
        });
    });
});

function expectSignedByShop(request: ReceivedEvent) {
    const expected = createHmac('sha256', SECRET).update(`${request.timestamp}.${request.rawBody}`).digest('hex');
    expect(request.signature).toBe(expected);
    expect(Math.abs(Date.now() / 1000 - Number(request.timestamp))).toBeLessThan(300);
}

/** Events are sent from the job queue, so tests wait for them to arrive. */
function waitForEvent(match: (event: any) => boolean, timeoutMs = 10_000) {
    return waitFor(async () => received.find(r => r.status === 200 && match(r.body))?.body, timeoutMs);
}

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 10_000): Promise<T> {
    const start = Date.now();
    let lastError: unknown;
    while (Date.now() - start < timeoutMs) {
        try {
            const result = await check();
            if (result) {
                return result;
            }
        } catch (err) {
            lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting: ${String(lastError ?? 'condition not met')}`);
}

async function uploadAsset(client: SimpleGraphQLClient): Promise<{ id: string; preview: string }> {
    // A 1×1 PNG.
    const file = path.join(os.tmpdir(), 'backend-bridge-e2e-logo.png');
    fs.writeFileSync(
        file,
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'base64',
        ),
    );
    const { createAssets } = await client.fileUploadMutation({
        mutation: CREATE_ASSETS,
        filePaths: [file],
        mapVariables: filePaths => ({ input: filePaths.map(() => ({ file: null })) }),
    });
    return createAssets[0];
}

async function createProduct(client: SimpleGraphQLClient, name: string, price: number) {
    const { taxCategories } = await client.query(GET_TAX_CATEGORIES);
    const { createProduct: product } = await client.query(CREATE_PRODUCT, {
        input: {
            translations: [
                { languageCode: 'en', name, slug: name.toLowerCase().replace(/\s+/g, '-'), description: '' },
            ],
        },
    });
    const { createProductVariants } = await client.query(CREATE_PRODUCT_VARIANTS, {
        input: [
            {
                productId: product.id,
                sku: name.toUpperCase().replace(/\s+/g, '-'),
                price,
                taxCategoryId: taxCategories.items[0].id,
                stockOnHand: 100,
                trackInventory: 'TRUE',
                translations: [{ languageCode: 'en', name }],
            },
        ],
    });
    return { productId: product.id as string, variantId: createProductVariants[0].id as string };
}

const SHIPPING_ADDRESS = {
    fullName: 'Priya Menon',
    streetLine1: '4 FC Road',
    city: 'Pune',
    postalCode: '411004',
    countryCode: 'IN',
};

const MARKETPLACE_SELLER_FIELDS = `
    id
    slug
    name
    description
    logo {
        id
        preview
    }
    banner {
        id
        preview
    }
    isHouseShop
    gstin
    fssaiLicenceNumber
    channelCode
    channelToken
`;

const MARKETPLACE_SELLERS = gql`
    query {
        marketplaceSellers {
            ${MARKETPLACE_SELLER_FIELDS}
        }
    }
`;

const MARKETPLACE_SELLER = gql`
    query ($slug: String!) {
        marketplaceSeller(slug: $slug) {
            ${MARKETPLACE_SELLER_FIELDS}
        }
    }
`;

const APPLY_AS_SELLER = gql`
    mutation ($input: SellerApplicationInput!) {
        applyAsSeller(input: $input) {
            id
            status
        }
    }
`;

const CREATE_SELLER = gql`
    mutation ($input: CreateSellerInput!) {
        createSeller(input: $input) {
            id
        }
    }
`;

const UPDATE_SELLER = gql`
    mutation ($input: UpdateSellerInput!) {
        updateSeller(input: $input) {
            id
        }
    }
`;

const DELETE_SELLER = gql`
    mutation ($id: ID!) {
        deleteSeller(id: $id) {
            result
            message
        }
    }
`;

const GET_CHANNELS = gql`
    query {
        channels {
            items {
                id
                code
                token
                seller {
                    id
                    name
                }
            }
        }
    }
`;

const CREATE_ASSETS = gql`
    mutation CreateAssets($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            ... on Asset {
                id
                preview
            }
        }
    }
`;

const AUTHENTICATE = gql`
    mutation ($token: String!) {
        authenticate(input: { vitamin2001: { token: $token } }) {
            ... on CurrentUser {
                id
                identifier
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const ACTIVE_CUSTOMER = gql`
    query {
        activeCustomer {
            id
            emailAddress
            firstName
            lastName
            phoneNumber
        }
    }
`;

const GET_CUSTOMERS = gql`
    query ($email: String!) {
        customers(options: { filter: { emailAddress: { eq: $email } } }) {
            totalItems
            items {
                id
                user {
                    id
                    authenticationMethods {
                        strategy
                    }
                }
            }
        }
    }
`;

const GET_TAX_CATEGORIES = gql`
    query {
        taxCategories {
            items {
                id
            }
        }
    }
`;

const CREATE_PRODUCT = gql`
    mutation ($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`;

const CREATE_PRODUCT_VARIANTS = gql`
    mutation ($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
        }
    }
`;

const GET_PRODUCT = gql`
    query ($id: ID!) {
        product(id: $id) {
            id
            enabled
        }
    }
`;

const ADD_ITEM_TO_ORDER = gql`
    mutation ($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const ACTIVE_ORDER = gql`
    query {
        activeOrder {
            id
            code
            customer {
                emailAddress
            }
            lines {
                quantity
                productVariant {
                    id
                }
            }
        }
    }
`;

const SET_SHIPPING_ADDRESS = gql`
    mutation ($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            ... on Order {
                id
            }
        }
    }
`;

const ELIGIBLE_SHIPPING_METHODS = gql`
    query {
        eligibleShippingMethods {
            id
            code
        }
    }
`;

const SET_SHIPPING_METHOD = gql`
    mutation ($ids: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $ids) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const TRANSITION_TO_STATE = gql`
    mutation ($state: String!) {
        transitionOrderToState(state: $state) {
            ... on Order {
                id
                code
                state
                totalWithTax
            }
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
`;

const ELIGIBLE_PAYMENT_METHODS = gql`
    query {
        eligiblePaymentMethods {
            code
            name
            isEligible
        }
    }
`;

const GET_PAYMENT_METHODS = gql`
    query {
        paymentMethods {
            items {
                id
                code
            }
        }
    }
`;

const ADD_PAYMENT = gql`
    mutation ($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PaymentDeclinedError {
                paymentErrorMessage
            }
        }
    }
`;

const GET_ORDER = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            code
            type
            state
            payments {
                method
                amount
                state
                transactionId
                metadata
            }
            sellerOrders {
                id
                code
                state
            }
        }
    }
`;

const GET_ORDERS = gql`
    query {
        orders {
            items {
                id
                code
                type
                lines {
                    id
                    quantity
                }
            }
        }
    }
`;

const ADD_FULFILLMENT = gql`
    mutation ($input: FulfillOrderInput!) {
        addFulfillmentToOrder(input: $input) {
            ... on Fulfillment {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const TRANSITION_FULFILLMENT = gql`
    mutation ($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
            ... on Fulfillment {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
