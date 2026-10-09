import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    Administrator,
    AdministratorService,
    Channel,
    ChannelService,
    defaultShippingCalculator,
    ID,
    idsAreEqual,
    InternalServerError,
    isGraphQlErrorResult,
    Logger,
    manualFulfillmentHandler,
    PaymentMethod,
    Permission,
    RequestContext,
    Role,
    RoleService,
    Seller,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TaxSetting,
    TransactionalConnection,
} from '@vendure/core';
import { randomBytes } from 'crypto';
import { IsNull, Not } from 'typeorm';

import { loggerCtx, SELLER_PAYOUT_METHOD_CODE, SELLER_ROLE_SUFFIX, SellerStatus } from '../constants';
import { sellerShippingEligibilityChecker } from '../config/seller-shipping-checker';

import { SuperadminContextService } from './superadmin-context.service';

/** What a seller can do inside their own shop (Channel), and nowhere else. */
export const SELLER_PERMISSIONS: Permission[] = [
    Permission.CreateProduct,
    Permission.ReadProduct,
    Permission.UpdateProduct,
    Permission.DeleteProduct,
    Permission.CreateAsset,
    Permission.ReadAsset,
    Permission.UpdateAsset,
    Permission.DeleteAsset,
    Permission.ReadFacet,
    Permission.ReadCollection,
    Permission.ReadTaxCategory,
    Permission.ReadTaxRate,
    Permission.ReadCountry,
    Permission.ReadZone,
    Permission.ReadOrder,
    Permission.UpdateOrder,
    Permission.ReadCustomer,
    Permission.ReadPaymentMethod,
    Permission.CreateShippingMethod,
    Permission.ReadShippingMethod,
    Permission.UpdateShippingMethod,
    Permission.DeleteShippingMethod,
    Permission.CreateStockLocation,
    Permission.ReadStockLocation,
    Permission.UpdateStockLocation,
    Permission.DeleteStockLocation,
];

/**
 * Opens and closes seller shops. Approving a seller creates their Channel, a Role limited to
 * that Channel, a stock location and a shipping method, and gives their login that Role.
 */
