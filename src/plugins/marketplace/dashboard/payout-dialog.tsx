import {
    api,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    Textarea,
    useLocalFormat,
} from '@vendure/dashboard';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DetailList, errorMessage, Payout, payoutFields, SellerSettlement, useMoney } from './shared';

const recordPayoutDocument = `
    mutation RecordSellerPayout($input: RecordSellerPayoutInput!) {
        recordSellerPayout(input: $input) {
            ${payoutFields}
        }
    }
`;

const updatePayoutDocument = `
    mutation UpdateSellerPayout($input: UpdateSellerPayoutInput!) {
        updateSellerPayout(input: $input) {
            ${payoutFields}
        }
    }
`;

const voidPayoutDocument = `
    mutation VoidSellerPayout($id: ID!, $reason: String!) {
        voidSellerPayout(id: $id, reason: $reason) {
            id
        }
    }
`;

const OTHER = '__other__';

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Records a payment to a seller, or edits one. Staff pick the seller's payout method,
 * which shows its account details to pay to, then add the transaction ID and details.
 */
export function PayoutDialog({
    open,
    onOpenChange,
    settlement,
    payout,
    onSaved,
}: Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settlement: SellerSettlement;
    /** The payment to edit. Without it, a new payment is recorded. */
    payout?: Payout | null;
    onSaved: () => void;
}>) {
    const { toMajorUnits, toMinorUnits } = useLocalFormat();
    const { money } = useMoney();
    const { summary, payoutMethods } = settlement;
    const currency = summary.currencyCode;
    const [amount, setAmount] = useState('');
    const [methodId, setMethodId] = useState('');
    const [manualMethodName, setManualMethodName] = useState('');
    const [paidAt, setPaidAt] = useState(today());
    const [transactionId, setTransactionId] = useState('');
    const [transactionDetails, setTransactionDetails] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        if (payout) {
            setAmount(String(toMajorUnits(payout.amount)));
            setMethodId(payout.payoutMethodId ?? OTHER);
            setManualMethodName(payout.payoutMethodId ? '' : payout.methodName);
            setPaidAt(payout.paidAt.slice(0, 10));
            setTransactionId(payout.transactionId ?? '');
            setTransactionDetails(payout.transactionDetails ?? '');
        } else {
            setAmount(summary.pending > 0 ? String(toMajorUnits(summary.pending)) : '');
            const preferred = payoutMethods.find(method => method.isDefault) ?? payoutMethods[0];
            setMethodId(preferred?.id ?? OTHER);
            setManualMethodName('');
            setPaidAt(today());
            setTransactionId('');
            setTransactionDetails('');
        }
    }, [open, payout]);

    const selected = payoutMethods.find(method => method.id === methodId);
    const minorAmount = toMinorUnits(Number(amount) || 0);
    const maxAmount = summary.pending + (payout?.amount ?? 0);

    async function save() {
        if (!(minorAmount > 0)) {
            toast.error('Enter the amount paid.');
            return;
        }
        if (!transactionId.trim()) {
            toast.error('Enter the transaction ID (UTR, reference or cheque number).');
            return;
        }
        if (methodId === OTHER && !manualMethodName.trim()) {
            toast.error('Say how the seller was paid.');
            return;
        }
        const common = {
            amount: minorAmount,
            paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
            payoutMethodId: methodId === OTHER ? null : methodId,
            manualMethodName: methodId === OTHER ? manualMethodName.trim() : null,
            transactionId: transactionId.trim(),
            transactionDetails: transactionDetails.trim() || null,
        };
        setSaving(true);
        try {
            if (payout) {
                await api.mutate(updatePayoutDocument, { input: { id: payout.id, ...common } });
                toast.success('Payment updated');
            } else {
                await api.mutate(recordPayoutDocument, { input: { sellerId: summary.sellerId, ...common } });
                toast.success(`Recorded ${money(minorAmount, currency)} paid to ${summary.sellerName}`);
            }
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
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{payout ? 'Edit payment' : `Pay ${summary.sellerName}`}</DialogTitle>
                    <DialogDescription>
                        {payout
                            ? 'Correct the details of this payment.'
                            : `Record a payment you have made. ${money(summary.pending, currency)} is pending.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                    <div className="grid gap-1.5">
                        <Label htmlFor="payout-amount">Amount paid ({currency})</Label>
                        <Input
                            id="payout-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={amount}
                            onChange={event => setAmount(event.target.value)}
                        />
                        {!payout ? (
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    onClick={() => setAmount(String(toMajorUnits(summary.pending)))}
                                >
                                    All pending · {money(summary.pending, currency)}
                                </Button>
                                {summary.readyToSettle > 0 && summary.readyToSettle !== summary.pending ? (
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => setAmount(String(toMajorUnits(summary.readyToSettle)))}
                                    >
                                        Delivered orders · {money(summary.readyToSettle, currency)}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                        {minorAmount > maxAmount ? (
                            <p className="text-sm text-destructive">
                                That is more than the {money(maxAmount, currency)} this seller is owed.
                            </p>
                        ) : null}
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="payout-method">Paid to</Label>
                        <NativeSelect
                            id="payout-method"
                            className="w-full"
                            value={methodId}
                            onChange={event => setMethodId(event.target.value)}
                        >
                            {payoutMethods.map(method => (
                                <NativeSelectOption key={method.id} value={method.id}>
                                    {method.summary}
                                    {method.label ? ` (${method.label})` : ''}
                                    {method.isDefault ? ' · preferred' : ''}
                                </NativeSelectOption>
                            ))}
                            <NativeSelectOption value={OTHER}>Another way (not listed)</NativeSelectOption>
                        </NativeSelect>
                        {payoutMethods.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                This seller hasn't added a payout method yet. They can add one on their Payments page.
                            </p>
                        ) : null}
                        {selected ? (
                            <div className="rounded-md border bg-muted/40 p-3">
                                <DetailList details={selected.details} />
                            </div>
                        ) : (
                            <Input
                                placeholder="How you paid, e.g. Cheque or Cash"
                                value={manualMethodName}
                                onChange={event => setManualMethodName(event.target.value)}
                            />
                        )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                            <Label htmlFor="payout-date">Date paid</Label>
                            <Input
                                id="payout-date"
                                type="date"
                                max={today()}
                                value={paidAt}
                                onChange={event => setPaidAt(event.target.value)}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="payout-txn">Transaction ID</Label>
                            <Input
                                id="payout-txn"
                                placeholder="UTR or reference number"
                                value={transactionId}
                                onChange={event => setTransactionId(event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="payout-details">Transaction details</Label>
                        <Textarea
                            id="payout-details"
                            placeholder="E.g. paid from the ICICI current account, covers orders up to 30 Sept"
                            value={transactionDetails}
                            onChange={event => setTransactionDetails(event.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={saving || minorAmount > maxAmount}>
                        {payout ? 'Save changes' : 'Record payment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function VoidPayoutDialog({
    payout,
    onOpenChange,
    onSaved,
}: Readonly<{ payout: Payout | null; onOpenChange: (open: boolean) => void; onSaved: () => void }>) {
    const { money } = useMoney();
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => setReason(''), [payout]);

    async function save() {
        if (!payout) {
            return;
        }
        setSaving(true);
        try {
            await api.mutate(voidPayoutDocument, { id: payout.id, reason });
            toast.success('Payment voided');
            onOpenChange(false);
            onSaved();
        } catch (err) {
            toast.error(errorMessage(err));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open={!!payout} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Void this payment?</DialogTitle>
                    <DialogDescription>
                        {payout ? money(payout.amount, payout.currencyCode) : ''} goes back into what the seller is
                        owed. The record stays, marked voided.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-1.5">
                    <Label htmlFor="void-reason">Reason</Label>
                    <Input
                        id="void-reason"
                        placeholder="E.g. entered twice, transfer bounced"
                        value={reason}
                        onChange={event => setReason(event.target.value)}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={save} disabled={saving || !reason.trim()}>
                        Void payment
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
