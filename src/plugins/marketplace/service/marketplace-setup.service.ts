import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    ChannelEvent,
    ChannelService,
    EventBus,
    ID,
    idsAreEqual,
    LanguageCode,
    Logger,
    PaymentMethod,
    PaymentMethodEvent,
    PaymentMethodService,
    Permission,
    ProcessContext,
    ProductVariant,
    RequestContext,
    Role,
    Seller,
    SellerEvent,
    SellerService,
    ShippingMethod,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull, Like } from 'typeorm';

import { sellerOrderOnlyChecker, sellerPayoutHandler } from '../config/seller-payout-handler';
import { takeRemovedSeller } from '../config/seller-removal-subscriber';
import { sellerShippingEligibilityChecker } from '../config/seller-shipping-checker';
import {
    loggerCtx,
    manageOwnPayoutsPermission,
    MARKETPLACE_PLUGIN_OPTIONS,
    SELLER_PAYOUT_METHOD_CODE,
    SELLER_ROLE_SUFFIX,
    SellerStatus,
} from '../constants';
import { SellerShopSyncedEvent } from '../events';
import { MarketplacePluginOptions } from '../types';

import { PayoutMethodService } from './payout-method.service';
import { SellerProvisioningService } from './seller-provisioning.service';
import { SettlementService } from './settlement.service';
import { SuperadminContextService } from './superadmin-context.service';

/**
 * Runs on server start: keeps the store's data in the shape the marketplace needs,
 * and reacts to sellers being approved, rejected or deleted in the dashboard.
 */
