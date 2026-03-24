import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AgentDashboard from './pages/AgentDashboard';
import ProtectedRoute from './auth/ProtectedRoute';
import { AuthProvider, useAuth } from './auth/AuthContext';
import TenantSelector from './components/TenantSelector';
import AdminRoute from './auth/AdminRoute';
import AdminRules from './pages/AdminRules';
import AdminTenants from './pages/AdminTenants';
import AdminUsers from './pages/AdminUsers';
import AdminActivity from './pages/AdminActivity';
import AdminMaintenance from './pages/AdminMaintenance';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import UserMenu from './components/UserMenu';
import { Box, InlineStack, Text } from '@shopify/polaris';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* Header bar structure */}
        <Box 
          paddingBlock="400" 
          paddingInline="600" 
          borderBottomWidth="100" 
          borderColor="border" 
          background="bg-surface"
        >
          <InlineStack align="space-between" blockAlign="center">
            <Box>
              <Text as="h2" variant="headingLg" fontWeight="semibold">
                Refunds Portal
              </Text>
            </Box>
            
            <NavLinks />
            
            <HeaderRight />
          </InlineStack>
        </Box>

        {/* Main Content Area */}
        <Box paddingBlock="600" paddingInline="600" background="bg-surface-secondary" minHeight="calc(100vh - 65px)">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/agent" element={<ProtectedRoute><AgentDashboard /></ProtectedRoute>} />
            <Route path="/admin/rules" element={<ProtectedRoute><AdminRoute><AdminRules /></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/tenants" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin"]}><AdminTenants /></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminRoute><AdminUsers /></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/activity" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin","super_admin"]}><AdminActivity /></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/maintenance" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin"]}><AdminMaintenance /></AdminRoute></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/agent" replace />} />
          </Routes>
        </Box>
      </BrowserRouter>
    </AuthProvider>
  );
}

function HeaderRight() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const isAdmin = roles.map((r: string) => r?.toLowerCase?.()).some((r: string) => ['platform_admin','user_admin'].includes(r));
  return (
    <InlineStack gap="500" align="center">
      {user && isAdmin && (
        <TenantSelector />
      )}
      <UserMenu />
    </InlineStack>
  );
}

function NavLinks() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const normalizedRoles = roles.map((r: string) => r?.toLowerCase?.());
  const canSeeTenantsLink = normalizedRoles.includes('platform_admin');
  const canSeeActivity = normalizedRoles.includes('platform_admin') || normalizedRoles.includes('super_admin');
  const canSeeMaintenance = normalizedRoles.includes('platform_admin');
  const { pathname } = useLocation();

  const items: Array<{ to: string; label: string; show: boolean }> = [
    { to: '/agent', label: 'Agent', show: true },
    { to: '/admin/rules', label: 'Rules', show: true },
    { to: '/admin/users', label: 'Users', show: true },
    { to: '/admin/activity', label: 'Activity', show: canSeeActivity },
  ];
  // Add Tenants or Maintenance conditionally
  if (canSeeTenantsLink) items.splice(2, 0, { to: '/admin/tenants', label: 'Tenants', show: true });
  if (canSeeMaintenance) items.push({ to: '/admin/maintenance', label: 'Maintenance', show: true });

  return (
    <InlineStack gap="400" align="center">
      {items.filter(i => i.show).map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + '/');
        // Custom link styling replicating green underline mockup
        return (
          <Box key={item.to} position="relative" paddingBlock="100">
            <RouterLink 
              to={item.to} 
              style={{
                textDecoration: 'none',
                color: active ? 'var(--p-color-text)' : 'var(--p-color-text-subdued)',
                fontWeight: active ? '600' : '500',
                fontSize: '14px',
                padding: '4px 8px',
                borderRadius: '4px',
                transition: 'color 0.15s ease',
              }}
            >
              {item.label}
            </RouterLink>
            {active && (
              <Box 
                position="absolute" 
                insetBlockEnd="0px" 
                insetInlineStart="0px" 
                insetInlineEnd="0px" 
                height="3px" 
                background="bg-subdued" // placeholder, but we will style it emerald green setup below
                style={{ backgroundColor: '#008060', borderRadius: '2px' }} // Polaris green
              />
            )}
          </Box>
        );
      })}
    </InlineStack>
  );
}

