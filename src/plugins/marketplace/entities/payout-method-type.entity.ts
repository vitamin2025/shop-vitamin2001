import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity } from 'typeorm';

/** One detail a seller fills in for a payout method, such as "UPI ID" or "IFSC code". */
export interface PayoutFieldDefinition {
    key: string;
    label: string;
    required: boolean;
    placeholder?: string | null;
}

/**
 * A way the marketplace can pay sellers (UPI, NEFT, IMPS…), with the details a seller must give
 * for it. Staff manage these on the Settlements page; sellers pick one when they add a payout method.
 */
@Entity()
export class PayoutMethodType extends VendureEntity {
    constructor(input?: DeepPartial<PayoutMethodType>) {
        super(input);
    }

    @Column({ unique: true })
    code: string;

    @Column()
    name: string;

    @Column('text', { nullable: true })
    description: string | null;

    @Column({ default: true })
    enabled: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    @Column('simple-json')
    fields: PayoutFieldDefinition[];
}
