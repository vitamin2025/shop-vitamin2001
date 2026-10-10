import { LanguageCode, PaymentMethodHandler } from '@vendure/core';

import { verifyToken } from '../bridge-token';
import { BE_BRIDGE_PLUGIN_OPTIONS, PAYU_METHOD_CODE } from '../constants';
import { BackendBridgePluginOptions, PaymentToken } from '../types';

let options: BackendBridgePluginOptions;

/**
 * Settles an order the customer paid for with PayU on the BE. The BE confirms the payment with
 * PayU and passes a signed `payment` token in the metadata; the order is settled only when that
 * token names this order and this amount. Refunds are made by hand in the PayU dashboard.
 */
export const payuPaymentHandler = new PaymentMethodHandler({
    code: PAYU_METHOD_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'PayU, confirmed by vitamin2001.in' }],
    args: {},
    init(injector) {
        options = injector.get(BE_BRIDGE_PLUGIN_OPTIONS);
    },
    createPayment: (ctx, order, amount, args, metadata) => {
        const payment = verifyToken<PaymentToken>(options.secret, 'payment', metadata.token);
        if (
            !payment ||
            payment.orderCode !== order.code ||
            payment.amountMinor !== amount ||
            !payment.txnid ||
            !payment.mihpayid
        ) {
            return { amount, state: 'Declined' as const, errorMessage: 'Payment confirmation is invalid' };
        }
        const txnid = String(payment.txnid);
        const mihpayid = String(payment.mihpayid);
        return {
            amount,
            state: 'Settled' as const,
            transactionId: mihpayid,
            metadata: { txnid, mihpayid, public: { txnid } },
        };
    },
    settlePayment: () => ({ success: true }),
    createRefund: () => ({
        state: 'Settled' as const,
        metadata: { note: 'Refunded by hand in the PayU dashboard' },
    }),
});
