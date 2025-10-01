import { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, CardHeader, TextField, FormControlLabel, Switch, Button, Typography, Alert, Stack, Divider } from '@mui/material';
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
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <Card sx={{ width: '100%', maxWidth: 900 }}>
        <CardHeader title="Publish Refund Rules" subheader={isSuperAdmin ? 'Edit and publish a new active ruleset for your tenant' : 'Edit and publish a new active ruleset for the selected tenant'} />
        <CardContent>
          {msg && <Alert severity={msg.type} sx={{ mb: 2 }}>{msg.text}</Alert>}
          <Stack spacing={2} divider={<Divider flexItem />}> 
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Mode (observe | warn | enforce)"
                value={draft.mode || ''}
                onChange={(e) => update({ mode: e.target.value as Rules['mode'] })}
                placeholder="observe"
                fullWidth
              />
              <TextField
                label="Max Refund Percent"
                type="number"
                value={draft.maxRefundPercent ?? ''}
                onChange={(e) => update({ maxRefundPercent: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="30"
                fullWidth
              />
              <TextField
                label="Require Supervisor Above %"
                type="number"
                value={draft.requireSupervisorAbovePercent ?? ''}
                onChange={(e) => update({ requireSupervisorAbovePercent: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="20"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Max Refunds Per Day"
                type="number"
                value={draft.maxRefundsPerDay ?? ''}
                onChange={(e) => update({ maxRefundsPerDay: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="2"
                fullWidth
              />
              <TextField
                label="Refund Window (days)"
                type="number"
                value={draft.refundWindowDays ?? ''}
                onChange={(e) => update({ refundWindowDays: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="e.g., 30"
                fullWidth
              />
              <TextField
                label="Max Lifetime Refund Count"
                type="number"
                value={draft.maxLifetimeRefundCount ?? ''}
                onChange={(e) => update({ maxLifetimeRefundCount: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="e.g., 3"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Allowed Payment Methods (comma or newline separated)"
                value={allowText}
                onChange={(e) => setAllowText(e.target.value)}
                onBlur={() => update({ allowPaymentMethods: parseAllow(allowText) })}
                placeholder={"e.g.\nCard\nCash on Delivery\nUPI"}
                helperText="Use commas or new lines to separate values. Spaces within a value are allowed."
                fullWidth
                multiline
                minRows={2}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel
                control={<Switch checked={!!draft.bypassPercentCapForPartials} onChange={(e) => update({ bypassPercentCapForPartials: e.target.checked })} />}
                label="Bypass % Cap for Partials"
              />
              <FormControlLabel
                control={<Switch checked={!!draft.blockIfAlreadyRefunded} onChange={(e) => update({ blockIfAlreadyRefunded: e.target.checked })} />}
                label="Block if Already Refunded"
              />
            </Stack>

            <Box>
              <Button variant="contained" onClick={publish} disabled={!canPublish}>
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
              {!isSuperAdmin && !selectedTenantId && (
                <Typography variant="caption" sx={{ ml: 2 }} color="text.secondary">Select a tenant to enable publishing</Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
