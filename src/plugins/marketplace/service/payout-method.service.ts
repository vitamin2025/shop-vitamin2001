import { Injectable } from '@nestjs/common';
import { ID, idsAreEqual, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { IsNull } from 'typeorm';

import { DEFAULT_PAYOUT_METHOD_TYPES } from '../constants';
import { PayoutFieldDefinition, PayoutMethodType } from '../entities/payout-method-type.entity';
import { PayoutDetailSnapshot } from '../entities/seller-payout.entity';
import { SellerPayoutMethod } from '../entities/seller-payout-method.entity';

export interface PayoutFieldDefinitionInput {
    key?: string | null;
    label: string;
    required: boolean;
    placeholder?: string | null;
}

export interface PayoutMethodTypeInput {
    name: string;
    description?: string | null;
    enabled?: boolean | null;
    sortOrder?: number | null;
    fields: PayoutFieldDefinitionInput[];
}

export interface PayoutDetailInput {
    key: string;
    value: string;
}

export interface SellerPayoutMethodInput {
    typeId: ID;
    label?: string | null;
    details: PayoutDetailInput[];
    isDefault?: boolean | null;
}

/** Payout method types (staff), and the payout methods sellers add for themselves. */
@Injectable()
export class PayoutMethodService {
    constructor(private connection: TransactionalConnection) {}

    /** Adds the built-in types (UPI, NEFT, IMPS, Other, Custom) that are missing. Edited ones are left alone. */
    async ensureDefaultTypes(ctx: RequestContext): Promise<void> {
        const repo = this.connection.getRepository(ctx, PayoutMethodType);
        for (const type of DEFAULT_PAYOUT_METHOD_TYPES) {
            if (!(await repo.exists({ where: { code: type.code } }))) {
                await repo.save(new PayoutMethodType({ ...type, description: null, enabled: true }));
            }
        }
    }

    findTypes(ctx: RequestContext, includeDisabled = false): Promise<PayoutMethodType[]> {
        return this.connection.getRepository(ctx, PayoutMethodType).find({
            where: includeDisabled ? {} : { enabled: true },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
    }

    async createType(ctx: RequestContext, input: PayoutMethodTypeInput): Promise<PayoutMethodType> {
        const repo = this.connection.getRepository(ctx, PayoutMethodType);
        const name = requiredText(input.name, 'Name');
        const code = await this.uniqueTypeCode(ctx, name);
        return repo.save(
            new PayoutMethodType({
                code,
                name,
                description: input.description?.trim() || null,
                enabled: input.enabled ?? true,
                sortOrder: input.sortOrder ?? 100,
                fields: normalizeFields(input.fields),
            }),
        );
    }

    async updateType(ctx: RequestContext, id: ID, input: PayoutMethodTypeInput): Promise<PayoutMethodType> {
        const type = await this.connection.getEntityOrThrow(ctx, PayoutMethodType, id);
        type.name = requiredText(input.name, 'Name');
        type.description = input.description?.trim() || null;
        type.enabled = input.enabled ?? type.enabled;
        type.sortOrder = input.sortOrder ?? type.sortOrder;
        type.fields = normalizeFields(input.fields);
        return this.connection.getRepository(ctx, PayoutMethodType).save(type);
    }

    /** Only a type no seller has used can be deleted. Others can be turned off instead. */
    async deleteType(ctx: RequestContext, id: ID): Promise<boolean> {
        const type = await this.connection.getEntityOrThrow(ctx, PayoutMethodType, id);
        const inUse = await this.connection
            .getRepository(ctx, SellerPayoutMethod)
            .exists({ where: { typeId: type.id } });
        if (inUse) {
            throw new UserInputError(
                `Sellers have added "${type.name}" payout details, so it can't be deleted. Turn it off instead.`,
            );
        }
        await this.connection.getRepository(ctx, PayoutMethodType).remove(type);
        return true;
    }

    findSellerMethods(ctx: RequestContext, sellerId: ID): Promise<SellerPayoutMethod[]> {
        return this.connection.getRepository(ctx, SellerPayoutMethod).find({
            where: { sellerId, deletedAt: IsNull() },
            relations: ['type'],
            order: { isDefault: 'DESC', createdAt: 'ASC' },
        });
    }

    async findSellerMethod(ctx: RequestContext, sellerId: ID, id: ID): Promise<SellerPayoutMethod> {
        const method = await this.connection.getRepository(ctx, SellerPayoutMethod).findOne({
            where: { id, sellerId, deletedAt: IsNull() },
            relations: ['type'],
        });
        if (!method) {
            throw new UserInputError('That payout method was not found for this seller.');
        }
        return method;
    }

    async createSellerMethod(
        ctx: RequestContext,
        sellerId: ID,
        input: SellerPayoutMethodInput,
    ): Promise<SellerPayoutMethod> {
        const type = await this.findEnabledType(ctx, input.typeId);
        const existing = await this.findSellerMethods(ctx, sellerId);
        const method = await this.connection.getRepository(ctx, SellerPayoutMethod).save(
            new SellerPayoutMethod({
                sellerId,
                type,
                label: input.label?.trim() || null,
                details: validateDetails(type, input.details),
                // The first one a seller adds is where they are paid unless they say otherwise.
                isDefault: existing.length === 0 || !!input.isDefault,
                deletedAt: null,
            }),
        );
        if (method.isDefault) {
            await this.clearOtherDefaults(ctx, sellerId, method.id);
        }
        return method;
    }

    async updateSellerMethod(
        ctx: RequestContext,
        sellerId: ID,
        id: ID,
        input: SellerPayoutMethodInput,
    ): Promise<SellerPayoutMethod> {
        const method = await this.findSellerMethod(ctx, sellerId, id);
        const type = idsAreEqual(method.typeId, input.typeId) ? method.type : await this.findEnabledType(ctx, input.typeId);
        method.type = type;
        method.typeId = type.id;
        method.label = input.label?.trim() || null;
        method.details = validateDetails(type, input.details);
        if (input.isDefault != null) {
            method.isDefault = input.isDefault;
        }
        const saved = await this.connection.getRepository(ctx, SellerPayoutMethod).save(method);
        if (saved.isDefault) {
            await this.clearOtherDefaults(ctx, sellerId, saved.id);
        }
        return saved;
    }

    async deleteSellerMethod(ctx: RequestContext, sellerId: ID, id: ID): Promise<boolean> {
        const method = await this.findSellerMethod(ctx, sellerId, id);
        const repo = this.connection.getRepository(ctx, SellerPayoutMethod);
        await repo.update(method.id, { deletedAt: new Date(), isDefault: false });
        if (method.isDefault) {
            const [next] = await this.findSellerMethods(ctx, sellerId);
            if (next) {
                await repo.update(next.id, { isDefault: true });
            }
        }
        return true;
    }

    /** The details of a payout method in field order, with their labels. */
    describe(method: SellerPayoutMethod): PayoutDetailSnapshot[] {
        const fields = method.type?.fields ?? [];
        const described = fields
            .filter(field => method.details[field.key])
            .map(field => ({ key: field.key, label: field.label, value: method.details[field.key] }));
        // Values for fields staff have since removed from the type are still shown.
        for (const [key, value] of Object.entries(method.details)) {
            if (value && !fields.some(field => field.key === key)) {
                described.push({ key, label: key, value });
            }
        }
        return described;
    }

    /** "UPI · name@bank". A Custom method is named after what the seller called it. */
    methodName(method: SellerPayoutMethod): string {
        return method.details.methodName?.trim() || method.type?.name || 'Payout method';
    }

    summary(method: SellerPayoutMethod): string {
        const first = this.describe(method).find(detail => detail.key !== 'methodName' && detail.key !== 'accountHolderName');
        const value = first?.value ?? '';
        const masked = first?.key === 'accountNumber' && value.length > 4 ? `••••${value.slice(-4)}` : value;
        return [this.methodName(method), masked].filter(Boolean).join(' · ');
    }

    private async findEnabledType(ctx: RequestContext, id: ID): Promise<PayoutMethodType> {
        const type = await this.connection.getRepository(ctx, PayoutMethodType).findOne({ where: { id } });
        if (!type || !type.enabled) {
            throw new UserInputError('Choose one of the payout methods on offer.');
        }
        return type;
    }

    private async clearOtherDefaults(ctx: RequestContext, sellerId: ID, keepId: ID): Promise<void> {
        const methods = await this.findSellerMethods(ctx, sellerId);
        for (const other of methods) {
            if (other.isDefault && !idsAreEqual(other.id, keepId)) {
                await this.connection.getRepository(ctx, SellerPayoutMethod).update(other.id, { isDefault: false });
            }
        }
    }

    private async uniqueTypeCode(ctx: RequestContext, name: string): Promise<string> {
        const root = toKey(name, '-') || 'method';
        let code = root;
        const repo = this.connection.getRepository(ctx, PayoutMethodType);
        for (let i = 2; await repo.exists({ where: { code } }); i++) {
            code = `${root}-${i}`;
        }
        return code;
    }
}

function requiredText(value: string | null | undefined, what: string): string {
    const text = value?.trim();
    if (!text) {
        throw new UserInputError(`${what} is required.`);
    }
    return text;
}

/** "Account number" → "accountNumber" (or "account-number" with a hyphen separator). */
function toKey(label: string, separator = ''): string {
    const words = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    if (separator) {
        return words.join(separator).slice(0, 60);
    }
    return words.map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('').slice(0, 60);
}

function normalizeFields(fields: PayoutFieldDefinitionInput[]): PayoutFieldDefinition[] {
    if (!fields?.length) {
        throw new UserInputError('Add at least one detail for sellers to fill in.');
    }
    const seen = new Set<string>();
    return fields.map(field => {
        const label = requiredText(field.label, 'Every detail needs a label, and it');
        // An existing key is kept as it is, so the details sellers already gave stay attached to it.
        const givenKey = field.key?.trim();
        let key = (givenKey && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(givenKey) ? givenKey : toKey(label)) || 'field';
        for (let i = 2; seen.has(key); i++) {
            key = `${toKey(label) || 'field'}${i}`;
        }
        seen.add(key);
        return { key, label, required: !!field.required, placeholder: field.placeholder?.trim() || null };
    });
}

function validateDetails(type: PayoutMethodType, details: PayoutDetailInput[]): Record<string, string> {
    const given = new Map((details ?? []).map(detail => [detail.key, (detail.value ?? '').trim()]));
    const result: Record<string, string> = {};
    const missing: string[] = [];
    for (const field of type.fields) {
        const value = given.get(field.key) ?? '';
        if (value.length > 500) {
            throw new UserInputError(`${field.label} is too long.`);
        }
        if (value) {
            result[field.key] = value;
        } else if (field.required) {
            missing.push(field.label);
        }
    }
    if (missing.length) {
        throw new UserInputError(`Fill in ${missing.join(', ')}.`);
    }
    return result;
}
