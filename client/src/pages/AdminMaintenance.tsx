import { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardHeader, CardContent, TextField, Button, Alert, CircularProgress, Grid, Typography } from '@mui/material';
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
  const [msg, setMsg] = useState<{ type: 'success'|'error', text: string }|null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) setMsg({ type: 'error', text: 'Only platform admins can access maintenance tools.' });
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
      <Card sx={{ mb: 2 }}>
        <CardHeader title="Maintenance" subheader="Delete audit and refund logs (platform admin only)" />
        <CardContent>
          {msg && <Alert severity={msg.type} sx={{ mb: 2 }}>{msg.text}</Alert>}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardHeader title="User Audit Logs" subheader="Delete by tenant (header) and/or date range" />
                <CardContent>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField label="From" type="date" size="small" value={from} onChange={(e)=>setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
                    <TextField label="To" type="date" size="small" value={to} onChange={(e)=>setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
                    <Button variant="outlined" color="error" disabled={!isPlatformAdmin || loadingAudit} onClick={() => confirmAnd(deleteAudits, 'user audit logs')}>
                      {loadingAudit ? <CircularProgress size={18} /> : 'Delete Logs'}
                    </Button>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>To delete across all tenants, select "All tenants" in the header.</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardHeader title="Refund Logs" subheader="Delete by tenant (header), date range, and/or customer mobile" />
                <CardContent>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField label="From" type="date" size="small" value={from} onChange={(e)=>setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
                    <TextField label="To" type="date" size="small" value={to} onChange={(e)=>setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
                    <TextField label="Customer mobile" placeholder="e.g. 9876543210 or +91..." size="small" value={phone} onChange={(e)=>setPhone(e.target.value)} />
                    <Button variant="outlined" color="error" disabled={!isPlatformAdmin || loadingRefund} onClick={() => confirmAnd(deleteRefunds, 'refund logs')}>
                      {loadingRefund ? <CircularProgress size={18} /> : 'Delete Logs'}
                    </Button>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Phone supports +91 and leading zeros. Leave phone blank to delete by date only.</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
}
