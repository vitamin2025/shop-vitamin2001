import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext, Transaction } from '@vendure/core';

import { manageOwnPayoutsPermission, manageSellerPayoutsPermission } from '../constants';
import { SellerPayout } from '../entities/seller-payout.entity';
import { SellerPayoutMethod } from '../entities/seller-payout-method.entity';
import {
    PayoutMethodService,
    PayoutMethodTypeInput,
    SellerPayoutMethodInput,
} from '../service/payout-method.service';
import {
    RecordSellerPayoutInput,
    SettlementService,
    UpdateSellerPayoutInput,
} from '../service/settlement.service';

const staff = manageSellerPayoutsPermission.Permission;
const seller = manageOwnPayoutsPermission.Permission;

/** Settlements for staff: every seller's balance, payouts, and the payout method types on offer. */
@Resolver()
export class SettlementAdminResolver {
    constructor(
        private settlementService: SettlementService,
        private payoutMethodService: PayoutMethodService,
    ) {}

    @Query()
    @Allow(staff, seller)
    payoutMethodTypes(@Ctx() ctx: RequestContext, @Args() args: { includeDisabled?: boolean | null }) {
        const includeDisabled = !!args.includeDisabled && ctx.userHasPermissions([staff]);
        return this.payoutMethodService.findTypes(ctx, includeDisabled);
    }

    @Query()
    @Allow(staff)
    settlementOverview(@Ctx() ctx: RequestContext) {
        return this.settlementService.overview(ctx);
    }

    @Query()
    @Allow(staff)
    sellerSettlement(@Ctx() ctx: RequestContext, @Args() args: { sellerId: ID }) {
        return this.settlementService.sellerDetail(ctx, args.sellerId);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    createPayoutMethodType(@Ctx() ctx: RequestContext, @Args() args: { input: PayoutMethodTypeInput }) {
        return this.payoutMethodService.createType(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    updatePayoutMethodType(@Ctx() ctx: RequestContext, @Args() args: { id: ID; input: PayoutMethodTypeInput }) {
        return this.payoutMethodService.updateType(ctx, args.id, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    deletePayoutMethodType(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.payoutMethodService.deleteType(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    recordSellerPayout(@Ctx() ctx: RequestContext, @Args() args: { input: RecordSellerPayoutInput }) {
        return this.settlementService.recordPayout(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    updateSellerPayout(@Ctx() ctx: RequestContext, @Args() args: { input: UpdateSellerPayoutInput }) {
        return this.settlementService.updatePayout(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(staff)
    voidSellerPayout(@Ctx() ctx: RequestContext, @Args() args: { id: ID; reason: string }) {
        return this.settlementService.voidPayout(ctx, args.id, args.reason);
    }
}

/** A seller's own Payments page. The seller is the one whose shop the request is for. */
@Resolver()
export class SellerPaymentsResolver {
    constructor(
        private settlementService: SettlementService,
        private payoutMethodService: PayoutMethodService,
    ) {}

    @Query()
    @Allow(seller)
    async myPayments(@Ctx() ctx: RequestContext) {
        const own = await this.settlementService.sellerForActiveChannel(ctx);
        return this.settlementService.sellerDetail(ctx, own.id);
    }

    @Transaction()
    @Mutation()
    @Allow(seller)
    async createMyPayoutMethod(@Ctx() ctx: RequestContext, @Args() args: { input: SellerPayoutMethodInput }) {
        const own = await this.settlementService.sellerForActiveChannel(ctx);
        return this.payoutMethodService.createSellerMethod(ctx, own.id, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(seller)
    async updateMyPayoutMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; input: SellerPayoutMethodInput },
    ) {
        const own = await this.settlementService.sellerForActiveChannel(ctx);
        return this.payoutMethodService.updateSellerMethod(ctx, own.id, args.id, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(seller)
    async deleteMyPayoutMethod(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const own = await this.settlementService.sellerForActiveChannel(ctx);
        return this.payoutMethodService.deleteSellerMethod(ctx, own.id, args.id);
    }
}

@Resolver('SellerPayoutMethod')
export class SellerPayoutMethodEntityResolver {
    constructor(private payoutMethodService: PayoutMethodService) {}

    @ResolveField()
    name(@Parent() method: SellerPayoutMethod) {
        return this.payoutMethodService.methodName(method);
    }

    @ResolveField()
    summary(@Parent() method: SellerPayoutMethod) {
        return this.payoutMethodService.summary(method);
    }

    @ResolveField()
    details(@Parent() method: SellerPayoutMethod) {
        return this.payoutMethodService.describe(method);
    }
}

@Resolver('SellerPayout')
export class SellerPayoutEntityResolver {
    @ResolveField()
    voided(@Parent() payout: SellerPayout) {
        return !!payout.voidedAt;
    }
}
