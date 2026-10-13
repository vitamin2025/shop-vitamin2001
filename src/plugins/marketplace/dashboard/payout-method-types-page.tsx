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
    Link,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageLayout,
    PageTitle,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { errorMessage, PayoutField } from './shared';

const typeFields = `
    id
    code
    name
    description
    enabled
    sortOrder
    fields {
        key
        label
        required
        placeholder
    }
`;

const payoutMethodTypesDocument = `
    query PayoutMethodTypesForStaff {
        payoutMethodTypes(includeDisabled: true) {
            ${typeFields}
        }
    }
`;

const createTypeDocument = `
    mutation CreatePayoutMethodType($input: PayoutMethodTypeInput!) {
        createPayoutMethodType(input: $input) {
            ${typeFields}
        }
    }
`;

const updateTypeDocument = `
    mutation UpdatePayoutMethodType($id: ID!, $input: PayoutMethodTypeInput!) {
        updatePayoutMethodType(id: $id, input: $input) {
            ${typeFields}
        }
    }
`;

const deleteTypeDocument = `
    mutation DeletePayoutMethodType($id: ID!) {
        deletePayoutMethodType(id: $id)
    }
`;

interface PayoutMethodType {
    id: string;
    code: string;
    name: string;
    description: string | null;
    enabled: boolean;
    sortOrder: number;
    fields: PayoutField[];
}

/** Staff: the payout methods sellers can choose from, and the details each one asks for. */
export function PayoutMethodTypesPage() {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<PayoutMethodType | 'new' | null>(null);
    const { data, isLoading, error } = useQuery({
        queryKey: ['payoutMethodTypes', 'all'],
        queryFn: () => api.query(payoutMethodTypesDocument) as Promise<{ payoutMethodTypes: PayoutMethodType[] }>,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['payoutMethodTypes'] });

    async function remove(type: PayoutMethodType) {
        if (!window.confirm(`Delete the "${type.name}" payout method?`)) {
            return;
        }
        try {
            await api.mutate(deleteTypeDocument, { id: type.id });
            toast.success(`Deleted ${type.name}`);
            refresh();
        } catch (err) {
            toast.error(errorMessage(err));
        }
    }

    return (
        <Page pageId="payout-method-types">
            <PageTitle>Payout methods</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" render={<Link to={'/settlements' as any} />}>
                        Seller settlements
                    </Button>
                    <Button onClick={() => setEditing('new')}>Add payout method</Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="payout-method-types-list">
                    <p className="mb-3 text-sm text-muted-foreground">
                        Sellers choose one of these on their Payments page and fill in the details it asks for. You
                        then pick the seller's method when you record a payment to them.
                    </p>
                    {error ? <p className="text-destructive">{errorMessage(error)}</p> : null}
                    <div className="overflow-x-auto rounded-xl border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Method</TableHead>
                                    <TableHead>Details sellers fill in</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(data?.payoutMethodTypes ?? []).map(type => (
                                    <TableRow key={type.id}>
                                        <TableCell className="align-top">
                                            <div className="font-medium">{type.name}</div>
                                            {type.description ? (
                                                <div className="text-sm text-muted-foreground">{type.description}</div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <div className="flex flex-wrap gap-1">
                                                {type.fields.map(field => (
                                                    <Badge key={field.key} variant="outline">
                                                        {field.label}
                                                        {field.required ? ' *' : ''}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {type.enabled ? (
                                                <Badge variant="success">On offer</Badge>
                                            ) : (
                                                <Badge variant="secondary">Off</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right align-top">
                                            <div className="flex justify-end gap-1">
                                                <Button size="xs" variant="outline" onClick={() => setEditing(type)}>
                                                    Edit
                                                </Button>
                                                <Button size="xs" variant="ghost" onClick={() => remove(type)}>
                                                    Delete
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!isLoading && !data?.payoutMethodTypes.length ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                                            No payout methods yet.
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                            </TableBody>
                        </Table>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">* required</p>
                </FullWidthPageBlock>
            </PageLayout>
            <PayoutMethodTypeDialog
                type={editing === 'new' ? null : editing}
                open={editing !== null}
                onOpenChange={open => !open && setEditing(null)}
                onSaved={refresh}
            />
        </Page>
    );
}

function PayoutMethodTypeDialog({
    type,
    open,
    onOpenChange,
    onSaved,
}: Readonly<{
    type: PayoutMethodType | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}>) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [fields, setFields] = useState<PayoutField[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }
        setName(type?.name ?? '');
        setDescription(type?.description ?? '');
        setEnabled(type?.enabled ?? true);
        setFields(type?.fields ?? [{ key: '', label: '', required: true, placeholder: '' }]);
    }, [open, type]);

    const updateField = (index: number, patch: Partial<PayoutField>) =>
        setFields(current => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));

    async function save() {
        const input = {
            name,
            description: description || null,
            enabled,
            sortOrder: type?.sortOrder,
            fields: fields
                .filter(field => field.label.trim())
                .map(field => ({
                    key: field.key || null,
                    label: field.label,
                    required: field.required,
                    placeholder: field.placeholder || null,
                })),
        };
        setSaving(true);
        try {
            if (type) {
                await api.mutate(updateTypeDocument, { id: type.id, input });
            } else {
                await api.mutate(createTypeDocument, { input });
            }
            toast.success(`Saved ${name}`);
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
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{type ? `Edit ${type.name}` : 'Add payout method'}</DialogTitle>
                    <DialogDescription>Choose the details a seller must give to be paid this way.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="grid gap-1.5">
                            <Label htmlFor="type-name">Name</Label>
                            <Input
                                id="type-name"
                                placeholder="E.g. PayPal"
                                value={name}
                                onChange={event => setName(event.target.value)}
                            />
                        </div>
                        <label className="flex items-center gap-2 pb-2 text-sm">
                            <Switch checked={enabled} onCheckedChange={value => setEnabled(!!value)} />
                            Offer to sellers
                        </label>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="type-description">Note for sellers (optional)</Label>
                        <Textarea
                            id="type-description"
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Details sellers fill in</Label>
                        {fields.map((field, index) => (
                            <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                                <Input
                                    placeholder="Label, e.g. Account number"
                                    value={field.label}
                                    onChange={event => updateField(index, { label: event.target.value })}
                                />
                                <Input
                                    placeholder="Example (optional)"
                                    value={field.placeholder ?? ''}
                                    onChange={event => updateField(index, { placeholder: event.target.value })}
                                />
                                <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                                    <input
                                        type="checkbox"
                                        checked={field.required}
                                        onChange={event => updateField(index, { required: event.target.checked })}
                                    />
                                    Required
                                </label>
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setFields(current => current.filter((_, i) => i !== index))}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                        <div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                    setFields(current => [...current, { key: '', label: '', required: false, placeholder: '' }])
                                }
                            >
                                Add a detail
                            </Button>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={saving || !name.trim()}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
