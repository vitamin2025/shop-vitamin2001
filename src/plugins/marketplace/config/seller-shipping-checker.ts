import { ChannelService, EntityHydrator, LanguageCode, ShippingEligibilityChecker } from '@vendure/core';

import { linesForShippingMethod } from './seller-lines';

let entityHydrator: EntityHydrator;
let channelService: ChannelService;

/**
 * The only ShippingEligibilityChecker in this store. Because every ShippingMethod uses it,
 * a method a seller creates for their own shop can never be offered for another seller's items.
 */
export const sellerShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'marketplace-seller-shipping-checker',
    description: [
        {
            languageCode: LanguageCode.en,
            value: "Applies only to the items sold by this shipping method's seller shop",
        },
    ],
    args: {
        orderMinimum: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Minimum order value' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: "Eligible only when the seller's items in the order add up to at least this value",
                },
            ],
        },
    },
    init(injector) {
        entityHydrator = injector.get(EntityHydrator);
        channelService = injector.get(ChannelService);
    },
    check: async (ctx, order, args, method) => {
        const lines = await linesForShippingMethod(ctx, order, method, entityHydrator, channelService);
        if (lines.length === 0) {
            return false;
        }
        const sellerSubTotalWithTax = lines.reduce((sum, line) => sum + line.proratedLinePriceWithTax, 0);
        return sellerSubTotalWithTax >= args.orderMinimum;
    },
});