@Injectable()
export class MarketplaceSetupService implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private processContext: ProcessContext,
        private channelService: ChannelService,
        private paymentMethodService: PaymentMethodService,
        private sellerService: SellerService,
        private sellerProvisioningService: SellerProvisioningService,
        private superadminContextService: SuperadminContextService,
        private payoutMethodService: PayoutMethodService,
        private settlementService: SettlementService,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    async onApplicationBootstrap() {
        if (!this.processContext.isServer) {
            return;
        }
        this.eventBus.ofType(SellerEvent).subscribe(event => {
            if (event.type === 'deleted') {
                // The deleted Seller has lost its id; the input is the id that was deleted.
                const removed = takeRemovedSeller(event.input as ID);
                if (removed) {
                    this.sellerProvisioningService
                        .closeShop(removed)
                        .catch(err =>
                            Logger.error(
                                `Could not close the shop of "${removed.name}": ${String(err.message)}`,
                                loggerCtx,
                            ),
                        );
                }
                return;
            }
            this.sellerProvisioningService
                .syncSeller(event.entity.id)
                .catch(err => Logger.error(`Could not update seller "${event.entity.name}": ${String(err.message)}`, loggerCtx));
        });
        this.eventBus.ofType(PaymentMethodEvent).subscribe(event => {
            if (event.type === 'created' && event.entity.code !== SELLER_PAYOUT_METHOD_CODE) {
                this.sharePaymentMethodWithSellers(event.ctx, event.entity).catch(err =>
                    Logger.error(`Could not share a payment method with seller shops: ${String(err.message)}`, loggerCtx),
                );
            }
        });

        // The house shop needs the default channel's tax and shipping zones, which a new store sets later.
        this.eventBus.ofType(ChannelEvent).subscribe(event => {
            if (event.type === 'updated' && event.entity.code === DEFAULT_CHANNEL_CODE) {
                this.superadminContextService
                    .create()
                    .then(ctx => this.ensureHouseShop(ctx))
                    .catch(err => Logger.error(`Could not create the house shop: ${String(err.message)}`, loggerCtx));
            }
        });

        const ctx = await this.superadminContextService.create();
        await this.ensurePayoutPaymentMethod(ctx);
        await this.useSellerShippingChecker(ctx);
        try {
            await this.ensureHouseShop(ctx);
        } catch (err: any) {
            Logger.warn(
                `The "${this.options.houseShopName}" shop will be created once the default channel has a tax zone and a shipping zone.`,
                loggerCtx,
            );
        }
        await this.backfillSellerSlugs(ctx);
        await this.warnAboutProductsWithoutSeller(ctx);
        await this.payoutMethodService.ensureDefaultTypes(ctx);
        await this.grantPaymentsPageToSellers(ctx);
        await this.settlementService.recordOpeningBalances(ctx);
    }

    /** Seller roles made before the Payments page existed get access to it. */
    private async grantPaymentsPageToSellers(ctx: RequestContext) {
        const permission = manageOwnPayoutsPermission.Permission as Permission;
        const roles = await this.connection
            .getRepository(ctx, Role)
            .find({ where: { code: Like(`%${SELLER_ROLE_SUFFIX}`) } });
        for (const role of roles) {
            if (!role.permissions.includes(permission)) {
                role.permissions = [...role.permissions, permission];
                await this.connection.getRepository(ctx, Role).save(role);
            }
        }
    }

    private async ensurePayoutPaymentMethod(ctx: RequestContext) {
        const exists = await this.connection
            .getRepository(ctx, PaymentMethod)
            .exists({ where: { code: SELLER_PAYOUT_METHOD_CODE } });
        if (exists) {
            return;
        }
        await this.paymentMethodService.create(ctx, {
            code: SELLER_PAYOUT_METHOD_CODE,
            enabled: true,
            handler: { code: sellerPayoutHandler.code, arguments: [] },
            checker: { code: sellerOrderOnlyChecker.code, arguments: [] },
            translations: [
                {
                    languageCode: LanguageCode.en,
                    name: 'Paid through the marketplace',
                    description: 'Used by the marketplace for seller orders. Customers never see it.',
                },
            ],
        });
        Logger.info('Created the seller payout payment method', loggerCtx);
    }

    /**
     * Every ShippingMethod must use the seller-aware checker (it is the only one configured).
     * Methods created before the marketplace existed are switched over, keeping their minimum order value.
     */
    private async useSellerShippingChecker(ctx: RequestContext) {
        const repo = this.connection.getRepository(ctx, ShippingMethod);
        const methods = await repo.find({ where: { deletedAt: IsNull() } });
        for (const method of methods) {
            if (method.checker.code === sellerShippingEligibilityChecker.code) {
                continue;
            }
            const orderMinimum = method.checker.args.find(arg => arg.name === 'orderMinimum')?.value ?? '0';
            await repo.update(method.id, {
                checker: {
                    code: sellerShippingEligibilityChecker.code,
                    args: [{ name: 'orderMinimum', value: orderMinimum }],
                },
            });
            Logger.info(`Shipping method "${method.code}" now uses the seller shipping checker`, loggerCtx);
        }
    }

    private async ensureHouseShop(ctx: RequestContext) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!defaultChannel.defaultTaxZone || !defaultChannel.defaultShippingZone) {
            throw new Error('The default channel has no tax zone or shipping zone yet.');
        }
        await this.connection.withTransaction(ctx, async txCtx => {
            const sellers = await this.connection.getRepository(txCtx, Seller).find({ where: { deletedAt: IsNull() } });
            let houseShop = sellers.find(seller => seller.customFields.isHouseShop);
            if (houseShop && (await this.sellerProvisioningService.findSellerChannel(txCtx, houseShop.id))) {
                return;
            }
            if (!houseShop) {
                houseShop = await this.sellerService.create(txCtx, {
                    name: this.options.houseShopName,
                    customFields: { status: SellerStatus.Approved, isHouseShop: true },
                });
            }
            await this.sellerProvisioningService.openShop(txCtx, houseShop, { withSellerRole: false });
        });
    }

    /**
     * Shops opened before sellers had a slug get one from their channel code. Each is then
     * announced like a provisioned seller, since listeners have not seen it with a slug yet.
     */
    private async backfillSellerSlugs(ctx: RequestContext) {
        const sellers = await this.connection
            .getRepository(ctx, Seller)
            .find({ where: { deletedAt: IsNull(), customFields: { slug: IsNull() } }, order: { id: 'ASC' } });
        for (const seller of sellers) {
            const channel = await this.sellerProvisioningService.findSellerChannel(ctx, seller.id);
            if (channel && channel.code !== DEFAULT_CHANNEL_CODE) {
                await this.sellerProvisioningService.assignSlug(ctx, seller, channel.code);
                Logger.info(`Seller "${seller.name}" now has the slug "${seller.customFields.slug}"`, loggerCtx);
                await this.eventBus.publish(new SellerShopSyncedEvent(ctx, seller));
            }
        }
    }

    private async sharePaymentMethodWithSellers(ctx: RequestContext, paymentMethod: PaymentMethod) {
        const defaultChannel = await this.channelService.getDefaultChannel();
        if (!idsAreEqual(ctx.channelId, defaultChannel.id)) {
            return;
        }
        const superadminCtx = await this.superadminContextService.create();
        const sellerChannels = await this.sellerProvisioningService.findSellerChannels(superadminCtx);
        if (sellerChannels.length > 0) {
            await this.channelService.assignToChannels(
                superadminCtx,
                PaymentMethod,
                paymentMethod.id,
                sellerChannels.map(channel => channel.id),
            );
        }
    }

    private async warnAboutProductsWithoutSeller(ctx: RequestContext) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const count = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .leftJoin('variant.channels', 'channel', 'channel.id != :defaultChannelId', {
                defaultChannelId: defaultChannel.id,
            })
            .where('variant.deletedAt IS NULL')
            .andWhere('channel.id IS NULL')
            .getCount();
        if (count > 0) {
            Logger.warn(
                `${count} product variant(s) are not in any seller shop. Assign their products to the ` +
                    `"${this.options.houseShopName}" channel (or a seller's channel) so they can be sold.`,
                loggerCtx,
            );
        }
    }
}
