import {
    ChannelService,
    EntityHydrator,
    Injector,
    Order,
    RequestContext,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';

import { linesForShippingMethod } from './seller-lines';

/**
 * With items from several sellers, the customer picks one ShippingMethod per seller.
 * Each ShippingLine is assigned to the lines of the seller its method belongs to.
 */
export class SellerShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    private entityHydrator: EntityHydrator;
    private channelService: ChannelService;

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
        this.channelService = injector.get(ChannelService);
    }

    async assignShippingLineToOrderLines(ctx: RequestContext, shippingLine: ShippingLine, order: Order) {
        await this.entityHydrator.hydrate(ctx, shippingLine, { relations: ['shippingMethod'] });
        return linesForShippingMethod(
            ctx,
            order,
            shippingLine.shippingMethod,
            this.entityHydrator,
            this.channelService,
        );
    }
}
