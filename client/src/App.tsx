import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import { Link as RouterLink } from 'react-router-dom';
import UserMenu from './components/UserMenu';
import { Box, InlineStack, Text } from '@shopify/polaris';
import { motion, AnimatePresence } from 'framer-motion';
import { PageTransition } from './components/PageTransition';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppContent() {
  const location = useLocation();
  return (
    <>
      <style>{`
        .Polaris-Card {
          transition: transform 0.2s ease, box-shadow 0.2s ease !important;
        }
        .Polaris-Card:hover {
          transform: translateY(-2px);
          box-shadow: var(--p-shadow-300) !important;
        }
        .Polaris-Button {
          transition: transform 0.1s ease !important;
        }
        .Polaris-Button:active {
          transform: scale(0.98);
        }
      `}</style>
      
      {/* Header bar structure */}
      <Box 
        paddingInline="600" 
        borderBlockEndWidth="100" 
        borderColor="border" 
        background="bg-surface"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' }}>
          <Box>
            <Text as="h2" variant="headingLg" fontWeight="semibold">
              Refunds Portal
            </Text>
          </Box>
          
          <NavLinks />
          
          <HeaderRight />
        </div>
      </Box>

      {/* Main Content Area */}
      <Box paddingBlock="600" paddingInline="600" background="bg-surface-secondary" minHeight="calc(100vh - 65px)">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
            <Route path="/agent" element={<ProtectedRoute><PageTransition><AgentDashboard /></PageTransition></ProtectedRoute>} />
            <Route path="/admin/rules" element={<ProtectedRoute><AdminRoute><PageTransition><AdminRules /></PageTransition></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/tenants" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin"]}><PageTransition><AdminTenants /></PageTransition></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminRoute><PageTransition><AdminUsers /></PageTransition></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/activity" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin","super_admin"]}><PageTransition><AdminActivity /></PageTransition></AdminRoute></ProtectedRoute>} />
            <Route path="/admin/maintenance" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin"]}><PageTransition><AdminMaintenance /></PageTransition></AdminRoute></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/agent" replace />} />
          </Routes>
        </AnimatePresence>
      </Box>
    </>
  );
}

function HeaderRight() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const isAdmin = roles.map((r: string) => r?.toLowerCase?.()).some((r: string) => ['platform_admin','user_admin'].includes(r));
  return (
    <InlineStack gap="500" align="center" blockAlign="center">
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
    <InlineStack gap="600" align="center" blockAlign="stretch" wrap={false}>
      {items.filter(i => i.show).map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + '/');
        return (
          <div key={item.to} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '64px', padding: '0 4px' }}>
            <RouterLink 
              to={item.to} 
              style={{
                textDecoration: 'none',
                color: active ? 'var(--p-color-text)' : 'var(--p-color-text-subdued)',
                fontWeight: active ? '600' : '500',
                fontSize: '15px',
                transition: 'color 0.2s ease',
              }}
            >
              {item.label}
            </RouterLink>
            {active && (
              <motion.div 
                layoutId="nav-underline"
                style={{ 
                  position: 'absolute', 
                  bottom: 0, 
                  left: 0, 
                  right: 0, 
                  height: '3px', 
                  backgroundColor: '#008060', 
                  borderTopLeftRadius: '3px', 
                  borderTopRightRadius: '3px' 
                }} 
              />
            )}
          </div>
        );
      })}
    </InlineStack>
  );
}

