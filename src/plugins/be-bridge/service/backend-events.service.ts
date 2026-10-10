import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    ConfigService,
    EventBus,
    ID,
    JobQueue,
    JobQueueService,
    Logger,
    Order,
    OrderState,
    OrderStateTransitionEvent,
    ProcessContext,
    RequestContext,
    Seller,
    TransactionalConnection,
    translateEntity,
} from '@vendure/core';
import { randomUUID } from 'crypto';

import { SellerShopClosedEvent, SellerShopSyncedEvent } from '../../marketplace/events';
import { signEventBody } from '../bridge-token';
import { BE_BRIDGE_PLUGIN_OPTIONS, BE_EVENT_RETRIES, BE_EVENTS_QUEUE, loggerCtx } from '../constants';
import { BackendBridgePluginOptions, BackendEvent, BackendEventType, OrderShippingData } from '../types';

const ORDER_EVENT_TYPES: Partial<Record<OrderState, BackendEventType>> = {
    PartiallyShipped: 'order.shipped',
    Shipped: 'order.shipped',
    Delivered: 'order.delivered',
};

/**
 * Tells the BE about sellers and shipments. Each event is a job, so a BE that is down or answers
 * with an error gets it again later (BE_EVENT_RETRIES times, with growing delays).
 */
@Injectable()
export class BackendEventsService implements OnModuleInit {
    private queue: JobQueue<BackendEvent>;

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private eventBus: EventBus,
        private jobQueueService: JobQueueService,
        private processContext: ProcessContext,
        @Inject(BE_BRIDGE_PLUGIN_OPTIONS) private options: BackendBridgePluginOptions,
    ) {}

    /**
     * Subscribes here rather than on bootstrap, so the events the marketplace publishes while it
     * starts up (a new house shop, slugs given to existing shops) are not missed.
     */
    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: BE_EVENTS_QUEUE,
            process: async job => {
                try {
                    await this.post(job.data);
                } catch (err: any) {
                    const { type, id } = job.data;
                    Logger.warn(`Could not send ${type} ${id} to the BE: ${String(err.message)}`, loggerCtx);
                    throw err;
                }
            },
        });
        if (!this.processContext.isServer) {
            return;
        }
        if (!this.options.secret || !this.options.eventsUrl) {
            Logger.warn('SHOP_BRIDGE_SECRET or BE_EVENTS_URL is not set, so no events are sent to the BE.', loggerCtx);
            return;
        }
        this.eventBus.ofType(SellerShopSyncedEvent).subscribe(({ seller }) => this.sellerUpdated(seller));
        this.eventBus.ofType(SellerShopClosedEvent).subscribe(event =>
            this.add('seller.deleted', {
                sellerId: this.encodeId(event.sellerId),
                slug: event.slug,
                name: event.name,
            }),
        );
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(event => {
            const type = ORDER_EVENT_TYPES[event.toState];
            if (!type || event.order.type === OrderType.Aggregate) {
                return;
            }
            this.orderShippingData(event.ctx, event.order.id, event.toState)
                .then(data => data && this.add(type, data))
                .catch(err =>
                    Logger.error(
                        `Could not tell the BE about order ${event.order.code}: ${String(err.message)}`,
                        loggerCtx,
                    ),
                );
        });
    }

    private sellerUpdated(seller: Seller) {
        const { slug, status, isHouseShop, contactEmail, contactFirstName, contactLastName, contactPhone } =
            seller.customFields;
        return this.add('seller.updated', {
            sellerId: this.encodeId(seller.id),
            slug,
            name: seller.name,
            status,
            isHouseShop,
            contactEmail,
            contactFirstName,
            contactLastName,
            contactPhone,
        });
    }

    private async orderShippingData(
        ctx: RequestContext,
        orderId: ID,
        state: OrderState,
    ): Promise<OrderShippingData | undefined> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId },
            relations: {
                customer: true,
                lines: { productVariant: { translations: true } },
                fulfillments: true,
                channels: { seller: true },
                aggregateOrder: true,
            },
        });
        if (!order) {
            return;
        }
        // A seller order or a seller storefront's order is in that seller's Channel and the default one.
        const seller = order.channels.find(channel => channel.code !== DEFAULT_CHANNEL_CODE)?.seller;
        const trackingCodes = order.fulfillments
            .filter(fulfillment => fulfillment.state !== 'Cancelled' && fulfillment.trackingCode)
            .map(fulfillment => fulfillment.trackingCode);
        return {
            orderCode: order.code,
            aggregateOrderCode: order.aggregateOrder?.code ?? null,
            state,
            seller: seller ? { slug: seller.customFields.slug, name: seller.name } : null,
            customer: {
                emailAddress: order.customer?.emailAddress ?? '',
                firstName: order.customer?.firstName ?? '',
                lastName: order.customer?.lastName ?? '',
            },
            trackingCodes: [...new Set(trackingCodes)],
            lines: order.lines
                .filter(line => line.quantity > 0)
                .map(line => ({
                    name: translateEntity(line.productVariant, ctx.languageCode).name,
                    quantity: line.quantity,
                })),
        };
    }

    private add(type: BackendEventType, data: BackendEvent['data']) {
        const event: BackendEvent = { id: randomUUID(), type, occurredAt: new Date().toISOString(), data };
        return this.queue
            .add(event, { retries: BE_EVENT_RETRIES })
            .catch(err => Logger.error(`Could not queue ${type} for the BE: ${String(err.message)}`, loggerCtx));
    }

    /** The timestamp and signature are made per attempt, so a retry is not refused as stale. */
    private async post(event: BackendEvent): Promise<void> {
        const { secret, eventsUrl } = this.options;
        if (!secret || !eventsUrl) {
            return;
        }
        const body = JSON.stringify(event);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const response = await fetch(eventsUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-shop-timestamp': timestamp,
                'x-shop-signature': signEventBody(secret, timestamp, body),
            },
            body,
            signal: AbortSignal.timeout(10_000),
        });
        const answer = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${answer.slice(0, 200)}`.trim());
        }
    }

    /** IDs as the Shop API shows them, so the BE can match events to marketplaceSellers. */
    private encodeId(id: ID): string {
        const strategy = this.configService.entityOptions.entityIdStrategy;
        return String(strategy ? strategy.encodeId(id) : id);
    }
}
