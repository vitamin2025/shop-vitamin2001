import {
    ChannelService,
    EntityHydrator,
    ID,
    idsAreEqual,
    Order,
    OrderLine,
    RequestContext,
    ShippingMethod,
} from '@vendure/core';

/**
 * The OrderLines a ShippingMethod is responsible for.
 *
 * A ShippingMethod assigned to one or more seller Channels covers only the lines sold by those
 * sellers. A ShippingMethod that is only in the default Channel covers the lines that have no
 * seller (products that were never moved into a seller shop).
 */
export async function linesForShippingMethod(
    ctx: RequestContext,
    order: Order,
    method: ShippingMethod,
    entityHydrator: EntityHydrator,
    channelService: ChannelService,
): Promise<OrderLine[]> {
    await entityHydrator.hydrate(ctx, method, { relations: ['channels'] });
    const defaultChannel = await channelService.getDefaultChannel(ctx);
    const sellerChannelIds: ID[] = method.channels
        .filter(channel => !idsAreEqual(channel.id, defaultChannel.id))
        .map(channel => channel.id);
    if (sellerChannelIds.length === 0) {
        return order.lines.filter(line => line.sellerChannelId == null);
    }
    return order.lines.filter(
        line => line.sellerChannelId != null && sellerChannelIds.some(id => idsAreEqual(id, line.sellerChannelId)),
    );
}
