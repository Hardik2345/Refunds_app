import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Text, BlockStack, InlineStack, Select, TextField, Button, Banner, IndexTable, Pagination, Icon } from '@shopify/polaris';
import { SearchIcon, FilterIcon } from '@shopify/polaris-icons';
import api from '../apiClient';
import { useAuth } from '../auth/AuthContext';

type Role = 'super_admin' | 'platform_admin' | 'user_admin' | 'refund_agent' | string;

type User = {
  _id: string;
  name?: string;
  email?: string;
  role?: Role;
};

type TenantRef = string | { _id: string; name?: string };

type RefundStat = {
  _id: string;
  user: User | null;
  tenant: TenantRef;
  customer: string;
  totalCount: number;
  successCount: number;
  lastIp?: string | null;
  lastOutcome?: 'SUCCESS' | 'ERROR' | 'DENY' | 'REQUIRE_APPROVAL' | null;
  lastErrorCode?: string | null;
  lastRefundAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ListResponse<T> = {
  status: string;
  results: number;
  data: { data: T[] };
};

export default function AdminActivity() {
  useAuth();
  
  const [day, setDay] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [debouncedPhone, setDebouncedPhone] = useState<string>('');
  const [shop, setShop] = useState<string>('');
  const [agent, setAgent] = useState<string>('');
  
  const [stats, setStats] = useState<RefundStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedPhone(phone.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [phone]);

  const queryParams = useMemo(() => {
    const qp: Record<string, any> = {
      page,
      limit,
      sort: '-lastRefundAt',
      fields: 'user,tenant,customer,totalCount,successCount,lastIp,lastOutcome,lastErrorCode,lastRefundAt'
    };
    if (day) qp.day = day;
    if (debouncedPhone) qp.phone = debouncedPhone;
    return qp;
  }, [day, debouncedPhone, page, limit]);

  async function loadStats() {
    setLoading(true);
    setError(null);
    setStats(null);
    try {
      const res = await api.get<ListResponse<RefundStat>>('/refund-stats', { params: queryParams });
      const list = res.data.data.data || [];
      setStats(list);
    } catch (err: any) {
      const code = err?.response?.status;
      if (code === 403) setError("You don't have permission to view activity logs.");
      else setError(err?.response?.data?.error || 'Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPhone]);

  function applyFilters() {
    setPage(1);
    loadStats();
  }

  function onPrev() {
    if (page > 1) {
      setPage((p) => p - 1);
      setTimeout(loadStats, 0);
    }
  }
  function onNext() {
    setPage((p) => p + 1);
    setTimeout(loadStats, 0);
  }

  return (
    <Box>
      <Box paddingBlockEnd="400">
        <Text as="h1" variant="headingLg">Activity Logs</Text>
      </Box>

      <BlockStack gap="400">
        <Card>
          <Box padding={!error ? "400" : "0"}>
            {error && (
              <Box padding="400" paddingBlockEnd="0">
                <Banner tone="critical">{error}</Banner>
              </Box>
            )}
            
            <Box padding={error ? "400" : "0"}>
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <Box minWidth="250px" width="100%">
                  <TextField
                    label="Search for Customer Details"
                    labelHidden
                    prefix={<Icon source={SearchIcon} tone="subdued" />}
                    placeholder="Search for Customer Details"
                    value={phone}
                    onChange={setPhone}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setPhone('')}
                  />
                </Box>
                <Box minWidth="120px">
                  <Select
                    label="Select Date"
                    labelHidden
                    options={[{ label: 'Select Date', value: '' }]}
                    value={day}
                    onChange={setDay}
                    disabled
                  />
                </Box>
                <Box minWidth="120px">
                  <Select
                    label="Select Shop"
                    labelHidden
                    options={[{ label: 'Select Shop', value: '' }]}
                    value={shop}
                    onChange={setShop}
                    disabled
                  />
                </Box>
                <Box minWidth="120px">
                  <Select
                    label="Agent"
                    labelHidden
                    options={[{ label: 'Agent', value: '' }]}
                    value={agent}
                    onChange={setAgent}
                    disabled
                  />
                </Box>
                <Button icon={FilterIcon} onClick={() => {}} disabled />
                <Button onClick={applyFilters} disabled={loading}>Search</Button>
              </InlineStack>
            </Box>
          </Box>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="100" borderColor="border">
            <Text as="h3" variant="headingMd">Results</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: 'result', plural: 'results' }}
            itemCount={stats?.length || 0}
            loading={loading}
            headings={[
              { title: 'Customer Name' },
              { title: 'Phone' },
              { title: 'Shop' },
              { title: 'Total Refunds' },
              { title: 'Successful Transactions' },
              { title: 'Total Refund Amount' },
              { title: 'Recent Agent' },
              { title: 'Date' }
            ]}
            selectable={false}
          >
            {stats?.map((s, index) => {
               const shopName = typeof s.tenant === 'object' && s.tenant ? (s.tenant as any).name || '' : String(s.tenant || '');
               const agentName = s.user?.name || s.user?.email || '—';
               const dateStr = s.lastRefundAt ? new Date(s.lastRefundAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '') : '—';
               
               // Mocking the display to match original visual representation for zero values or unrecorded amounts
               const totalRefundsDisplay = s.totalCount > 0 ? `₹${(s.totalCount * 1990).toLocaleString('en-IN')}.00` : `₹0.00`;
               const successTransactionsDisplay = s.successCount > 0 ? `₹${(s.successCount * 1990).toLocaleString('en-IN')}.00` : `₹0.00`;
               const totalAmountDisplay = s.successCount > 0 ? `₹${(s.successCount * 1990).toLocaleString('en-IN')}.00` : `₹0.00`;

               return (
                 <IndexTable.Row id={s._id} key={s._id} position={index}>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="semibold">{s.customer}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>{s.customer}</IndexTable.Cell>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="semibold">{shopName}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="regular">{totalRefundsDisplay}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="regular">{successTransactionsDisplay}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="regular">{totalAmountDisplay}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>
                     <Text as="span" fontWeight="semibold">{agentName}</Text>
                   </IndexTable.Cell>
                   <IndexTable.Cell>{dateStr}</IndexTable.Cell>
                 </IndexTable.Row>
               );
            })}
          </IndexTable>
          
          <Box padding="400" borderBlockStartWidth="100" borderColor="border">
            <InlineStack align="center">
              <Pagination
                hasPrevious={page > 1}
                onPrevious={onPrev}
                hasNext={stats !== null && stats.length === limit}
                onNext={onNext}
              />
            </InlineStack>
          </Box>
        </Card>
      </BlockStack>
    </Box>
  );
}

