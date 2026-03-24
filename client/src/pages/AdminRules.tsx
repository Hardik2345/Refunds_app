import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Text, BlockStack, InlineGrid, InlineStack, Select, TextField, Checkbox, Button, Banner } from '@shopify/polaris';
import api from '../apiClient';

import { useAuth } from '../auth/AuthContext';

// Lightweight model matching the OpenAPI RefundRulesPayload
type Rules = {
  mode?: 'observe' | 'warn' | 'enforce';
  maxRefundPercent?: number;
  maxRefundsPerDay?: number;
  allowPaymentMethods?: string[];
  requireSupervisorAbovePercent?: number;
  bypassPercentCapForPartials?: boolean;
  refundWindowDays?: number | null;
  blockIfAlreadyRefunded?: boolean;
  maxLifetimeRefundCount?: number;
};

export default function AdminRules() {
  const { selectedTenantId, user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const normalized = roles.map((r: string) => r?.toLowerCase?.());
  const isSuperAdmin = normalized.includes('super_admin');
  const [draft, setDraft] = useState<Rules>({});
  const [allowText, setAllowText] = useState<string>("");
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const canPublish = useMemo(() => (isSuperAdmin || !!selectedTenantId) && !publishing, [isSuperAdmin, selectedTenantId, publishing]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setMsg(null);
      try {
        const res = await api.get('/refund-rules/active');
        if (!mounted) return;
  const data = (res.data?.data?.data) || res.data?.data || res.data; // accept all shapes per docs
  const rules = data?.rules || {};
  setDraft(rules);
  setAllowText(Array.isArray(rules.allowPaymentMethods) ? rules.allowPaymentMethods.join('\n') : '');
      } catch (e:any) {
        setMsg({ type: 'info', text: e?.response?.data?.error || 'No active ruleset yet for this tenant.' });
        setDraft({});
      } finally {
        // no-op
      }
    }
    load();
    return () => { mounted = false; };
  }, [selectedTenantId]);

  const update = (patch: Partial<Rules>) => setDraft((d) => ({ ...d, ...patch }));

  // Keep allowText in sync when draft changes from other sources (rare)
  useEffect(() => {
    if (Array.isArray(draft.allowPaymentMethods)) {
      setAllowText(draft.allowPaymentMethods.join('\n'));
    }
  }, [draft.allowPaymentMethods]);

  const parseAllow = (text: string): string[] =>
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  async function publish() {
    if (!isSuperAdmin && !selectedTenantId) {
      setMsg({ type: 'error', text: 'Select a tenant first.' });
      return;
    }
    setPublishing(true);
    setMsg(null);
    try {
      // Minimal payload; backend reads x-tenant-id header
      const rules: Rules = { ...draft, allowPaymentMethods: parseAllow(allowText) };
      await api.post('/refund-rules/publish', { rules });
      setMsg({ type: 'success', text: 'Rules published successfully.' });
    } catch (e:any) {
      setMsg({ type: 'error', text: e?.response?.data?.error || 'Failed to publish rules' });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Box>
      <Box paddingBlockEnd="400">
        <Text as="h1" variant="headingLg">Set Refund Rules</Text>
        <Text as="p" tone="subdued">
          {isSuperAdmin ? 'Edit and publish a new active ruleset for your tenant' : 'Edit and publish a new active ruleset for the selected tenant'}
        </Text>
      </Box>

      <Card>
        <Box padding="400">
          <BlockStack gap="500">
            {msg && (
              <Banner tone={msg.type === 'error' ? 'critical' : msg.type === 'success' ? 'success' : 'info'}>
                {msg.text}
              </Banner>
            )}

            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <Select
                label="Mode"
                options={[
                  { label: 'Observe', value: 'observe' },
                  { label: 'Warn', value: 'warn' },
                  { label: 'Enforce', value: 'enforce' }
                ]}
                value={draft.mode || 'observe'}
                onChange={(v) => update({ mode: v as Rules['mode'] })}
              />
              <TextField
                label="Max Refund %"
                type="number"
                value={draft.maxRefundPercent != null ? String(draft.maxRefundPercent) : ''}
                onChange={(v) => update({ maxRefundPercent: v === '' ? undefined : Number(v) })}
                autoComplete="off"
              />
              <TextField
                label="Need Supervision %"
                type="number"
                value={draft.requireSupervisorAbovePercent != null ? String(draft.requireSupervisorAbovePercent) : ''}
                onChange={(v) => update({ requireSupervisorAbovePercent: v === '' ? undefined : Number(v) })}
                autoComplete="off"
              />
            </InlineGrid>

            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <TextField
                label="Max Refund per day"
                type="number"
                value={draft.maxRefundsPerDay != null ? String(draft.maxRefundsPerDay) : ''}
                onChange={(v) => update({ maxRefundsPerDay: v === '' ? undefined : Number(v) })}
                autoComplete="off"
              />
              <TextField
                label="Refund window (days)"
                type="number"
                value={draft.refundWindowDays != null ? String(draft.refundWindowDays) : ''}
                onChange={(v) => update({ refundWindowDays: v === '' ? null : Number(v) })}
                autoComplete="off"
              />
              <TextField
                label="Max Lifetime Refund Count"
                type="number"
                value={draft.maxLifetimeRefundCount != null ? String(draft.maxLifetimeRefundCount) : ''}
                onChange={(v) => update({ maxLifetimeRefundCount: v === '' ? undefined : Number(v) })}
                autoComplete="off"
              />
            </InlineGrid>

            <TextField
              label="Allowed Payment Methods"
              value={allowText}
              onChange={setAllowText}
              onBlur={() => update({ allowPaymentMethods: parseAllow(allowText) })}
              multiline={3}
              helpText="(use comma or new line for seperation)"
              autoComplete="off"
            />

            <InlineStack gap="500">
              <Checkbox
                label="Bypass % Cap for Partials"
                checked={!!draft.bypassPercentCapForPartials}
                onChange={(checked) => update({ bypassPercentCapForPartials: checked })}
              />
              <Checkbox
                label="Block if already refunded"
                checked={!!draft.blockIfAlreadyRefunded}
                onChange={(checked) => update({ blockIfAlreadyRefunded: checked })}
              />
            </InlineStack>

            <InlineStack align="start" blockAlign="center" gap="300">
              <Button variant="primary" onClick={publish} loading={publishing} disabled={!canPublish}>
                Publish
              </Button>
              {!isSuperAdmin && !selectedTenantId && (
                <Text as="span" variant="bodySm" tone="subdued">Select a tenant to enable publishing</Text>
              )}
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    </Box>
  );
}

