import { Inject, Injectable } from '@nestjs/common';
import {
    Administrator,
    Channel,
    ChannelService,
    CurrencyCode,
    ID,
    idsAreEqual,
    Order,
    RequestContext,
    Seller,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { IsNull } from 'typeorm';

import { MARKETPLACE_PLUGIN_OPTIONS, PayoutStatus } from '../constants';
import { SellerPayout } from '../entities/seller-payout.entity';
import { MarketplacePluginOptions } from '../types';

import { PayoutMethodService } from './payout-method.service';

export interface RecordSellerPayoutInput {
    sellerId: ID;
    amount: number;
    paidAt?: Date | null;
    payoutMethodId?: ID | null;
    /** When the seller has no payout method: how they were paid, e.g. "Cheque". */
    manualMethodName?: string | null;
    transactionId?: string | null;
    transactionDetails?: string | null;
}

export interface UpdateSellerPayoutInput {
    id: ID;
    amount?: number | null;
    paidAt?: Date | null;
    payoutMethodId?: ID | null;
    manualMethodName?: string | null;
    transactionId?: string | null;
    transactionDetails?: string | null;
}

export interface SettlementOrder {
    id: ID;
    code: string;
    state: string;
    orderPlacedAt: Date | null;
    currencyCode: CurrencyCode;
    totalWithTax: number;
    commissionPercent: number | null;
    commissionAmount: number;
    sellerPayoutAmount: number;
    payoutStatus: PayoutStatus;
}

export interface SellerSettlementSummary {
    sellerId: ID;
    sellerName: string;
    slug: string | null;
    status: string;
    commissionPercent: number;
    currencyCode: CurrencyCode;
    orderCount: number;
    grossSales: number;
    commission: number;
    earned: number;
    paid: number;
    pending: number;
    pendingOrderCount: number;
    /** Owed for delivered orders that are not yet covered by payouts. */
    readyToSettle: number;
    salesLast30Days: number;
    averageOrderValue: number;
    lastPayoutAt: Date | null;
    lastPayoutAmount: number | null;
    payoutCount: number;
    defaultPayoutMethod: string | null;
}

export interface SettlementMonth {
    month: string;
    orderCount: number;
    grossSales: number;
    commission: number;
    earned: number;
    paid: number;
}

const DELIVERED_STATES = ['Delivered'];
const MONTHS_SHOWN = 6;

/**
 * What the marketplace owes each seller and what it has paid them.
 *
 * Owed: the "Owed to seller" amount of every paid, uncancelled order sold by the seller.
 * Paid: every payout staff recorded and did not void. Pending is the difference.
 * Payouts settle orders oldest first, which sets each order's "Seller payout" field.
 */
@Injectable()
export class SettlementService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private payoutMethodService: PayoutMethodService,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    async overview(ctx: RequestContext) {
        const sellers = await this.findSellers(ctx);
        const summaries: SellerSettlementSummary[] = [];
        for (const seller of sellers) {
            summaries.push((await this.computeSeller(ctx, seller)).summary);
        }
        const sum = (pick: (s: SellerSettlementSummary) => number) => summaries.reduce((t, s) => t + pick(s), 0);
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1);
        startOfMonth.setUTCHours(0, 0, 0, 0);
        const paidThisMonth = await this.connection
            .getRepository(ctx, SellerPayout)
            .createQueryBuilder('payout')
            .select('SUM(payout.amount)', 'total')
            .where('payout.voidedAt IS NULL')
            .andWhere('payout.paidAt >= :start', { start: startOfMonth })
            .getRawOne<{ total: string | number | null }>();
        return {
            currencyCode: await this.defaultCurrency(ctx),
            grossSales: sum(s => s.grossSales),
            commission: sum(s => s.commission),
            earned: sum(s => s.earned),
            paid: sum(s => s.paid),
            pending: sum(s => Math.max(0, s.pending)),
            readyToSettle: sum(s => s.readyToSettle),
            paidThisMonth: Number(paidThisMonth?.total ?? 0),
            sellersWithPending: summaries.filter(s => s.pending > 0).length,
            sellers: summaries.sort((a, b) => b.pending - a.pending || a.sellerName.localeCompare(b.sellerName)),
        };
    }

    async sellerDetail(ctx: RequestContext, sellerId: ID) {
        const seller = await this.findSeller(ctx, sellerId);
        const { summary, orders, payouts } = await this.computeSeller(ctx, seller);
        return {
            summary,
            months: this.months(orders, payouts),
            payouts: payouts.slice().reverse(),
            payoutMethods: await this.payoutMethodService.findSellerMethods(ctx, seller.id),
            recentOrders: orders.slice().reverse().slice(0, 50),
        };
    }

    async recordPayout(ctx: RequestContext, input: RecordSellerPayoutInput): Promise<SellerPayout> {
        const seller = await this.findSeller(ctx, input.sellerId);
        const amount = this.validAmount(input.amount);
        const { summary } = await this.computeSeller(ctx, seller);
        if (amount > summary.pending) {
            throw new UserInputError(
                `That is more than the ${formatMinor(summary.pending, summary.currencyCode)} this seller is owed.`,
            );
        }
        const payout = new SellerPayout({
            sellerId: seller.id,
            amount,
            currencyCode: summary.currencyCode,
            paidAt: this.validPaidAt(input.paidAt),
            transactionId: input.transactionId?.trim() || null,
            transactionDetails: input.transactionDetails?.trim() || null,
            recordedBy: await this.administratorName(ctx),
            voidedAt: null,
            voidReason: null,
        });
        await this.applyMethod(ctx, payout, seller.id, input);
        const saved = await this.connection.getRepository(ctx, SellerPayout).save(payout);
        await this.syncOrderPayoutStatus(ctx, seller);
        return saved;
    }

    async updatePayout(ctx: RequestContext, input: UpdateSellerPayoutInput): Promise<SellerPayout> {
        const payout = await this.connection.getEntityOrThrow(ctx, SellerPayout, input.id);
        if (payout.voidedAt) {
            throw new UserInputError('A voided payout cannot be changed.');
        }
        const seller = await this.findSeller(ctx, payout.sellerId);
        if (input.amount != null) {
            const amount = this.validAmount(input.amount);
            const { summary } = await this.computeSeller(ctx, seller);
            if (amount - payout.amount > summary.pending) {
                throw new UserInputError(
                    `That would pay this seller more than the ${formatMinor(summary.earned, summary.currencyCode)} they have earned.`,
                );
            }
            payout.amount = amount;
        }
        if (input.paidAt) {
            payout.paidAt = this.validPaidAt(input.paidAt);
        }
        if (input.payoutMethodId !== undefined || input.manualMethodName !== undefined) {
            await this.applyMethod(ctx, payout, seller.id, input);
        }
        if (input.transactionId !== undefined) {
            payout.transactionId = input.transactionId?.trim() || null;
        }
        if (input.transactionDetails !== undefined) {
            payout.transactionDetails = input.transactionDetails?.trim() || null;
        }
        const saved = await this.connection.getRepository(ctx, SellerPayout).save(payout);
        await this.syncOrderPayoutStatus(ctx, seller);
        return saved;
    }

    /** A payout entered by mistake is voided, not deleted, so the record of it stays. */
    async voidPayout(ctx: RequestContext, id: ID, reason: string): Promise<SellerPayout> {
        const payout = await this.connection.getEntityOrThrow(ctx, SellerPayout, id);
        if (!reason?.trim()) {
            throw new UserInputError('Say why the payout is being voided.');
        }
        if (!payout.voidedAt) {
            payout.voidedAt = new Date();
            payout.voidReason = reason.trim();
            await this.connection.getRepository(ctx, SellerPayout).save(payout);
            await this.syncOrderPayoutStatus(ctx, await this.findSeller(ctx, payout.sellerId));
        }
        return payout;
    }

    /**
     * Before this page, staff marked orders paid one by one. A seller with such orders and no
     * payouts gets one "opening balance" payout for them, so their pending amount stays right.
     */
    async recordOpeningBalances(ctx: RequestContext): Promise<void> {
        const payoutRepo = this.connection.getRepository(ctx, SellerPayout);
        for (const seller of await this.findSellers(ctx)) {
            if (await payoutRepo.exists({ where: { sellerId: seller.id } })) {
                continue;
            }
            const orders = (await this.findOrders(ctx, seller.id)).filter(
                order => order.customFields.sellerPayoutStatus === PayoutStatus.Paid,
            );
            if (orders.length === 0) {
                continue;
            }
            await payoutRepo.save(
                new SellerPayout({
                    sellerId: seller.id,
                    amount: orders.reduce((total, order) => total + (order.customFields.sellerPayoutAmount ?? 0), 0),
                    currencyCode: orders[0].currencyCode,
                    paidAt: new Date(),
                    payoutMethodId: null,
                    methodName: 'Recorded before settlements',
                    methodDetails: [],
                    transactionId: null,
                    transactionDetails: `Orders marked paid before the Settlements page existed: ${orders
                        .map(order => order.code)
                        .join(', ')}`,
                    recordedBy: 'System',
                    voidedAt: null,
                    voidReason: null,
                }),
            );
            await this.syncOrderPayoutStatus(ctx, seller);
        }
    }

    /** The seller whose shop the request is for: a seller signed in to their own shop. */
    async sellerForActiveChannel(ctx: RequestContext): Promise<Seller> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(ctx.channelId, defaultChannel.id) || !ctx.channel.sellerId) {
            throw new UserInputError('Payments are shown inside a seller shop. Switch to the shop to see its payments.');
        }
        return this.findSeller(ctx, ctx.channel.sellerId);
    }

    private async computeSeller(ctx: RequestContext, seller: Seller) {
        const orders = await this.findOrders(ctx, seller.id);
        const payouts = await this.connection.getRepository(ctx, SellerPayout).find({
            where: { sellerId: seller.id },
            order: { paidAt: 'ASC', id: 'ASC' },
        });
        const valid = payouts.filter(payout => !payout.voidedAt);
        const paid = valid.reduce((total, payout) => total + payout.amount, 0);
        const settlementOrders = allocate(orders, paid);
        const earned = settlementOrders.reduce((total, order) => total + order.sellerPayoutAmount, 0);
        const grossSales = settlementOrders.reduce((total, order) => total + order.totalWithTax, 0);
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const lastPayout = valid[valid.length - 1];
        const methods = await this.payoutMethodService.findSellerMethods(ctx, seller.id);
        const defaultMethod = methods.find(method => method.isDefault) ?? methods[0];
        const unpaid = settlementOrders.filter(order => order.payoutStatus === PayoutStatus.Pending);
        const summary: SellerSettlementSummary = {
            sellerId: seller.id,
            sellerName: seller.name,
            slug: seller.customFields.slug,
            status: seller.customFields.status,
            commissionPercent:
                seller.customFields.commissionPercent ?? this.options.defaultCommissionPercent,
            currencyCode: orders[0]?.currencyCode ?? (await this.defaultCurrency(ctx)),
            orderCount: settlementOrders.length,
            grossSales,
            commission: settlementOrders.reduce((total, order) => total + order.commissionAmount, 0),
            earned,
            paid,
            pending: earned - paid,
            pendingOrderCount: unpaid.length,
            readyToSettle: Math.min(
                Math.max(0, earned - paid),
                unpaid
                    .filter(order => DELIVERED_STATES.includes(order.state))
                    .reduce((total, order) => total + order.sellerPayoutAmount, 0),
            ),
            salesLast30Days: settlementOrders
                .filter(order => order.orderPlacedAt && order.orderPlacedAt.getTime() >= since)
                .reduce((total, order) => total + order.totalWithTax, 0),
            averageOrderValue: settlementOrders.length ? Math.round(grossSales / settlementOrders.length) : 0,
            lastPayoutAt: lastPayout?.paidAt ?? null,
            lastPayoutAmount: lastPayout?.amount ?? null,
            payoutCount: valid.length,
            defaultPayoutMethod: defaultMethod ? this.payoutMethodService.summary(defaultMethod) : null,
        };
        return { summary, orders: settlementOrders, payouts };
    }

    private months(orders: SettlementOrder[], payouts: SellerPayout[]): SettlementMonth[] {
        const months: SettlementMonth[] = [];
        const now = new Date();
        for (let i = MONTHS_SHOWN - 1; i >= 0; i--) {
            const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            months.push({ month: monthKey(date), orderCount: 0, grossSales: 0, commission: 0, earned: 0, paid: 0 });
        }
        const byKey = new Map(months.map(month => [month.month, month]));
        for (const order of orders) {
            const month = order.orderPlacedAt && byKey.get(monthKey(order.orderPlacedAt));
            if (month) {
                month.orderCount++;
                month.grossSales += order.totalWithTax;
                month.commission += order.commissionAmount;
                month.earned += order.sellerPayoutAmount;
            }
        }
        for (const payout of payouts) {
            const month = !payout.voidedAt && byKey.get(monthKey(payout.paidAt));
            if (month) {
                month.paid += payout.amount;
            }
        }
        return months;
    }

    /** Sets each order's "Seller payout" field from the payouts, settling the oldest orders first. */
    private async syncOrderPayoutStatus(ctx: RequestContext, seller: Seller): Promise<void> {
        const { orders } = await this.computeSeller(ctx, seller);
        const raw = await this.findOrders(ctx, seller.id);
        const repo = this.connection.getRepository(ctx, Order);
        for (const order of orders) {
            const current = raw.find(o => idsAreEqual(o.id, order.id));
            if (current && current.customFields.sellerPayoutStatus !== order.payoutStatus) {
                await repo.update(order.id, {
                    customFields: { ...current.customFields, sellerPayoutStatus: order.payoutStatus },
                });
            }
        }
    }

    private async applyMethod(
        ctx: RequestContext,
        payout: SellerPayout,
        sellerId: ID,
        input: { payoutMethodId?: ID | null; manualMethodName?: string | null },
    ): Promise<void> {
        if (input.payoutMethodId) {
            const method = await this.payoutMethodService.findSellerMethod(ctx, sellerId, input.payoutMethodId);
            payout.payoutMethodId = method.id;
            payout.methodName = this.payoutMethodService.methodName(method);
            payout.methodDetails = this.payoutMethodService.describe(method);
            return;
        }
        const name = input.manualMethodName?.trim();
        if (!name) {
            throw new UserInputError("Choose the seller's payout method the money was sent to, or say how it was paid.");
        }
        payout.payoutMethodId = null;
        payout.methodName = name;
        payout.methodDetails = [];
    }

    private validAmount(amount: number): number {
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new UserInputError('Enter an amount above zero.');
        }
        return amount;
    }

    private validPaidAt(paidAt: Date | null | undefined): Date {
        const date = paidAt ? new Date(paidAt) : new Date();
        if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
            throw new UserInputError('The payment date cannot be in the future.');
        }
        return date;
    }

    /** Sellers that have a shop, other than the marketplace itself and the store's own house shop. */
    private async findSellers(ctx: RequestContext): Promise<Seller[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const sellers = await this.connection.getRepository(ctx, Seller).find({
            where: { deletedAt: IsNull() },
            order: { name: 'ASC' },
        });
        return sellers.filter(
            seller => !idsAreEqual(seller.id, defaultChannel.sellerId) && !seller.customFields.isHouseShop,
        );
    }

    private async findSeller(ctx: RequestContext, sellerId: ID): Promise<Seller> {
        const seller = (await this.findSellers(ctx)).find(s => idsAreEqual(s.id, sellerId));
        if (!seller) {
            throw new UserInputError('That seller was not found.');
        }
        return seller;
    }

    /** Paid, uncancelled orders sold by the seller, oldest first. */
    private async findOrders(ctx: RequestContext, sellerId: ID): Promise<Order[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channels = await this.connection.getRepository(ctx, Channel).find({ where: { sellerId } });
        const channelIds = channels.map(c => c.id).filter(id => !idsAreEqual(id, defaultChannel.id));
        if (channelIds.length === 0) {
            return [];
        }
        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.channels', 'channel', 'channel.id IN (:...channelIds)', { channelIds })
            .where('order.state != :cancelled', { cancelled: 'Cancelled' })
            .andWhere('order.orderPlacedAt IS NOT NULL')
            .orderBy('order.orderPlacedAt', 'ASC')
            .addOrderBy('order.id', 'ASC')
            .getMany();
        return orders.filter(order => order.customFields.sellerPayoutAmount != null);
    }

    private async defaultCurrency(ctx: RequestContext): Promise<CurrencyCode> {
        return (await this.channelService.getDefaultChannel(ctx)).defaultCurrencyCode;
    }

    private async administratorName(ctx: RequestContext): Promise<string | null> {
        if (!ctx.activeUserId) {
            return null;
        }
        const administrator = await this.connection.getRepository(ctx, Administrator).findOne({
            where: { user: { id: ctx.activeUserId } },
        });
        return administrator ? `${administrator.firstName} ${administrator.lastName}`.trim() : null;
    }
}

/** Marks orders paid, oldest first, while the payouts cover them. A partly covered order stays pending. */
function allocate(orders: Order[], paid: number): SettlementOrder[] {
    let remaining = paid;
    return orders.map(order => {
        const owed = order.customFields.sellerPayoutAmount ?? 0;
        const covered = remaining >= owed;
        if (covered) {
            remaining -= owed;
        } else {
            remaining = 0;
        }
        return {
            id: order.id,
            code: order.code,
            state: order.state,
            orderPlacedAt: order.orderPlacedAt ?? null,
            currencyCode: order.currencyCode,
            totalWithTax: order.totalWithTax,
            commissionPercent: order.customFields.commissionPercent,
            commissionAmount: order.customFields.commissionAmount ?? 0,
            sellerPayoutAmount: owed,
            payoutStatus: covered ? PayoutStatus.Paid : PayoutStatus.Pending,
        };
    });
}

function monthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMinor(amount: number, currencyCode: CurrencyCode): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode }).format(amount / 100);
}
