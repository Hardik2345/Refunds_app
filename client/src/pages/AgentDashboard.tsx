import { useMemo, useState } from 'react';
import { Page, Layout, Card, Text, Tabs, TextField, InlineStack, Badge, Button, IndexTable, Modal, Box, Divider, Checkbox, InlineGrid, ButtonGroup, Select } from '@shopify/polaris';
import { FilterIcon } from '@shopify/polaris-icons';
import api from '../apiClient';


interface OrderLineItem { id: number; name: string; quantity: number; price: string; }
interface OrderSummary { id: number; name: string; created_at: string; current_subtotal_price: string; financial_status: string; fulfillment_status: string; line_items: OrderLineItem[]; customer: { id: number; first_name: string; last_name: string; email: string; phone: string } | null }
interface GetOrdersResponse { orders: OrderSummary[]; nextPageInfo?: string | null }

interface RuleDecision { outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL'; reason?: string; matched?: string[]; rulesVersion?: number; ruleSetId?: string | null }
interface PreviewResult { orderId: number | null; decision: RuleDecision | null; requiresApproval: boolean | null; ctxHints?: { orderId?: number | null; rulesVersion?: number; ruleSetId?: string | null; attemptsToday?: number | null; daysSinceDelivery?: number | null; totalCredits?: number | null; totalSpentCredits?: number | null } | null; error?: string | null }

export default function AgentDashboard() {
	const [searchMode, setSearchMode] = useState<'phone'|'orderName'>('phone');
	const [query, setQuery] = useState('');
	const [orders, setOrders] = useState<OrderSummary[] | null>(null);
	const [preview, setPreview] = useState<Record<string, PreviewResult>>({});
	const [loading, setLoading] = useState(false);
	const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success'|'error'|'info' } | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Tabs: 0 = Orders, 1 = Cashback
	const [tab, setTab] = useState(0);
	const [cashbackSummary, setCashbackSummary] = useState<{ totalCredits: number | null; totalSpentCredits: number | null } | null>(null);
	// Partial refund dialog state
	const [partialDlg, setPartialDlg] = useState<{ open: boolean; order: OrderSummary | null }>({ open: false, order: null });
	// Selection state per orderId -> per lineItemId -> { selected, quantity, amount }
	const [selections, setSelections] = useState<Record<number, Record<number, { selected: boolean; quantity: number; amount: string }>>>({});
	// Optional: a separate preview result for current selection per order
	const [selectionPreview, setSelectionPreview] = useState<Record<number, PreviewResult>>({});
	// Confirmation dialog state
	const [confirm, setConfirm] = useState<{
		open: boolean;
		type: 'full' | 'partial' | null;
		orderId: number | null;
		amountLabel: string;
		customerName: string;
		note?: string;
	}>({ open: false, type: null, orderId: null, amountLabel: '', customerName: '', note: '' });
	// Confirm action loading state
	const [confirmLoading, setConfirmLoading] = useState(false);
	// Result dialog state (blocks until Continue)
	const [resultDlg, setResultDlg] = useState<{ open: boolean; status: 'success'|'failure'|'pending'; message: string } | null>(null);
	// Track the last successfully refunded order to apply an optimistic UI update on Continue
	const [lastRefundedOrderId, setLastRefundedOrderId] = useState<number | null>(null);

	const merged = useMemo(() => {
		if (!orders) return [] as Array<{ order: OrderSummary; preview?: PreviewResult }>;
		return orders.map(o => ({ order: o, preview: preview[String(o.id)] }));
	}, [orders, preview]);

	function badgeToneFor(decision?: RuleDecision | null): 'info' | 'success' | 'warning' | 'critical' | undefined {
		if (!decision) return undefined;
		if (decision.outcome === 'DENY') return 'critical';
		if (decision.outcome === 'REQUIRE_APPROVAL') return 'warning';
		if (decision.outcome === 'ALLOW') return 'success';
		return undefined;
	}




	async function onSearch(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSnack(null);
		setLoading(true);
		setOrders(null);
		setPreview({});
		setSelectionPreview({});
		setSelections({});
		try {
			const params = searchMode === 'phone' ? { phone: query } : { orderName: query };
			const res = await api.get<GetOrdersResponse>('/orders', { params });
			const found = res.data.orders || [];
			setOrders(found);
			if (found.length) {
				const items = found.map(o => ({ orderId: o.id }));
				const body = searchMode === 'phone' ? { phone: query, items } : { items };
				const p = await api.post<{ results: PreviewResult[] }>('/refund/preview/bulk', body);
					const byId: Record<string, PreviewResult> = {};
					let summary: { totalCredits: number | null; totalSpentCredits: number | null } | null = null;
				for (const r of p.data.results) {
					if (r && r.orderId != null) byId[String(r.orderId)] = r;
						// Capture global cashback from first result that has it
						const tc = r?.ctxHints?.totalCredits;
						const ts = r?.ctxHints?.totalSpentCredits;
						if (!summary && (tc != null || ts != null)) {
							summary = { totalCredits: tc ?? null, totalSpentCredits: ts ?? null };
						}
				}
				setPreview(byId);
					setCashbackSummary(summary);
			}
		} catch (err: any) {
			setError(err?.response?.data?.error || 'Failed to fetch orders');
		} finally {
			setLoading(false);
		}
	}

	function refundEnabled(r?: PreviewResult) {
		if (!r || !r.decision) return false;
		if (r.decision.outcome === 'ALLOW') return true;
		if (r.decision.outcome === 'REQUIRE_APPROVAL') return r.requiresApproval === false;
		return false;
	}

	async function onRefund(orderId: number) {
		try {
			const payloadBase = searchMode === 'phone' ? { phone: query, orderId } : { orderId };
			const payload = { ...payloadBase, note: confirm.note || undefined };
			const res = await api.post('/refund', payload);
			if (res.status === 200) {
				setResultDlg({ open: true, status: 'success', message: 'Refund executed successfully' });
				setLastRefundedOrderId(orderId);
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				setResultDlg({ open: true, status: 'pending', message: `Approval required. PendingId: ${pendingId}` });
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Refund failed';
			setResultDlg({ open: true, status: 'failure', message: msg });
		}
	}

	function openPartialDialog(order: OrderSummary) {
		setPartialDlg({ open: true, order });
	}

	function closePartialDialog() {
		setPartialDlg({ open: false, order: null });
	}

	function unitPrice(li: OrderLineItem) {
		const n = parseFloat(li.price);
		return Number.isFinite(n) ? n : 0;
	}

	function onToggleLine(orderId: number, li: OrderLineItem, checked: boolean) {
		setSelections(prev => {
			const perOrder = { ...(prev[orderId] || {}) };
			if (!checked) {
				delete perOrder[li.id];
				return { ...prev, [orderId]: perOrder };
			}
			const defaultQty = Math.min(1, li.quantity) || 1;
			const amount = (defaultQty * unitPrice(li)).toFixed(2);
			perOrder[li.id] = { selected: true, quantity: defaultQty, amount };
			return { ...prev, [orderId]: perOrder };
		});
	}

	function onChangeQty(orderId: number, li: OrderLineItem, qty: number) {
		setSelections(prev => {
			const perOrder = { ...(prev[orderId] || {}) };
			const entry = perOrder[li.id];
			if (!entry) return prev;
			const bounded = Math.max(1, Math.min(li.quantity, Math.floor(qty || 0)));
			const newAmount = (bounded * unitPrice(li)).toFixed(2);
			perOrder[li.id] = { ...entry, quantity: bounded, amount: newAmount };
			return { ...prev, [orderId]: perOrder };
		});
	}

	function onChangeAmount(orderId: number, li: OrderLineItem, amountStr: string) {
		setSelections(prev => {
			const perOrder = { ...(prev[orderId] || {}) };
			const entry = perOrder[li.id];
			if (!entry) return prev;
			// sanitize to 2 decimals, keep as string for input UX
			perOrder[li.id] = { ...entry, amount: amountStr };
			return { ...prev, [orderId]: perOrder };
		});
	}

	function buildPartialPayload(orderId: number) {
		const perOrder = selections[orderId] || {};
		const items = Object.entries(perOrder)
			.filter(([, v]) => v.selected)
			.map(([lineItemIdStr, v]) => {
				const lineItemId = Number(lineItemIdStr);
				const amountNum = Number.parseFloat(v.amount);
				return {
					lineItemId,
					quantity: v.quantity,
					// Only include amount if it's a valid number
					...(Number.isFinite(amountNum) ? { amount: Number(amountNum.toFixed(2)) } : {})
				};
			});
		const base = searchMode === 'phone' ? { phone: query } : {};
		return { ...base, orderId, lineItems: items } as const;
	}

	function partialRefundEnabled(orderId: number) {
		const r = selectionPreview[orderId];
		if (!r || !r.decision) return true; // allow submission if not previewed yet
		if (r.decision.outcome === 'ALLOW') return true;
		if (r.decision.outcome === 'REQUIRE_APPROVAL') return r.requiresApproval === false;
		return false;
	}

	function customerNameFor(order: OrderSummary) {
		const c = order.customer;
		if (!c) return 'Unknown customer';
		const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
		return name || c.email || c.phone || 'Unknown customer';
	}

	function openConfirmFull(order: OrderSummary) {
		const amountLabel = order.current_subtotal_price ? `₹${Number(parseFloat(order.current_subtotal_price)).toFixed(2)}` : 'N/A';
		setConfirm(prev => ({ ...prev, open: true, type: 'full', orderId: order.id, amountLabel, customerName: customerNameFor(order), note: prev.note ?? '' }));
	}

	function computePartialTotal(orderId: number) {
		const perOrder = selections[orderId] || {};
		let total = 0;
		for (const v of Object.values(perOrder)) {
			if (!v.selected) continue;
			const amt = Number.parseFloat(v.amount);
			if (Number.isFinite(amt)) total += amt;
		}
		return total;
	}

	function openConfirmPartial(order: OrderSummary) {
		const total = computePartialTotal(order.id);
		if (!Number.isFinite(total) || total <= 0) {
			setSnack({ open: true, message: 'Select at least one line item with a valid amount', severity: 'error' });
			return;
		}
		const amountLabel = `₹${total.toFixed(2)}`;
		setConfirm(prev => ({ ...prev, open: true, type: 'partial', orderId: order.id, amountLabel, customerName: customerNameFor(order), note: prev.note ?? '' }));
	}

	async function onConfirmProceed() {
		const orderId = confirm.orderId!;
			try {
				setConfirmLoading(true);
				if (confirm.type === 'full') {
					await onRefund(orderId);
				} else if (confirm.type === 'partial') {
					await onPartialRefund(orderId);
				}
			} finally {
				setConfirmLoading(false);
				setConfirm({ open: false, type: null, orderId: null, amountLabel: '', customerName: '' });
			}
	}

	function onConfirmCancel() {
		setConfirm({ open: false, type: null, orderId: null, amountLabel: '', customerName: '' });
	}

	// Removed preview selection flow per UX update

	async function onPartialRefund(orderId: number) {
		try {
			const payload = { ...buildPartialPayload(orderId), note: confirm.note || undefined } as any;
			if (!payload.lineItems.length) {
				setSnack({ open: true, message: 'Select at least one line item', severity: 'error' });
				return;
			}
			const res = await api.post('/refund', payload);
			if (res.status === 200) {
				setResultDlg({ open: true, status: 'success', message: 'Partial refund executed successfully' });
				setLastRefundedOrderId(orderId);
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				setResultDlg({ open: true, status: 'pending', message: `Approval required. PendingId: ${pendingId}` });
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Partial refund failed';
			setResultDlg({ open: true, status: 'failure', message: msg });
		}
	}

	function applyOptimisticRefundUpdate(orderId: number) {
		setPreview(prev => {
			const key = String(orderId);
			const existing = prev[key];
			const updatedDecision: RuleDecision = {
				outcome: 'DENY',
				reason: 'Refund executed',
				matched: existing?.decision?.matched,
				rulesVersion: existing?.decision?.rulesVersion,
				ruleSetId: existing?.decision?.ruleSetId,
			};
			const updated: PreviewResult = existing
				? { ...existing, decision: updatedDecision, requiresApproval: false }
				: { orderId, decision: updatedDecision, requiresApproval: false, ctxHints: null } as PreviewResult;
			return { ...prev, [key]: updated };
		});
		// Clear any selection state for this order in case of partial flow
		setSelections(prev => ({ ...prev, [orderId]: {} }));
		setSelectionPreview(prev => ({ ...prev, [orderId]: {} as any }));
	}

  const tabs = [
    { id: 'orders-0', content: 'Orders', accessibilityLabel: 'Orders' },
    { id: 'cashback-1', content: 'Cashback', accessibilityLabel: 'Cashback' }
  ];

  const resourceName = { singular: 'order', plural: 'orders' };

  const rowMarkup = merged.map(({ order, preview: p }, index) => {
    const customer = order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown';
    const phone = order.customer?.phone || 'N/A';
    const createdStr = new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    const amount = order.current_subtotal_price ? `₹${parseFloat(order.current_subtotal_price).toLocaleString()}` : 'N/A';
    const statusOutcome = p?.decision?.outcome || 'Pending';
    const reason = p?.decision?.reason || 'Loading hints...';

    return (
      <IndexTable.Row id={order.id.toString()} key={order.id} position={index}>
        <IndexTable.Cell><Checkbox label="" checked={false} onChange={() => {}} /></IndexTable.Cell>
        <IndexTable.Cell><Text as="span" fontWeight="semibold">{order.name}</Text></IndexTable.Cell>
        <IndexTable.Cell>{createdStr}</IndexTable.Cell>
        <IndexTable.Cell>{customer}</IndexTable.Cell>
        <IndexTable.Cell>{phone}</IndexTable.Cell>
        <IndexTable.Cell>{amount}</IndexTable.Cell>

        <IndexTable.Cell>
          <Badge tone={badgeToneFor(p?.decision)}>{statusOutcome}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">{reason}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <ButtonGroup>
            <Button size="slim" onClick={() => openConfirmFull(order)} disabled={!refundEnabled(p)}>Process Refund</Button>
            <Button size="slim" variant="secondary" onClick={() => openPartialDialog(order)}>Partial Refund</Button>
          </ButtonGroup>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const rowMarkupCashback = merged.map(({ order, preview: p }, index) => {
    const customer = order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown';
    const phone = order.customer?.phone || 'N/A';
    const createdStr = new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    const totalCashback = p?.ctxHints?.totalCredits != null ? `₹${parseFloat(String(p.ctxHints.totalCredits)).toLocaleString()}` : '₹0.00';
    const totalSpent = p?.ctxHints?.totalSpentCredits != null ? `₹${parseFloat(String(p.ctxHints.totalSpentCredits)).toLocaleString()}` : '₹0.00';
    const balance = (p?.ctxHints?.totalCredits != null && p?.ctxHints?.totalSpentCredits != null) 
                      ? `₹${parseFloat(String(p.ctxHints.totalCredits - p.ctxHints.totalSpentCredits)).toLocaleString()}` 
                      : '₹0.00';

    return (
      <IndexTable.Row id={`cashback-${order.id}`} key={order.id} position={index}>
        <IndexTable.Cell><Checkbox label="" checked={false} onChange={() => {}} /></IndexTable.Cell>
        <IndexTable.Cell><Text as="span" fontWeight="semibold">{order.name}</Text></IndexTable.Cell>
        <IndexTable.Cell>{createdStr}</IndexTable.Cell>
        <IndexTable.Cell>{customer}</IndexTable.Cell>
        <IndexTable.Cell>{phone}</IndexTable.Cell>
        <IndexTable.Cell>{totalCashback}</IndexTable.Cell>
        <IndexTable.Cell>{totalSpent}</IndexTable.Cell>
        <IndexTable.Cell>{balance}</IndexTable.Cell>
      </IndexTable.Row>
    );
  });


  return (
    <Page title="Refunds" fullWidth>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted />
            
            <Box padding="400">
              {error && <Text as="p" tone="critical">{error}</Text>}
              
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Search query"
                    labelHidden
                    placeholder={searchMode === 'phone' ? 'Enter customer contact number to load recent orders and preview refund eligibility' : 'Enter Order Name (#1234)'}
                    value={query}
                    onChange={setQuery}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setQuery('')}
                    connectedLeft={
                      <Select
                        label="Search type"
                        labelHidden
                        options={[
                          {label: 'Contact Number', value: 'phone'},
                          {label: 'Order ID', value: 'orderName'}
                        ]}
                        value={searchMode}
                        onChange={(v) => setSearchMode(v as 'phone'|'orderName')}
                      />
                    }
                  />
                </div>
                <Button onClick={() => onSearch({ preventDefault: () => {} } as any)} disabled={loading || !query.trim()}>
                  {loading ? 'Searching...' : 'Search'}
                </Button>
                <Button icon={FilterIcon} onClick={() => {}} disabled />
              </InlineStack>

              <Box paddingBlockStart="400">
                {orders && orders.length === 0 && !loading && (
                   <Text as="p" tone="subdued">No orders found.</Text>
                )}

                {tab === 0 && orders && orders.length > 0 && (
                  <IndexTable
                    resourceName={resourceName}
                    itemCount={orders.length}
                    headings={[
                      { title: '' },
                      { title: 'Order ID' },
                      { title: 'Created On' },
                      { title: 'Customer' },
                      { title: 'Contact No.' },
                      { title: 'Amount' },
                      { title: 'Status' },
                      { title: 'Reason' },
                      { title: 'Actions' },
                    ]}
                    selectable={false}
                  >
                    {rowMarkup}
                  </IndexTable>
                )}

                {tab === 1 && orders && orders.length > 0 && (
                  <IndexTable
                    resourceName={{ singular: 'cashback', plural: 'cashbacks' }}
                    itemCount={orders.length}
                    headings={[
                      { title: '' },
                      { title: 'Order ID' },
                      { title: 'Created On' },
                      { title: 'Customer' },
                      { title: 'Contact No.' },
                      { title: 'Total Cashback' },
                      { title: 'Total Spent' },
                      { title: 'Balance Amount' }
                    ]}
                    selectable={false}
                  >
                    {rowMarkupCashback}
                  </IndexTable>
                )}

              </Box>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Dialogs mapping */}
      <Modal
        open={confirm.open}
        onClose={onConfirmCancel}
        title="Confirm refund"
        primaryAction={{
          content: 'Confirm',
          onAction: onConfirmProceed,
          loading: confirmLoading,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: onConfirmCancel }]}
      >
        <Modal.Section>
          <Text as="p">Are you sure you want to refund this order?</Text>
          <Box paddingBlockStart="200">
            <Text as="p" tone="subdued">Customer: {confirm.customerName}</Text>
            <Text as="p" tone="subdued">Amount: {confirm.amountLabel}</Text>
          </Box>
        </Modal.Section>
      </Modal>

      <Modal
         open={partialDlg.open}
         onClose={closePartialDialog}
         title={`Partial refund${partialDlg.order ? ` • ${partialDlg.order.name}` : ''}`}
         primaryAction={{
           content: 'Continue',
           onAction: () => { openConfirmPartial(partialDlg.order!); closePartialDialog(); }
         }}
         secondaryActions={[{ content: 'Cancel', onAction: closePartialDialog }]}
      >
         <Modal.Section>
           <Text as="p">Select line items to refund:</Text>
           <Box paddingBlockStart="200">
             {partialDlg.order?.line_items.map((li) => {
               const entry = (selections[partialDlg.order!.id] || {})[li.id];
               const selected = !!entry?.selected;
               const defaultQty = 1;
               const defaultAmount = (defaultQty * unitPrice(li)).toFixed(2);
               return (
                 <Box key={li.id} padding="200" borderBlockEndWidth="100" borderColor="border">
                   <InlineStack gap="300" align="space-between" blockAlign="center">
                     <div style={{ flex: 1 }}>
                       <Checkbox label={li.name} checked={selected} onChange={(checked) => onToggleLine(partialDlg.order!.id, li, checked)} />
                       <Text as="p" tone="subdued" variant="bodySm">Available: {li.quantity}</Text>
                     </div>
                     <InlineStack gap="200" align="end">
                       <Box maxWidth="80px">
                         <TextField
                           label="Qty"
                           labelHidden
                           type="number"
                           value={String(entry?.quantity ?? 1)}
                           onChange={(v) => onChangeQty(partialDlg.order!.id, li, Number(v))}
                           disabled={!selected}
                           autoComplete="off"
                         />
                       </Box>
                       <Box maxWidth="120px">
                         <TextField
                           label="Amount"
                           labelHidden
                           type="number"
                           value={entry?.amount ?? defaultAmount}
                           onChange={(v) => onChangeAmount(partialDlg.order!.id, li, v)}
                           disabled={!selected}
                           autoComplete="off"
                         />
                       </Box>
                     </InlineStack>
                   </InlineStack>
                 </Box>
               );
             })}

           </Box>
         </Modal.Section>
      </Modal>
    </Page>

	);
}

