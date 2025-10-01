import { useState } from 'react';
import { Box, Card, CardContent, CardActions, TextField, Button, Typography, Alert } from '@mui/material';
import api from '../apiClient';

export default function Login() {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await api.post('/users/login', { email, password });
			window.location.href = '/agent';
		} catch (err: any) {
			setError(err?.response?.data?.message || 'Login failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
			<Card sx={{ width: 380 }} component="form" onSubmit={onSubmit}>
				<CardContent>
					<Typography variant="h6" gutterBottom>Login</Typography>
					{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
					<TextField fullWidth label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} margin="normal" required />
					<TextField fullWidth label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} margin="normal" required />
				</CardContent>
				<CardActions sx={{ p: 2 }}>
					<Button type="submit" variant="contained" disabled={loading} fullWidth>
						{loading ? 'Signing in…' : 'Login'}
					</Button>
				</CardActions>
			</Card>
		</Box>
	);
}

