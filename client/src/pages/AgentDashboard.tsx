import { useMemo, useState } from 'react';
import { Box, Grid, Card, CardHeader, CardContent, CardActions, Button, TextField, Typography, Alert, Snackbar, CircularProgress, Chip, Tooltip, Checkbox, InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions, Tabs, Tab } from '@mui/material';
import api from '../apiClient';

interface OrderLineItem { id: number; name: string; quantity: number; price: string; }
interface OrderSummary { id: number; name: string; created_at: string; current_subtotal_price: string; financial_status: string; fulfillment_status: string; line_items: OrderLineItem[]; customer: { id: number; first_name: string; last_name: string; email: string; phone: string } | null }
interface GetOrdersResponse { orders: OrderSummary[]; nextPageInfo?: string | null }

interface RuleDecision { outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL'; reason?: string; matched?: string[]; rulesVersion?: number; ruleSetId?: string | null }
interface PreviewResult { orderId: number | null; decision: RuleDecision | null; requiresApproval: boolean | null; ctxHints?: { orderId?: number | null; rulesVersion?: number; ruleSetId?: string | null; attemptsToday?: number | null; daysSinceDelivery?: number | null; totalCredits?: number | null; totalSpentCredits?: number | null } | null; error?: string | null }

export default function AgentDashboard() {
	const [phone, setPhone] = useState('');
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
	}>({ open: false, type: null, orderId: null, amountLabel: '', customerName: '' });
	// Confirm action loading state
	const [confirmLoading, setConfirmLoading] = useState(false);

	const merged = useMemo(() => {
		if (!orders) return [] as Array<{ order: OrderSummary; preview?: PreviewResult }>;
		return orders.map(o => ({ order: o, preview: preview[String(o.id)] }));
	}, [orders, preview]);

	function chipColorFor(decision?: RuleDecision | null): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
		if (!decision) return 'default';
		if (decision.outcome === 'DENY') return 'error';
		if (decision.outcome === 'REQUIRE_APPROVAL') return 'warning';
		if (decision.outcome === 'ALLOW') return 'success';
		return 'default';
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
			const res = await api.get<GetOrdersResponse>('/orders', { params: { phone } });
			const found = res.data.orders || [];
			setOrders(found);
			if (found.length) {
				const items = found.map(o => ({ orderId: o.id }));
				const p = await api.post<{ results: PreviewResult[] }>('/refund/preview/bulk', { phone, items });
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
			const res = await api.post('/refund', { phone, orderId });
			if (res.status === 200) {
				setSnack({ open: true, message: 'Refund executed successfully', severity: 'success' });
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				setSnack({ open: true, message: `Approval required. PendingId: ${pendingId}`, severity: 'info' });
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Refund failed';
			setSnack({ open: true, message: msg, severity: 'error' });
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
		return { phone, orderId, lineItems: items } as const;
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
		setConfirm({ open: true, type: 'full', orderId: order.id, amountLabel, customerName: customerNameFor(order) });
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
		setConfirm({ open: true, type: 'partial', orderId: order.id, amountLabel, customerName: customerNameFor(order) });
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
			const payload = buildPartialPayload(orderId);
			if (!payload.lineItems.length) {
				setSnack({ open: true, message: 'Select at least one line item', severity: 'error' });
				return;
			}
			const res = await api.post('/refund', payload);
			if (res.status === 200) {
				setSnack({ open: true, message: 'Partial refund executed successfully', severity: 'success' });
			} else if (res.status === 202) {
				const pendingId = (res as any).data?.pendingId;
				setSnack({ open: true, message: `Approval required. PendingId: ${pendingId}`, severity: 'info' });
			}
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Partial refund failed';
			setSnack({ open: true, message: msg, severity: 'error' });
		}
	}

	return (
		<>
		<Box>
			{/* Search Panel */}
			<Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
				<Card sx={{ width: '100%', maxWidth: 720 }}>
					<CardHeader title="Refunds Portal" subheader="Search by customer phone to load recent orders and preview refund eligibility" />
					<CardContent>
						{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
						<Box component="form" onSubmit={onSearch} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
							<TextField label="Customer Phone" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth size="small" />
							<Button type="submit" variant="contained" disabled={loading || !phone.trim()} sx={{ whiteSpace: 'nowrap' }}>{loading ? <CircularProgress size={18} /> : 'Search'}</Button>
						</Box>
					</CardContent>
				</Card>
			</Box>

			{/* Empty state */}
			{!loading && orders && orders.length === 0 && (
				<Alert severity="info" sx={{ mb: 2 }}>No orders found.</Alert>
			)}

			{/* Tabs for Orders and Cashback */}
			<Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1 }}>
				<Tabs value={tab} onChange={(_, v) => setTab(v)}>
					<Tab label="Orders" />
					<Tab label="Cashback" />
				</Tabs>
			</Box>

