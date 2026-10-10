import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    input SellerApplicationInput {
        shopName: String!
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
        phoneNumber: String
        gstin: String
        fssaiLicenceNumber: String
    }

    type SellerApplication {
        id: ID!
        shopName: String!
        status: String!
    }

    "A seller with an open shop, as a storefront shows it."
    type MarketplaceSeller {
        id: ID!
        slug: String!
        name: String!
        description: String
        logo: Asset
        banner: Asset
        isHouseShop: Boolean!
        "Printed on the seller's invoices when given."
        gstin: String
        "Printed on the seller's invoices when given."
        fssaiLicenceNumber: String
        channelCode: String!
        "Send this as the vendure-token header to see only this seller's products."
        channelToken: String!
    }

    extend type Query {
        "Approved sellers that have an open shop, house shop included. Ignores the request's channel."
        marketplaceSellers: [MarketplaceSeller!]!
        marketplaceSeller(slug: String!): MarketplaceSeller
    }

    extend type Mutation {
        """
        Apply to sell on the marketplace. The seller can sign in to the dashboard with this email
        address and password once the store approves the application.
        """
        applyAsSeller(input: SellerApplicationInput!): SellerApplication!
    }
`;
