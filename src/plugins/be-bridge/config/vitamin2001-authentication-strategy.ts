import {
    AuthenticationStrategy,
    ChannelService,
    Customer,
    CustomerService,
    ExternalAuthenticationService,
    Injector,
    normalizeEmailAddress,
    RequestContext,
    UnverifiedExternalEmailError,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

import { verifyToken } from '../bridge-token';
import { BE_BRIDGE_PLUGIN_OPTIONS, VITAMIN2001_AUTH_STRATEGY } from '../constants';
import { BackendBridgePluginOptions, LoginToken } from '../types';

export interface Vitamin2001AuthData {
    token: string;
}

/**
 * Signs in a customer the BE has already authenticated. The BE sends a signed `login` token that
 * lasts a minute; its user id is the login's external identifier, so the same person always gets
 * the same Customer, whichever Channel (marketplace or seller storefront) they sign in on.
 */
export class Vitamin2001AuthenticationStrategy implements AuthenticationStrategy<Vitamin2001AuthData> {
    readonly name = VITAMIN2001_AUTH_STRATEGY;

    private options: BackendBridgePluginOptions;
    private externalAuthenticationService: ExternalAuthenticationService;
    private customerService: CustomerService;
    private channelService: ChannelService;

    init(injector: Injector) {
        this.options = injector.get(BE_BRIDGE_PLUGIN_OPTIONS);
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.customerService = injector.get(CustomerService);
        this.channelService = injector.get(ChannelService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input Vitamin2001AuthInput {
                token: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: Vitamin2001AuthData): Promise<User | false | string> {
        const login = readLoginToken(verifyToken<LoginToken>(this.options.secret, 'login', data.token));
        if (!login) {
            return false;
        }
        const externalIdentifier = String(login.sub);
        // Looks in every Channel: a customer who signed up on one storefront signs in on all of them.
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, externalIdentifier);
        if (user) {
            const customer = await this.customerService.findOneByUserId(ctx, user.id, false);
            if (!customer) {
                return false;
            }
            await this.channelService.assignToChannels(ctx, Customer, customer.id, [ctx.channelId]);
            await this.updateDetails(ctx, customer, login);
            return user;
        }
        try {
            const created = await this.externalAuthenticationService.createCustomerAndUser(ctx, {
                strategy: this.name,
                externalIdentifier,
                verified: login.verified,
                emailAddress: normalizeEmailAddress(login.email),
                firstName: login.firstName ?? '',
                lastName: login.lastName ?? '',
            });
            const customer = await this.customerService.findOneByUserId(ctx, created.id);
            if (customer) {
                await this.updateDetails(ctx, customer, login);
            }
            return created;
        } catch (err) {
            if (err instanceof UnverifiedExternalEmailError) {
                return 'An account with this email address already exists. Verify the email address first.';
            }
            throw err;
        }
    }

    /** Customers edit their name and phone number on the BE, so its values win. */
    private async updateDetails(ctx: RequestContext, customer: Customer, login: LoginToken) {
        const changes: { firstName?: string; lastName?: string; phoneNumber?: string } = {};
        if (login.firstName && login.firstName !== customer.firstName) {
            changes.firstName = login.firstName;
        }
        if (login.lastName && login.lastName !== customer.lastName) {
            changes.lastName = login.lastName;
        }
        if (login.phone && login.phone !== customer.phoneNumber) {
            changes.phoneNumber = login.phone;
        }
        if (Object.keys(changes).length > 0) {
            await this.customerService.update(ctx, { id: customer.id, ...changes });
        }
    }
}

/** The token's fields with blank optional values dropped, or undefined when a required one is missing. */
function readLoginToken(token: LoginToken | undefined): LoginToken | undefined {
    if (!token) {
        return;
    }
    const { sub, email, verified } = token;
    const hasSub = (typeof sub === 'string' && sub !== '') || typeof sub === 'number';
    if (!hasSub || typeof email !== 'string' || !email.includes('@') || typeof verified !== 'boolean') {
        return;
    }
    return {
        ...token,
        firstName: text(token.firstName),
        lastName: text(token.lastName),
        phone: text(token.phone),
    };
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
