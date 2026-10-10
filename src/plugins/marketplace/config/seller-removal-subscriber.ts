import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Channel, ID, Seller, UserInputError } from '@vendure/core';
import { EntitySubscriberInterface, EventSubscriber, RemoveEvent } from 'typeorm';

/** What is left to clean up after a seller is deleted. */
export interface RemovedSeller {
    sellerId: ID;
    channelIds: ID[];
    slug: string | null;
    name: string;
    administratorId: string | null;
}

const removedSellers = new Map<string, RemovedSeller>();

/**
 * Hands over what SellerRemovalSubscriber kept about a deleted seller. Called from the
 * SellerEvent 'deleted' handler, when the row is gone and the event's Seller may have lost its id.
 */
export function takeRemovedSeller(sellerId: ID): RemovedSeller | undefined {
    const removed = removedSellers.get(String(sellerId));
    removedSellers.delete(String(sellerId));
    return removed;
}

/**
 * Vendure deletes a Seller row outright, which the database refuses while the seller's shop
 * Channel still points at it. So the Channels are detached first, in the same transaction.
 * They keep their products and orders, so past orders stay intact.
 *
 * Registered with TypeORM (not Nest), so it only uses the transaction's own EntityManager.
 */
@EventSubscriber()
export class SellerRemovalSubscriber implements EntitySubscriberInterface<Seller> {
    listenTo() {
        return Seller;
    }

    async beforeRemove(event: RemoveEvent<Seller>) {
        const seller = event.entity;
        if (!seller) {
            return;
        }
        // The plugin would only create the house shop again on the next start.
        if (seller.customFields?.isHouseShop) {
            throw new UserInputError(`"${seller.name}" holds the store's own products and cannot be deleted.`);
        }
        const channels = await event.manager.getRepository(Channel).find({ where: { sellerId: seller.id } });
        if (channels.some(channel => channel.code === DEFAULT_CHANNEL_CODE)) {
            throw new UserInputError('The seller of the default channel cannot be deleted.');
        }
        if (channels.length > 0) {
            await event.manager
                .createQueryBuilder()
                .update(Channel)
                .set({ sellerId: () => 'NULL' })
                .whereInIds(channels.map(channel => channel.id))
                .execute();
        }
        removedSellers.set(String(seller.id), {
            sellerId: seller.id,
            channelIds: channels.map(channel => channel.id),
            slug: seller.customFields?.slug ?? null,
            name: seller.name,
            administratorId: seller.customFields?.administratorId ?? null,
        });
    }
}
