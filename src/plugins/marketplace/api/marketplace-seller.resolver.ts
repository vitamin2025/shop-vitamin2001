import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { MarketplaceSellerService } from '../service/marketplace-seller.service';

@Resolver()
export class MarketplaceSellerResolver {
    constructor(private marketplaceSellerService: MarketplaceSellerService) {}

    @Query()
    @Allow(Permission.Public)
    marketplaceSellers(@Ctx() ctx: RequestContext) {
        return this.marketplaceSellerService.findAll(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceSeller(@Ctx() ctx: RequestContext, @Args() args: { slug: string }) {
        return this.marketplaceSellerService.findOneBySlug(ctx, args.slug);
    }
}
