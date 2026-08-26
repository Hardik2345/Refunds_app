const UserAudit = require('../models/userAuditModel');
const catchAsync = require('./../utils/catchAsync');

// Roles that are allowed to see every store, and therefore also the
// platform-level audit rows that belong to no store at all.
const CROSS_TENANT_ROLES = new Set(['platform_admin', 'user_admin']);

/**
 * Builds the Mongo filter for an audit list request.
 *
 * Tenant scoping:
 * - Middleware-attached tenant wins; otherwise an explicit `tenant` param is used;
 *   otherwise there is no tenant filter (the `x-tenant-id: ALL` case).
 * - Platform admins have no `storeId`, so acting on one writes an audit row with
 *   `tenant: null`. A plain `tenant: <id>` match drops those rows, which made
 *   platform-admin-on-platform-admin creates, deletes and restores invisible
 *   unless the viewer happened to switch to "All stores". Viewers who can see
 *   every store therefore get `tenant: <id> OR tenant: null` — those rows are
 *   attributable to no other store, so this is the only place they can surface.
 * - super_admin stays hard-scoped to its own store: same match, no widening.
 */
function buildAuditFilter({ query = {}, tenant: reqTenant = null, role = null } = {}) {
  const { action, actor, targetUser, tenant, from, to } = query;

  const filter = {};
  if (action) filter.action = action;
  if (actor) filter.actor = actor;
  if (targetUser) filter.targetUser = targetUser;

  const scopedTenantId = reqTenant?._id || tenant || null;
  if (scopedTenantId) {
    if (CROSS_TENANT_ROLES.has(String(role))) {
      filter.$or = [{ tenant: scopedTenantId }, { tenant: null }];
    } else {
      filter.tenant = scopedTenantId;
    }
  }

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(String(from));
    if (to) filter.createdAt.$lte = new Date(String(to));
  }

  return filter;
}

// GET /api/v1/user-audits
// Query params: page, limit, sort, action, actor, targetUser, tenant, from, to
exports.listAudits = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, sort = '-createdAt' } = req.query || {};

  const filter = buildAuditFilter({
    query: req.query || {},
    tenant: req.tenant || null,
    role: req.user?.role,
  });

  const p = Math.max(1, parseInt(page));
  const l = Math.max(1, Math.min(200, parseInt(limit)));

  const query = UserAudit.find(filter)
    .sort(String(sort))
    .skip((p - 1) * l)
    .limit(l)
    .populate({ path: 'actor', select: 'name email role', options: { includeInactive: true } })
    .populate({ path: 'targetUser', select: 'name email role', options: { includeInactive: true } })
    .populate({ path: 'tenant', select: 'name' });

  const [items, total] = await Promise.all([
    query,
    UserAudit.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: items.length,
    page: p,
    limit: l,
    total,
    data: { data: items },
  });
});

// DELETE /api/v1/user-audits
// Query: from, to (ISO), tenant optional (x-tenant-id used via middleware). If neither is provided, block.
exports.deleteAudits = catchAsync(async (req, res, next) => {
  const { from, to } = req.query || {};

  const filter = {};
  if (req.tenant?._id) filter.tenant = req.tenant._id;
  // If ALL (no req.tenant), allow cross-tenant delete for platform_admin (route-enforced)
  // Deliberately NOT widened to `tenant: null` the way listAudits is — deleting one
  // store's logs must never take the platform-level rows with it.

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(String(from));
    if (to) filter.createdAt.$lte = new Date(String(to));
  }

  if (!filter.tenant && !filter.createdAt) {
    return res.status(400).json({ error: 'Provide a tenant (x-tenant-id) or a date range (from/to) to delete audit logs.' });
  }

  const result = await require('../models/userAuditModel').deleteMany(filter);
  return res.status(200).json({ status: 'success', deletedCount: result?.deletedCount || 0 });
});

// Exported for unit tests — the scoping rule is the part worth pinning down.
exports.buildAuditFilter = buildAuditFilter;
