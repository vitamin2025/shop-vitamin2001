import { Asset, ID } from '@vendure/core';

export interface MarketplacePluginOptions {
    /**
     * Commission, as a percentage of a seller order's items (including tax, excluding shipping),
     * for sellers whose Commission % field is blank.
     */
    defaultCommissionPercent: number;
    /** When false, the Shop API refuses new seller applications. */
    applicationsOpen: boolean;
    /**
     * Name of the seller shop that holds the store's own products. It is created on first boot,
     * so that every product in the marketplace belongs to a seller.
     */
    houseShopName: string;
}

export interface SellerApplicationInput {
    shopName: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    password: string;
    phoneNumber?: string | null;
    gstin?: string | null;
    fssaiLicenceNumber?: string | null;
}

export interface MarketplaceSeller {
    id: ID;
    slug: string;
    name: string;
    description: string | null;
    logo: Asset | null;
    banner: Asset | null;
    isHouseShop: boolean;
    gstin: string | null;
    fssaiLicenceNumber: string | null;
    channelCode: string;
    channelToken: string;
}

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomSellerFields {
        status: string;
        commissionPercent: number | null;
        contactFirstName: string | null;
        contactLastName: string | null;
        contactEmail: string | null;
        contactPhone: string | null;
        gstin: string | null;
        fssaiLicenceNumber: string | null;
        slug: string | null;
        description: string | null;
        logo: Asset | null;
        banner: Asset | null;
        administratorId: string | null;
        isHouseShop: boolean;
    }
    interface CustomOrderFields {
        commissionPercent: number | null;
        commissionAmount: number | null;
        sellerPayoutAmount: number | null;
        sellerPayoutStatus: string | null;
    }
}
