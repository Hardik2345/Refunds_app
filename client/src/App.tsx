import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Container, AppBar, Toolbar, Typography, Box } from '@mui/material';
import { theme } from './theme';
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
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Link } from '@mui/material';
import UserMenu from './components/UserMenu';

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <AppBar
            position="fixed"
            color="transparent"
            elevation={0}
            sx={{
              backdropFilter: 'saturate(180%) blur(6px)',
              backgroundColor: 'rgba(255,255,255,0.8)',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display:'flex', alignItems:'center', gap: 2, flexGrow: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, letterSpacing: 0.2 }}>
                  Refunds Portal
                </Typography>
                <NavLinks />
              </Box>
              <HeaderRight />
            </Toolbar>
          </AppBar>
          <Toolbar />
          <Container maxWidth="lg" sx={{ py: 3 }}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/agent" element={<ProtectedRoute><AgentDashboard /></ProtectedRoute>} />
              <Route path="/admin/rules" element={<ProtectedRoute><AdminRoute><AdminRules /></AdminRoute></ProtectedRoute>} />
              <Route path="/admin/tenants" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin"]}><AdminTenants /></AdminRoute></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute><AdminRoute><AdminUsers /></AdminRoute></ProtectedRoute>} />
              <Route path="/admin/activity" element={<ProtectedRoute><AdminRoute allowedRoles={["platform_admin","super_admin"]}><AdminActivity /></AdminRoute></ProtectedRoute>} />
              <Route path="/" element={<Navigate to="/agent" replace />} />
            </Routes>
          </Container>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

function HeaderRight() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const isAdmin = roles.map((r: string) => r?.toLowerCase?.()).some((r: string) => ['platform_admin','user_admin'].includes(r));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {user && isAdmin && (
        <Box sx={{ minWidth: 240 }}>
          <TenantSelector />
        </Box>
      )}
      <UserMenu />
    </Box>
  );
}

function NavLinks() {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const normalizedRoles = roles.map((r: string) => r?.toLowerCase?.());
  const canSeeTenantsLink = normalizedRoles.includes('platform_admin');
  const canSeeActivity = normalizedRoles.includes('platform_admin') || normalizedRoles.includes('super_admin');
  const { pathname } = useLocation();

  const items: Array<{ to: string; label: string; show: boolean }> = [
    { to: '/agent', label: 'Agent', show: true },
    { to: '/admin/rules', label: 'Rules', show: true },
    { to: '/admin/tenants', label: 'Tenants', show: canSeeTenantsLink },
    { to: '/admin/users', label: 'Users', show: true },
    { to: '/admin/activity', label: 'Activity', show: canSeeActivity },
  ];
  return (
    <Box sx={{ display:'flex', alignItems:'center', gap: 1.5 }}>
      {items.filter(i => i.show).map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + '/');
        return (
          <Box key={item.to} sx={{ position: 'relative', pb: 1 }}>
            <Link
              component={RouterLink}
              to={item.to}
              underline="none"
              aria-current={active ? 'page' : undefined}
              color={active ? 'text.primary' : 'text.secondary'}
              sx={{
                fontWeight: active ? 700 : 500,
                letterSpacing: 0.1,
                px: 0.25,
                borderRadius: 0.75,
                transition: 'color .15s ease, background-color .15s ease',
                '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
              }}
            >
              {item.label}
            </Link>
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 2,
                borderRadius: 1,
                bgcolor: active ? 'primary.main' : 'transparent',
                transition: 'background-color .2s ease',
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
}