@Injectable()
export class SellerProvisioningService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private roleService: RoleService,
        private administratorService: AdministratorService,
        private shippingMethodService: ShippingMethodService,
        private stockLocationService: StockLocationService,
        private superadminContextService: SuperadminContextService,
    ) {}

    /** Brings a seller's shop and login in line with the seller's Status. */
    async syncSeller(sellerId: ID): Promise<void> {
        const superadminCtx = await this.superadminContextService.create();
        await this.connection.withTransaction(superadminCtx, async ctx => {
            const seller = await this.connection
                .getRepository(ctx, Seller)
                .findOne({ where: { id: sellerId, deletedAt: IsNull() } });
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            if (!seller || idsAreEqual(seller.id, defaultChannel.sellerId)) {
                return;
            }
            switch (seller.customFields.status) {
                case SellerStatus.Approved: {
                    const channel = (await this.findSellerChannel(ctx, seller.id)) ?? (await this.openShop(ctx, seller));
                    await this.grantLogin(ctx, seller, channel);
                    break;
                }
                case SellerStatus.Rejected:
                    await this.removeLogin(ctx, seller);
                    break;
                default:
                    await this.suspendLogin(ctx, seller);
            }
        });
    }

    findSellerChannel(ctx: RequestContext, sellerId: ID): Promise<Channel | null> {
        return this.connection.getRepository(ctx, Channel).findOne({ where: { sellerId } });
    }

    /** All Channels that belong to a seller other than the default seller. */
    async findSellerChannels(ctx: RequestContext): Promise<Channel[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        return this.connection.getRepository(ctx, Channel).find({
            where: { id: Not(defaultChannel.id), sellerId: Not(IsNull()) },
        });
    }

    /**
     * @param options.withSellerRole false for the house shop, which the store's own staff manage
     */
    async openShop(ctx: RequestContext, seller: Seller, options = { withSellerRole: true }): Promise<Channel> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!defaultChannel.defaultTaxZone || !defaultChannel.defaultShippingZone) {
            throw new InternalServerError(
                'Set the default tax zone and shipping zone of the default channel (Settings → Channels) before approving sellers.',
            );
        }
        const code = await this.uniqueChannelCode(ctx, normalizeString(seller.name, '-'));
        const channel = await this.channelService.create(ctx, {
            code,
            // Storefronts send this token to see only this seller's products.
            token: randomBytes(16).toString('hex'),
            sellerId: seller.id,
            defaultLanguageCode: defaultChannel.defaultLanguageCode,
            availableLanguageCodes: defaultChannel.availableLanguageCodes,
            defaultCurrencyCode: defaultChannel.defaultCurrencyCode,
            availableCurrencyCodes: defaultChannel.availableCurrencyCodes,
            pricesIncludeTax: defaultChannel.pricesIncludeTax,
            defaultShippingZoneId: defaultChannel.defaultShippingZone.id,
            defaultTaxZoneId: defaultChannel.defaultTaxZone.id,
        });
        if (isGraphQlErrorResult(channel)) {
            throw new InternalServerError(channel.message);
        }
        // The superadmin's cached permissions predate the new Channel, so continue in a fresh copy.
        const shopCtx = ctx.copy();

        const stockLocation = await this.stockLocationService.create(shopCtx, { name: `${seller.name} warehouse` });
        await this.channelService.assignToChannels(shopCtx, StockLocation, stockLocation.id, [channel.id]);

        const shippingMethod = await this.shippingMethodService.create(shopCtx, {
            code: `${code}-shipping`,
            checker: {
                code: sellerShippingEligibilityChecker.code,
                arguments: [{ name: 'orderMinimum', value: '0' }],
            },
            calculator: {
                code: defaultShippingCalculator.code,
                arguments: [
                    { name: 'rate', value: '0' },
                    { name: 'includesTax', value: TaxSetting.auto },
                    { name: 'taxRate', value: '0' },
                ],
            },
            fulfillmentHandler: manualFulfillmentHandler.code,
            translations: [
                {
                    languageCode: defaultChannel.defaultLanguageCode,
                    name: `Standard shipping (${seller.name})`,
                    description: '',
                },
            ],
        });
        await this.channelService.assignToChannels(shopCtx, ShippingMethod, shippingMethod.id, [channel.id]);

        await this.shareCustomerPaymentMethods(shopCtx, [channel.id]);

        if (options.withSellerRole) {
            await this.roleService.create(shopCtx, {
                code: `${code}${SELLER_ROLE_SUFFIX}`,
                description: `Seller: ${seller.name}`,
                channelIds: [channel.id],
                permissions: SELLER_PERMISSIONS,
            });
        }
        Logger.info(`Opened seller shop "${seller.name}" (channel ${code})`, loggerCtx);
        return channel;
    }

    /**
     * Customers on a seller's own storefront pay with the marketplace's payment methods,
     * so those methods are assigned to the seller Channels too.
     */
    async shareCustomerPaymentMethods(ctx: RequestContext, sellerChannelIds: ID[]): Promise<void> {
        if (sellerChannelIds.length === 0) {
            return;
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const paymentMethods = await this.connection
            .getRepository(ctx, PaymentMethod)
            .createQueryBuilder('method')
            .innerJoin('method.channels', 'channel', 'channel.id = :channelId', { channelId: defaultChannel.id })
            .where('method.code != :payoutCode', { payoutCode: SELLER_PAYOUT_METHOD_CODE })
            .getMany();
        for (const paymentMethod of paymentMethods) {
            await this.channelService.assignToChannels(ctx, PaymentMethod, paymentMethod.id, sellerChannelIds);
        }
    }

    private async grantLogin(ctx: RequestContext, seller: Seller, channel: Channel): Promise<void> {
        const role = await this.connection
            .getRepository(ctx, Role)
            .findOne({ where: { code: `${channel.code}${SELLER_ROLE_SUFFIX}` } });
        if (!role) {
            // The house shop has no seller login: the store's own staff manage it.
            return;
        }
        const roleCtx = ctx.copy();
        const administrator = await this.findSellerAdministrator(roleCtx, seller);
        if (administrator) {
            const hasRole = administrator.user.roles.some(r => idsAreEqual(r.id, role.id));
            if (!hasRole) {
                await this.administratorService.update(roleCtx, { id: administrator.id, roleIds: [role.id] });
            }
            return;
        }
        const { contactEmail, contactFirstName, contactLastName } = seller.customFields;
        if (!contactEmail) {
            Logger.warn(
                `Seller "${seller.name}" was approved but has no contact email, so no login was created.`,
                loggerCtx,
            );
            return;
        }
        // A seller you add yourself in the dashboard gets a random password; set theirs under Administrators.
        const created = await this.administratorService.create(roleCtx, {
            firstName: contactFirstName || seller.name,
            lastName: contactLastName || 'Seller',
            emailAddress: contactEmail,
            password: randomBytes(24).toString('base64url'),
            roleIds: [role.id],
        });
        await this.linkAdministrator(ctx, seller, created.id);
        Logger.info(
            `Created the login ${contactEmail} for seller "${seller.name}". Set its password under Administrators.`,
            loggerCtx,
        );
    }

    /** Pending: the login stays but loses its access. */
    private async suspendLogin(ctx: RequestContext, seller: Seller): Promise<void> {
        const administrator = await this.findSellerAdministrator(ctx, seller);
        if (administrator && administrator.user.roles.length > 0) {
            await this.administratorService.update(ctx, { id: administrator.id, roleIds: [] });
        }
    }

    /** Rejected: the login is deleted. */
    private async removeLogin(ctx: RequestContext, seller: Seller): Promise<void> {
        const administrator = await this.findSellerAdministrator(ctx, seller);
        if (administrator) {
            await this.administratorService.softDelete(ctx, administrator.id);
            await this.linkAdministrator(ctx, seller, null);
        }
    }

    async linkAdministrator(ctx: RequestContext, seller: Seller, administratorId: ID | null): Promise<void> {
        const value = administratorId == null ? null : String(administratorId);
        await this.connection
            .getRepository(ctx, Seller)
            .update(seller.id, { customFields: { ...seller.customFields, administratorId: value } });
        seller.customFields.administratorId = value;
    }

    private async findSellerAdministrator(ctx: RequestContext, seller: Seller): Promise<Administrator | null> {
        const { administratorId } = seller.customFields;
        if (!administratorId) {
            return null;
        }
        return this.connection.getRepository(ctx, Administrator).findOne({
            where: { id: administratorId, deletedAt: IsNull() },
            relations: ['user', 'user.roles'],
        });
    }

    private async uniqueChannelCode(ctx: RequestContext, base: string): Promise<string> {
        const root = base || 'seller';
        let code = root;
        for (let i = 2; await this.connection.getRepository(ctx, Channel).exists({ where: { code } }); i++) {
            code = `${root}-${i}`;
        }
        return code;
    }
}