			{/* Orders Tab */}
			{tab === 0 && (
				<Grid container spacing={2}>
					{merged.map(({ order, preview: p }) => (
						<Grid item xs={12} md={6} lg={4} key={order.id} sx={{ display: 'flex' }}>
							<Card sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
							<CardHeader title={order.name} subheader={new Date(order.created_at).toLocaleString()} />
							<CardContent sx={{ flexGrow: 1 }}>
								<Typography variant="body2">Subtotal: {order.current_subtotal_price}</Typography>
								<Typography variant="body2">Financial: {order.financial_status} | Fulfillment: {order.fulfillment_status}</Typography>
								{order.customer && (
									<Typography variant="body2">Customer: {order.customer.first_name} {order.customer.last_name} ({order.customer.email || 'N/A'})</Typography>
								)}
								{p && p.decision && (
									<Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
										<Chip size="small" label={p.decision.outcome} color={chipColorFor(p.decision)} />
										{p.decision.reason && (
											<Tooltip title={p.decision.reason} arrow>
												<Box
													sx={{
														fontSize: 12,
														lineHeight: 1.2,
														px: 1,
														py: 0.5,
														borderRadius: 1,
														bgcolor: (theme) => {
															const msg = (p.decision!.reason || '').toLowerCase().trim();
															if (p.decision!.outcome === 'DENY') return theme.palette.warning.light;
															if (p.decision!.outcome === 'REQUIRE_APPROVAL') return theme.palette.warning.light;
															if (msg === 'allowed by default') return theme.palette.info.light; // message chip blue
															return theme.palette.success.light;
														},
														color: (theme) => {
															const msg = (p.decision!.reason || '').toLowerCase().trim();
															if (p.decision!.outcome === 'DENY') return theme.palette.text.primary;
															if (p.decision!.outcome === 'REQUIRE_APPROVAL') return theme.palette.text.primary;
															if (msg === 'allowed by default') return theme.palette.info.contrastText;
															return theme.palette.success.contrastText;
														},
														maxWidth: '100%',
														whiteSpace: 'normal',
														wordBreak: 'break-word',
														overflowWrap: 'anywhere',
													}}
												>
													{p.decision.reason}
												</Box>
											</Tooltip>
										)}
									</Box>
								)}
							</CardContent>
							<CardActions sx={{ display: 'flex', justifyContent: 'space-between', mt: 'auto' }}>
								<Box sx={{ display: 'flex', gap: 1 }}>
									<Button variant="contained" onClick={() => openConfirmFull(order)} disabled={!refundEnabled(p)}>Refund Full</Button>
									<Button variant="outlined" onClick={() => openPartialDialog(order)}>
										Partial refund
									</Button>
								</Box>
							</CardActions>
					
						</Card>
					</Grid>
				))}
			</Grid>
			)}

			{/* Cashback Tab */}
			{tab === 1 && (
				<Card sx={{ mb: 2 }}>
					<CardHeader title="Cashback" subheader={phone ? `Customer phone: ${phone}` : undefined} />
					<CardContent>
						{cashbackSummary ? (
							<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
								<Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
									<Typography variant="overline" color="text.secondary">Current balance</Typography>
									<Typography variant="h6">{cashbackSummary.totalCredits ?? '—'}</Typography>
								</Box>
								<Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
									<Typography variant="overline" color="text.secondary">Total spent</Typography>
									<Typography variant="h6">{cashbackSummary.totalSpentCredits ?? '—'}</Typography>
								</Box>
							</Box>
						) : (
							<Alert severity="info">No cashback information available for this customer.</Alert>
						)}
					</CardContent>
				</Card>
			)}

			{/* Snackbar */}
			{snack && (
				<Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
					<Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>{snack.message}</Alert>
				</Snackbar>
			)}
		</Box>

