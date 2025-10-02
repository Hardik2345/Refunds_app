import { useEffect, useState } from 'react';
import { Box, Card, CardContent, CardHeader, TextField, MenuItem, Button, Alert, Stack, FormHelperText, FormControl, InputLabel, Select, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, CircularProgress } from '@mui/material';
import api from '../apiClient';
import { useAuth } from '../auth/AuthContext';

type Role = 'refund_agent' | 'platform_admin' | 'super_admin' | 'user_admin';

type Tenant = { _id: string; name: string; shopDomain?: string };

export default function AdminUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadingTenants, setLoadingTenants] = useState<boolean>(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('refund_agent');
  const [storeId, setStoreId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const roleOfCurrent = String((user as any)?.role || '').toLowerCase();
  const canManage = user && (user as any).role && ['platform_admin', 'super_admin', 'user_admin'].includes(roleOfCurrent);
  const currentUserId = (user as any)?._id || '';

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/users', { params: { fields: 'name,email,role,storeId' } });
      const data = res.data?.data?.data || [];
      setUsers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadTenants = async () => {
    try {
      setLoadingTenants(true);
      const res = await api.get('/tenants', { params: { limit: 200, fields: 'name,shopDomain' } });
      setTenants(res.data?.data?.data || []);
    } catch {
      setTenants([]);
    } finally {
      setLoadingTenants(false);
    }
  };

  useEffect(() => {
    if (canManage) {
      loadUsers();
      loadTenants();
    }
  }, [canManage]);

  useEffect(() => {
    if (role === 'platform_admin') setStoreId('');
  }, [role]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!canManage) {
      setMsg({ type: 'error', text: 'You do not have permission to create users.' });
      return;
    }
    if (!name || !email || !password || !passwordConfirm) {
      setMsg({ type: 'error', text: 'Name, email, password and confirmation are required.' });
      return;
    }
    if (role !== 'platform_admin' && !storeId) {
      setMsg({ type: 'error', text: 'Tenant is required for non-platform_admin users.' });
      return;
    }
    if (password !== passwordConfirm) {
      setMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = { name, email, phone, role, password, passwordConfirm };
      if (role !== 'platform_admin') {
        if (roleOfCurrent === 'super_admin') {
          payload.storeId = String((user as any)?.storeId || '');
        } else {
          payload.storeId = storeId;
        }
      }
      const res = await api.post('/users', payload);
      if (res.status === 201) {
        setMsg({ type: 'success', text: `User ${name} created.` });
        setName(''); setEmail(''); setPhone(''); setStoreId(''); setPassword(''); setPasswordConfirm(''); setRole('refund_agent');
        loadUsers();
      } else {
        setMsg({ type: 'error', text: 'Failed to create user.' });
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.message || e?.response?.data?.error || 'Failed to create user' });
    } finally {
      setSubmitting(false);
    }
  };

  const onDeleteUser = async (id: string, display: string) => {
    if (!canManage) {
      setMsg({ type: 'error', text: 'You do not have permission to delete users.' });
      return;
    }
    if (!id) return;
    if (!window.confirm(`Delete user ${display}? This will deactivate their account.`)) return;
    setDeletingId(id);
    setMsg(null);
    try {
      const res = await api.delete(`/users/${id}`);
      if (res.status === 204) {
        setMsg({ type: 'success', text: `User ${display} deleted.` });
        loadUsers();
      } else {
        setMsg({ type: 'error', text: 'Failed to delete user.' });
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.message || e?.response?.data?.error || 'Failed to delete user' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Box>
      <Stack spacing={3}>
        <Typography variant="h6">Users</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
          <Card sx={{ flex: 1, minWidth: 320 }}>
            <CardHeader title="Create User" subheader="Platform Admin or Super Admin" />
            <CardContent>
              {msg && <Alert severity={msg.type} sx={{ mb: 2 }}>{msg.text}</Alert>}
              <Box component="form" onSubmit={onSubmit}>
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth required />
                    <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth required />
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth />
                    <FormControl fullWidth>
                      <InputLabel id="role-label">Role</InputLabel>
                      <Select labelId="role-label" label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                        <MenuItem value="refund_agent">Refund Agent</MenuItem>
                        {roleOfCurrent !== 'super_admin' && (
                          <MenuItem value="platform_admin">Platform Admin</MenuItem>
                        )}
                        <MenuItem value="super_admin">Super Admin</MenuItem>
                      </Select>
                      <FormHelperText>Select the role for this user</FormHelperText>
                    </FormControl>
                  </Stack>
                  {role !== 'platform_admin' && roleOfCurrent !== 'super_admin' && (
                    <FormControl fullWidth required>
                      <InputLabel id="tenant-select-label" shrink>Tenant</InputLabel>
                      <Select
                        labelId="tenant-select-label"
                        label="Tenant"
                        value={storeId}
                        onChange={(e) => setStoreId(String(e.target.value))}
                        displayEmpty
                      >
                        <MenuItem value="" disabled>
                          Select tenant
                        </MenuItem>
                        {loadingTenants && (
                          <MenuItem value="">
                            <CircularProgress size={16} style={{ marginRight: 8 }} /> Loading…
                          </MenuItem>
                        )}
                        {!loadingTenants && tenants.map((t: Tenant) => (
                          <MenuItem key={t._id} value={t._id}>{t.name}</MenuItem>
                        ))}
                      </Select>
                      <FormHelperText>Select the tenant to assign this user to</FormHelperText>
                    </FormControl>
                  )}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth required />
                    <TextField label="Confirm Password" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} fullWidth required />
                  </Stack>
                  <Box>
                    <Button type="submit" variant="contained" disabled={submitting || !canManage}>
                      {submitting ? 'Creating…' : 'Create User'}
                    </Button>
                  </Box>
                </Stack>
              </Box>
            </CardContent>
          </Card>

          <Paper sx={{ flex: 2, overflow: 'hidden', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>All Users</Typography>
              <Typography variant="caption" color="text.secondary">{loading ? 'Loading…' : `${users.length} total`}</Typography>
            </Box>
            <Box sx={{ maxHeight: 480, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Tenant</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u: any) => {
                    const id = u.id || u._id;
                    const isSelf = id === currentUserId;
                    const display = u.name || u.email || id;
                    return (
                      <TableRow key={id} hover>
                        <TableCell>{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{String(u.role || '').replace('_', ' ')}</TableCell>
                        <TableCell>{u.storeId?.name || '—'}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            disabled={!canManage || isSelf || deletingId === id}
                            onClick={() => onDeleteUser(id, display)}
                          >
                            {deletingId === id ? 'Deleting…' : 'Delete'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!users.length && !loading && (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography variant="body2" color="text.secondary">No users found.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  );
}
