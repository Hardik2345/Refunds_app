import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Text, BlockStack, InlineGrid, InlineStack, TextField, Button, Banner } from '@shopify/polaris';
import api from '../apiClient';
import { useAuth } from '../auth/AuthContext';

export default function AdminMaintenance() {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  const isPlatformAdmin = role === 'platform_admin';

  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [loadingRefund, setLoadingRefund] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success'|'error'|'warning', text: string }|null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setMsg({ type: 'warning', text: 'Only platform admins can access maintenance tools.' });
    }
  }, [isPlatformAdmin]);

  const commonParams = useMemo(() => {
    const p: any = {};
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [from, to]);

  async function deleteAudits() {
    setMsg(null);
    setLoadingAudit(true);
    try {
      const res = await api.delete('/user-audits', { params: commonParams });
      const n = res.data?.deletedCount ?? 0;
      setMsg({ type: 'success', text: `Deleted ${n} user audit logs.` });
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.error || 'Failed to delete user audit logs' });
    } finally {
      setLoadingAudit(false);
    }
  }

  async function deleteRefunds() {
    setMsg(null);
    setLoadingRefund(true);
    try {
      const params = { ...commonParams } as any;
      if (phone.trim()) params.phone = phone.trim();
      const res = await api.delete('/refund-stats', { params });
      const n = res.data?.deletedCount ?? 0;
      setMsg({ type: 'success', text: `Deleted ${n} refund logs.` });
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.error || 'Failed to delete refund logs' });
    } finally {
      setLoadingRefund(false);
    }
  }

  function confirmAnd(fn: () => Promise<void>, label: string) {
    if (!window.confirm(`Are you sure you want to delete ${label}? This action cannot be undone.`)) return;
    fn();
  }

  return (
    <Box>
      <Box paddingBlockEnd="400">
        <BlockStack gap="200">
          <Text as="h1" variant="headingLg">Maintenance</Text>
          <Text as="p" tone="subdued">Delete audit and refund logs (platform admin only)</Text>
        </BlockStack>
      </Box>

      {msg && (
        <Box paddingBlockEnd="400">
          <Banner tone={msg.type === 'error' ? 'critical' : msg.type === 'warning' ? 'warning' : 'success'} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Banner>
        </Box>
      )}

      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400" alignItems="start">
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">User Audit Logs</Text>
              <Text as="p" tone="subdued">Delete by tenant (header) and/or date range</Text>
            </BlockStack>
            
            <InlineStack gap="300" blockAlign="end" wrap>
              <Box minWidth="140px">
                <TextField label="From" type="date" value={from} onChange={setFrom} autoComplete="off" />
              </Box>
              <Box minWidth="140px">
                <TextField label="To" type="date" value={to} onChange={setTo} autoComplete="off" />
              </Box>
              <Button tone="critical" disabled={!isPlatformAdmin || loadingAudit} loading={loadingAudit} onClick={() => confirmAnd(deleteAudits, 'user audit logs')}>
                Delete Logs
              </Button>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              To delete across all tenants, select "All tenants" in the header.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">Refund Logs</Text>
              <Text as="p" tone="subdued">Delete by tenant (header), date range, and/or customer mobile</Text>
            </BlockStack>
            
            <InlineStack gap="300" blockAlign="end" wrap>
              <Box minWidth="140px">
                <TextField label="From" type="date" value={from} onChange={setFrom} autoComplete="off" />
              </Box>
              <Box minWidth="140px">
                <TextField label="To" type="date" value={to} onChange={setTo} autoComplete="off" />
              </Box>
              <Box minWidth="140px">
                <TextField label="Customer mobile" placeholder="e.g. 9876543210..." value={phone} onChange={setPhone} autoComplete="off" />
              </Box>
              <Button tone="critical" disabled={!isPlatformAdmin || loadingRefund} loading={loadingRefund} onClick={() => confirmAnd(deleteRefunds, 'refund logs')}>
                Delete Logs
              </Button>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              Phone supports +91 and leading zeros. Leave phone blank to delete by date only.
            </Text>
          </BlockStack>
        </Card>
      </InlineGrid>
    </Box>
  );
}
