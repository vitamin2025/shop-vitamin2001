import { LanguageCode, mergeConfig, PaymentMethodHandler } from '@vendure/core';
import {
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    registerInitializer,
    SimpleGraphQLClient,
    SqljsInitializer,
    testConfig,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MarketplacePlugin } from '../src/plugins/marketplace/marketplace.plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

const testPaymentHandler = new PaymentMethodHandler({
    code: 'test-payment',
    description: [{ languageCode: LanguageCode.en, value: 'Test payment' }],
    args: {},
    createPayment: (ctx, order, amount) => ({ amount, state: 'Settled' as const, transactionId: 'test' }),
    settlePayment: () => ({ success: true }),
});

const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig, {
        paymentOptions: { paymentMethodHandlers: [testPaymentHandler] },
        plugins: [
            MarketplacePlugin.init({
                defaultCommissionPercent: 10,
                applicationsOpen: true,
                houseShopName: 'Vitamin 2001',
            }),
        ],
    }),
);

const PASSWORD = 'seller-password-1';

describe('Seller marketplace', () => {
    const sellerA = { shopName: 'Alpha Nutrition', email: 'alpha@example.com', channelToken: '', productVariantId: '' };
    const sellerB = { shopName: 'Beta Herbs', email: 'beta@example.com', channelToken: '', productVariantId: '' };
    let sellerAId: string;
    let sellerBId: string;
    let alphaProductId: string;
    let betaProductId: string;
    let marketplaceOrderId: string;

    beforeAll(async () => {
        await server.init({
            initialData: {
                defaultLanguage: LanguageCode.en,
                defaultZone: 'Asia',
                taxRates: [{ name: 'GST', percentage: 18 }],
                shippingMethods: [],
                paymentMethods: [{ name: 'Test payment', handler: { code: 'test-payment', arguments: [] } }],
                countries: [{ name: 'India', code: 'IN', zone: 'Asia' }],
                collections: [],
            },
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, 120_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('creates the house shop on startup', async () => {
        const { channels } = await adminClient.query(GET_CHANNELS);
        const house = channels.items.find((c: any) => c.seller?.name === 'Vitamin 2001');
        expect(house?.code).toBe('vitamin-2001');
    });

    it('saves an application as a pending seller', async () => {
        const { applyAsSeller } = await shopClient.query(APPLY_AS_SELLER, {
            input: {
                shopName: sellerA.shopName,
                firstName: 'Asha',
                lastName: 'Rao',
                emailAddress: sellerA.email,
                password: PASSWORD,
                phoneNumber: '+91 98765 43210',
            },
        });
        expect(applyAsSeller.status).toBe('pending');
        sellerAId = applyAsSeller.id;

        const { seller } = await adminClient.query(GET_SELLER, { id: sellerAId });
        expect(seller.customFields).toMatchObject({
            status: 'pending',
            contactEmail: sellerA.email,
            contactPhone: '+91 98765 43210',
            gstin: null,
            fssaiLicenceNumber: null,
            businessAddress: null,
        });
    });

    it('refuses a second application with the same email address', async () => {
        await expect(
            shopClient.query(APPLY_AS_SELLER, {
                input: {
                    shopName: 'Another shop',
                    firstName: 'Asha',
                    lastName: 'Rao',
                    emailAddress: sellerA.email,
                    password: PASSWORD,
                },
            }),
        ).rejects.toThrow('An account with this email address already exists.');
    });

    it('gives a pending seller no access', async () => {
        await adminClient.asUserWithCredentials(sellerA.email, PASSWORD);
        await expect(adminClient.query(GET_PRODUCTS)).rejects.toThrow('not currently authorized');
        await adminClient.asSuperAdmin();
    });

    it('opens the shop and grants access when the seller is approved', async () => {
        await adminClient.query(UPDATE_SELLER, { input: { id: sellerAId, customFields: { status: 'approved' } } });
        const channel = await waitForSellerChannel(adminClient, sellerA.shopName);
        expect(channel.code).toBe('alpha-nutrition');
        expect(channel.token).toMatch(/^[0-9a-f]{32}$/);
        sellerA.channelToken = channel.token;

        await waitFor(async () => {
            await adminClient.asUserWithCredentials(sellerA.email, PASSWORD);
            const { me } = await adminClient.query(ME);
            return me.channels.some((c: any) => c.code === 'alpha-nutrition');
        });
        adminClient.setChannelToken(sellerA.channelToken);
        const { shippingMethods } = await adminClient.query(GET_SHIPPING_METHODS);
        expect(shippingMethods.items.map((m: any) => m.code)).toEqual(['alpha-nutrition-shipping']);
        const { stockLocations } = await adminClient.query(GET_STOCK_LOCATIONS);
        expect(stockLocations.items.map((l: any) => l.name)).toContain('Alpha Nutrition warehouse');
        await asSuperAdmin(adminClient);
    });

    it('creates a login for a seller added in the dashboard', async () => {
        const { createSeller } = await adminClient.query(CREATE_SELLER, {
            input: {
                name: sellerB.shopName,
                customFields: {
                    status: 'pending',
                    contactFirstName: 'Bina',
                    contactLastName: 'Shah',
                    contactEmail: sellerB.email,
                    commissionPercent: 15,
                    gstin: '27ABCDE1234F1Z5',
                    businessAddress: '4 Linking Road, Mumbai, Maharashtra 400050',
                },
            },
        });
        sellerBId = createSeller.id;
        const { seller } = await adminClient.query(GET_SELLER, { id: sellerBId });
        expect(seller.customFields).toMatchObject({
            gstin: '27ABCDE1234F1Z5',
            businessAddress: '4 Linking Road, Mumbai, Maharashtra 400050',
        });
        await adminClient.query(UPDATE_SELLER, { input: { id: sellerBId, customFields: { status: 'approved' } } });
        const channel = await waitForSellerChannel(adminClient, sellerB.shopName);
        sellerB.channelToken = channel.token;

        const administrator = await waitFor(async () => {
            const { administrators } = await adminClient.query(GET_ADMINISTRATORS);
            return administrators.items.find((a: any) => a.emailAddress === sellerB.email);
        });
        // The store sets the password for sellers it adds itself.
        await adminClient.query(UPDATE_ADMINISTRATOR, { input: { id: administrator.id, password: PASSWORD } });
        await adminClient.asUserWithCredentials(sellerB.email, PASSWORD);
        const { me } = await adminClient.query(ME);
        expect(me.channels.map((c: any) => c.code)).toContain('beta-herbs');
        await asSuperAdmin(adminClient);
    });

    it('lets each seller add products to their own shop', async () => {
        await asSeller(adminClient, sellerA);
        ({ productId: alphaProductId, variantId: sellerA.productVariantId } = await createProduct(
            adminClient,
            'Alpha Multivitamin',
            50000,
        ));
        await asSeller(adminClient, sellerB);
        ({ productId: betaProductId, variantId: sellerB.productVariantId } = await createProduct(
            adminClient,
            'Beta Ashwagandha',
            30000,
        ));
        await asSuperAdmin(adminClient);
    });

    it("keeps each seller out of other sellers' products and the store's settings", async () => {
        await asSeller(adminClient, sellerA);
        const { product } = await adminClient.query(GET_PRODUCT, { id: betaProductId });
        expect(product).toBeNull();
        await expect(adminClient.query(CREATE_PROMOTION)).rejects.toThrow('not currently authorized');
        await expect(adminClient.query(CREATE_CUSTOMER)).rejects.toThrow('not currently authorized');
        await expect(
            adminClient.query(UPDATE_SELLER, { input: { id: sellerAId, customFields: { commissionPercent: 0 } } }),
        ).rejects.toThrow('not currently authorized');
        await asSuperAdmin(adminClient);
    });

    it("lists every seller's products in the marketplace at the seller's price", async () => {
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await shopClient.query(SHOP_GET_PRODUCT, { id: alphaProductId });
        expect(product.variants[0].price).toBe(50000);
        const { product: beta } = await shopClient.query(SHOP_GET_PRODUCT, { id: betaProductId });
        expect(beta.variants[0].price).toBe(30000);
    });

    it('lets a seller change their shipping and add shipping methods that cover only their items', async () => {
        await asSeller(adminClient, sellerA);
        const { shippingEligibilityCheckers } = await adminClient.query(GET_SHIPPING_CHECKERS);
        expect(shippingEligibilityCheckers.map((c: any) => c.code)).toEqual(['marketplace-seller-shipping-checker']);

        const { shippingMethods } = await adminClient.query(GET_SHIPPING_METHODS);
        await adminClient.query(UPDATE_SHIPPING_METHOD, {
            input: {
                id: shippingMethods.items[0].id,
                translations: [],
                calculator: {
                    code: 'default-shipping-calculator',
                    arguments: [
                        { name: 'rate', value: '4000' },
                        { name: 'includesTax', value: 'include' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
            },
        });
        await adminClient.query(CREATE_SHIPPING_METHOD, {
            input: {
                code: 'alpha-express',
                fulfillmentHandler: 'manual-fulfillment',
                checker: {
                    code: 'marketplace-seller-shipping-checker',
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: 'default-shipping-calculator',
                    arguments: [
                        { name: 'rate', value: '9000' },
                        { name: 'includesTax', value: 'include' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
                translations: [{ languageCode: 'en', name: 'Alpha express', description: '' }],
            },
        });
        await asSuperAdmin(adminClient);

        // A basket with only seller B's item is never offered seller A's methods.
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: sellerB.productVariantId, quantity: 1 });
        await shopClient.query(SET_SHIPPING_ADDRESS, { input: SHIPPING_ADDRESS });
        const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING_METHODS);
        expect(eligibleShippingMethods.map((m: any) => m.code)).toEqual(['beta-herbs-shipping']);
    });

    it('splits a two-seller order into one order per seller, each with its commission', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: sellerA.productVariantId, quantity: 2 });
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: sellerB.productVariantId, quantity: 1 });
        await shopClient.query(SET_CUSTOMER, {
            input: { emailAddress: 'buyer@example.com', firstName: 'Ravi', lastName: 'Kumar' },
        });
        await shopClient.query(SET_SHIPPING_ADDRESS, { input: SHIPPING_ADDRESS });
        const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING_METHODS);
        const byCode = Object.fromEntries(eligibleShippingMethods.map((m: any) => [m.code, m]));
        expect(Object.keys(byCode).sort()).toEqual(['alpha-express', 'alpha-nutrition-shipping', 'beta-herbs-shipping']);
        expect(byCode['alpha-nutrition-shipping'].priceWithTax).toBe(4000);

        // Moving to payment without a method for every seller is refused.
        await shopClient.query(SET_SHIPPING_METHOD, { ids: [byCode['alpha-nutrition-shipping'].id] });
        const { transitionOrderToState: refused } = await shopClient.query(TRANSITION_TO_STATE, {
            state: 'ArrangingPayment',
        });
        expect(refused.transitionError).toBe('Choose a shipping method for every seller in the order');

        await shopClient.query(SET_SHIPPING_METHOD, {
            ids: [byCode['alpha-nutrition-shipping'].id, byCode['beta-herbs-shipping'].id],
        });
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
        const { eligiblePaymentMethods } = await shopClient.query(ELIGIBLE_PAYMENT_METHODS);
        const payout = eligiblePaymentMethods.find((m: any) => m.code === 'marketplace-seller-payout');
        expect(payout?.isEligible ?? false).toBe(false);

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: { method: 'test-payment', metadata: {} },
        });
        expect(addPaymentToOrder.state).toBe('PaymentSettled');
        marketplaceOrderId = addPaymentToOrder.id;

        const { order } = await adminClient.query(GET_ORDER_WITH_SELLER_ORDERS, { id: marketplaceOrderId });
        expect(order.type).toBe('Aggregate');
        expect(order.sellerOrders).toHaveLength(2);
        const alphaOrder = order.sellerOrders.find((o: any) => o.lines[0].productVariant.id === sellerA.productVariantId);
        const betaOrder = order.sellerOrders.find((o: any) => o.lines[0].productVariant.id === sellerB.productVariantId);

        // The test channel's prices exclude tax, so 18% GST is added. Commission is on items with tax.
        expect(alphaOrder.state).toBe('PaymentSettled');
        expect(alphaOrder.subTotalWithTax).toBe(118000);
        expect(alphaOrder.customFields).toEqual({
            commissionPercent: 10,
            commissionAmount: 11800,
            sellerPayoutAmount: alphaOrder.totalWithTax - 11800,
            sellerPayoutStatus: 'pending',
        });
        expect(betaOrder.subTotalWithTax).toBe(35400);
        expect(betaOrder.customFields).toEqual({
            commissionPercent: 15,
            commissionAmount: 5310,
            sellerPayoutAmount: betaOrder.totalWithTax - 5310,
            sellerPayoutStatus: 'pending',
        });
    });

    it("shows each seller only their own part of the order, and doesn't double-count stock", async () => {
        await asSeller(adminClient, sellerA);
        const { orders } = await adminClient.query(GET_ORDERS);
        expect(orders.items).toHaveLength(1);
        expect(orders.items[0].type).toBe('Seller');
        expect(orders.items[0].lines.map((l: any) => l.productVariant.id)).toEqual([sellerA.productVariantId]);

        const { productVariant } = await adminClient.query(GET_VARIANT_STOCK, { id: sellerA.productVariantId });
        expect(productVariant.stockAllocated).toBe(2);
        await asSuperAdmin(adminClient);
    });

    it('marks the marketplace order shipped once every seller has shipped', async () => {
        await shipSellerOrder(adminClient, sellerA);
        let { order } = await adminClient.query(GET_ORDER_WITH_SELLER_ORDERS, { id: marketplaceOrderId });
        expect(order.state).toBe('PartiallyShipped');

        await shipSellerOrder(adminClient, sellerB);
        ({ order } = await adminClient.query(GET_ORDER_WITH_SELLER_ORDERS, { id: marketplaceOrderId }));
        expect(order.state).toBe('Shipped');
    });

    it("sells only a seller's own products on their storefront, without splitting the order", async () => {
        await shopClient.asAnonymousUser();
        shopClient.setChannelToken(sellerA.channelToken);
        const { products } = await shopClient.query(SHOP_GET_PRODUCTS);
        expect(products.items.map((p: any) => p.name)).toEqual(['Alpha Multivitamin']);

        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: sellerA.productVariantId, quantity: 1 });
        await shopClient.query(SET_CUSTOMER, {
            input: { emailAddress: 'storefront-buyer@example.com', firstName: 'Meera', lastName: 'Iyer' },
        });
        await shopClient.query(SET_SHIPPING_ADDRESS, { input: SHIPPING_ADDRESS });
        const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING_METHODS);
        const standard = eligibleShippingMethods.find((m: any) => m.code === 'alpha-nutrition-shipping');
        await shopClient.query(SET_SHIPPING_METHOD, { ids: [standard.id] });
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: { method: 'test-payment', metadata: {} },
        });
        expect(addPaymentToOrder.state).toBe('PaymentSettled');

        const { order } = await adminClient.query(GET_ORDER_WITH_SELLER_ORDERS, { id: addPaymentToOrder.id });
        expect(order.type).toBe('Regular');
        expect(order.sellerOrders).toHaveLength(0);
        expect(order.customFields).toMatchObject({
            commissionPercent: 10,
            commissionAmount: 5900,
            sellerPayoutStatus: 'pending',
        });
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('lets a seller add the accounts they are paid to, with the details each method needs', async () => {
        await asSeller(adminClient, sellerA);
        const { payoutMethodTypes } = await adminClient.query(PAYOUT_METHOD_TYPES);
        expect(payoutMethodTypes.map((t: any) => t.name)).toEqual(['UPI', 'NEFT', 'IMPS', 'Other', 'Custom']);
        const upi = payoutMethodTypes.find((t: any) => t.code === 'upi');
        const neft = payoutMethodTypes.find((t: any) => t.code === 'neft');

        await expect(
            adminClient.query(CREATE_MY_PAYOUT_METHOD, {
                input: { typeId: upi.id, details: [{ key: 'upiId', value: 'alpha@okhdfc' }] },
            }),
        ).rejects.toThrow('Fill in Name on the account.');

        const { createMyPayoutMethod: first } = await adminClient.query(CREATE_MY_PAYOUT_METHOD, {
            input: {
                typeId: upi.id,
                details: [
                    { key: 'upiId', value: 'alpha@okhdfc' },
                    { key: 'accountHolderName', value: 'Alpha Nutrition' },
                ],
            },
        });
        expect(first).toMatchObject({ name: 'UPI', isDefault: true, summary: 'UPI · alpha@okhdfc' });

        const { createMyPayoutMethod: bank } = await adminClient.query(CREATE_MY_PAYOUT_METHOD, {
            input: {
                typeId: neft.id,
                label: 'HDFC current account',
                isDefault: true,
                details: [
                    { key: 'accountHolderName', value: 'Alpha Nutrition' },
                    { key: 'accountNumber', value: '50200012345678' },
                    { key: 'ifsc', value: 'HDFC0001234' },
                ],
            },
        });
        expect(bank.summary).toBe('NEFT · ••••5678');
        const { myPayments } = await adminClient.query(MY_PAYMENTS);
        expect(myPayments.payoutMethods.map((m: any) => [m.name, m.isDefault])).toEqual([
            ['NEFT', true],
            ['UPI', false],
        ]);

        // Staff pages stay closed to sellers.
        await expect(adminClient.query(SETTLEMENT_OVERVIEW)).rejects.toThrow('not currently authorized');
        await asSuperAdmin(adminClient);
    });

    it('shows staff what each seller earned, the commission, and what is still owed', async () => {
        const { settlementOverview } = await adminClient.query(SETTLEMENT_OVERVIEW);
        const alpha = settlementOverview.sellers.find((s: any) => s.sellerId === sellerAId);
        // The split order (118000 + 4000 shipping) and the storefront order (59000 + 4000 shipping).
        expect(alpha).toMatchObject({
            orderCount: 2,
            grossSales: 185000,
            commission: 17700,
            earned: 185000 - 17700,
            paid: 0,
            pending: 185000 - 17700,
            pendingOrderCount: 2,
            commissionPercent: 10,
            defaultPayoutMethod: 'NEFT · ••••5678',
        });
        const beta = settlementOverview.sellers.find((s: any) => s.sellerId === sellerBId);
        expect(beta).toMatchObject({ orderCount: 1, commission: 5310, commissionPercent: 15, defaultPayoutMethod: null });
        expect(settlementOverview.sellers.map((s: any) => s.sellerName)).not.toContain('Vitamin 2001');
        expect(settlementOverview.pending).toBe(alpha.pending + beta.pending);
        expect(settlementOverview.commission).toBe(17700 + 5310);
    });

    it('records a payout to the chosen account and settles the oldest orders first', async () => {
        const { sellerSettlement } = await adminClient.query(SELLER_SETTLEMENT, { sellerId: sellerAId });
        const bank = sellerSettlement.payoutMethods.find((m: any) => m.name === 'NEFT');
        const [oldest, newest] = sellerSettlement.recentOrders.slice().reverse();

        await expect(
            adminClient.query(RECORD_PAYOUT, {
                input: { sellerId: sellerAId, amount: 185000, payoutMethodId: bank.id, transactionId: 'X' },
            }),
        ).rejects.toThrow('more than the');

        const { recordSellerPayout } = await adminClient.query(RECORD_PAYOUT, {
            input: {
                sellerId: sellerAId,
                amount: oldest.sellerPayoutAmount,
                payoutMethodId: bank.id,
                transactionId: 'UTR123456',
                transactionDetails: 'Paid from the ICICI current account',
            },
        });
        expect(recordSellerPayout).toMatchObject({
            methodName: 'NEFT',
            transactionId: 'UTR123456',
            recordedBy: 'Super Admin',
            voided: false,
        });
        expect(recordSellerPayout.methodDetails).toContainEqual({
            key: 'accountNumber',
            label: 'Account number',
            value: '50200012345678',
        });

        const { sellerSettlement: after } = await adminClient.query(SELLER_SETTLEMENT, { sellerId: sellerAId });
        expect(after.summary).toMatchObject({ paid: oldest.sellerPayoutAmount, pending: newest.sellerPayoutAmount });
        const statuses = Object.fromEntries(after.recentOrders.map((o: any) => [o.code, o.payoutStatus]));
        expect(statuses).toEqual({ [oldest.code]: 'paid', [newest.code]: 'pending' });
        const { order } = await adminClient.query(GET_ORDER_PAYOUT_STATUS, { id: oldest.id });
        expect(order.customFields.sellerPayoutStatus).toBe('paid');
    });

    it("shows the seller their payouts, where the money went and the transaction ID", async () => {
        await asSeller(adminClient, sellerA);
        const { myPayments } = await adminClient.query(MY_PAYMENTS);
        expect(myPayments.summary.pending).toBe(myPayments.summary.earned - myPayments.summary.paid);
        expect(myPayments.payouts).toHaveLength(1);
        expect(myPayments.payouts[0]).toMatchObject({
            methodName: 'NEFT',
            transactionId: 'UTR123456',
            transactionDetails: 'Paid from the ICICI current account',
        });
        await asSuperAdmin(adminClient);
    });

    it('puts a voided payout back into what the seller is owed', async () => {
        const { sellerSettlement } = await adminClient.query(SELLER_SETTLEMENT, { sellerId: sellerAId });
        await adminClient.query(VOID_PAYOUT, { id: sellerSettlement.payouts[0].id, reason: 'Entered twice' });
        const { sellerSettlement: after } = await adminClient.query(SELLER_SETTLEMENT, { sellerId: sellerAId });
        expect(after.summary).toMatchObject({ paid: 0, pending: after.summary.earned, pendingOrderCount: 2 });
        expect(after.payouts[0]).toMatchObject({ voided: true, voidReason: 'Entered twice' });
    });

    it('lets staff record a payout to a seller with no payout method, saying how they paid', async () => {
        await expect(
            adminClient.query(RECORD_PAYOUT, { input: { sellerId: sellerBId, amount: 1000 } }),
        ).rejects.toThrow('say how it was paid');
        const { recordSellerPayout } = await adminClient.query(RECORD_PAYOUT, {
            input: { sellerId: sellerBId, amount: 1000, manualMethodName: 'Cheque', transactionId: 'CHQ-0042' },
        });
        expect(recordSellerPayout).toMatchObject({ methodName: 'Cheque', methodDetails: [] });
        const { updateSellerPayout } = await adminClient.query(UPDATE_PAYOUT, {
            input: { id: recordSellerPayout.id, amount: 2000, transactionDetails: 'Handed over in person' },
        });
        expect(updateSellerPayout).toMatchObject({ amount: 2000, transactionDetails: 'Handed over in person' });
    });

    it('lets staff add a payout method with its own required details', async () => {
        const { createPayoutMethodType } = await adminClient.query(CREATE_PAYOUT_METHOD_TYPE, {
            input: {
                name: 'PayPal',
                fields: [
                    { label: 'PayPal email', required: true },
                    { label: 'Notes', required: false },
                ],
            },
        });
        expect(createPayoutMethodType).toMatchObject({
            code: 'paypal',
            enabled: true,
            fields: [
                { key: 'paypalEmail', label: 'PayPal email', required: true },
                { key: 'notes', label: 'Notes', required: false },
            ],
        });
        await asSeller(adminClient, sellerB);
        const { payoutMethodTypes } = await adminClient.query(PAYOUT_METHOD_TYPES);
        expect(payoutMethodTypes.map((t: any) => t.name)).toContain('PayPal');
        await asSuperAdmin(adminClient);

        // Sellers can no longer pick a method staff turn off.
        await adminClient.query(UPDATE_PAYOUT_METHOD_TYPE, {
            id: createPayoutMethodType.id,
            input: { name: 'PayPal', enabled: false, fields: createPayoutMethodType.fields },
        });
        await asSeller(adminClient, sellerB);
        const { payoutMethodTypes: after } = await adminClient.query(PAYOUT_METHOD_TYPES);
        expect(after.map((t: any) => t.name)).not.toContain('PayPal');
        await asSuperAdmin(adminClient);
    });

    it('asks staff to open a seller shop to see its Payments page', async () => {
        await expect(adminClient.query(MY_PAYMENTS)).rejects.toThrow('Switch to the shop');
    });

    it('removes the login of a rejected seller', async () => {
        const { applyAsSeller } = await shopClient.query(APPLY_AS_SELLER, {
            input: {
                shopName: 'Gamma Foods',
                firstName: 'Gita',
                lastName: 'Das',
                emailAddress: 'gamma@example.com',
                password: PASSWORD,
            },
        });
        await adminClient.query(UPDATE_SELLER, {
            input: { id: applyAsSeller.id, customFields: { status: 'rejected' } },
        });
        await waitFor(async () => {
            const { administrators } = await adminClient.query(GET_ADMINISTRATORS);
            return !administrators.items.some((a: any) => a.emailAddress === 'gamma@example.com');
        });
        const result = await adminClient.asUserWithCredentials('gamma@example.com', PASSWORD);
        expect(result).toMatchObject({ errorCode: 'INVALID_CREDENTIALS_ERROR' });
        await asSuperAdmin(adminClient);
    });
});

