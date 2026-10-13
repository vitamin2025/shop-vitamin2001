import {
    api,
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    FullWidthPageBlock,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
    DetailList,
    errorMessage,
    MonthsTable,
    OrdersTable,
    PayoutField,
    payoutMethodFields,
    PayoutsTable,
    SellerPayoutMethod,
    SellerSettlement,
    settlementFields,
    count,
    StatCard,
    StatGrid,
    useMoney,
} from './shared';

const myPaymentsDocument = `
    query MyPayments {
        myPayments {
            ${settlementFields}
        }
    }
`;

const payoutMethodTypesDocument = `
    query PayoutMethodTypesForSeller {
        payoutMethodTypes {
            id
            code
            name
            description
            fields {
                key
                label
                required
                placeholder
            }
        }
    }
`;

const createMethodDocument = `
    mutation CreateMyPayoutMethod($input: SellerPayoutMethodInput!) {
        createMyPayoutMethod(input: $input) {
            ${payoutMethodFields}
        }
    }
`;

const updateMethodDocument = `
    mutation UpdateMyPayoutMethod($id: ID!, $input: SellerPayoutMethodInput!) {
        updateMyPayoutMethod(id: $id, input: $input) {
            ${payoutMethodFields}
        }
    }
`;

const deleteMethodDocument = `
    mutation DeleteMyPayoutMethod($id: ID!) {
        deleteMyPayoutMethod(id: $id)
    }
`;

interface MethodType {
    id: string;
    code: string;
    name: string;
    description: string | null;
    fields: PayoutField[];
}

