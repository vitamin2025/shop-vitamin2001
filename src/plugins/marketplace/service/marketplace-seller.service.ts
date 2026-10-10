import { Injectable } from '@nestjs/common';
import { ChannelService, RequestContext, Seller, TransactionalConnection } from '@vendure/core';
import { IsNull, Not } from 'typeorm';

import { SellerStatus } from '../constants';
import { MarketplaceSeller } from '../types';

/**
 * The sellers a storefront can show: approved, not deleted, with an open shop and a slug.
 * Looked up across all Channels, whichever Channel the request came in on.
 */
@Injectable()
export class MarketplaceSellerService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    async findAll(ctx: RequestContext): Promise<MarketplaceSeller[]> {
        return this.find(ctx);
    }

    async findOneBySlug(ctx: RequestContext, slug: string): Promise<MarketplaceSeller | undefined> {
        const [seller] = await this.find(ctx, slug);
        return seller;
    }

    private async find(ctx: RequestContext, slug?: string): Promise<MarketplaceSeller[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const sellers = await this.connection.getRepository(ctx, Seller).find({
            where: {
                deletedAt: IsNull(),
                customFields: { status: SellerStatus.Approved, slug: slug ?? Not(IsNull()) },
                channels: { id: Not(defaultChannel.id) },
            },
            relations: { channels: true, customFields: { logo: true, banner: true } },
            order: { name: 'ASC' },
        });
        return sellers.map(seller => ({
            id: seller.id,
            slug: seller.customFields.slug ?? '',
            name: seller.name,
            description: seller.customFields.description,
            logo: seller.customFields.logo,
            banner: seller.customFields.banner,
            isHouseShop: seller.customFields.isHouseShop,
            gstin: seller.customFields.gstin ?? null,
            fssaiLicenceNumber: seller.customFields.fssaiLicenceNumber ?? null,
            businessAddress: seller.customFields.businessAddress ?? null,
            channelCode: seller.channels[0].code,
            channelToken: seller.channels[0].token,
        }));
    }
}
