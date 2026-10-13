import { DeepPartial, EntityId, ID, Seller, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { PayoutMethodType } from './payout-method-type.entity';

/** A seller's own account for one payout method type, e.g. their UPI ID or bank account. */
@Entity()
export class SellerPayoutMethod extends VendureEntity {
    constructor(input?: DeepPartial<SellerPayoutMethod>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Seller, { onDelete: 'CASCADE' })
    seller: Seller;

    @EntityId()
    sellerId: ID;

    @ManyToOne(type => PayoutMethodType, { onDelete: 'RESTRICT' })
    type: PayoutMethodType;

    @EntityId()
    typeId: ID;

    /** The seller's own name for it, e.g. "HDFC current account". */
    @Column({ type: 'varchar', nullable: true })
    label: string | null;

    /** Values keyed by PayoutFieldDefinition.key. */
    @Column('simple-json')
    details: Record<string, string>;

    @Column({ default: false })
    isDefault: boolean;

    /** Removed by the seller. Kept so past payouts still point at it. */
    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;
}
