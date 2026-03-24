import { useEffect, useMemo, useState } from 'react';
import { Select, Box, Text } from '@shopify/polaris';
import api, { setTenantHeader } from '../apiClient';
import { useAuth } from '../auth/AuthContext';

interface Tenant { _id: string; name: string; shopDomain?: string }
interface TenantListResponse { data: { data: Tenant[] }; results?: number }

export default function TenantSelector() {
  const { user, selectedTenantId, setSelectedTenantId } = useAuth();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [loading, setLoading] = useState(false);

  const isAdmin = useMemo(() => {
    const role = user?.role?.toLowerCase();
    return role === 'platform_admin' || role === 'user_admin' || role === 'admin';
  }, [user]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!isAdmin) return;
      setLoading(true);
      try {
        const res = await api.get<TenantListResponse>('/tenants', { params: { limit: 200, fields: 'name,shopDomain' } });
        if (!mounted) return;
        setTenants(res.data?.data?.data || []);
      } catch (e) {
        setTenants([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [isAdmin]);

  useEffect(() => {
    setTenantHeader(selectedTenantId);
  }, [selectedTenantId]);

  if (!isAdmin) return null;

  const options = [
    { label: 'All tenants', value: 'ALL' },
    ...(tenants || []).map(t => ({
      label: t.name,
      value: t._id,
    }))
  ];

  return (
    <Box minWidth="200px">
      <Select
        label={
          <Text as="span" variant="bodyXs" tone="subdued">Shop</Text>
        }
        options={options}
        onChange={(value) => setSelectedTenantId(value === 'ALL' ? null : value)}
        value={selectedTenantId || ''}
        disabled={loading}
      />
    </Box>
  );
}

