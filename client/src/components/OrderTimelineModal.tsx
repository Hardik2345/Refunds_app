import { useCallback, useEffect, useState } from 'react';
import { Modal, BlockStack, InlineStack, Box, Text, Badge, Banner, Button, SkeletonBodyText } from '@shopify/polaris';
import api from '../apiClient';
import type { OrderSummary } from '../agent/AgentSearchContext';

// Mirrors the normalized shape returned by services/shopifyOrderEventsService.js
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
}

interface PageInfo { hasNextPage: boolean; endCursor: string | null }
interface TimelineResponse { events: TimelineEvent[]; pageInfo: PageInfo }

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

export function OrderTimelineModal({
  open,
  order,
  onClose,
}: {
  open: boolean;
  order: OrderSummary | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ hasNextPage: false, endCursor: null });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderId = order?.id ?? null;

  const load = useCallback(async (id: number, cursor: string | null) => {
    const isFirstPage = !cursor;
    if (isFirstPage) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<TimelineResponse>(`/orders/${id}/timeline`, {
        params: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      });
      const fetched = res.data?.events || [];
      setEvents((prev) => (isFirstPage ? fetched : [...prev, ...fetched]));
      setPageInfo(res.data?.pageInfo || { hasNextPage: false, endCursor: null });
    } catch (err: unknown) {
      const apiError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(apiError || 'Failed to load the order timeline.');
      if (isFirstPage) {
        setEvents([]);
        setPageInfo({ hasNextPage: false, endCursor: null });
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Refetch whenever the modal opens for an order — a timeline is only useful fresh.
  useEffect(() => {
    if (!open || orderId == null) return;
    setEvents([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    load(orderId, null);
  }, [open, orderId, load]);

  const groups = groupByDay(events);

  return (
    <Modal
      size="large"
      open={open}
      onClose={onClose}
      title={`Timeline${order ? ` • ${order.name}` : ''}`}
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        {error && (
          <Box paddingBlockEnd="400">
            <Banner tone="critical">{error}</Banner>
          </Box>
        )}

        {loading && <SkeletonBodyText lines={6} />}

        {!loading && !error && events.length === 0 && (
          <Text as="p" tone="subdued">
            No timeline events for this order. Shopify retains event data for one year.
          </Text>
        )}

        {!loading && events.length > 0 && (
          <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
            <BlockStack gap="400">
              {groups.map((group) => (
                <BlockStack key={group.label} gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">{group.label}</Text>
                  {group.events.map((event, index) => (
                    <Box
                      key={event.id || `${group.label}-${index}`}
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="300"
                    >
                      <InlineStack gap="300" wrap={false} blockAlign="start">
                        {/* Timeline dot rail */}
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            marginTop: 6,
                            flexShrink: 0,
                            backgroundColor: event.criticalAlert
                              ? 'var(--p-color-bg-fill-critical)'
                              : 'var(--p-color-bg-fill-tertiary)',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd">
                              {event.text || event.action || 'Event'}
                            </Text>
                            {event.secondaryText && (
                              <Text as="p" variant="bodySm" tone="subdued">{event.secondaryText}</Text>
                            )}
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodySm" tone="subdued">
                                {timeLabel(event.createdAt)}
                              </Text>
                              {(event.author || event.appTitle) && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {event.author || event.appTitle}
                                </Text>
                              )}
                              {event.type === 'comment' && <Badge tone="info">Comment</Badge>}
                              {event.criticalAlert && <Badge tone="critical">Critical</Badge>}
                            </InlineStack>
                          </BlockStack>
                        </div>
                      </InlineStack>
                    </Box>
                  ))}
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
          </div>
        )}
      </Modal.Section>
    </Modal>
  );
}
