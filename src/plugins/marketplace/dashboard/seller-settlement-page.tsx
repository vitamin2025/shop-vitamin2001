import {
    api,
    Badge,
    Button,
    FullWidthPageBlock,
    Link,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { useState } from 'react';

import { PayoutDialog, VoidPayoutDialog } from './payout-dialog';
import {
    DetailList,
    errorMessage,
    MonthsTable,
    OrdersTable,
    Payout,
    PayoutsTable,
    SellerSettlement,
    settlementFields,
    count,
    StatCard,
    StatGrid,
    useMoney,
} from './shared';

const sellerSettlementDocument = `
    query SellerSettlement($sellerId: ID!) {
        sellerSettlement(sellerId: $sellerId) {
            ${settlementFields}
        }
    }
`;

/** Staff: one seller's balance, payments and sales, and where to record a payment to them. */
export function SellerSettlementPage({ sellerId }: Readonly<{ sellerId: string }>) {
    const { money, date } = useMoney();
    const queryClient = useQueryClient();
    const [paying, setPaying] = useState(false);
    const [editing, setEditing] = useState<Payout | null>(null);
    const [voiding, setVoiding] = useState<Payout | null>(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ['sellerSettlement', sellerId],
        queryFn: () =>
            api.query(sellerSettlementDocument, { sellerId }) as Promise<{ sellerSettlement: SellerSettlement }>,
    });
    const settlement = data?.sellerSettlement;
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['sellerSettlement', sellerId] });
        queryClient.invalidateQueries({ queryKey: ['settlementOverview'] });
    };

    if (error || (!isLoading && !settlement)) {
        return (
            <Page pageId="seller-settlement">
                <PageTitle>Seller settlement</PageTitle>
                <PageLayout>
                    <FullWidthPageBlock blockId="seller-settlement-error">
                        <p className="text-destructive">{errorMessage(error)}</p>
                    </FullWidthPageBlock>
                </PageLayout>
            </Page>
        );
    }
    const summary = settlement?.summary;
    const currency = summary?.currencyCode ?? 'INR';

    return (
        <Page pageId="seller-settlement">
            <PageTitle>{summary?.sellerName ?? 'Seller settlement'}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" render={<Link to={'/settlements' as any} />}>
                        All sellers
                    </Button>
                    <Button onClick={() => setPaying(true)} disabled={!settlement || (summary?.pending ?? 0) <= 0}>
                        Record payment
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="seller-settlement-stats">
                    <StatGrid>
                        <StatCard
                            label="Pending"
                            value={isLoading ? '…' : money(summary?.pending, currency)}
                            hint={`${count(summary?.pendingOrderCount, 'order')} not yet settled`}
                            tone={(summary?.pending ?? 0) > 0 ? 'warning' : 'success'}
                        />
                        <StatCard
                            label="Ready to settle"
                            value={money(summary?.readyToSettle, currency)}
                            hint="Owed for delivered orders"
                        />
                        <StatCard
                            label="Paid to seller"
                            value={money(summary?.paid, currency)}
                            hint={
                                summary?.lastPayoutAt
                                    ? `Last paid ${date(summary.lastPayoutAt)}`
                                    : 'No payments yet'
                            }
                        />
                        <StatCard
                            label="Commission"
                            value={money(summary?.commission, currency)}
                            hint={`${summary?.commissionPercent ?? 0}% of items incl. GST`}
                            tone="success"
                        />
                        <StatCard
                            label="Earned by seller"
                            value={money(summary?.earned, currency)}
                            hint={`${count(summary?.orderCount, 'order')} · ${money(summary?.grossSales, currency)} sales`}
                        />
                    </StatGrid>
                </FullWidthPageBlock>
                <PageBlock column="main" blockId="seller-settlement-payouts" title="Payments to this seller">
                    <PayoutsTable
                        payouts={settlement?.payouts ?? []}
                        actions={payout =>
                            payout.voided ? null : (
                                <div className="flex justify-end gap-1">
                                    <Button size="xs" variant="outline" onClick={() => setEditing(payout)}>
                                        Edit
                                    </Button>
                                    <Button size="xs" variant="ghost" onClick={() => setVoiding(payout)}>
                                        Void
                                    </Button>
                                </div>
                            )
                        }
                    />
                </PageBlock>
                <PageBlock column="side" blockId="seller-settlement-methods" title="Seller's payout methods">
                    {settlement?.payoutMethods.length ? (
                        <div className="flex flex-col gap-4">
                            {settlement.payoutMethods.map(method => (
                                <div key={method.id} className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{method.name}</span>
                                        {method.label ? (
                                            <span className="text-sm text-muted-foreground">{method.label}</span>
                                        ) : null}
                                        {method.isDefault ? <Badge variant="secondary">Preferred</Badge> : null}
                                    </div>
                                    <DetailList details={method.details} stacked />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            The seller hasn't added a payout method yet. They add them on their Payments page.
                        </p>
                    )}
                </PageBlock>
                <PageBlock column="side" blockId="seller-settlement-analytics" title="Sales">
                    <dl className="grid grid-cols-2 gap-y-2 text-sm">
                        <dt className="text-muted-foreground">Last 30 days</dt>
                        <dd className="text-right tabular-nums">{money(summary?.salesLast30Days, currency)}</dd>
                        <dt className="text-muted-foreground">Average order</dt>
                        <dd className="text-right tabular-nums">{money(summary?.averageOrderValue, currency)}</dd>
                        <dt className="text-muted-foreground">Orders</dt>
                        <dd className="text-right tabular-nums">{summary?.orderCount ?? 0}</dd>
                        <dt className="text-muted-foreground">Payments</dt>
                        <dd className="text-right tabular-nums">{summary?.payoutCount ?? 0}</dd>
                    </dl>
                </PageBlock>
                <PageBlock column="main" blockId="seller-settlement-months" title="Last 6 months">
                    {settlement ? <MonthsTable months={settlement.months} currencyCode={currency} /> : null}
                </PageBlock>
                <PageBlock column="main" blockId="seller-settlement-orders" title="Orders">
                    <OrdersTable orders={settlement?.recentOrders ?? []} linkToOrders />
                </PageBlock>
            </PageLayout>
            {settlement ? (
                <>
                    <PayoutDialog open={paying} onOpenChange={setPaying} settlement={settlement} onSaved={refresh} />
                    <PayoutDialog
                        open={!!editing}
                        onOpenChange={open => !open && setEditing(null)}
                        settlement={settlement}
                        payout={editing}
                        onSaved={refresh}
                    />
                </>
            ) : null}
            <VoidPayoutDialog payout={voiding} onOpenChange={open => !open && setVoiding(null)} onSaved={refresh} />
        </Page>
    );
}
