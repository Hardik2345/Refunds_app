import { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, FormControl, InputLabel, MenuItem, Select, Tooltip } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
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

  // Fetch tenants if admin
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
    // Keep axios header synced when selected tenant changes
    setTenantHeader(selectedTenantId);
  }, [selectedTenantId]);

  if (!isAdmin) return null;

  const handleChange = (evt: SelectChangeEvent<string>) => {
    const id = evt.target.value || '';
    // Allow a special value 'ALL' to represent all tenants for admin views (e.g., audits)
    setSelectedTenantId(id ? id : null);
  };

  return (
    <Box sx={{ minWidth: 220 }}>
      <FormControl size="small" fullWidth>
        <InputLabel id="tenant-label">Tenant</InputLabel>
        <Select
          labelId="tenant-label"
          label="Tenant"
          value={selectedTenantId || ''}
          onChange={handleChange}
          renderValue={(value) => {
            const t = tenants?.find(x => x._id === value);
            if (value === 'ALL') return 'All tenants';
            return t ? `${t.name}` : 'Select tenant';
          }}
        >
          {/* All tenants option for admin roles */}
          <MenuItem value="ALL">All tenants</MenuItem>
          {loading && <MenuItem value=""><CircularProgress size={16} sx={{ mr: 1 }} /> Loading…</MenuItem>}
          {!loading && (tenants || []).map(t => (
            <MenuItem key={t._id} value={t._id}>
              <Tooltip title={t.shopDomain || ''}><span>{t.name}</span></Tooltip>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}
