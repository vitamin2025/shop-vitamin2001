import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type PayoutFieldDefinition {
        key: String!
        label: String!
        required: Boolean!
        placeholder: String
    }

    type PayoutMethodType implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        name: String!
        description: String
        enabled: Boolean!
        sortOrder: Int!
        fields: [PayoutFieldDefinition!]!
    }

    type PayoutDetail {
        key: String!
        label: String!
        value: String!
    }

    type SellerPayoutMethod implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        type: PayoutMethodType!
        name: String!
        label: String
        isDefault: Boolean!
        summary: String!
        details: [PayoutDetail!]!
    }

    type SellerPayout implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        sellerId: ID!
        amount: Money!
        currencyCode: CurrencyCode!
        paidAt: DateTime!
        payoutMethodId: ID
        methodName: String!
        methodDetails: [PayoutDetail!]!
        transactionId: String
        transactionDetails: String
        recordedBy: String
        voided: Boolean!
        voidedAt: DateTime
        voidReason: String
    }

    type SellerSettlementSummary {
        sellerId: ID!
        sellerName: String!
        slug: String
        status: String!
        commissionPercent: Float!
        currencyCode: CurrencyCode!
        orderCount: Int!
        grossSales: Money!
        commission: Money!
        earned: Money!
        paid: Money!
        pending: Money!
        pendingOrderCount: Int!
        readyToSettle: Money!
        salesLast30Days: Money!
        averageOrderValue: Money!
        lastPayoutAt: DateTime
        lastPayoutAmount: Money
        payoutCount: Int!
        defaultPayoutMethod: String
    }

    type SettlementOverview {
        currencyCode: CurrencyCode!
        grossSales: Money!
        commission: Money!
        earned: Money!
        paid: Money!
        pending: Money!
        readyToSettle: Money!
        paidThisMonth: Money!
        sellersWithPending: Int!
        sellers: [SellerSettlementSummary!]!
    }

    type SettlementMonth {
        month: String!
        orderCount: Int!
        grossSales: Money!
        commission: Money!
        earned: Money!
        paid: Money!
    }

    type SettlementOrder {
        id: ID!
        code: String!
        state: String!
        orderPlacedAt: DateTime
        currencyCode: CurrencyCode!
        totalWithTax: Money!
        commissionPercent: Float
        commissionAmount: Money!
        sellerPayoutAmount: Money!
        payoutStatus: String!
    }

    type SellerSettlement {
        summary: SellerSettlementSummary!
        months: [SettlementMonth!]!
        payouts: [SellerPayout!]!
        payoutMethods: [SellerPayoutMethod!]!
        recentOrders: [SettlementOrder!]!
    }

    input PayoutFieldDefinitionInput {
        key: String
        label: String!
        required: Boolean!
        placeholder: String
    }

    input PayoutMethodTypeInput {
        name: String!
        description: String
        enabled: Boolean
        sortOrder: Int
        fields: [PayoutFieldDefinitionInput!]!
    }

    input PayoutDetailInput {
        key: String!
        value: String!
    }

    input SellerPayoutMethodInput {
        typeId: ID!
        label: String
        details: [PayoutDetailInput!]!
        isDefault: Boolean
    }

    input RecordSellerPayoutInput {
        sellerId: ID!
        amount: Money!
        paidAt: DateTime
        payoutMethodId: ID
        manualMethodName: String
        transactionId: String
        transactionDetails: String
    }

    input UpdateSellerPayoutInput {
        id: ID!
        amount: Money
        paidAt: DateTime
        payoutMethodId: ID
        manualMethodName: String
        transactionId: String
        transactionDetails: String
    }

    extend type Query {
        "Payout method types sellers can choose from. Staff can include the ones turned off."
        payoutMethodTypes(includeDisabled: Boolean): [PayoutMethodType!]!
        "What every seller has earned, been paid and is still owed."
        settlementOverview: SettlementOverview!
        sellerSettlement(sellerId: ID!): SellerSettlement!
        "For a seller signed in to their shop: their earnings, payouts and payout methods."
        myPayments: SellerSettlement!
    }

    extend type Mutation {
        createPayoutMethodType(input: PayoutMethodTypeInput!): PayoutMethodType!
        updatePayoutMethodType(id: ID!, input: PayoutMethodTypeInput!): PayoutMethodType!
        deletePayoutMethodType(id: ID!): Boolean!
        recordSellerPayout(input: RecordSellerPayoutInput!): SellerPayout!
        updateSellerPayout(input: UpdateSellerPayoutInput!): SellerPayout!
        voidSellerPayout(id: ID!, reason: String!): SellerPayout!
        createMyPayoutMethod(input: SellerPayoutMethodInput!): SellerPayoutMethod!
        updateMyPayoutMethod(id: ID!, input: SellerPayoutMethodInput!): SellerPayoutMethod!
        deleteMyPayoutMethod(id: ID!): Boolean!
    }
`;
