import { OrderType } from '@vendure/common/lib/generated-types';
import { LanguageCode, PaymentMethodEligibilityChecker, PaymentMethodHandler } from '@vendure/core';

import { SELLER_PAYOUT_METHOD_CODE } from '../constants';

/**
 * Marks a seller order as paid. The customer paid the marketplace for the whole basket, so the
 * seller's part is settled straight away and the seller can ship. What the marketplace owes the
 * seller is kept in the order's "Owed to seller" and "Seller payout" fields.
 */
export const sellerPayoutHandler = new PaymentMethodHandler({
    code: SELLER_PAYOUT_METHOD_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'Paid through the marketplace' }],
    args: {},
    createPayment: (ctx, order, amount, args, metadata) => {
        if (order.type !== OrderType.Seller) {
            return {
                amount,
                state: 'Declined' as const,
                errorMessage: 'This payment method is only used for seller orders',
            };
        }
        return {
            amount,
            state: 'Settled' as const,
            transactionId: `marketplace-${order.code}`,
            metadata: {
                aggregateOrderCode: metadata.aggregateOrderCode,
                public: { note: 'Paid by the customer through the marketplace' },
            },
        };
    },
    settlePayment: () => ({ success: true }),
});

/** Keeps the payout method out of every customer checkout. */
export const sellerOrderOnlyChecker = new PaymentMethodEligibilityChecker({
    code: 'marketplace-seller-order-only',
    description: [{ languageCode: LanguageCode.en, value: 'Only for seller orders created by the marketplace' }],
    args: {},
    check: (ctx, order) => order.type === OrderType.Seller,
});
