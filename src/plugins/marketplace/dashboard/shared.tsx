import {
    Badge,
    Card,
    CardContent,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useLocalFormat,
} from '@vendure/dashboard';
import type { ReactNode } from 'react';

/** Payout fields every settlement query asks for. */
export const payoutFields = `
    id
    amount
    currencyCode
    paidAt
    payoutMethodId
    methodName
    methodDetails {
        key
        label
        value
    }
    transactionId
    transactionDetails
    recordedBy
    voided
    voidedAt
    voidReason
`;

export const payoutMethodFields = `
    id
    name
    label
    isDefault
    summary
    type {
        id
        name
        fields {
            key
            label
            required
            placeholder
        }
    }
    details {
        key
        label
        value
    }
`;

export const summaryFields = `
    sellerId
    sellerName
    slug
    status
    commissionPercent
    currencyCode
    orderCount
    grossSales
    commission
    earned
    paid
    pending
    pendingOrderCount
    readyToSettle
    salesLast30Days
    averageOrderValue
    lastPayoutAt
    lastPayoutAmount
    payoutCount
    defaultPayoutMethod
`;

export const settlementFields = `
    summary {
        ${summaryFields}
    }
    months {
        month
        orderCount
        grossSales
        commission
        earned
        paid
    }
    payouts {
        ${payoutFields}
    }
    payoutMethods {
        ${payoutMethodFields}
    }
    recentOrders {
        id
        code
        state
        orderPlacedAt
        currencyCode
        totalWithTax
        commissionPercent
        commissionAmount
        sellerPayoutAmount
        payoutStatus
    }
`;

export interface PayoutDetail {
    key: string;
    label: string;
    value: string;
}

export interface PayoutField {
    key: string;
    label: string;
    required: boolean;
    placeholder?: string | null;
}

export interface Payout {
    id: string;
    amount: number;
    currencyCode: string;
    paidAt: string;
    payoutMethodId: string | null;
    methodName: string;
    methodDetails: PayoutDetail[];
    transactionId: string | null;
    transactionDetails: string | null;
    recordedBy: string | null;
    voided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
}

export interface SellerPayoutMethod {
    id: string;
    name: string;
    label: string | null;
    isDefault: boolean;
    summary: string;
    type: { id: string; name: string; fields: PayoutField[] };
    details: PayoutDetail[];
}

export interface SettlementSummary {
    sellerId: string;
    sellerName: string;
    slug: string | null;
    status: string;
    commissionPercent: number;
    currencyCode: string;
    orderCount: number;
    grossSales: number;
    commission: number;
    earned: number;
    paid: number;
    pending: number;
    pendingOrderCount: number;
    readyToSettle: number;
    salesLast30Days: number;
    averageOrderValue: number;
    lastPayoutAt: string | null;
    lastPayoutAmount: number | null;
    payoutCount: number;
    defaultPayoutMethod: string | null;
}

export interface SettlementMonth {
    month: string;
    orderCount: number;
    grossSales: number;
    commission: number;
    earned: number;
    paid: number;
}

export interface SettlementOrder {
    id: string;
    code: string;
    state: string;
    orderPlacedAt: string | null;
    currencyCode: string;
    totalWithTax: number;
    commissionPercent: number | null;
    commissionAmount: number;
    sellerPayoutAmount: number;
    payoutStatus: string;
}

export interface SellerSettlement {
    summary: SettlementSummary;
    months: SettlementMonth[];
    payouts: Payout[];
    payoutMethods: SellerPayoutMethod[];
    recentOrders: SettlementOrder[];
}

export function useMoney() {
    const { formatCurrency, formatDate } = useLocalFormat();
    return {
        money: (value: number | null | undefined, currencyCode: string) => formatCurrency(value ?? 0, currencyCode),
        date: (value: string | null | undefined) =>
            value ? formatDate(value, { year: 'numeric', month: 'short', day: 'numeric' }) : '—',
    };
}

