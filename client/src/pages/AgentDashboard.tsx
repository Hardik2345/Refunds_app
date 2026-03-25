import { useMemo, useState } from 'react';
import { Page, Layout, Card, Text, TextField, InlineStack, Badge, Button, IndexTable, Modal, Box, Checkbox, BlockStack } from '@shopify/polaris';
import { CustomSelect } from '../components/CustomSelect';
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
	const [error, setError] = useState<string | null>(null);
	// Tabs: 0 = Orders, 1 = Cashback
	const [tab, setTab] = useState(0);
	// Partial refund dialog state
	const [partialDlg, setPartialDlg] = useState<{ open: boolean; order: OrderSummary | null }>({ open: false, order: null });
	// Selection state per orderId -> per lineItemId -> { selected, quantity, amount }
	const [selections, setSelections] = useState<Record<number, Record<number, { selected: boolean; quantity: number; amount: string }>>>({});
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

	const merged = useMemo(() => {
		if (!orders) return [] as Array<{ order: OrderSummary; preview?: PreviewResult }>;
		return orders.map(o => ({ order: o, preview: preview[String(o.id)] }));
	}, [orders, preview]);




	async function onSearch(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		setOrders(null);
		setPreview({});
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
				for (const r of p.data.results) {
					if (r && r.orderId != null) byId[String(r.orderId)] = r;
				}
				setPreview(byId);
			}
		} catch (err: any) {
			setError(err?.response?.data?.error || 'Failed to fetch orders');
		} finally {
			setLoading(false);
		}
	}

	function refundEnabled(p?: PreviewResult) {
		if (!p || !p.decision) return true; // fallback
		if (p.decision.outcome === 'ALLOW' || p.decision.outcome === 'REQUIRE_APPROVAL') return true;
		return false;
	}

	async function onRefund(orderId: number) {
		try {
			const payloadBase = searchMode === 'phone' ? { phone: query, orderId } : { orderId };
			const payload = { ...payloadBase, note: confirm.note || undefined };
			const res = await api.post('/refund', payload);
			if (res.status === 200) {
				alert('Refund executed successfully');
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				alert(`Approval required. PendingId: ${pendingId}`);
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Refund failed';
			alert(msg);
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
			alert('Select at least one line item with a valid amount');
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
				alert('Select at least one line item');
				return;
			}
			const res = await api.post('/refund', payload);
			if (res.status === 200) {
				alert('Partial refund executed successfully');
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				alert(`Approval required. PendingId: ${pendingId}`);
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Partial refund failed';
			alert(msg);
		}
	}

    // Function removed as it was unused

  const resourceName = { singular: 'order', plural: 'orders' };

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
            {/* Custom Pill-style Tabs */}
            <Box padding="400" borderBlockEndWidth="100" borderColor="border">
              <InlineStack gap="400">
                <button
                  onClick={() => setTab(0)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: tab === 0 ? 'var(--p-color-bg-surface-secondary)' : 'transparent',
                    color: 'var(--p-color-text)',
                    fontWeight: tab === 0 ? 'bold' : 'normal',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Orders
                </button>
                <button
                  onClick={() => setTab(1)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: tab === 1 ? 'var(--p-color-bg-surface-secondary)' : 'transparent',
                    color: 'var(--p-color-text)',
                    fontWeight: tab === 1 ? 'bold' : 'normal',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Cashback
                </button>
              </InlineStack>
            </Box>
            
            <Box padding="400">
              {error && <Box paddingBlockEnd="400"><Text as="p" tone="critical">{error}</Text></Box>}
              
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <div style={{ flex: 1 }}>
                  <InlineStack gap="200" wrap={false} blockAlign="center">
                    <div style={{ width: '200px' }}>
                      <CustomSelect
                        options={[
                          {label: 'Contact Number', value: 'phone'},
                          {label: 'Order ID', value: 'orderName'}
                        ]}
                        value={searchMode}
                        onChange={(v) => setSearchMode(v as 'phone'|'orderName')}
                        fullWidth={true}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Search for Customer Details"
                        labelHidden
                        placeholder="Search Orders... (Phone, Order ID)"
                        autoComplete="off"
                        value={query}
                        onChange={setQuery}
                        clearButton
                        onClearButtonClick={() => setQuery('')}
                      />
                    </div>
                  </InlineStack>
                </div>
                <Button onClick={() => onSearch({ preventDefault: () => {} } as any)} disabled={loading || !query.trim()}>
                  {loading ? 'Searching...' : 'Search'}
                </Button>
                <Button icon={FilterIcon} onClick={() => {}} />
              </InlineStack>

              <Box paddingBlockStart="400">
                {orders && orders.length === 0 && !loading && (
                   <Text as="p" tone="subdued">No orders found.</Text>
                )}

                {tab === 0 && orders && orders.length > 0 && (
                  <div className="custom-table-header">
                    <style>{`
                      .custom-table-header .Polaris-IndexTable-IndexTableHead {
                        background-color: var(--p-color-bg-surface-secondary);
                      }
                      .custom-table-header .Polaris-IndexTable__HeaderCell {
                        background-color: transparent !important;
                        border-bottom: 1px solid var(--p-color-border-subdued);
                      }
                    `}</style>
                    <IndexTable
                      resourceName={resourceName}
                      itemCount={orders.length}
                      headings={[
                        { title: '' },
                        { title: 'Order ID' },
                        { title: 'Created On' },
                        { title: 'Customer' },
                        { title: 'Contact No.' },
                        { title: 'Refund Amount' },
                        { title: 'Refund Status' },
                        { title: 'Reason' },
                        { title: '' },
                      ]}
                      selectable={false}
                    >
                      {merged.map(({ order, preview: p }, index) => {
                        const customer = order.customer ? `${order.customer.first_name}` : 'Unknown';
                        const phone = order.customer?.phone || 'N/A';
                        
                        const dateObj = new Date(order.created_at);
                        const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
                        const timeStr = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        
                        const amount = order.current_subtotal_price ? `₹${parseFloat(order.current_subtotal_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A';
                        const statusOutcome = p?.decision?.outcome || 'Pending';
                        const reason = p?.decision?.reason || 'Loading hints...';
                        
                        // Mapping target mockup status badges
                        let badges = [];
                        if (statusOutcome === 'DENY') {
                          badges.push(<Badge tone="critical">Rejected</Badge>);
                          badges.push(<Badge tone="warning">Unfulfilled</Badge>);
                        } else if (statusOutcome === 'ALLOW') {
                          badges.push(<Badge tone="success">Processed</Badge>);
                        } else if (statusOutcome === 'REQUIRE_APPROVAL') {
                           badges.push(<Badge tone="info">Fullfillable</Badge>);
                        }

                        return (
                          <IndexTable.Row id={order.id.toString()} key={order.id} position={index}>
                            <IndexTable.Cell><Checkbox label="" checked={false} onChange={() => {}} /></IndexTable.Cell>
                            <IndexTable.Cell><Text as="span" fontWeight="bold">#{order.name}</Text></IndexTable.Cell>
                            <IndexTable.Cell>
                              <BlockStack gap="050">
                                <Text as="span" variant="bodySm">{dateStr}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{timeStr}</Text>
                              </BlockStack>
                            </IndexTable.Cell>
                            <IndexTable.Cell>{customer}</IndexTable.Cell>
                            <IndexTable.Cell>{phone}</IndexTable.Cell>
                            <IndexTable.Cell><Text as="span" fontWeight="semibold">{amount}</Text></IndexTable.Cell>
                            <IndexTable.Cell>
                              <InlineStack gap="100">{badges}</InlineStack>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Box maxWidth="200px">
                                <Text as="span" tone="subdued" variant="bodySm">{reason}</Text>
                              </Box>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <InlineStack gap="200" align="end">
                                <Button size="slim" onClick={() => openConfirmFull(order)} disabled={!refundEnabled(p)}>Process Refund</Button>
                                <Button size="slim" variant="secondary" onClick={() => openPartialDialog(order)}>Partial Refund</Button>
                              </InlineStack>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        );
                      })}
                    </IndexTable>
                  </div>
                )}

                {tab === 1 && orders && orders.length > 0 && (
                   <div className="custom-table-header">
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
                  </div>
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

