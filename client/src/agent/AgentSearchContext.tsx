import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useAuth } from '../auth/AuthContext';

export type AgentSearchMode = 'phone' | 'orderName';
export type AgentTab = 0 | 1;
export type CashbackStatus = 'available' | 'unavailable' | 'not_configured' | 'multiple_customers';

export interface OrderLineItem {
  id: number;
  name: string;
  quantity: number;
  price: string;
}

export interface OrderSummary {
  id: number;
  name: string;
  created_at: string;
  current_subtotal_price: string;
  financial_status: string;
  fulfillment_status: string;
  line_items: OrderLineItem[];
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  } | null;
}

export interface RuleDecision {
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  reason?: string;
  matched?: string[];
  rulesVersion?: number;
  ruleSetId?: string | null;
}

export interface PreviewResult {
  orderId: number | null;
  decision: RuleDecision | null;
  requiresApproval: boolean | null;
  ctxHints?: {
    orderId?: number | null;
    rulesVersion?: number;
    ruleSetId?: string | null;
    attemptsToday?: number | null;
    daysSinceDelivery?: number | null;
    availableBalance?: number | null;
    totalDeducted?: number | null;
    totalCredited?: number | null;
    totalCredits?: number | null;
    totalSpentCredits?: number | null;
  } | null;
  error?: string | null;
}

export interface CashbackSummary {
  customerId?: string | null;
  status?: 'available' | 'unavailable' | 'not_configured';
  totalCredited: number | null;
  totalDeducted: number | null;
  availableBalance: number | null;
  fetchedAt?: string | null;
}

interface AgentSearchContextValue {
  searchMode: AgentSearchMode;
  setSearchMode: Dispatch<SetStateAction<AgentSearchMode>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  orders: OrderSummary[] | null;
  setOrders: Dispatch<SetStateAction<OrderSummary[] | null>>;
  preview: Record<string, PreviewResult>;
  setPreview: Dispatch<SetStateAction<Record<string, PreviewResult>>>;
  tab: AgentTab;
  setTab: Dispatch<SetStateAction<AgentTab>>;
  cashbackSummary: CashbackSummary | null;
  setCashbackSummary: Dispatch<SetStateAction<CashbackSummary | null>>;
  cashbackStatus: CashbackStatus | 'idle';
  setCashbackStatus: Dispatch<SetStateAction<CashbackStatus | 'idle'>>;
  lastFetchedAt: number | null;
  setLastFetchedAt: Dispatch<SetStateAction<number | null>>;
  clearSearch: () => void;
}

const AgentSearchContext = createContext<AgentSearchContextValue | undefined>(undefined);

export function AgentSearchProvider({ children }: { children: ReactNode }) {
  const { user, selectedTenantId } = useAuth();
  const [searchMode, setSearchMode] = useState<AgentSearchMode>('phone');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [preview, setPreview] = useState<Record<string, PreviewResult>>({});
  const [tab, setTab] = useState<AgentTab>(0);
  const [cashbackSummary, setCashbackSummary] = useState<CashbackSummary | null>(null);
  const [cashbackStatus, setCashbackStatus] = useState<CashbackStatus | 'idle'>('idle');
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const clearSearch = useCallback(() => {
    setQuery('');
    setOrders(null);
    setPreview({});
    setCashbackSummary(null);
    setCashbackStatus('idle');
    setLastFetchedAt(null);
  }, []);

  const identityKey = `${user?._id || 'anonymous'}:${selectedTenantId || 'default'}`;
  const previousIdentityKey = useRef(identityKey);

  useEffect(() => {
    if (previousIdentityKey.current === identityKey) return;
    previousIdentityKey.current = identityKey;
    setSearchMode('phone');
    setTab(0);
    clearSearch();
  }, [clearSearch, identityKey]);

  return (
    <AgentSearchContext.Provider
      value={{
        searchMode,
        setSearchMode,
        query,
        setQuery,
        orders,
        setOrders,
        preview,
        setPreview,
        tab,
        setTab,
        cashbackSummary,
        setCashbackSummary,
        cashbackStatus,
        setCashbackStatus,
        lastFetchedAt,
        setLastFetchedAt,
        clearSearch,
      }}
    >
      {children}
    </AgentSearchContext.Provider>
  );
}

// This module intentionally colocates the provider and its hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useAgentSearch() {
  const context = useContext(AgentSearchContext);
  if (!context) throw new Error('useAgentSearch must be used within AgentSearchProvider');
  return context;
}
