import { useState } from 'react';
import { Box, Card, CardContent, CardHeader, TextField, Button, Alert, Stack } from '@mui/material';
import api from '../apiClient';

export default function AdminTenants() {
  const [name, setName] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [apiVersion, setApiVersion] = useState('2025-07');
  const [apiKey, setApiKey] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [msg, setMsg] = useState<{type:'success'|'error', text:string}|null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    try {
      await api.post('/tenants', { name, shopDomain, apiVersion, apiKey, accessToken, apiSecret });
      setMsg({ type: 'success', text: 'Tenant created.' });
      setName(''); setShopDomain(''); setApiKey(''); setAccessToken(''); setApiSecret('');
    } catch (e:any) {
      setMsg({ type: 'error', text: e?.response?.data?.error || 'Failed to create tenant' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ display:'flex', justifyContent:'center' }}>
      <Card sx={{ width:'100%', maxWidth: 900 }}>
        <CardHeader title="Create Tenant" subheader="Register a new merchant/shop into the platform" />
        <CardContent>
          {msg && <Alert severity={msg.type} sx={{ mb: 2 }}>{msg.text}</Alert>}
          <Box component="form" onSubmit={onCreate}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Name" value={name} onChange={(e)=>setName(e.target.value)} fullWidth required />
                <TextField label="Shop Domain" value={shopDomain} onChange={(e)=>setShopDomain(e.target.value)} placeholder="example.myshopify.com" fullWidth required />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="API Version" value={apiVersion} onChange={(e)=>setApiVersion(e.target.value)} fullWidth />
                <TextField label="API Key" value={apiKey} onChange={(e)=>setApiKey(e.target.value)} fullWidth required />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Access Token" value={accessToken} onChange={(e)=>setAccessToken(e.target.value)} fullWidth required />
                <TextField label="API Secret" value={apiSecret} onChange={(e)=>setApiSecret(e.target.value)} fullWidth required />
              </Stack>
              <Box>
                <Button type="submit" variant="contained" disabled={submitting}>{submitting?'Creating…':'Create Tenant'}</Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
