import { useEffect, useState } from 'react';
import { Button, Popover, ActionList, Text, InlineStack, Icon } from '@shopify/polaris';
import { 
  PersonFilledIcon, 
  ShieldCheckMarkIcon, 
  PersonIcon, 
  ProfileIcon,
  SearchIcon
} from '@shopify/polaris-icons';
import api, { setTenantHeader } from '../apiClient';
import { useAuth } from '../auth/AuthContext';

export default function UserMenu() {
  const { user, setUser, setSelectedTenantId } = useAuth();
  const [loading, setLoading] = useState<boolean>(!user);
  const [active, setActive] = useState(false);

  const toggleActive = () => setActive((prev) => !prev);

  useEffect(() => {
    let mounted = true;
    if (!user && window.location.pathname !== '/login') {
      api.get('/users/me').then((res) => {
        if (!mounted) return;
        setUser(res.data?.data?.data || null);
      }).catch(() => {
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
    } finally {
      setUser(null);
      setSelectedTenantId(null);
      setTenantHeader(null);
      window.location.href = '/login';
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm('Deactivate your account? This will disable access until an admin reactivates it.')) return;
    try {
      const res = await api.delete('/users/deleteMe');
      if (res.status === 204) {
        setUser(null);
        setSelectedTenantId(null);
        setTenantHeader(null);
        window.location.href = '/login';
      }
    } catch (e) {
      setUser(null);
      setSelectedTenantId(null);
      setTenantHeader(null);
      window.location.href = '/login';
    }
  };

  if (loading) {
    return <Button variant="tertiary" disabled>Loading…</Button>;
  }

  if (!user) {
    return (
      <Button variant="primary" url="/login">
        Login
      </Button>
    );
  }

  const roleKey = (user as any).role || (Array.isArray((user as any).roles) ? (user as any).roles[0] : null);
  
  // Mapping roles to Names and Icons
  const roleConfig: Record<string, { label: string; icon: any; color: string }> = {
    platform_admin: { label: 'Platform Admin', icon: ShieldCheckMarkIcon, color: '#9c6ade' },
    super_admin: { label: 'Super Admin', icon: PersonFilledIcon, color: '#008060' },
    user_admin: { label: 'User Admin', icon: PersonIcon, color: '#458fff' },
    agent: { label: 'Agent', icon: ProfileIcon, color: '#6d7175' }
  };

  const currentRole = roleConfig[roleKey] || { label: roleKey || 'User', icon: SearchIcon, color: '#6d7175' };

  const activator = (
    <div onClick={toggleActive} style={{ cursor: 'pointer' }}>
      <InlineStack gap="200" align="center" blockAlign="center">
        <div style={{ 
          backgroundColor: currentRole.color, 
          padding: '6px', 
          borderRadius: '8px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: 'white'
        }}>
          <Icon source={currentRole.icon} tone="inherit" />
        </div>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {currentRole.label}
        </Text>
      </InlineStack>
    </div>
  );

  const actions = [
    {
      content: 'Deactivate account',
      destructive: true,
      onAction: handleDeactivate,
    },
    {
      content: 'Logout',
      onAction: handleLogout,
    },
  ];

  return (
    <Popover
      active={active}
      activator={activator}
      onClose={toggleActive}
      autofocusTarget="none"
    >
      <ActionList items={actions} />
    </Popover>
  );
}