export function StatCard({
    label,
    value,
    hint,
    tone,
}: Readonly<{ label: string; value: ReactNode; hint?: ReactNode; tone?: 'warning' | 'success' }>) {
    const toneClass = tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : '';
    return (
        <Card className="w-full">
            <CardContent className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
                <span className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</span>
                {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
            </CardContent>
        </Card>
    );
}

export function StatGrid({ children }: Readonly<{ children: ReactNode }>) {
    return <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{children}</div>;
}

/** Account details. `stacked` puts each label above its value, for narrow side panels. */
export function DetailList({ details, stacked }: Readonly<{ details: PayoutDetail[]; stacked?: boolean }>) {
    if (details.length === 0) {
        return <span className="text-muted-foreground">—</span>;
    }
    if (stacked) {
        return (
            <dl className="flex flex-col gap-1.5 text-sm">
                {details.map(detail => (
                    <div key={detail.key}>
                        <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                        <dd className="font-mono break-all">{detail.value}</dd>
                    </div>
                ))}
            </dl>
        );
    }
    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            {details.map(detail => (
                <div key={detail.key} className="contents">
                    <dt className="whitespace-nowrap text-muted-foreground">{detail.label}</dt>
                    <dd className="font-mono break-all">{detail.value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function PayoutStatusBadge({ status }: Readonly<{ status: string }>) {
    return status === 'paid' ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Pending</Badge>;
}

export function PayoutsTable({
    payouts,
    actions,
}: Readonly<{ payouts: Payout[]; actions?: (payout: Payout) => ReactNode }>) {
    const { money, date } = useMoney();
    if (payouts.length === 0) {
        return <p className="text-sm text-muted-foreground">No payments yet.</p>;
    }
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Paid to</TableHead>
                        <TableHead>Transaction</TableHead>
                        {actions ? <TableHead /> : null}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {payouts.map(payout => (
                        <TableRow key={payout.id} className={payout.voided ? 'opacity-60' : ''}>
                            <TableCell className="whitespace-nowrap align-top">
                                {date(payout.paidAt)}
                                {payout.voided ? (
                                    <div className="mt-1">
                                        <Badge variant="destructive">Voided</Badge>
                                    </div>
                                ) : null}
                            </TableCell>
                            <TableCell
                                className={`text-right font-medium tabular-nums align-top ${payout.voided ? 'line-through' : ''}`}
                            >
                                {money(payout.amount, payout.currencyCode)}
                            </TableCell>
                            <TableCell className="align-top">
                                <div className="mb-1 font-medium">{payout.methodName}</div>
                                {payout.methodDetails.length ? <DetailList details={payout.methodDetails} /> : null}
                            </TableCell>
                            <TableCell className="min-w-48 whitespace-normal align-top text-sm">
                                <div className="font-mono">{payout.transactionId ?? '—'}</div>
                                {payout.transactionDetails ? (
                                    <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                                        {payout.transactionDetails}
                                    </div>
                                ) : null}
                                {payout.voided && payout.voidReason ? (
                                    <div className="mt-1 text-destructive">Voided: {payout.voidReason}</div>
                                ) : null}
                                {payout.recordedBy ? (
                                    <div className="mt-1 text-xs text-muted-foreground">Recorded by {payout.recordedBy}</div>
                                ) : null}
                            </TableCell>
                            {actions ? <TableCell className="align-top text-right">{actions(payout)}</TableCell> : null}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function OrdersTable({ orders, linkToOrders }: Readonly<{ orders: SettlementOrder[]; linkToOrders: boolean }>) {
    const { money, date } = useMoney();
    if (orders.length === 0) {
        return <p className="text-sm text-muted-foreground">No paid orders yet.</p>;
    }
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Placed</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Owed to seller</TableHead>
                        <TableHead>Payout</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {orders.map(order => (
                        <TableRow key={order.id}>
                            <TableCell className="font-mono">
                                {linkToOrders ? (
                                    <Link to={`/orders/${order.id}` as any} className="underline-offset-2 hover:underline">
                                        {order.code}
                                    </Link>
                                ) : (
                                    order.code
                                )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{date(order.orderPlacedAt)}</TableCell>
                            <TableCell>{order.state}</TableCell>
                            <TableCell className="text-right tabular-nums">
                                {money(order.totalWithTax, order.currencyCode)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {money(order.commissionAmount, order.currencyCode)}
                                {order.commissionPercent != null ? (
                                    <span className="ml-1 text-xs text-muted-foreground">({order.commissionPercent}%)</span>
                                ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                                {money(order.sellerPayoutAmount, order.currencyCode)}
                            </TableCell>
                            <TableCell>
                                <PayoutStatusBadge status={order.payoutStatus} />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export function MonthsTable({ months, currencyCode }: Readonly<{ months: SettlementMonth[]; currencyCode: string }>) {
    const { money } = useMoney();
    const max = Math.max(1, ...months.map(month => month.grossSales));
    const monthName = (key: string) =>
        new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="w-1/4">Sales</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Earned by seller</TableHead>
                        <TableHead className="text-right">Paid out</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {months.map(month => (
                        <TableRow key={month.month}>
                            <TableCell className="whitespace-nowrap">{monthName(month.month)}</TableCell>
                            <TableCell className="text-right tabular-nums">{month.orderCount}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    <div className="h-2 flex-1 rounded bg-muted">
                                        <div
                                            className="h-2 rounded bg-primary"
                                            style={{ width: `${Math.round((month.grossSales / max) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="w-24 text-right tabular-nums">{money(month.grossSales, currencyCode)}</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{money(month.commission, currencyCode)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(month.earned, currencyCode)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(month.paid, currencyCode)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

/** "1 order", "3 orders". */
export function count(n: number | null | undefined, noun: string): string {
    const value = n ?? 0;
    return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

export function errorMessage(err: unknown): string {
    const e = err as any;
    return String(e?.graphQLErrors?.[0]?.message ?? e?.response?.errors?.[0]?.message ?? e?.message ?? err);
}