/** A seller's Payments tab: what they have earned, what the marketplace has paid them, and where to pay them. */
export function SellerPaymentsPage() {
    const { money, date } = useMoney();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<SellerPayoutMethod | 'new' | null>(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ['myPayments'],
        queryFn: () => api.query(myPaymentsDocument) as Promise<{ myPayments: SellerSettlement }>,
        retry: false,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['myPayments'] });
    const payments = data?.myPayments;
    const summary = payments?.summary;
    const currency = summary?.currencyCode ?? 'INR';

    async function makePreferred(method: SellerPayoutMethod) {
        try {
            await api.mutate(updateMethodDocument, {
                id: method.id,
                input: {
                    typeId: method.type.id,
                    label: method.label,
                    isDefault: true,
                    details: method.details.map(detail => ({ key: detail.key, value: detail.value })),
                },
            });
            refresh();
        } catch (err) {
            toast.error(errorMessage(err));
        }
    }

    async function remove(method: SellerPayoutMethod) {
        if (!window.confirm(`Remove ${method.summary}?`)) {
            return;
        }
        try {
            await api.mutate(deleteMethodDocument, { id: method.id });
            toast.success('Payout method removed');
            refresh();
        } catch (err) {
            toast.error(errorMessage(err));
        }
    }

    if (error) {
        return (
            <Page pageId="seller-payments">
                <PageTitle>Payments</PageTitle>
                <PageLayout>
                    <FullWidthPageBlock blockId="seller-payments-error">
                        <p className="text-muted-foreground">{errorMessage(error)}</p>
                    </FullWidthPageBlock>
                </PageLayout>
            </Page>
        );
    }

    return (
        <Page pageId="seller-payments">
            <PageTitle>Payments</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button onClick={() => setEditing('new')}>Add payout method</Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="seller-payments-stats">
                    <StatGrid>
                        <StatCard
                            label="Pending payment"
                            value={isLoading ? '…' : money(summary?.pending, currency)}
                            hint={`${count(summary?.pendingOrderCount, 'order')} not yet paid out`}
                            tone={(summary?.pending ?? 0) > 0 ? 'warning' : 'success'}
                        />
                        <StatCard
                            label="Paid to you"
                            value={money(summary?.paid, currency)}
                            hint={summary?.lastPayoutAt ? `Last paid ${date(summary.lastPayoutAt)}` : 'No payments yet'}
                        />
                        <StatCard
                            label="Earned"
                            value={money(summary?.earned, currency)}
                            hint="Sales minus commission"
                        />
                        <StatCard
                            label="Sales"
                            value={money(summary?.grossSales, currency)}
                            hint={count(summary?.orderCount, 'order')}
                        />
                        <StatCard
                            label="Commission"
                            value={money(summary?.commission, currency)}
                            hint={`${summary?.commissionPercent ?? 0}% of items incl. GST`}
                        />
                    </StatGrid>
                </FullWidthPageBlock>
                <PageBlock column="main" blockId="seller-payments-payouts" title="Payments received">
                    <PayoutsTable payouts={(payments?.payouts ?? []).filter(payout => !payout.voided)} />
                </PageBlock>
                <PageBlock
                    column="side"
                    blockId="seller-payments-methods"
                    title="Your payout methods"
                    description="Where we send your money. We pay to your preferred method."
                >
                    {payments?.payoutMethods.length ? (
                        <div className="flex flex-col gap-4">
                            {payments.payoutMethods.map(method => (
                                <div key={method.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{method.name}</span>
                                        {method.label ? (
                                            <span className="text-sm text-muted-foreground">{method.label}</span>
                                        ) : null}
                                        {method.isDefault ? <Badge variant="secondary">Preferred</Badge> : null}
                                    </div>
                                    <DetailList details={method.details} stacked />
                                    <div className="flex gap-1 pt-1">
                                        <Button size="xs" variant="outline" onClick={() => setEditing(method)}>
                                            Edit
                                        </Button>
                                        {!method.isDefault ? (
                                            <Button size="xs" variant="outline" onClick={() => makePreferred(method)}>
                                                Make preferred
                                            </Button>
                                        ) : null}
                                        <Button size="xs" variant="ghost" onClick={() => remove(method)}>
                                            Remove
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-start gap-2">
                            <p className="text-sm text-muted-foreground">
                                Add a UPI ID or bank account so we can pay you.
                            </p>
                            <Button size="sm" onClick={() => setEditing('new')}>
                                Add payout method
                            </Button>
                        </div>
                    )}
                </PageBlock>
                <PageBlock column="main" blockId="seller-payments-months" title="Last 6 months">
                    {payments ? <MonthsTable months={payments.months} currencyCode={currency} /> : null}
                </PageBlock>
                <PageBlock column="main" blockId="seller-payments-orders" title="Orders">
                    <OrdersTable orders={payments?.recentOrders ?? []} linkToOrders />
                </PageBlock>
            </PageLayout>
            <PayoutMethodDialog
                method={editing === 'new' ? null : editing}
                open={editing !== null}
                onOpenChange={open => !open && setEditing(null)}
                onSaved={refresh}
            />
        </Page>
    );
}

function PayoutMethodDialog({
    method,
    open,
    onOpenChange,
    onSaved,
}: Readonly<{
    method: SellerPayoutMethod | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}>) {
    const { data } = useQuery({
        queryKey: ['payoutMethodTypes', 'enabled'],
        queryFn: () => api.query(payoutMethodTypesDocument) as Promise<{ payoutMethodTypes: MethodType[] }>,
        enabled: open,
    });
    const types = data?.payoutMethodTypes ?? [];
    const [typeId, setTypeId] = useState('');
    const [label, setLabel] = useState('');
    const [values, setValues] = useState<Record<string, string>>({});
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        setTypeId(method?.type.id ?? '');
        setLabel(method?.label ?? '');
        setValues(Object.fromEntries((method?.details ?? []).map(detail => [detail.key, detail.value])));
        setIsDefault(method?.isDefault ?? false);
    }, [open, method]);

    useEffect(() => {
        if (open && !typeId && types.length) {
            setTypeId(types[0].id);
        }
    }, [open, typeId, types]);

    // A method's own type may since have been turned off by staff; it can still be edited.
    const type = types.find(t => t.id === typeId) ?? (method && method.type.id === typeId ? method.type : undefined);
    const missing = (type?.fields ?? []).filter(field => field.required && !values[field.key]?.trim());

    async function save() {
        if (!type) {
            return;
        }
        const input = {
            typeId: type.id,
            label: label || null,
            isDefault,
            details: type.fields.map(field => ({ key: field.key, value: values[field.key] ?? '' })),
        };
        setSaving(true);
        try {
            if (method) {
                await api.mutate(updateMethodDocument, { id: method.id, input });
            } else {
                await api.mutate(createMethodDocument, { input });
            }
            toast.success('Payout method saved');
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{method ? 'Edit payout method' : 'Add payout method'}</DialogTitle>
                    <DialogDescription>Tell us where to send your payments.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                    <div className="grid gap-1.5">
                        <Label htmlFor="method-type">Method</Label>
                        <NativeSelect
                            id="method-type"
                            className="w-full"
                            value={typeId}
                            onChange={event => setTypeId(event.target.value)}
                        >
                            {method && !types.some(t => t.id === method.type.id) ? (
                                <NativeSelectOption value={method.type.id}>{method.type.name}</NativeSelectOption>
                            ) : null}
                            {types.map(t => (
                                <NativeSelectOption key={t.id} value={t.id}>
                                    {t.name}
                                </NativeSelectOption>
                            ))}
                        </NativeSelect>
                        {types.find(t => t.id === typeId)?.description ? (
                            <p className="text-sm text-muted-foreground">
                                {types.find(t => t.id === typeId)?.description}
                            </p>
                        ) : null}
                    </div>
                    {(type?.fields ?? []).map(field => (
                        <div key={field.key} className="grid gap-1.5">
                            <Label htmlFor={`method-${field.key}`}>
                                {field.label}
                                {field.required ? <span className="text-destructive"> *</span> : null}
                            </Label>
                            <Input
                                id={`method-${field.key}`}
                                placeholder={field.placeholder ?? ''}
                                value={values[field.key] ?? ''}
                                onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
                            />
                        </div>
                    ))}
                    <div className="grid gap-1.5">
                        <Label htmlFor="method-label">Nickname (optional)</Label>
                        <Input
                            id="method-label"
                            placeholder="E.g. HDFC current account"
                            value={label}
                            onChange={event => setLabel(event.target.value)}
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={isDefault}
                            onChange={event => setIsDefault(event.target.checked)}
                        />
                        Pay me here by default
                    </label>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={saving || !type || missing.length > 0}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
