import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { SellerApplicationService } from '../service/seller-application.service';
import { SellerApplicationInput } from '../types';

@Resolver()
export class SellerApplicationResolver {
    constructor(private sellerApplicationService: SellerApplicationService) {}

    @Mutation()
    @Allow(Permission.Public)
    applyAsSeller(@Ctx() ctx: RequestContext, @Args() args: { input: SellerApplicationInput }) {
        return this.sellerApplicationService.apply(ctx, args.input);
    }
}
