import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  TextField,
  MenuItem,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Grid,
  Chip,
  Divider,
} from '@mui/material';
import api from '../apiClient';
import { useAuth } from '../auth/AuthContext';

type Role = 'super_admin' | 'platform_admin' | 'user_admin' | 'refund_agent' | string;

type User = {
  _id: string;
  name?: string;
  email?: string;
  role?: Role;
};

type TenantRef = string | { _id: string; name?: string };

type RefundStat = {
  _id: string;
  user: User | null;
  tenant: TenantRef;
  customer: string;
  totalCount: number;
  successCount: number;
  lastIp?: string | null;
  lastOutcome?: 'SUCCESS' | 'ERROR' | 'DENY' | 'REQUIRE_APPROVAL' | null;
  lastErrorCode?: string | null;
  lastRefundAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ListResponse<T> = {
  status: string;
  results: number;
  data: { data: T[] };
};

type UsersListResponse = {
  status: string;
  results: number;
  data: { data: User[] };
};

export default function AdminActivity() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const normalized = roles.map((r: string) => r?.toLowerCase?.());
  const isPlatformAdmin = normalized.includes('platform_admin');

  const [day, setDay] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<RefundStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalShown, setTotalShown] = useState(0);

  const canFilterUser = isPlatformAdmin; // Super admin: only day filter per requirements

  useEffect(() => {
    if (isPlatformAdmin) {
      // Load users for this tenant for the user filter
      // Tenant is sourced from TenantSelector (header) via axios default header
      api
        .get<UsersListResponse>('/users', { params: { limit: 1000, fields: 'name,email,role' } })
        .then((res) => setUsers(res.data.data.data || []))
        .catch(() => setUsers([]));
    }
  }, [isPlatformAdmin]);

  const queryParams = useMemo(() => {
    const qp: Record<string, any> = {
      page,
      limit,
      sort: '-lastRefundAt',
      // Request only the fields we plan to render (new detailed logs)
      fields: 'user,tenant,customer,totalCount,successCount,lastIp,lastOutcome,lastErrorCode,lastRefundAt'
    };
    if (day) qp.day = day;
    if (canFilterUser && userId) qp.user = userId;
    return qp;
  }, [day, canFilterUser, userId, page, limit]);

  async function loadStats() {
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const res = await api.get<ListResponse<RefundStat>>('/refund-stats', { params: queryParams });
      const list = res.data.data.data || [];
      setStats(list);
      setTotalShown(list.length);
    } catch (err: any) {
      const code = err?.response?.status;
      if (code === 403) setError("You don't have permission to view activity logs.");
      else setError(err?.response?.data?.error || 'Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial load
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setPage(1);
    loadStats();
  }

  function onPrev() {
    if (page > 1) {
      setPage((p) => p - 1);
      setTimeout(loadStats, 0);
    }
  }
  function onNext() {
    setPage((p) => p + 1);
    setTimeout(loadStats, 0);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <Card sx={{ width: '100%', maxWidth: 960 }}>
          <CardHeader
            title="Activity Logs"
            subheader={isPlatformAdmin ? 'Filter by day and user. Tenant is selected from the header.' : 'Filter by day (bound to your tenant).'}
          />
          <CardContent>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Box component="form" onSubmit={applyFilters} sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <TextField
                label="Day"
                type="date"
                size="small"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              {canFilterUser && (
                <TextField
                  select
                  label="User"
                  size="small"
                  sx={{ minWidth: 220 }}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  SelectProps={{
                    displayEmpty: true,
                    renderValue: (selected) => {
                      if (!selected) {
                        return <span style={{ color: 'rgba(0,0,0,0.6)' }}>All users</span>;
                      }
                      const u = users.find((x) => x._id === selected);
                      return (u?.name || u?.email || 'User') as unknown as string;
                    },
                  }}
                >
                  <MenuItem value="">All users</MenuItem>
                  {users.map((u) => (
                    <MenuItem key={u._id} value={u._id}>
                      {u.name || u.email || u._id}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <Button type="submit" variant="contained" disabled={loading} sx={{ ml: { xs: 0, sm: 1 } }}>
                {loading ? <CircularProgress size={18} /> : 'Apply'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardHeader
          title="Results"
          subheader={stats ? `${totalShown} rows • page ${page}` : ''}
          sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label="Rows"
                select
                size="small"
                sx={{ width: 100 }}
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); setTimeout(loadStats, 0); }}
              >
                {[10, 20, 50, 100].map((opt) => (
                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" onClick={onPrev} disabled={loading || page <= 1}>
                Prev
              </Button>
              <Button variant="outlined" onClick={onNext} disabled={loading || (stats !== null && stats.length < limit)}>
                Next
              </Button>
            </Box>
          }
        />
        <Divider />
        <CardContent>
          <Box sx={{ maxHeight: '60vh', overflowY: 'auto', pr: 1 }}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {!loading && stats && stats.length === 0 && <Alert severity="info">No activity found for the selected filters.</Alert>}
            {!loading && stats && stats.length > 0 && (
              <Grid container spacing={1.5}>
                {stats.map((s) => {
                  const outcome = s.lastOutcome || null;
                  const outcomeColor: 'default' | 'success' | 'error' | 'warning' | 'info' =
                    outcome === 'SUCCESS' ? 'success'
                    : outcome === 'ERROR' ? 'error'
                    : outcome === 'DENY' ? 'warning'
                    : outcome === 'REQUIRE_APPROVAL' ? 'info'
                    : 'default';

                  return (
                    <Grid item xs={12} key={s._id}>
                      <Card
                        variant="outlined"
                        sx={{
                          borderRadius: 2,
                          overflow: 'hidden',
                          boxShadow: 'none',
                          borderLeft: (theme) => `4px solid ${
                            outcome === 'SUCCESS'
                              ? theme.palette.success.main
                              : outcome === 'ERROR'
                              ? theme.palette.error.main
                              : outcome === 'DENY'
                              ? theme.palette.warning.main
                              : outcome === 'REQUIRE_APPROVAL'
                              ? theme.palette.info.main
                              : theme.palette.divider
                          }`,
                        }}
                      >
                        <CardHeader
                          title={`Last refunded by: ${s.user?.name || s.user?.email || 'Unknown user'}`}
                          subheader={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                              <Typography variant="caption" color="text.secondary">Tenant:</Typography>
                              <Typography variant="caption">
                                {typeof s.tenant === 'object' && s.tenant && (s.tenant as any).name
                                  ? (s.tenant as any).name
                                  : String(s.tenant)}
                              </Typography>
                            </Box>
                          }
                          sx={{
                            pb: 0.25,
                            '& .MuiCardHeader-title': { fontSize: 14, fontWeight: 600 },
                            '& .MuiCardHeader-subheader': { fontSize: 11 }
                          }}
                        />
                        <CardContent sx={{ pt: 1, pb: 1.25, display: 'grid', gap: 0.75 }}>
                          {/* Outcome & error */}
                          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Chip size="small" label={outcome || '—'} color={outcomeColor} variant="outlined" />
                            {s.lastErrorCode && (
                              <Chip size="small" label={`error: ${s.lastErrorCode}`} color="warning" variant="outlined" />
                            )}
                          </Box>

                          {/* Counts */}
                          <Box sx={{ display: 'flex', gap: 0.75 }}>
                            <Chip size="small" label={`total: ${s.totalCount ?? 0}`} variant="outlined" />
                            <Chip size="small" label={`success: ${s.successCount ?? 0}`} variant="outlined" color="success" />
                          </Box>

                          {/* Customer & IP */}
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto 1fr auto 1fr' }, columnGap: 1, rowGap: 0.25 }}>
                            <Typography variant="caption" color="text.secondary">Customer</Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{s.customer}</Typography>
                            <Typography variant="caption" color="text.secondary">IP</Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{s.lastIp || '—'}</Typography>
                          </Box>

                          {/* Timestamp subtle */}
                          <Typography variant="caption" color="text.secondary">
                            {s.lastRefundAt ? new Date(s.lastRefundAt).toLocaleString() : '—'}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