async function asSuperAdmin(client: SimpleGraphQLClient) {
    client.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    await client.asSuperAdmin();
}

async function asSeller(client: SimpleGraphQLClient, seller: { email: string; channelToken: string }) {
    await client.asUserWithCredentials(seller.email, PASSWORD);
    client.setChannelToken(seller.channelToken);
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

async function shipSellerOrder(client: SimpleGraphQLClient, seller: { email: string; channelToken: string }) {
    await asSeller(client, seller);
    const { orders } = await client.query(GET_ORDERS);
    const sellerOrder = orders.items[0];
    const { addFulfillmentToOrder } = await client.query(ADD_FULFILLMENT, {
        input: {
            lines: sellerOrder.lines.map((l: any) => ({ orderLineId: l.id, quantity: l.quantity })),
            handler: {
                code: 'manual-fulfillment',
                arguments: [
                    { name: 'method', value: 'Courier' },
                    { name: 'trackingCode', value: 'TRACK-1' },
                ],
            },
        },
    });
    const { transitionFulfillmentToState } = await client.query(TRANSITION_FULFILLMENT, {
        id: addFulfillmentToOrder.id,
        state: 'Shipped',
    });
    expect(transitionFulfillmentToState.state).toBe('Shipped');
    await asSuperAdmin(client);
}

async function waitForSellerChannel(client: SimpleGraphQLClient, sellerName: string) {
    return waitFor(async () => {
        const { channels } = await client.query(GET_CHANNELS);
        return channels.items.find((c: any) => c.seller?.name === sellerName);
    });
}

/** Seller approval runs after the update is saved, so tests wait for its effects. */
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

const SHIPPING_ADDRESS = {
    fullName: 'Ravi Kumar',
    streetLine1: '12 MG Road',
    city: 'Bengaluru',
    postalCode: '560001',
    countryCode: 'IN',
};

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

const APPLY_AS_SELLER = gql`
    mutation ($input: SellerApplicationInput!) {
        applyAsSeller(input: $input) {
            id
            shopName
            status
        }
    }
`;

const GET_SELLER = gql`
    query ($id: ID!) {
        seller(id: $id) {
            id
            name
            customFields {
                status
                commissionPercent
                contactEmail
                contactPhone
                gstin
                fssaiLicenceNumber
                businessAddress
            }
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

const ME = gql`
    query {
        me {
            id
            channels {
                code
                permissions
            }
        }
    }
`;

const GET_ADMINISTRATORS = gql`
    query {
        administrators {
            items {
                id
                emailAddress
            }
        }
    }
`;

const UPDATE_ADMINISTRATOR = gql`
    mutation ($input: UpdateAdministratorInput!) {
        updateAdministrator(input: $input) {
            id
        }
    }
`;

const GET_PRODUCTS = gql`
    query {
        products {
            items {
                id
            }
        }
    }
`;

const GET_PRODUCT = gql`
    query ($id: ID!) {
        product(id: $id) {
            id
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

const GET_VARIANT_STOCK = gql`
    query ($id: ID!) {
        productVariant(id: $id) {
            id
            stockOnHand
            stockAllocated
        }
    }
`;

const CREATE_PROMOTION = gql`
    mutation {
        createPromotion(
            input: {
                enabled: true
                conditions: []
                actions: [
                    {
                        code: "order_percentage_discount"
                        arguments: [{ name: "discount", value: "50" }]
                    }
                ]
                translations: [{ languageCode: en, name: "Half price" }]
            }
        ) {
            ... on Promotion {
                id
            }
        }
    }
`;

const CREATE_CUSTOMER = gql`
    mutation {
        createCustomer(input: { firstName: "X", lastName: "Y", emailAddress: "x@example.com" }) {
            ... on Customer {
                id
            }
        }
    }
`;

const GET_SHIPPING_METHODS = gql`
    query {
        shippingMethods {
            items {
                id
                code
            }
        }
    }
`;

const GET_SHIPPING_CHECKERS = gql`
    query {
        shippingEligibilityCheckers {
            code
        }
    }
`;

const CREATE_SHIPPING_METHOD = gql`
    mutation ($input: CreateShippingMethodInput!) {
        createShippingMethod(input: $input) {
            id
        }
    }
`;

const UPDATE_SHIPPING_METHOD = gql`
    mutation ($input: UpdateShippingMethodInput!) {
        updateShippingMethod(input: $input) {
            id
        }
    }
`;

const GET_STOCK_LOCATIONS = gql`
    query {
        stockLocations {
            items {
                id
                name
            }
        }
    }
`;

const ORDER_FRAGMENT = `
    id
    code
    type
    state
    subTotalWithTax
    totalWithTax
    customFields {
        commissionPercent
        commissionAmount
        sellerPayoutAmount
        sellerPayoutStatus
    }
    lines {
        id
        quantity
        productVariant {
            id
        }
    }
`;

const GET_ORDER_WITH_SELLER_ORDERS = gql`
    query ($id: ID!) {
        order(id: $id) {
            ${ORDER_FRAGMENT}
            sellerOrders {
                ${ORDER_FRAGMENT}
            }
        }
    }
`;

const GET_ORDERS = gql`
    query {
        orders {
            items {
                id
                type
                state
                lines {
                    id
                    quantity
                    productVariant {
                        id
                    }
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

const SHOP_GET_PRODUCT = gql`
    query ($id: ID!) {
        product(id: $id) {
            id
            variants {
                id
                price
            }
        }
    }
`;

const SHOP_GET_PRODUCTS = gql`
    query {
        products {
            items {
                id
                name
            }
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

const SET_CUSTOMER = gql`
    mutation ($input: CreateCustomerInput!) {
        setCustomerForOrder(input: $input) {
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
            priceWithTax
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
                state
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
            isEligible
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
        }
    }
`;

const PAYOUT_METHOD_FIELDS = `
    id
    name
    label
    isDefault
    summary
    details {
        key
        label
        value
    }
`;

const PAYOUT_FIELDS = `
    id
    amount
    paidAt
    methodName
    methodDetails {
        key
        label
        value
    }
    transactionId
    transactionDetails
    recordedBy
    voided
    voidReason
`;

const SETTLEMENT_FIELDS = `
    summary {
        sellerId
        earned
        paid
        pending
        pendingOrderCount
    }
    payouts {
        ${PAYOUT_FIELDS}
    }
    payoutMethods {
        ${PAYOUT_METHOD_FIELDS}
    }
    recentOrders {
        id
        code
        sellerPayoutAmount
        payoutStatus
    }
`;

const PAYOUT_METHOD_TYPES = gql`
    query {
        payoutMethodTypes {
            id
            code
            name
        }
    }
`;

const CREATE_MY_PAYOUT_METHOD = gql`
    mutation ($input: SellerPayoutMethodInput!) {
        createMyPayoutMethod(input: $input) {
            ${PAYOUT_METHOD_FIELDS}
        }
    }
`;

const MY_PAYMENTS = gql`
    query {
        myPayments {
            ${SETTLEMENT_FIELDS}
        }
    }
`;

const SETTLEMENT_OVERVIEW = gql`
    query {
        settlementOverview {
            pending
            commission
            sellers {
                sellerId
                sellerName
                commissionPercent
                orderCount
                grossSales
                commission
                earned
                paid
                pending
                pendingOrderCount
                defaultPayoutMethod
            }
        }
    }
`;

const SELLER_SETTLEMENT = gql`
    query ($sellerId: ID!) {
        sellerSettlement(sellerId: $sellerId) {
            ${SETTLEMENT_FIELDS}
        }
    }
`;

const RECORD_PAYOUT = gql`
    mutation ($input: RecordSellerPayoutInput!) {
        recordSellerPayout(input: $input) {
            ${PAYOUT_FIELDS}
        }
    }
`;

const UPDATE_PAYOUT = gql`
    mutation ($input: UpdateSellerPayoutInput!) {
        updateSellerPayout(input: $input) {
            ${PAYOUT_FIELDS}
        }
    }
`;

const VOID_PAYOUT = gql`
    mutation ($id: ID!, $reason: String!) {
        voidSellerPayout(id: $id, reason: $reason) {
            id
        }
    }
`;

const CREATE_PAYOUT_METHOD_TYPE = gql`
    mutation ($input: PayoutMethodTypeInput!) {
        createPayoutMethodType(input: $input) {
            id
            code
            enabled
            fields {
                key
                label
                required
            }
        }
    }
`;

const UPDATE_PAYOUT_METHOD_TYPE = gql`
    mutation ($id: ID!, $input: PayoutMethodTypeInput!) {
        updatePayoutMethodType(id: $id, input: $input) {
            id
            enabled
        }
    }
`;

const GET_ORDER_PAYOUT_STATUS = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            customFields {
                sellerPayoutStatus
            }
        }
    }
`;
