import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { payuPaymentHandler } from './config/payu-payment-handler';
import { Vitamin2001AuthenticationStrategy } from './config/vitamin2001-authentication-strategy';
import { BE_BRIDGE_PLUGIN_OPTIONS } from './constants';
import { BackendEventsService } from './service/backend-events.service';
import { PayuSetupService } from './service/payu-setup.service';
import { BackendBridgePluginOptions } from './types';

/**
 * The Vendure side of the bridge to the vitamin2001.in backend (the BE), which is the only API
 * storefronts call. The BE talks to the Shop API server to server:
 *
 * - it signs customers in with the `vitamin2001` authentication strategy,
 * - it pays for orders with the `payu` payment method once PayU has confirmed the payment,
 * - and this plugin POSTs signed events to it when sellers change and orders ship.
 *
 * Both sides share SHOP_BRIDGE_SECRET. See README.md, "Storefront backend".
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        PayuSetupService,
        BackendEventsService,
        { provide: BE_BRIDGE_PLUGIN_OPTIONS, useFactory: () => BackendBridgePlugin.options },
    ],
    configuration: config => {
        config.authOptions.shopAuthenticationStrategy.push(new Vitamin2001AuthenticationStrategy());
        config.paymentOptions.paymentMethodHandlers.push(payuPaymentHandler);
        return config;
    },
    compatibility: '^3.0.0',
})
export class BackendBridgePlugin {
    static options: BackendBridgePluginOptions;

    static init(options: BackendBridgePluginOptions): Type<BackendBridgePlugin> {
        BackendBridgePlugin.options = options;
        return BackendBridgePlugin;
    }
}
