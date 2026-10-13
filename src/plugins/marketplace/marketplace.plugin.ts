import {
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    PluginCommonModule,
    Type,
    VendurePlugin,
} from '@vendure/core';

import { adminApiExtensions } from './api/admin-api-extensions';
import { MarketplaceSellerResolver } from './api/marketplace-seller.resolver';
import {
    SellerPaymentsResolver,
    SellerPayoutEntityResolver,
    SellerPayoutMethodEntityResolver,
    SettlementAdminResolver,
} from './api/payouts.resolver';
import { SellerApplicationResolver } from './api/seller-application.resolver';
import { shopApiExtensions } from './api/shop-api-extensions';
import { marketplaceOrderProcess } from './config/marketplace-order-process';
import { MarketplaceOrderSellerStrategy } from './config/seller-order-strategy';
import { sellerOrderOnlyChecker, sellerPayoutHandler } from './config/seller-payout-handler';
import { SellerRemovalSubscriber } from './config/seller-removal-subscriber';
import { sellerShippingEligibilityChecker } from './config/seller-shipping-checker';
import { SellerShippingLineAssignmentStrategy } from './config/seller-shipping-line-strategy';
import { SellerStockAllocationStrategy } from './config/seller-stock-allocation-strategy';
import { manageOwnPayoutsPermission, manageSellerPayoutsPermission, MARKETPLACE_PLUGIN_OPTIONS } from './constants';
import { orderCustomFields, sellerCustomFields } from './custom-fields';
import { PayoutMethodType } from './entities/payout-method-type.entity';
import { SellerPayout } from './entities/seller-payout.entity';
import { SellerPayoutMethod } from './entities/seller-payout-method.entity';
import { CommissionService } from './service/commission.service';
import { MarketplaceSellerService } from './service/marketplace-seller.service';
import { MarketplaceSetupService } from './service/marketplace-setup.service';
import { PayoutMethodService } from './service/payout-method.service';
import { SellerApplicationService } from './service/seller-application.service';
import { SellerProvisioningService } from './service/seller-provisioning.service';
import { SettlementService } from './service/settlement.service';
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
        MarketplaceSellerService,
        PayoutMethodService,
        SettlementService,
        { provide: MARKETPLACE_PLUGIN_OPTIONS, useFactory: () => MarketplacePlugin.options },
    ],
    entities: [PayoutMethodType, SellerPayoutMethod, SellerPayout],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            SettlementAdminResolver,
            SellerPaymentsResolver,
            SellerPayoutMethodEntityResolver,
            SellerPayoutEntityResolver,
        ],
    },
    // Settlements and payout pages for staff, and the Payments page for sellers.
    dashboard: './dashboard/index.tsx',
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [SellerApplicationResolver, MarketplaceSellerResolver],
    },
    configuration: config => {
        config.customFields.Seller.push(...sellerCustomFields);
        config.customFields.Order.push(...orderCustomFields);
        config.authOptions.customPermissions.push(manageSellerPayoutsPermission, manageOwnPayoutsPermission);

        // Lets a seller be deleted while their shop Channel still exists. See SellerRemovalSubscriber.
        const { subscribers = [] } = config.dbConnectionOptions;
        config.dbConnectionOptions = {
            ...config.dbConnectionOptions,
            subscribers: [
                ...(Array.isArray(subscribers) ? subscribers : Object.values(subscribers)),
                SellerRemovalSubscriber,
            ],
        };

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
