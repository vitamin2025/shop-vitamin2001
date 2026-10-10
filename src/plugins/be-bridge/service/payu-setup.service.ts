import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    Channel,
    ChannelService,
    LanguageCode,
    Logger,
    PaymentMethod,
    PaymentMethodService,
    ProcessContext,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull, Not } from 'typeorm';

import { payuPaymentHandler } from '../config/payu-payment-handler';
import { loggerCtx, PAYU_METHOD_CODE } from '../constants';

/**
 * Keeps a `payu` PaymentMethod in the default Channel and in every seller shop, so the BE can
 * pay for orders placed in the marketplace and on seller storefronts alike.
 */
@Injectable()
export class PayuSetupService implements OnApplicationBootstrap {
    constructor(
        private connection: TransactionalConnection,
        private processContext: ProcessContext,
        private requestContextService: RequestContextService,
        private channelService: ChannelService,
        private paymentMethodService: PaymentMethodService,
    ) {}

    async onApplicationBootstrap() {
        if (!this.processContext.isServer) {
            return;
        }
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        // One transaction, so when the marketplace shares a newly created method with the seller
        // shops (on PaymentMethodEvent, after the commit), it finds that already done.
        await this.connection.withTransaction(ctx, async txCtx => {
            const existing = await this.connection
                .getRepository(txCtx, PaymentMethod)
                .findOne({ where: { code: PAYU_METHOD_CODE } });
            const payu = existing ?? (await this.createPayuMethod(txCtx));
            // Seller shops opened before this method existed did not get it.
            const sellerChannels = await this.connection
                .getRepository(txCtx, Channel)
                .find({ where: { code: Not(DEFAULT_CHANNEL_CODE), sellerId: Not(IsNull()) } });
            if (sellerChannels.length > 0) {
                await this.channelService.assignToChannels(
                    txCtx,
                    PaymentMethod,
                    payu.id,
                    sellerChannels.map(channel => channel.id),
                );
            }
        });
    }

    private async createPayuMethod(ctx: RequestContext): Promise<PaymentMethod> {
        const payu = await this.paymentMethodService.create(ctx, {
            code: PAYU_METHOD_CODE,
            enabled: true,
            handler: { code: payuPaymentHandler.code, arguments: [] },
            translations: [{ languageCode: LanguageCode.en, name: 'PayU', description: 'Paid through vitamin2001.in' }],
        });
        Logger.info('Created the PayU payment method', loggerCtx);
        return payu;
    }
}
