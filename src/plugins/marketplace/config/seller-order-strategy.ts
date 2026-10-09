import {
    ChannelService,
    EntityHydrator,
    ID,
    idsAreEqual,
    Injector,
    InternalServerError,
    isGraphQlErrorResult,
    Logger,
    Order,
    OrderLine,
    OrderSellerStrategy,
    OrderService,
    RequestContext,
    SplitOrderContents,
} from '@vendure/core';

import { loggerCtx, SELLER_PAYOUT_METHOD_CODE } from '../constants';
import { CommissionService } from '../service/commission.service';

/**
 * Decides which seller each basket line belongs to, and splits a paid marketplace order
 * into one order per seller.
 */
export class MarketplaceOrderSellerStrategy implements OrderSellerStrategy {
    private entityHydrator: EntityHydrator;
    private channelService: ChannelService;
    private orderService: OrderService;
    private commissionService: CommissionService;

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
        this.channelService = injector.get(ChannelService);
        this.orderService = injector.get(OrderService);
        this.commissionService = injector.get(CommissionService);
    }

    async setOrderLineSellerChannel(ctx: RequestContext, orderLine: OrderLine) {
        await this.entityHydrator.hydrate(ctx, orderLine.productVariant, { relations: ['channels'] });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const sellerChannels = orderLine.productVariant.channels.filter(
            channel => !idsAreEqual(channel.id, defaultChannel.id),
        );
        if (!idsAreEqual(ctx.channelId, defaultChannel.id)) {
            // A seller's own storefront: every line belongs to that seller.
            return sellerChannels.find(channel => idsAreEqual(channel.id, ctx.channelId));
        }
        if (sellerChannels.length > 1) {
            Logger.warn(
                `Product variant ${String(orderLine.productVariant.id)} is in ${sellerChannels.length} seller shops. ` +
                    'It is sold by the first one; assign it to only one seller shop.',
                loggerCtx,
            );
        }
        return sellerChannels[0];
    }

    async splitOrder(ctx: RequestContext, order: Order): Promise<SplitOrderContents[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!idsAreEqual(ctx.channelId, defaultChannel.id)) {
            // Placed on a seller's own storefront, so it already belongs to one seller.
            return [];
        }
        const partialOrders = new Map<string, SplitOrderContents>();
        for (const line of order.lines) {
            if (line.sellerChannelId == null) {
                Logger.warn(
                    `Order ${order.code} has a line for product variant ${String(line.productVariantId)}, ` +
                        'which is not in any seller shop. That line stays on the marketplace order.',
                    loggerCtx,
                );
                continue;
            }
            const key = String(line.sellerChannelId);
            let partialOrder = partialOrders.get(key);
            if (!partialOrder) {
                partialOrder = {
                    channelId: line.sellerChannelId,
                    shippingLines: [],
                    lines: [],
                    state: 'ArrangingPayment',
                };
                partialOrders.set(key, partialOrder);
            }
            partialOrder.lines.push(line);
        }
        for (const partialOrder of partialOrders.values()) {
            const shippingLineIds = new Set(partialOrder.lines.map(line => String(line.shippingLineId)));
            partialOrder.shippingLines = order.shippingLines.filter(shippingLine =>
                shippingLineIds.has(String(shippingLine.id)),
            );
        }
        return [...partialOrders.values()];
    }

    async afterSellerOrdersCreated(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        for (const sellerOrder of sellerOrders) {
            const sellerChannelId: ID | undefined = sellerOrder.channels.find(
                channel => !idsAreEqual(channel.id, defaultChannel.id),
            )?.id;
            if (sellerChannelId == null) {
                throw new InternalServerError(`Could not find the seller shop for order ${sellerOrder.code}`);
            }
            await this.commissionService.recordCommission(ctx, sellerOrder, sellerChannelId);
            const result = await this.orderService.addPaymentToOrder(ctx, sellerOrder.id, {
                method: SELLER_PAYOUT_METHOD_CODE,
                metadata: { aggregateOrderCode: aggregateOrder.code },
            });
            if (isGraphQlErrorResult(result)) {
                throw new InternalServerError(result.message);
            }
        }
    }
}
