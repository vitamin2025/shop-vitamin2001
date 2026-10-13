import {
    api,
    Badge,
    Button,
    FullWidthPageBlock,
    Input,
    Link,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useQuery,
} from '@vendure/dashboard';
import { useMemo, useState } from 'react';

import { count, errorMessage, SettlementSummary, StatCard, StatGrid, summaryFields, useMoney } from './shared';

const settlementOverviewDocument = `
    query SettlementOverview {
        settlementOverview {
            currencyCode
            grossSales
            commission
            earned
            paid
            pending
            readyToSettle
            paidThisMonth
            sellersWithPending
            sellers {
                ${summaryFields}
            }
        }
    }
`;

interface SettlementOverview {
    currencyCode: string;
    grossSales: number;
    commission: number;
    earned: number;
    paid: number;
    pending: number;
    readyToSettle: number;
    paidThisMonth: number;
    sellersWithPending: number;
    sellers: SettlementSummary[];
}

/** Staff: what every seller has earned, been paid and is still owed. */
export function SettlementsPage() {
    const { money, date } = useMoney();
    const [search, setSearch] = useState('');
    const [onlyPending, setOnlyPending] = useState(false);
    const { data, isLoading, error } = useQuery({
        queryKey: ['settlementOverview'],
        queryFn: () => api.query(settlementOverviewDocument) as Promise<{ settlementOverview: SettlementOverview }>,
    });
    const overview = data?.settlementOverview;
    const currency = overview?.currencyCode ?? 'INR';
    const sellers = useMemo(
        () =>
            (overview?.sellers ?? []).filter(
                seller =>
                    (!onlyPending || seller.pending > 0) &&
                    seller.sellerName.toLowerCase().includes(search.trim().toLowerCase()),
            ),
        [overview, search, onlyPending],
    );
    const topCommission = useMemo(
        () => [...(overview?.sellers ?? [])].sort((a, b) => b.commission - a.commission).slice(0, 5),
        [overview],
    );

    return (
        <Page pageId="seller-settlements">
            <PageTitle>Seller settlements</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" render={<Link to={'/settlements/payout-methods' as any} />}>
                        Payout methods
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="settlement-totals">
                    {error ? (
                        <p className="text-destructive">{errorMessage(error)}</p>
                    ) : (
                        <StatGrid>
                            <StatCard
                                label="Pending to pay sellers"
                                value={isLoading ? '…' : money(overview?.pending, currency)}
                                hint={`${count(overview?.sellersWithPending, 'seller')} waiting`}
                                tone="warning"
                            />
                            <StatCard
                                label="Ready to settle"
                                value={money(overview?.readyToSettle, currency)}
                                hint="Owed for delivered orders"
                            />
                            <StatCard
                                label="Commission earned"
                                value={money(overview?.commission, currency)}
                                hint={`on ${money(overview?.grossSales, currency)} of seller sales`}
                                tone="success"
                            />
                            <StatCard
                                label="Paid to sellers"
                                value={money(overview?.paid, currency)}
                                hint={`${money(overview?.paidThisMonth, currency)} this month`}
                            />
                            <StatCard
                                label="Earned by sellers"
                                value={money(overview?.earned, currency)}
                                hint="Sales minus commission"
                            />
                        </StatGrid>
                    )}
                </FullWidthPageBlock>
                <FullWidthPageBlock blockId="settlement-sellers">
                    <div className="rounded-xl border bg-card">
                        <div className="flex flex-wrap items-center gap-3 border-b p-4">
                            <h2 className="mr-auto text-base font-semibold">Sellers</h2>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={onlyPending}
                                    onChange={event => setOnlyPending(event.target.checked)}
                                />
                                Only sellers with money pending
                            </label>
                            <Input
                                className="w-56"
                                placeholder="Search sellers"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </div>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Seller</TableHead>
                                        <TableHead className="text-right">Orders</TableHead>
                                        <TableHead className="text-right">Sales</TableHead>
                                        <TableHead className="text-right">Commission</TableHead>
                                        <TableHead className="text-right">Earned</TableHead>
                                        <TableHead className="text-right">Paid</TableHead>
                                        <TableHead className="text-right">Pending</TableHead>
                                        <TableHead>Last payment</TableHead>
                                        <TableHead>Pays to</TableHead>
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sellers.map(seller => (
                                        <TableRow key={seller.sellerId}>
                                            <TableCell>
                                                <Link
                                                    to={`/settlements/${seller.sellerId}` as any}
                                                    className="font-medium underline-offset-2 hover:underline"
                                                >
                                                    {seller.sellerName}
                                                </Link>
                                                {seller.status !== 'approved' ? (
                                                    <Badge variant="secondary" className="ml-2 capitalize">
                                                        {seller.status}
                                                    </Badge>
                                                ) : null}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">{seller.orderCount}</TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {money(seller.grossSales, seller.currencyCode)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {money(seller.commission, seller.currencyCode)}
                                                <span className="ml-1 text-xs text-muted-foreground">
                                                    ({seller.commissionPercent}%)
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {money(seller.earned, seller.currencyCode)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {money(seller.paid, seller.currencyCode)}
                                            </TableCell>
                                            <TableCell
                                                className={`text-right font-semibold tabular-nums ${seller.pending > 0 ? 'text-warning' : ''}`}
                                            >
                                                {money(seller.pending, seller.currencyCode)}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">
                                                {seller.lastPayoutAt ? (
                                                    <>
                                                        {date(seller.lastPayoutAt)}
                                                        <div className="text-xs text-muted-foreground">
                                                            {money(seller.lastPayoutAmount, seller.currencyCode)}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <span className="text-muted-foreground">Never</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {seller.defaultPayoutMethod ?? (
                                                    <span className="text-muted-foreground">Not added yet</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant={seller.pending > 0 ? 'default' : 'outline'}
                                                    render={<Link to={`/settlements/${seller.sellerId}` as any} />}
                                                >
                                                    {seller.pending > 0 ? 'Settle' : 'Open'}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {!isLoading && sellers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                                                No sellers to show.
                                            </TableCell>
                                        </TableRow>
                                    ) : null}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </FullWidthPageBlock>
                <PageBlock column="main" blockId="settlement-commission" title="Commission by seller">
                    {topCommission.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No commission yet.</p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {topCommission.map(seller => {
                                const share = overview?.commission ? seller.commission / overview.commission : 0;
                                return (
                                    <div key={seller.sellerId} className="flex flex-col gap-1">
                                        <div className="flex justify-between text-sm">
                                            <span>{seller.sellerName}</span>
                                            <span className="tabular-nums">
                                                {money(seller.commission, seller.currencyCode)} ·{' '}
                                                {Math.round(share * 100)}%
                                            </span>
                                        </div>
                                        <div className="h-2 rounded bg-muted">
                                            <div
                                                className="h-2 rounded bg-primary"
                                                style={{ width: `${Math.round(share * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </PageBlock>
                <PageBlock column="side" blockId="settlement-how" title="How this is worked out">
                    <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        <li>Earned is each paid, uncancelled order minus its commission. Shipping goes to the seller.</li>
                        <li>Pending is earned minus the payments recorded here.</li>
                        <li>Payments settle a seller's oldest orders first.</li>
                        <li>Refunds don't lower what a seller earned. Void or edit a payment if one changes.</li>
                    </ul>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
