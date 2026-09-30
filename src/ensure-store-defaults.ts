import { INestApplication } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Channel, CurrencyCode, Logger, TransactionalConnection } from '@vendure/core';

import { parseCurrency, parseLanguage } from './vendure-config';

const loggerCtx = 'StoreDefaults';

/**
 * Vendure creates the default channel in USD. Currency is not a global config
 * setting, so on first boot — while the channel is still that untouched USD
 * default — switch it to the currency and language from the environment
 * (INR and English unless overridden).
 *
 * A later change made in the dashboard is left alone: we only rewrite a channel
 * that is still USD-only and has not been updated since it was created.
 */
export async function ensureStoreDefaults(app: INestApplication): Promise<void> {
    if (process.env.APPLY_STORE_DEFAULTS === 'false') {
        return;
    }

    const connection = app.get(TransactionalConnection);
    const repo = connection.rawConnection.getRepository(Channel);
    const channel = await repo.findOne({ where: { code: DEFAULT_CHANNEL_CODE } });
    if (!channel) {
        return;
    }

    const currency = parseCurrency(process.env.DEFAULT_CURRENCY);
    const language = parseLanguage(process.env.DEFAULT_LANGUAGE_CODE);
    const pricesIncludeTax = (process.env.PRICES_INCLUDE_TAX ?? 'true') === 'true';

    if (channel.defaultCurrencyCode === currency && channel.defaultLanguageCode === language) {
        return;
    }

    const createdAt = channel.createdAt?.getTime?.() ?? 0;
    const updatedAt = channel.updatedAt?.getTime?.() ?? 0;
    const stillStockUsd =
        channel.defaultCurrencyCode === CurrencyCode.USD &&
        channel.availableCurrencyCodes?.length === 1 &&
        channel.availableCurrencyCodes[0] === CurrencyCode.USD &&
        Math.abs(updatedAt - createdAt) < 10_000;

    if (!stillStockUsd) {
        Logger.info(
            `Default channel currency is ${channel.defaultCurrencyCode}; leaving it unchanged.`,
            loggerCtx,
        );
        return;
    }

    channel.defaultCurrencyCode = currency;
    channel.availableCurrencyCodes = [currency];
    channel.defaultLanguageCode = language;
    if (!channel.availableLanguageCodes?.includes(language)) {
        channel.availableLanguageCodes = [language];
    }
    channel.pricesIncludeTax = pricesIncludeTax;
    await repo.save(channel);
    Logger.info(
        `Default channel set to currency ${currency}, language ${language}, pricesIncludeTax=${pricesIncludeTax}.`,
        loggerCtx,
    );
}
