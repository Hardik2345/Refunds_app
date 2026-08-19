import { useState } from 'react';
import { Box, Card, Text, BlockStack, InlineGrid, TextField, Button, Banner } from '@shopify/polaris';
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
    if (e) e.preventDefault();
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
    <Box>
      <Box paddingBlockEnd="400">
        <Text as="h1" variant="headingLg">Create Tenant</Text>
        <Text as="p" tone="subdued">Register a new merchant/shop into the platform</Text>
      </Box>

      <Card>
        <Box padding="400">
          <form onSubmit={onCreate}>
            <BlockStack gap="500">
              {msg && <Banner tone={msg.type === 'error' ? 'critical' : 'success'}>{msg.text}</Banner>}
              
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField label="Name *" value={name} onChange={setName} autoComplete="off" />
                <TextField label="Shop Domain *" value={shopDomain} onChange={setShopDomain} placeholder="example.myshopify.com" autoComplete="off" />
              </InlineGrid>

              
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField label="API Version" value={apiVersion} onChange={setApiVersion} autoComplete="off" />
                <TextField label="API Key *" value={apiKey} onChange={setApiKey} autoComplete="off" />
              </InlineGrid>

              
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField label="Access Token *" value={accessToken} onChange={setAccessToken} autoComplete="off" />
                <TextField label="API Secret *" value={apiSecret} onChange={setApiSecret} autoComplete="off" />
              </InlineGrid>

              
              <Box>
                <Button submit variant="primary" loading={submitting}>Create Tenant</Button>
              </Box>
            </BlockStack>
          </form>
        </Box>
      </Card>
    </Box>
  );
}

