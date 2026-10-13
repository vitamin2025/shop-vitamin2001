import { CurrencyCode, DeepPartial, EntityId, ID, Money, Seller, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

/** One detail of the account a payout went to, copied when the payout was recorded. */
export interface PayoutDetailSnapshot {
    key: string;
    label: string;
    value: string;
}

/**
 * Money the marketplace paid a seller, recorded by staff after making the transfer.
 * The account it went to is copied in, so the record stays correct if the seller later edits it.
 */
@Entity()
export class SellerPayout extends VendureEntity {
    constructor(input?: DeepPartial<SellerPayout>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Seller, { onDelete: 'CASCADE' })
    seller: Seller;

    @EntityId()
    sellerId: ID;

    @Money()
    amount: number;

    @Column('varchar')
    currencyCode: CurrencyCode;

    @Column()
    paidAt: Date;

    /** The SellerPayoutMethod paid to, if the seller had one. */
    @EntityId({ nullable: true })
    payoutMethodId: ID | null;

    /** E.g. "UPI", or what staff typed when the seller had no payout method. */
    @Column()
    methodName: string;

    @Column('simple-json')
    methodDetails: PayoutDetailSnapshot[];

    @Column({ type: 'varchar', nullable: true })
    transactionId: string | null;

    @Column('text', { nullable: true })
    transactionDetails: string | null;

    @Column({ type: 'varchar', nullable: true })
    recordedBy: string | null;

    @Column({ type: Date, nullable: true })
    voidedAt: Date | null;

    @Column('text', { nullable: true })
    voidReason: string | null;
}
