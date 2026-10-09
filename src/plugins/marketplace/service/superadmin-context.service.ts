import { Injectable } from '@nestjs/common';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { RequestContext, RequestContextService, TransactionalConnection, User } from '@vendure/core';

/**
 * Seller applications and approvals create Channels, Roles and Administrators, which needs
 * the permissions of the superadmin rather than those of the caller.
 */
@Injectable()
export class SuperadminContextService {
    constructor(
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
    ) {}

    async create(): Promise<RequestContext> {
        // Looked up by role rather than by SUPERADMIN_USERNAME, which may have been changed in the dashboard.
        const superadmin = await this.connection.rawConnection
            .getRepository(User)
            .createQueryBuilder('user')
            .innerJoinAndSelect('user.roles', 'role', 'role.code = :code', { code: SUPER_ADMIN_ROLE_CODE })
            .leftJoinAndSelect('role.channels', 'channel')
            .where('user.deletedAt IS NULL')
            .orderBy('user.id', 'ASC')
            .getOne();
        return this.requestContextService.create({
            apiType: 'admin',
            user: superadmin ?? undefined,
        });
    }
}
