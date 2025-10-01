import { Box, Typography } from '@mui/material';
import { useAuth } from './AuthContext';

type Props = {
  children: React.ReactNode;
  allowedRoles?: Array<'platform_admin' | 'super_admin' | 'user_admin'>;
};

export default function AdminRoute({ children, allowedRoles }: Props) {
  const { user } = useAuth();
  const roles = (user?.role ? [user.role] : (user as any)?.roles) || [];
  const normalized = roles.map((r: string) => r?.toLowerCase?.());
  const defaultAllowed = new Set(['platform_admin', 'super_admin', 'user_admin']);
  const allowed = new Set((allowedRoles || Array.from(defaultAllowed)).map((r) => r.toLowerCase()));
  const authorized = normalized.some((r: string) => allowed.has(r));

  if (!authorized) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>403 — Not allowed</Typography>
        <Typography variant="body2">You don't have permission to view this page.</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}
