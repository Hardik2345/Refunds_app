const UserAudit = require('../models/userAuditModel');
const catchAsync = require('./../utils/catchAsync');

// GET /api/v1/user-audits
// Query params: page, limit, sort, action, actor, targetUser, tenant, from, to
exports.listAudits = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    sort = '-createdAt',
    action,
    actor,
    targetUser,
    tenant,
    from,
    to,
  } = req.query || {};

  const filter = {};
  if (action) filter.action = action;
  if (actor) filter.actor = actor;
  if (targetUser) filter.targetUser = targetUser;
  // Tenant scoping:
  // - If middleware attached a tenant, enforce it
  // - Else, if explicit tenant param provided, use it
  // - Else, no tenant filter (ALL tenants)
  if (req.tenant?._id) {
    filter.tenant = req.tenant._id;
  } else if (tenant) {
    filter.tenant = tenant;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(String(from));
    if (to) filter.createdAt.$lte = new Date(String(to));
  }

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
