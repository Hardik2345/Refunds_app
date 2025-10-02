import axios from 'axios';

const api = axios.create({
	baseURL: '/api/v1',
	withCredentials: true,
});

// Initialize tenant header from localStorage (kept in sync by AuthContext)
const initialTenant = typeof window !== 'undefined' ? localStorage.getItem('tenantId') : null;
if (initialTenant) {
	api.defaults.headers.common['x-tenant-id'] = initialTenant;
}

export function setTenantHeader(tenantId: string | null) {
	if (tenantId) {
		api.defaults.headers.common['x-tenant-id'] = tenantId;
		localStorage.setItem('tenantId', tenantId);
	} else {
		delete api.defaults.headers.common['x-tenant-id'];
		localStorage.removeItem('tenantId');
	}
}

// ----- Refresh-token support -----
// Single-flight refresh promise to avoid parallel refresh storms
let refreshPromise: Promise<any> | null = null;

async function refreshTokensOnce() {
	if (refreshPromise) return refreshPromise;
	// Use a clean axios instance to avoid interceptor recursion
	const refreshClient = axios.create({ baseURL: '/api/v1', withCredentials: true });
	refreshPromise = refreshClient
		.post('/users/refresh')
		.finally(() => {
			// Reset after completion so future 401s can trigger a new refresh
			refreshPromise = null;
		});
	return refreshPromise;
}

api.interceptors.response.use(
	(res) => res,
	async (error) => {
		const { response, config } = error || {};
		const status = response?.status;
		const originalRequest = config || {};

		// If no response or not a 401, just propagate
		if (!response || status !== 401) {
			return Promise.reject(error);
		}

		// Do not try to refresh on auth endpoints themselves
		const url: string = originalRequest?.url || '';
		const isAuthEndpoint = url.includes('/users/login') || url.includes('/users/refresh');

		// Prevent infinite retry loop
		if ((originalRequest as any)._retry || isAuthEndpoint) {
			// Hard fail: clear tenant context and redirect to login
			try { localStorage.removeItem('tenantId'); } catch {}
			if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
				window.location.href = '/login';
			}
			return Promise.reject(error);
		}

		// Mark this request as a retry attempt
		(originalRequest as any)._retry = true;

		try {
			// Attempt a single-flight refresh
			await refreshTokensOnce();
			// Cookies are updated server-side; retry the original request
			return api(originalRequest);
		} catch (refreshErr) {
			// Refresh failed → redirect to login
			try { localStorage.removeItem('tenantId'); } catch {}
			if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
				window.location.href = '/login';
			}
			return Promise.reject(refreshErr);
		}
	}
);

export default api;

