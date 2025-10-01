import { useEffect, useMemo, useState } from 'react';
import { Button, Menu, MenuItem, Divider, Typography } from '@mui/material';
import api, { setTenantHeader } from '../apiClient';
import { useAuth } from '../auth/AuthContext';

export default function UserMenu() {
  const { user, setUser, setSelectedTenantId } = useAuth();
  const [loading, setLoading] = useState<boolean>(!user);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = useMemo(() => Boolean(anchorEl), [anchorEl]);

  useEffect(() => {
    let mounted = true;
    // Lazily check session so header reflects auth across routes
    if (!user && window.location.pathname !== '/login') {
      api.get('/users/me').then((res) => {
        if (!mounted) return;
        setUser(res.data?.data?.data || null);
      }).catch(() => {
        // not logged in
      }).finally(() => {
        if (mounted) setLoading(false);
      });
    } else {
      setLoading(false);
    }
    return () => { mounted = false; };
  }, [user, setUser]);

  const handleLogout = async () => {
    try {
      await api.get('/users/logout');
    } catch {
      // ignore errors on logout
    } finally {
      setUser(null);
      setSelectedTenantId(null);
      setTenantHeader(null);
      window.location.href = '/login';
    }
  };

  if (loading) {
    return (
      <Button size="small" variant="text" disabled sx={{ opacity: 0.6 }}>Loading…</Button>
    );
  }

  if (!user) {
    return (
      <Button size="small" variant="contained" color="primary" href="/login">
        Login
      </Button>
    );
  }

  const displayName = user.name || user.email || 'Account';
  const role = (user as any).role || (Array.isArray((user as any).roles) ? (user as any).roles[0] : null);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        sx={{ textTransform: 'none' }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, mr: role ? 0.75 : 0 }}>{displayName}</Typography>
        {role && (
          <Typography variant="caption" color="text.secondary">({String(role)})</Typography>
        )}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled>
          <div>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{displayName}</Typography>
            {role && <Typography variant="caption" color="text.secondary">Role: {String(role)}</Typography>}
          </div>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => setAnchorEl(null)}>Account</MenuItem>
        <MenuItem onClick={() => setAnchorEl(null)}>Settings</MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>Logout</MenuItem>
      </Menu>
    </>
  );
}
