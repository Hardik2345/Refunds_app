import { useEffect, useMemo, useState } from 'react';
import { Button, Popover, ActionList, Avatar, Box, Text, InlineStack } from '@shopify/polaris';
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

  const displayName = user.name || user.email || 'Account';
  const role = (user as any).role || (Array.isArray((user as any).roles) ? (user as any).roles[0] : null);

  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const activator = (
    <Box onClick={toggleActive}>
      <InlineStack gap="200" align="center">
        <Avatar initials={initials} size="md" />
        <InlineStack gap="100" align="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{displayName}</Text>
          {role && <Text as="span" variant="bodyXs" tone="subdued">({String(role)})</Text>}
        </InlineStack>
      </InlineStack>
    </Box>
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

