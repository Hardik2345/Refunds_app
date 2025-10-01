import { createContext, useContext, useEffect, useState } from 'react';

type User = { _id?: string; name?: string; email?: string; role?: string } | null;

type AuthContextType = {
	user: User;
	setUser: (u: User) => void;
	selectedTenantId: string | null;
	setSelectedTenantId: (id: string | null) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<User>(null);
	const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);

	// Initialize tenant from localStorage to keep axios in sync on reloads
	useEffect(() => {
		const saved = localStorage.getItem('tenantId');
		if (saved) setSelectedTenantIdState(saved);
	}, []);

	const setSelectedTenantId = (id: string | null) => {
		setSelectedTenantIdState(id);
		if (id) localStorage.setItem('tenantId', id);
		else localStorage.removeItem('tenantId');
	};

	return (
		<AuthContext.Provider value={{ user, setUser, selectedTenantId, setSelectedTenantId }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}