		{/* Confirm Dialog */}
		<Dialog open={confirm.open} onClose={onConfirmCancel} maxWidth="xs" fullWidth>
			<DialogTitle>Confirm refund</DialogTitle>
			<DialogContent>
				<Typography variant="body2" sx={{ mb: 1 }}>
					Are you sure you want to refund this order?
				</Typography>
				<Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 0.5, columnGap: 1, mt: 1 }}>
					<Typography variant="caption" color="text.secondary">Customer</Typography>
					<Typography variant="caption">{confirm.customerName}</Typography>
					<Typography variant="caption" color="text.secondary">Amount</Typography>
					<Typography variant="caption">{confirm.amountLabel}</Typography>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onConfirmCancel}>Cancel</Button>
				<Button variant="contained" onClick={onConfirmProceed} autoFocus disabled={confirmLoading}>
					{confirmLoading ? <CircularProgress size={18} /> : 'Confirm'}
				</Button>
			</DialogActions>
		</Dialog>

		{/* Partial Refund Dialog */}
		<Dialog open={partialDlg.open} onClose={closePartialDialog} maxWidth="sm" fullWidth scroll="paper">
			<DialogTitle>Partial refund{partialDlg.order ? ` • ${partialDlg.order.name}` : ''}</DialogTitle>
			<DialogContent sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
						{partialDlg.order && (
					<Box>
						<Typography variant="subtitle2" sx={{ mb: 1 }}>Select line items to refund</Typography>
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
							{partialDlg.order.line_items.map((li) => {
								const entry = (selections[partialDlg.order!.id] || {})[li.id];
								const selected = !!entry?.selected;
								const defaultQty = 1;
								const defaultAmount = (defaultQty * unitPrice(li)).toFixed(2);
								return (
									<Box key={li.id} sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
										<Checkbox checked={selected} onChange={(e) => onToggleLine(partialDlg.order!.id, li, e.target.checked)} />
										<Box>
											<Typography variant="body2" sx={{ fontWeight: 500 }}>{li.name}</Typography>
											<Typography variant="caption" color="text.secondary">Qty available: {li.quantity} • Unit: {Number(unitPrice(li)).toFixed(2)}</Typography>
										</Box>
										<Box sx={{ display: 'flex', gap: 1, opacity: selected ? 1 : 0.6 }}>
											<TextField
												label="Quantity"
												type="number"
												size="small"
												inputProps={{ min: 1, max: li.quantity, step: 1 }}
												value={entry?.quantity ?? 1}
												onChange={(e) => onChangeQty(partialDlg.order!.id, li, Number(e.target.value))}
												sx={{ width: 110 }}
												disabled={!selected}
											/>
											<TextField
												label="Amount"
												type="number"
												size="small"
												inputProps={{ min: 0, step: '0.01' }}
												value={entry?.amount ?? defaultAmount}
												onChange={(e) => onChangeAmount(partialDlg.order!.id, li, e.target.value)}
												InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
												sx={{ width: 150 }}
												disabled={!selected}
											/>
										</Box>
								</Box>
							);
							})}
						</Box>
						{/* Selection preview decision chips */}
						{selectionPreview[partialDlg.order.id] && selectionPreview[partialDlg.order.id].decision && (
							<Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
								<Chip size="small" label={`Selection: ${selectionPreview[partialDlg.order.id].decision!.outcome}`} color={chipColorFor(selectionPreview[partialDlg.order.id].decision!)} />
								{selectionPreview[partialDlg.order.id].decision!.reason && (
									<Tooltip title={selectionPreview[partialDlg.order.id].decision!.reason} arrow>
										<Box sx={{
											fontSize: 12,
											lineHeight: 1.2,
											px: 1,
											py: 0.5,
											borderRadius: 1,
											bgcolor: (theme) => {
												const d = selectionPreview[partialDlg.order!.id].decision!;
												const msg = (d.reason || '').toLowerCase().trim();
												if (d.outcome === 'DENY') return theme.palette.warning.light;
												if (d.outcome === 'REQUIRE_APPROVAL') return theme.palette.warning.light;
												if (msg === 'allowed by default') return theme.palette.info.light; // message chip blue
												return theme.palette.success.light;
											},
											color: (theme) => {
												const d = selectionPreview[partialDlg.order!.id].decision!;
												const msg = (d.reason || '').toLowerCase().trim();
												if (d.outcome === 'DENY') return theme.palette.text.primary;
												if (d.outcome === 'REQUIRE_APPROVAL') return theme.palette.text.primary;
												if (msg === 'allowed by default') return theme.palette.info.contrastText;
												return theme.palette.success.contrastText;
											},
											maxWidth: '100%',
											whiteSpace: 'normal',
											wordBreak: 'break-word',
											overflowWrap: 'anywhere',
										}}>
											{selectionPreview[partialDlg.order.id].decision!.reason}
										</Box>
									</Tooltip>
								)}
							</Box>
						)}
					</Box>
				)}
			</DialogContent>
			<DialogActions>
				{partialDlg.order && (
					<>
						<Box sx={{ flex: 1 }} />
						<Button onClick={closePartialDialog}>Cancel</Button>
						<Button
							variant="contained"
							onClick={() => { openConfirmPartial(partialDlg.order!); closePartialDialog(); }}
							disabled={!partialRefundEnabled(partialDlg.order.id)}
						>
							Continue
						</Button>
					</>
				)}
			</DialogActions>
		</Dialog>
		</>
	);
}

