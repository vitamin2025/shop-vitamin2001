import { OrderType } from '@vendure/common/lib/generated-types';
import { DefaultStockAllocationStrategy, Order, OrderState, RequestContext } from '@vendure/core';

/**
 * Stock is allocated on each seller order, which is what the seller fulfils. Allocating it on the
 * marketplace order as well would count the same items twice and never release them.
 */
export class SellerStockAllocationStrategy extends DefaultStockAllocationStrategy {
    shouldAllocateStock(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean | Promise<boolean> {
        if (order.type === OrderType.Aggregate) {
            return false;
        }
        return super.shouldAllocateStock(ctx, fromState, toState, order);
    }
}
