import {
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    PluginCommonModule,
    Type,
    VendurePlugin,
} from '@vendure/core';

import { SellerApplicationResolver } from './api/seller-application.resolver';
import { shopApiExtensions } from './api/shop-api-extensions';
import { marketplaceOrderProcess } from './config/marketplace-order-process';
import { MarketplaceOrderSellerStrategy } from './config/seller-order-strategy';
import { sellerOrderOnlyChecker, sellerPayoutHandler } from './config/seller-payout-handler';
import { sellerShippingEligibilityChecker } from './config/seller-shipping-checker';
import { SellerShippingLineAssignmentStrategy } from './config/seller-shipping-line-strategy';
import { SellerStockAllocationStrategy } from './config/seller-stock-allocation-strategy';
import { MARKETPLACE_PLUGIN_OPTIONS } from './constants';
import { orderCustomFields, sellerCustomFields } from './custom-fields';
import { CommissionService } from './service/commission.service';
import { MarketplaceSetupService } from './service/marketplace-setup.service';
import { SellerApplicationService } from './service/seller-application.service';
import { SellerProvisioningService } from './service/seller-provisioning.service';
import { SuperadminContextService } from './service/superadmin-context.service';
import { MarketplacePluginOptions } from './types';

/**
 * Turns the store into a marketplace. Each approved seller gets their own shop (a Channel) with a
 * login limited to it; the default Channel is the marketplace that lists every seller's products.
 * A paid marketplace order is split into one order per seller, and the commission is recorded on each.
 *
 * Built on Vendure's multivendor example plugin. See README.md, "Sellers".
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        SuperadminContextService,
        CommissionService,
        SellerProvisioningService,
        SellerApplicationService,
        MarketplaceSetupService,
        { provide: MARKETPLACE_PLUGIN_OPTIONS, useFactory: () => MarketplacePlugin.options },
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [SellerApplicationResolver],
    },
    configuration: config => {
        config.customFields.Seller.push(...sellerCustomFields);
        config.customFields.Order.push(...orderCustomFields);

        config.paymentOptions.paymentMethodHandlers.push(sellerPayoutHandler);
        config.paymentOptions.paymentMethodEligibilityCheckers = [
            ...(config.paymentOptions.paymentMethodEligibilityCheckers ?? []),
            sellerOrderOnlyChecker,
        ];

        // Marketplace orders have no fulfillments of their own; marketplaceOrderProcess keeps the
        // fulfillment checks for every other order.
        config.orderOptions.process = [
            configureDefaultOrderProcess({ checkFulfillmentStates: false }),
            marketplaceOrderProcess,
        ];
        config.orderOptions.orderSellerStrategy = new MarketplaceOrderSellerStrategy();
        config.orderOptions.stockAllocationStrategy = new SellerStockAllocationStrategy();

        // A price a seller sets in their shop is also the price in the marketplace.
        config.catalogOptions.productVariantPriceUpdateStrategy = new DefaultProductVariantPriceUpdateStrategy({
            syncPricesAcrossChannels: true,
        });

        // The only checker on offer, so a shipping method a seller creates applies to their items alone.
        config.shippingOptions.shippingEligibilityCheckers = [sellerShippingEligibilityChecker];
        config.shippingOptions.shippingLineAssignmentStrategy = new SellerShippingLineAssignmentStrategy();
        return config;
    },
    compatibility: '^3.0.0',
})
export class MarketplacePlugin {
    static options: MarketplacePluginOptions;

    static init(options: MarketplacePluginOptions): Type<MarketplacePlugin> {
        MarketplacePlugin.options = options;
        return MarketplacePlugin;
    }
}
