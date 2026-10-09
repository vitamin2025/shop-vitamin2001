import { OrderType } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelService,
    CustomOrderProcess,
    EntityHydrator,
    ID,
    idsAreEqual,
    Order,
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    orderItemsArePartiallyShipped,
    orderItemsAreShipped,
    OrderService,
    OrderState,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { CommissionService } from '../service/commission.service';

let connection: TransactionalConnection;
let orderService: OrderService;
let channelService: ChannelService;
let entityHydrator: EntityHydrator;
let commissionService: CommissionService;

/**
 * Used together with the default order process configured with `checkFulfillmentStates: false`.
 *
 * - The marketplace order has no fulfillments of its own, so it may move to Shipped or Delivered
 *   without them, and follows its seller orders: Shipped once every seller has shipped, and so on.
 * - Every other order keeps the default fulfillment checks.
 * - An order placed on a seller's own storefront gets its commission recorded once it is paid.
 */
export const marketplaceOrderProcess: CustomOrderProcess<OrderState> = {
    init(injector) {
        connection = injector.get(TransactionalConnection);
        orderService = injector.get(OrderService);
        channelService = injector.get(ChannelService);
        entityHydrator = injector.get(EntityHydrator);
        commissionService = injector.get(CommissionService);
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        if (fromState === 'AddingItems' && toState === 'ArrangingPayment') {
            if (order.lines.some(line => !line.shippingLineId)) {
                return 'Choose a shipping method for every seller in the order';
            }
        }
        if (order.type === OrderType.Aggregate) {
            return;
        }
        if (toState === 'PartiallyShipped') {
            if (!orderItemsArePartiallyShipped(await findOrderWithFulfillments(ctx, order.id))) {
                return 'message.cannot-transition-unless-some-order-items-shipped';
            }
        }
        if (toState === 'Shipped') {
            if (!orderItemsAreShipped(await findOrderWithFulfillments(ctx, order.id))) {
                return 'message.cannot-transition-unless-all-order-items-shipped';
            }
        }
        if (toState === 'PartiallyDelivered') {
            if (!orderItemsArePartiallyDelivered(await findOrderWithFulfillments(ctx, order.id))) {
                return 'message.cannot-transition-unless-some-order-items-delivered';
            }
        }
        if (toState === 'Delivered') {
            if (!orderItemsAreDelivered(await findOrderWithFulfillments(ctx, order.id))) {
                return 'message.cannot-transition-unless-all-order-items-delivered';
            }
        }
    },

    async onTransitionEnd(fromState, toState, { ctx, order }) {
        if (order.type === OrderType.Seller) {
            await syncAggregateOrderState(ctx, order, toState);
        }
        if (
            order.type === OrderType.Regular &&
            (toState === 'PaymentSettled' || toState === 'PaymentAuthorized') &&
            order.customFields.commissionAmount == null
        ) {
            const defaultChannel = await channelService.getDefaultChannel(ctx);
            await entityHydrator.hydrate(ctx, order, { relations: ['channels'] });
            const sellerChannel = order.channels.find(channel => !idsAreEqual(channel.id, defaultChannel.id));
            if (sellerChannel) {
                await commissionService.recordCommission(ctx, order, sellerChannel.id);
            }
        }
    },
};

async function syncAggregateOrderState(ctx: RequestContext, sellerOrder: Order, toState: OrderState) {
    const aggregateOrder = await orderService.getAggregateOrder(ctx, sellerOrder);
    if (!aggregateOrder) {
        return;
    }
    // The current context may belong to the seller's Channel, which cannot update the marketplace
    // order. A copy keeps the session and the transaction; only the Channel changes.
    const defaultChannelCtx = ctx.copy();
    (defaultChannelCtx as unknown as { _channel: Channel })._channel = await channelService.getDefaultChannel(ctx);
    const otherSellerOrders = (await orderService.getSellerOrders(ctx, aggregateOrder)).filter(
        order => !idsAreEqual(order.id, sellerOrder.id),
    );
    const states = [...otherSellerOrders.map(order => order.state), toState];
    let nextState: OrderState | undefined;
    if (states.every(state => state === 'Delivered')) {
        nextState = 'Delivered';
    } else if (states.every(state => state === 'Shipped' || state === 'Delivered')) {
        nextState = 'Shipped';
    } else if (states.some(state => state === 'Delivered')) {
        nextState = 'PartiallyDelivered';
    } else if (states.some(state => state === 'Shipped' || state === 'PartiallyShipped')) {
        nextState = 'PartiallyShipped';
    }
    if (nextState && nextState !== aggregateOrder.state) {
        await orderService.transitionToState(defaultChannelCtx, aggregateOrder.id, nextState);
    }
}

async function findOrderWithFulfillments(ctx: RequestContext, id: ID): Promise<Order> {
    return connection.getEntityOrThrow(ctx, Order, id, {
        relations: ['lines', 'fulfillments', 'fulfillments.lines', 'fulfillments.lines.fulfillment'],
    });
}
