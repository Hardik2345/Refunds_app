const Tenant = require("../models/tenantModel");

/**
 * Middleware to attach tenant context to the request.
 * 
 * - Checks for tenant ID in `x-tenant-id` header or `req.user.tenantId`.
 * - Loads tenant from DB and attaches it to `req.tenant`.
 * - Throws 404 if tenant not found.
 */
module.exports = async function tenantMiddleware(req, res, next) {
  try {
    const headerTenantId = req.headers["x-tenant-id"];
    const role = req.user?.role || (Array.isArray(req.user?.roles) ? req.user.roles[0] : null);
    const userTenantId = req.user?.storeId || req.user?.tenantId || null; // storeId references Tenant

    // Refund agents and super_admin are always scoped to their assigned tenant (storeId)
    if (role === 'refund_agent' || role === 'super_admin') {
      if (!userTenantId) {
        return res.status(403).json({ error: "No tenant assigned to your account" });
      }
      if (headerTenantId && String(headerTenantId) !== String(userTenantId)) {
        return res.status(403).json({ error: "Mismatched tenant. You are not allowed to switch tenants." });
      }
      const tenant = await Tenant.findById(userTenantId);
      if (!tenant) return res.status(404).json({ error: "Assigned tenant not found" });
      req.tenant = tenant;
      return next();
    }

    // Admin roles that can switch: require explicit x-tenant-id header
    const adminRoles = new Set(['platform_admin', 'user_admin']);
    if (adminRoles.has(String(role))) {
      if (!headerTenantId) {
        return res.status(400).json({ error: "Tenant ID missing" });
      }
      const tenant = await Tenant.findById(headerTenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      req.tenant = tenant;
      return next();
    }

    // Fallback: require header (legacy roles)
    if (!headerTenantId) return res.status(400).json({ error: "Tenant ID missing" });
    const tenant = await Tenant.findById(headerTenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    req.tenant = tenant;
    return next();
  } catch (err) {
    console.error("Tenant resolution failed:", err.message);
    res.status(500).json({ error: "Failed to resolve tenant context" });
  }
};
