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

    extend type Mutation {
        """
        Apply to sell on the marketplace. The seller can sign in to the dashboard with this email
        address and password once the store approves the application.
        """
        applyAsSeller(input: SellerApplicationInput!): SellerApplication!
    }
`;
