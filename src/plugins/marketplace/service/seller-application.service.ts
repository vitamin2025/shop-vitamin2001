import { Inject, Injectable } from '@nestjs/common';
import {
    AdministratorService,
    ConfigService,
    normalizeEmailAddress,
    RequestContext,
    Seller,
    SellerService,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { IsNull } from 'typeorm';

import { MARKETPLACE_PLUGIN_OPTIONS, SellerStatus } from '../constants';
import { MarketplacePluginOptions, SellerApplicationInput } from '../types';

import { SellerProvisioningService } from './seller-provisioning.service';
import { SuperadminContextService } from './superadmin-context.service';

const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class SellerApplicationService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private administratorService: AdministratorService,
        private sellerService: SellerService,
        private sellerProvisioningService: SellerProvisioningService,
        private superadminContextService: SuperadminContextService,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    /**
     * Saves a Pending seller and a login with no Roles. The login can sign in but has no access
     * until the seller is approved.
     */
    async apply(ctx: RequestContext, input: SellerApplicationInput) {
        if (!this.options.applicationsOpen) {
            throw new UserInputError('Seller applications are closed.');
        }
        const shopName = input.shopName.trim();
        const firstName = input.firstName.trim();
        const lastName = input.lastName.trim();
        const emailAddress = normalizeEmailAddress(input.emailAddress);
        if (!shopName || !firstName || !lastName) {
            throw new UserInputError('Shop name, first name and last name are required.');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
            throw new UserInputError('Enter a valid email address.');
        }
        await this.validatePassword(ctx, input.password);

        const superadminCtx = await this.superadminContextService.create();
        const seller = await this.connection.withTransaction(superadminCtx, async txCtx => {
            const emailTaken = await this.connection
                .getRepository(txCtx, User)
                .exists({ where: { identifier: emailAddress, deletedAt: IsNull() } });
            if (emailTaken) {
                throw new UserInputError('An account with this email address already exists.');
            }
            const nameTaken = await this.connection
                .getRepository(txCtx, Seller)
                .exists({ where: { name: shopName, deletedAt: IsNull() } });
            if (nameTaken) {
                throw new UserInputError('A shop with this name already exists.');
            }
            const administrator = await this.administratorService.create(txCtx, {
                firstName,
                lastName,
                emailAddress,
                password: input.password,
                roleIds: [],
            });
            const created = await this.sellerService.create(txCtx, {
                name: shopName,
                customFields: {
                    status: SellerStatus.Pending,
                    contactFirstName: firstName,
                    contactLastName: lastName,
                    contactEmail: emailAddress,
                    contactPhone: input.phoneNumber?.trim() || null,
                    gstin: input.gstin?.trim().toUpperCase() || null,
                    fssaiLicenceNumber: input.fssaiLicenceNumber?.trim() || null,
                },
            });
            await this.sellerProvisioningService.linkAdministrator(txCtx, created, administrator.id);
            return created;
        });
        return { id: seller.id, shopName: seller.name, status: seller.customFields.status };
    }

    private async validatePassword(ctx: RequestContext, password: string) {
        if (password.length < MIN_PASSWORD_LENGTH) {
            throw new UserInputError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        const result = await this.configService.authOptions.passwordValidationStrategy.validate(ctx, password);
        if (result !== true) {
            throw new UserInputError(typeof result === 'string' ? result : 'The password is not allowed.');
        }
    }
}
