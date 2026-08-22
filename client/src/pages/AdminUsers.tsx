import { useEffect, useRef, useState } from 'react';
import { Box, Card, Text, BlockStack, InlineGrid, InlineStack, TextField, Button, Banner, IndexTable, Badge, ButtonGroup, Icon } from '@shopify/polaris';
import { CustomSelect } from '../components/CustomSelect';
import { EditIcon, DeleteIcon, PersonIcon } from '@shopify/polaris-icons';
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
  const [audits, setAudits] = useState<any[]>([]);
  const [loadingAudits, setLoadingAudits] = useState<boolean>(false);
  const [auditPage, setAuditPage] = useState<number>(1);
  const [auditLimit] = useState<number>(10);
  const [auditTotal, setAuditTotal] = useState<number>(0);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('refund_agent');
  const [storeId, setStoreId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userShopFilter, setUserShopFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'active' | 'inactive'>('active');
  const hasInitializedUserSearch = useRef(false);
  const suppressNextUserSearch = useRef(false);
  
  const roleOfCurrent = String((user as any)?.role || '').toLowerCase();
  const canManage = user && (user as any).role && ['platform_admin', 'super_admin', 'user_admin'].includes(roleOfCurrent);
  const isSuperAdmin = roleOfCurrent === 'super_admin';
  const currentUserId = (user as any)?._id || '';
  const loadUsers = async (filters = {
    search: userSearch.trim(),
    role: userRoleFilter,
    storeId: userShopFilter,
    status: userStatusFilter
  }) => {
    try {
      setLoading(true);
      const res = await api.get('/users', { params: { fields: 'name,email,role,storeId,isActive', ...filters } });
      setUsers(res.data?.data?.data || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const loadTenants = async () => {
    try {
      setLoadingTenants(true);
      const res = await api.get('/tenants', { params: { limit: 200, fields: 'name,shopDomain' } });
      setTenants(res.data?.data?.data || []);
    } catch { setTenants([]); } finally { setLoadingTenants(false); }
  };

  const loadAudits = async (page?: number) => {
    if (!canManage) return;
    try {
      setLoadingAudits(true);
      const p = page ?? auditPage;
      const res = await api.get('/user-audits', { params: { page: p, limit: auditLimit, sort: '-createdAt' } });
      setAudits(res.data?.data?.data || []);
      setAuditTotal(Number(res.data?.total ?? 0));
      setAuditPage(Number(res.data?.page ?? p) || 1);
    } catch { setAudits([]); setAuditTotal(0); } finally { setLoadingAudits(false); }
  };

  useEffect(() => {
    if (canManage) {
      loadUsers();
      if (!isSuperAdmin) loadTenants();
      setAuditPage(1); loadAudits(1);
    }
  }, [canManage, isSuperAdmin]);

  useEffect(() => { if (role === 'platform_admin') setStoreId(''); }, [role]);

  useEffect(() => {
    if (!canManage) return;
    if (!hasInitializedUserSearch.current) {
      hasInitializedUserSearch.current = true;
      return;
    }
    if (suppressNextUserSearch.current) {
      suppressNextUserSearch.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      loadUsers({
        search: userSearch.trim(),
        role: userRoleFilter,
        storeId: userShopFilter,
        status: userStatusFilter
      });
    }, 400);
    return () => window.clearTimeout(timer);
    // Search is intentionally the only automatic filter; the remaining filters apply on button click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearch, canManage]);

  const onSubmit = async (e: React.FormEvent) => {
    if (e) e.preventDefault();
    setMsg(null);
    if (!canManage) { setMsg({ type: 'error', text: 'Permission denied.' }); return; }
    if (!name || !email || !password || !passwordConfirm) { setMsg({ type: 'error', text: 'All starred fields inclusive password confirm required.' }); return; }
    if (role !== 'platform_admin' && roleOfCurrent !== 'super_admin' && !storeId) { setMsg({ type: 'error', text: 'Tenant is required for this role.' }); return; }
    if (password !== passwordConfirm) { setMsg({ type: 'error', text: 'Passwords do not match.' }); return; }
    
    setSubmitting(true);
    try {
      const payload: any = { name, email, phone, role, password, passwordConfirm };
      if (role !== 'platform_admin') payload.storeId = roleOfCurrent === 'super_admin' ? String((user as any)?.storeId || '') : storeId;
      
      const res = await api.post('/users', payload);
      if (res.status === 201 || res.status === 200) {
        setMsg({ type: 'success', text: `User ${name} ${res.status === 200 ? 'restored' : 'created'}.` });
        setName(''); setEmail(''); setPhone(''); setStoreId(''); setPassword(''); setPasswordConfirm(''); setRole('refund_agent');
        loadUsers(); loadAudits();
      }
    } catch (e: any) { setMsg({ type: 'error', text: e?.response?.data?.message || 'Failed to create user' }); } finally { setSubmitting(false); }
  };

  const onDeleteUser = async (id: string, display: string) => {
    if (!canManage || !id) return;
    if (!window.confirm(`Delete user ${display}? This will deactivate their account.`)) return;
    setDeletingId(id); setMsg(null);
    try {
      await api.delete(`/users/${id}`);
      setMsg({ type: 'success', text: `User ${display} deleted.` }); loadUsers(); loadAudits();
    } catch (e: any) { setMsg({ type: 'error', text: 'Failed to delete user' }); } finally { setDeletingId(null); }
  };

  const roleOptions = [
    { label: 'Refund Agent', value: 'refund_agent' },
    { label: 'Platform Admin', value: 'platform_admin', disabled: roleOfCurrent === 'super_admin' },
    { label: 'Super Admin', value: 'super_admin' }
  ];

  const tenantOptions = tenants.map((t) => ({ label: t.name, value: t._id }));
  const userRoleFilterOptions = [
    { label: 'All roles', value: '' },
    { label: 'Refund Agent', value: 'refund_agent' },
    { label: 'Platform Admin', value: 'platform_admin' },
    { label: 'Super Admin', value: 'super_admin' },
    { label: 'User Admin', value: 'user_admin' }
  ];
  const userStatusFilterOptions = [
    { label: 'Active users', value: 'active' },
    { label: 'Inactive users', value: 'inactive' }
  ];

  const applyUserFilters = () => loadUsers();
  const clearUserFilters = () => {
    suppressNextUserSearch.current = true;
    setUserSearch('');
    setUserRoleFilter('');
    setUserShopFilter('');
    setUserStatusFilter('active');
    loadUsers({ search: '', role: '', storeId: '', status: 'active' });
  };

  return (
    <Box>
      <Box paddingBlockEnd="400">
        <Text as="h1" variant="headingLg">Manage Users</Text>
        <Text as="p" tone="subdued">Create and manage users</Text>
      </Box>

      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        {/* Left Column: Form */}
        <Box>
          <Card>
            <Box padding="400">
              <form onSubmit={onSubmit}>
                <BlockStack gap="400">
                  {msg && <Banner tone={msg.type === 'error' ? 'critical' : 'success'}>{msg.text}</Banner>}
                  
                  <TextField label="Name *" value={name} onChange={setName} autoComplete="off" />
                  <TextField label="Email *" type="email" value={email} onChange={setEmail} autoComplete="off" />
                  <TextField label="Phone" value={phone} onChange={setPhone} autoComplete="off" />
                  
                  <CustomSelect
                    label="Role *"
                    options={roleOptions}
                    value={role}
                    onChange={(v) => setRole(v as Role)}
                  />

                  {role !== 'platform_admin' && roleOfCurrent !== 'super_admin' && (
                    <CustomSelect
                      label="Shop *"
                      options={[{ label: 'Select shop assigned to user', value: '' }, ...tenantOptions]}
                      value={storeId}
                      onChange={setStoreId}
                      disabled={loadingTenants}
                    />
                  )}

                  <TextField label="Password *" type="password" value={password} onChange={setPassword} autoComplete="off" />
                  <TextField label="Confirm Password *" type="password" value={passwordConfirm} onChange={setPasswordConfirm} autoComplete="off" />

                  <Box>
                    <Button submit variant="primary" loading={submitting} disabled={!canManage}>
                      Create User
                    </Button>
                  </Box>
                </BlockStack>
              </form>
            </Box>
          </Card>
        </Box>

        {/* Right Column: List and Audits */}
        <BlockStack gap="400">
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="100" borderColor="border">
              <InlineStack align="space-between">
                <div>
                  <Text as="h3" variant="headingMd">All Users</Text>
                  <Text as="p" tone="subdued">{loading ? 'Loading...' : `${users.length} Members`}</Text>
                </div>
              </InlineStack>
            </Box>

            <Box padding="400" borderBlockEndWidth="100" borderColor="border">
              <BlockStack gap="300">
                <TextField
                  label="Search users"
                  labelHidden
                  placeholder="Search name or email"
                  value={userSearch}
                  onChange={setUserSearch}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => setUserSearch('')}
                />
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                  <CustomSelect options={userRoleFilterOptions} value={userRoleFilter} onChange={setUserRoleFilter} />
                  <CustomSelect
                    options={[{ label: 'All shops', value: '' }, ...tenantOptions]}
                    value={userShopFilter}
                    onChange={setUserShopFilter}
                    disabled={loadingTenants || isSuperAdmin}
                    placeholder="All shops"
                  />
                  <CustomSelect options={userStatusFilterOptions} value={userStatusFilter} onChange={(value) => setUserStatusFilter(value as 'active' | 'inactive')} />
                </InlineGrid>
                <InlineStack gap="200">
                  <Button onClick={applyUserFilters} loading={loading}>Apply filters</Button>
                  <Button onClick={clearUserFilters} disabled={loading}>Clear</Button>
                </InlineStack>
              </BlockStack>
            </Box>

            <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
              <Box padding="400">
                <BlockStack gap="300">
                  {users.map((u: any) => {
                  const id = u.id || u._id;
                  const isSelf = id === currentUserId;
                  const display = u.name || u.email || id;
                  return (
                    <Box key={id} padding="300" background="bg-surface-secondary" borderRadius="300">
                      <InlineGrid columns={{ xs: '1fr auto', sm: '1fr 1fr auto' }} alignItems="center" gap="300">
                        {/* Avatar and Name */}
                        <InlineStack gap="300" blockAlign="center">
                          <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#5c5f62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <div style={{ width: 24, height: 24, fill: '#ffffff' }}>
                              <Icon source={PersonIcon} tone="base" />
                            </div>
                          </div>
                          <div>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{u.name}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{u.email}</Text>
                          </div>
                        </InlineStack>

                        {/* Role and Store */}
                        <div>
                          <Text as="p" variant="bodyMd" tone="subdued">
                            {String(u.role || '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {u.storeId?.name || 'No Store Assigned'}
                          </Text>
                        </div>
                        
                        {/* Actions */}
                        <InlineStack align="end" gap="200" blockAlign="center">
                          <ButtonGroup>
                            <Button icon={EditIcon} variant="tertiary" onClick={() => {}} disabled />
                             <Button icon={DeleteIcon} variant="tertiary" onClick={() => onDeleteUser(id, display)} disabled={isSelf || !canManage} loading={deletingId === id} />
                          </ButtonGroup>
                        </InlineStack>
                      </InlineGrid>
                    </Box>
                  );
                  })}
                </BlockStack>
              </Box>
            </div>
          </Card>

          {/* Audit Logs */}
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="100" borderColor="border">
              <Text as="h3" variant="headingMd">User Audit Logs</Text>
              <Text as="p" tone="subdued">Page {auditPage} of {Math.max(1, Math.ceil(auditTotal / auditLimit))}</Text>
            </Box>

             <IndexTable
               resourceName={{ singular: 'audit', plural: 'audits' }}
               itemCount={audits.length}
               headings={[
                 { title: 'User' },
                 { title: 'Action' },
                 { title: 'Shop' },
                 { title: 'Date' },
                 { title: 'Info' }
               ]}
               selectable={false}
               loading={loadingAudits}
             >
              {audits.map((a: any, idx: number) => (
                <IndexTable.Row id={a._id} key={a._id} position={idx}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">{a.targetUser?.name || 'User'}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={a.action === 'USER_CREATED' ? 'success' : a.action === 'USER_DELETED' ? 'critical' : 'attention'}>
                      {a.action.replace('USER_', '')}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{a.tenant?.name || '—'}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(a.createdAt).toLocaleDateString()}</IndexTable.Cell>
                  <IndexTable.Cell>{a.actor?.name || '—'}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </BlockStack>
      </InlineGrid>
    </Box>
  );
}
