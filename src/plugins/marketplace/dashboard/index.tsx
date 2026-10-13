import { defineDashboardExtension } from '@vendure/dashboard';
import { Landmark, Wallet } from 'lucide-react';

import { PayoutMethodTypesPage } from './payout-method-types-page';
import { SellerPaymentsPage } from './seller-payments-page';
import { SellerSettlementPage } from './seller-settlement-page';
import { SettlementsPage } from './settlements-page';

const STAFF = 'ManageSellerPayouts';
const SELLER = 'ManageOwnPayouts';

defineDashboardExtension({
    navSections: [
        { id: 'settlements', title: 'Settlements', icon: Landmark, order: 450, placement: 'top' },
        { id: 'payments', title: 'Payments', icon: Wallet, order: 460, placement: 'top' },
    ],
    routes: [
        {
            path: '/settlements',
            component: () => <SettlementsPage />,
            loader: () => ({ breadcrumb: 'Seller settlements' }),
            navMenuItem: {
                sectionId: 'settlements',
                id: 'seller-settlements',
                title: 'Seller settlements',
                order: 100,
                requiresPermission: STAFF,
            },
        },
        {
            path: '/settlements/payout-methods',
            component: () => <PayoutMethodTypesPage />,
            loader: () => ({
                breadcrumb: [{ path: '/settlements', label: 'Seller settlements' }, 'Payout methods'],
            }),
            navMenuItem: {
                sectionId: 'settlements',
                id: 'payout-method-types',
                title: 'Payout methods',
                order: 200,
                requiresPermission: STAFF,
            },
        },
        {
            path: '/settlements/$sellerId',
            component: route => <SellerSettlementPage sellerId={(route.useParams() as { sellerId: string }).sellerId} />,
            loader: () => ({
                breadcrumb: [{ path: '/settlements', label: 'Seller settlements' }, 'Seller'],
            }),
        },
        {
            path: '/payments',
            component: () => <SellerPaymentsPage />,
            loader: () => ({ breadcrumb: 'Payments' }),
            navMenuItem: {
                sectionId: 'payments',
                id: 'seller-payments',
                title: 'Payments',
                requiresPermission: SELLER,
            },
        },
    ],
});
