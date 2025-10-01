import { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import api, { setTenantHeader } from '../apiClient';
import { useAuth } from './AuthContext';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { user, setUser } = useAuth();
	const [loading, setLoading] = useState(!user);

	useEffect(() => {
		let mounted = true;
		if (!user) {
			api.get('/users/me')
								.then((res) => {
					if (!mounted) return;
										const me = res.data?.data?.data || null;
										setUser(me);
										// Auto-bind agents to their tenant in client header
										const role = me?.role || (Array.isArray(me?.roles) ? me.roles[0] : null);
										if (role === 'refund_agent' && me?.storeId) {
											setTenantHeader(String(me.storeId));
										}
				})
				.catch(() => {})
				.finally(() => { if (mounted) setLoading(false); });
		} else {
			setLoading(false);
		}
		return () => { mounted = false; };
	}, [user, setUser]);

	if (loading) {
		return (
			<Box display="flex" alignItems="center" justifyContent="center" minHeight={200}>
				<CircularProgress />
			</Box>
		);
	}

	return <>{children}</>;
}

