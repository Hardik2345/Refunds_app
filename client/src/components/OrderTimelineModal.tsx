import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Badge,
  Banner,
  Button,
  SkeletonBodyText,
  Thumbnail,
  Collapsible,
  Divider,
} from '@shopify/polaris';
import { ImageIcon, ChevronDownIcon, ChevronUpIcon } from '@shopify/polaris-icons';
import api from '../apiClient';
import type { OrderSummary } from '../agent/AgentSearchContext';

// All of the shapes below mirror what services/shopifyOrderEventsService.js
// returns — one Shopify request gives us the header, the line items and the
// first page of events.
export interface Money {
  amount: string;
  currencyCode: string | null;
}

export interface TimelineEvent {
  id: string | null;
  type: 'basic' | 'comment';
  action: string | null;
  createdAt: string | null;
  text: string | null;
  secondaryText: string | null;
  author: string | null;
  appTitle: string | null;
  attributeToApp: boolean;
  attributeToUser: boolean;
  criticalAlert: boolean;
  detailLines: string[];
}

export interface OrderDetailLineItem {
  id: number | string | null;
  name: string | null;
  title: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  refundableQuantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface OrderDetailHeader {
  id: number | string | null;
  name: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currencyCode: string | null;
  note: string | null;
  tags: string[];
  shipping: { title: string | null; price: Money | null } | null;
  totals: {
    subtotal: Money | null;
    shipping: Money | null;
    tax: Money | null;
    total: Money | null;
    refunded: Money | null;
  };
}

interface PageInfo { hasNextPage: boolean; endCursor: string | null }

interface OrderDetailResponse {
  order: OrderDetailHeader | null;
  lineItems: OrderDetailLineItem[];
  hasMoreLineItems: boolean;
  events: TimelineEvent[];
  pageInfo: PageInfo;
}

const PAGE_SIZE = 20;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today" / "Yesterday" / "25 Aug 26" — the day heading Shopify's timeline uses. */
function dayLabel(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function timeLabel(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Shopify shows "1 minute ago" for recent events and clock times for older ones. */
function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0 || seconds >= 86_400) return timeLabel(iso);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function dateTimeLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Amounts arrive with their own currency code, so this stays correct for a
 * non-INR store while still rendering ₹ like the rest of the dashboard.
 */
function money(value: Money | null, fallbackCurrency?: string | null): string {
  if (!value || value.amount == null) return '—';
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return '—';
  const currency = value.currencyCode || fallbackCurrency || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Shopify's `name` carries the store's order prefix, which may or may not
 * already include the `#` the orders table prepends by hand.
 */
function orderLabel(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Order details';
  return `Order ${trimmed.startsWith('#') ? trimmed : `#${trimmed}`}`;
}

/** "partially_refunded" → "Partially refunded" */
function statusLabel(status: string | null): string {
  if (!status) return '';
  const words = status.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type BadgeTone = 'success' | 'attention' | 'warning' | 'info' | 'critical' | undefined;

function financialTone(status: string | null): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'pending':
    case 'authorized':
    case 'partially_paid':
      return 'attention';
    case 'refunded':
    case 'partially_refunded':
      return 'info';
    default:
      return undefined;
  }
}

function fulfillmentTone(status: string | null): BadgeTone {
  switch (status) {
    case 'fulfilled':
      return 'success';
    case 'unfulfilled':
      return 'attention';
    case 'partially_fulfilled':
    case 'in_progress':
    case 'scheduled':
      return 'warning';
    default:
      return undefined;
  }
}

/** Events arrive newest-first; preserve that order while grouping by day. */
function groupByDay(events: TimelineEvent[]): { label: string; events: TimelineEvent[] }[] {
  const groups: { label: string; events: TimelineEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

/**
 * The dashboard already holds name/quantity/price for every line item, so the
 * rows can paint before Shopify answers and only gain the thumbnail, SKU and
 * refundable counts when it does.
 */
function itemsFromSearch(order: OrderSummary | null): OrderDetailLineItem[] {
  return (order?.line_items || []).map((li) => {
    const unit = Number(li.price);
    return {
      id: li.id,
      name: li.name,
      title: null,
      variantTitle: null,
      sku: null,
      quantity: li.quantity,
      currentQuantity: li.quantity,
      refundableQuantity: li.quantity,
      unitPrice: { amount: li.price, currencyCode: null },
      lineTotal: Number.isFinite(unit)
        ? { amount: (unit * li.quantity).toFixed(2), currencyCode: null }
        : null,
      imageUrl: null,
      imageAlt: null,
    };
  });
}

function headerFromSearch(order: OrderSummary | null): OrderDetailHeader | null {
  if (!order) return null;
  return {
    id: order.id,
    name: order.name,
    createdAt: order.created_at,
    cancelledAt: null,
    financialStatus: order.financial_status || null,
    fulfillmentStatus: order.fulfillment_status || null,
    currencyCode: null,
    note: null,
    tags: [],
    shipping: null,
    totals: {
      subtotal: order.current_subtotal_price
        ? { amount: order.current_subtotal_price, currencyCode: null }
        : null,
      shipping: null,
      tax: null,
      total: null,
      refunded: null,
    },
  };
}

function TotalRow({
  label,
  value,
  currency,
  strong,
  tone,
}: {
  label: string;
  value: Money | null;
  currency: string | null;
  strong?: boolean;
  tone?: 'critical' | 'subdued';
}) {
  if (!value) return null;
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodySm" tone={tone === 'critical' ? undefined : 'subdued'}>
        {label}
      </Text>
      <Text
        as="span"
        variant="bodySm"
        tone={tone}
        fontWeight={strong ? 'semibold' : undefined}
      >
        {money(value, currency)}
      </Text>
    </InlineStack>
  );
}

function LineItemRow({ item, currency }: { item: OrderDetailLineItem; currency: string | null }) {
  const fullyRefunded = item.refundableQuantity === 0 && item.quantity > 0;
  const partlyRefunded = item.refundableQuantity > 0 && item.refundableQuantity < item.quantity;

  return (
    <InlineStack gap="300" wrap={false} blockAlign="center">
      <Thumbnail
        size="small"
        source={item.imageUrl || ImageIcon}
        alt={item.imageAlt || item.name || 'Product image'}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {item.name || item.title || 'Item'}
          </Text>
          {item.sku && (
            <Text as="span" variant="bodySm" tone="subdued">{item.sku}</Text>
          )}
          {fullyRefunded && (
            <Text as="span" variant="bodySm" tone="subdued">Fully refunded</Text>
          )}
          {partlyRefunded && (
            <Text as="span" variant="bodySm" tone="subdued">
              {item.refundableQuantity} of {item.quantity} still refundable
            </Text>
          )}
        </BlockStack>
      </div>
      <Text as="span" variant="bodySm" tone="subdued">
        {money(item.unitPrice, currency)} × {item.quantity}
      </Text>
      <div style={{ minWidth: 96, textAlign: 'right' }}>
        <Text as="span" variant="bodyMd">{money(item.lineTotal, currency)}</Text>
      </div>
    </InlineStack>
  );
}

function EventRow({
  event,
  index,
  expanded,
  onToggle,
}: {
  event: TimelineEvent;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailId = `timeline-detail-${event.id || index}`;
  const meta = [event.author || event.appTitle].filter(Boolean).join('');

  return (
    <Box paddingBlockStart="150" paddingBlockEnd="150">
      <InlineStack gap="300" wrap={false} blockAlign="start">
        {/* Dot sits above the rail behind it, so it needs its own stacking context. */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: 9,
            height: 9,
            borderRadius: '50%',
            marginTop: 6,
            flexShrink: 0,
            backgroundColor: event.criticalAlert
              ? 'var(--p-color-bg-fill-critical)'
              : 'var(--p-color-bg-fill-tertiary)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <BlockStack gap="100">
            <Text as="p" variant="bodyMd">{event.text || statusLabel(event.action) || 'Event'}</Text>
            {event.secondaryText && (
              <Text as="p" variant="bodySm" tone="subdued">{event.secondaryText}</Text>
            )}
            <InlineStack gap="200" blockAlign="center">
              {meta && <Text as="span" variant="bodySm" tone="subdued">{meta}</Text>}
              {event.type === 'comment' && <Badge tone="info">Comment</Badge>}
              {event.criticalAlert && <Badge tone="critical">Critical</Badge>}
              {event.detailLines.length > 0 && (
                <Button
                  variant="tertiary"
                  size="micro"
                  icon={expanded ? ChevronUpIcon : ChevronDownIcon}
                  onClick={onToggle}
                  accessibilityLabel={expanded ? 'Hide details' : 'Show details'}
                />
              )}
            </InlineStack>
            {event.detailLines.length > 0 && (
              <Collapsible id={detailId} open={expanded}>
                <Box
                  padding="200"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="050">
                    {event.detailLines.map((line, i) => (
                      <Text key={i} as="p" variant="bodySm" tone="subdued">{line}</Text>
                    ))}
                  </BlockStack>
                </Box>
              </Collapsible>
            )}
          </BlockStack>
        </div>
        <Text as="span" variant="bodySm" tone="subdued">{relativeTime(event.createdAt)}</Text>
      </InlineStack>
    </Box>
  );
}

export function OrderTimelineModal({
  open,
  order,
  onClose,
}: {
  open: boolean;
  order: OrderSummary | null;
  onClose: () => void;
}) {
  const [header, setHeader] = useState<OrderDetailHeader | null>(null);
  const [lineItems, setLineItems] = useState<OrderDetailLineItem[]>([]);
  const [hasMoreLineItems, setHasMoreLineItems] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ hasNextPage: false, endCursor: null });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const orderId = order?.id ?? null;

  const load = useCallback(async (id: number, cursor: string | null) => {
    const isFirstPage = !cursor;
    if (isFirstPage) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<OrderDetailResponse>(`/orders/${id}/timeline`, {
        params: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      });
      const fetched = res.data?.events || [];
      setEvents((prev) => (isFirstPage ? fetched : [...prev, ...fetched]));
      setPageInfo(res.data?.pageInfo || { hasNextPage: false, endCursor: null });
      // Only the first page carries the order and its line items.
      if (isFirstPage) {
        if (res.data?.order) setHeader(res.data.order);
        if (res.data?.lineItems?.length) setLineItems(res.data.lineItems);
        setHasMoreLineItems(res.data?.hasMoreLineItems === true);
      }
    } catch (err: unknown) {
      const apiError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(apiError || 'Failed to load the order details.');
      if (isFirstPage) {
        setEvents([]);
        setPageInfo({ hasNextPage: false, endCursor: null });
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Refetch whenever the modal opens for an order — this data is only useful fresh.
  useEffect(() => {
    if (!open || orderId == null) return;
    setEvents([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setExpanded({});
    setHasMoreLineItems(false);
    // Seed from the search results so the rows paint immediately.
    setHeader(headerFromSearch(order));
    setLineItems(itemsFromSearch(order));
    load(orderId, null);
    // `order` is the same object behind `orderId` for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, load]);

  const groups = groupByDay(events);
  const currency = header?.currencyCode || null;
  const totals = header?.totals;

  return (
    <Modal
      size="large"
      open={open}
      onClose={onClose}
      title={orderLabel(header?.name || order?.name)}
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        {error && (
          <Box paddingBlockEnd="400">
            <Banner tone="critical">{error}</Banner>
          </Box>
        )}

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <BlockStack gap="400">
            {/* Status row */}
            {header && (
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center" wrap>
                  {header.fulfillmentStatus && (
                    <Badge tone={fulfillmentTone(header.fulfillmentStatus)}>
                      {statusLabel(header.fulfillmentStatus)}
                    </Badge>
                  )}
                  {header.financialStatus && (
                    <Badge tone={financialTone(header.financialStatus)}>
                      {statusLabel(header.financialStatus)}
                    </Badge>
                  )}
                  {header.cancelledAt && <Badge tone="critical">Cancelled</Badge>}
                  {header.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </InlineStack>
                {header.createdAt && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {dateTimeLabel(header.createdAt)}
                  </Text>
                )}
              </BlockStack>
            )}

            {/* Shipping line, mirroring Shopify's own row above the items */}
            {header?.shipping?.title && (
              <Box
                padding="300"
                borderWidth="025"
                borderColor="border"
                borderRadius="300"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd">{header.shipping.title}</Text>
                  <Text as="span" variant="bodyMd">{money(header.shipping.price, currency)}</Text>
                </InlineStack>
              </Box>
            )}

            {/* Line items */}
            {lineItems.length > 0 && (
              <Box
                padding="300"
                borderWidth="025"
                borderColor="border"
                borderRadius="300"
              >
                <BlockStack gap="300">
                  {lineItems.map((item, index) => (
                    <BlockStack key={item.id ?? index} gap="300">
                      {index > 0 && <Divider />}
                      <LineItemRow item={item} currency={currency} />
                    </BlockStack>
                  ))}
                  {hasMoreLineItems && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Showing the first 50 items on this order.
                    </Text>
                  )}
                </BlockStack>
              </Box>
            )}

            {/* Totals */}
            {totals && (totals.subtotal || totals.total) && (
              <Box paddingInlineStart="200" paddingInlineEnd="200">
                <BlockStack gap="100">
                  <TotalRow label="Subtotal" value={totals.subtotal} currency={currency} />
                  <TotalRow label="Shipping" value={totals.shipping} currency={currency} />
                  <TotalRow label="Tax" value={totals.tax} currency={currency} />
                  <TotalRow label="Total" value={totals.total} currency={currency} strong />
                  <TotalRow
                    label="Refunded"
                    value={totals.refunded}
                    currency={currency}
                    tone="critical"
                  />
                </BlockStack>
              </Box>
            )}

            <Divider />

            {/* Timeline */}
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Timeline</Text>

              {loading && <SkeletonBodyText lines={6} />}

              {!loading && !error && events.length === 0 && (
                <Text as="p" tone="subdued">
                  No timeline events for this order. Shopify retains event data for one year.
                </Text>
              )}

              {!loading && events.length > 0 && (
                <BlockStack gap="400">
                  {groups.map((group) => (
                    <BlockStack key={group.label} gap="100">
                      <Text as="h4" variant="headingSm" tone="subdued">{group.label}</Text>
                      {/* The rail runs behind the dots of this day's events. */}
                      <div style={{ position: 'relative' }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: 4,
                            top: 14,
                            bottom: 14,
                            width: 1,
                            backgroundColor: 'var(--p-color-border)',
                          }}
                        />
                        {group.events.map((event, index) => {
                          const key = event.id || `${group.label}-${index}`;
                          return (
                            <EventRow
                              key={key}
                              event={event}
                              index={index}
                              expanded={expanded[key] === true}
                              onToggle={() =>
                                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                            />
                          );
                        })}
                      </div>
                    </BlockStack>
                  ))}

                  {pageInfo.hasNextPage && (
                    <Box paddingBlockStart="200">
                      <Button
                        onClick={() => orderId != null && load(orderId, pageInfo.endCursor)}
                        loading={loadingMore}
                        fullWidth
                      >
                        Load more
                      </Button>
                    </Box>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </BlockStack>
        </div>
      </Modal.Section>
    </Modal>
  );
}
