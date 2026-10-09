import { Inject, Injectable } from '@nestjs/common';
import { Channel, ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';

import { MARKETPLACE_PLUGIN_OPTIONS, PayoutStatus } from '../constants';
import { MarketplacePluginOptions } from '../types';

@Injectable()
export class CommissionService {
    constructor(
        private connection: TransactionalConnection,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    /**
     * Records the commission and the amount owed to the seller on an order sold by one seller:
     * a seller order split from a marketplace order, or an order placed on the seller's own storefront.
     *
     * Commission is a percentage of the items including tax, after discounts, without shipping.
     */
    async recordCommission(ctx: RequestContext, order: Order, sellerChannelId: ID): Promise<void> {
        const channel = await this.connection.getRepository(ctx, Channel).findOne({
            where: { id: sellerChannelId },
            relations: ['seller'],
        });
        const percent = channel?.seller?.customFields?.commissionPercent ?? this.options.defaultCommissionPercent;
        const commissionAmount = Math.round((order.subTotalWithTax * percent) / 100);
        const customFields = {
            commissionPercent: percent,
            commissionAmount,
            sellerPayoutAmount: order.totalWithTax - commissionAmount,
            sellerPayoutStatus: PayoutStatus.Pending,
        };
        await this.connection.getRepository(ctx, Order).update(order.id, { customFields });
        order.customFields = { ...order.customFields, ...customFields };
    }
}
