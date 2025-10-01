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

api.interceptors.response.use(
	(res) => res,
	(err) => {
		if (err?.response?.status === 401) {
			if (window.location.pathname !== '/login') window.location.href = '/login';
		}
		return Promise.reject(err);
	}
);

export default api;

