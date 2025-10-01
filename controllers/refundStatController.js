const RefundStat = require('../models/refundStatModel');
const handlerFactory = require('./handlerFactory');
const catchAsync = require('../utils/catchAsync');

// Ensure queries are scoped to the resolved tenant
exports.scopeToTenant = (req, res, next) => {
  if (req.tenant?._id) {
    // Force tenant scoping regardless of client query
    req.query.tenant = req.tenant._id.toString();
  }
  next();
};

// If a userId is present in params, propagate to query filter
exports.setUserFilter = (req, res, next) => {
  if (req.params.userId) {
    req.query.user = req.params.userId;
  }
  next();
};

// Convert day/startDate/endDate query or params into lastRefundAt range filter
exports.setDateFilters = (req, res, next) => {
  const day = req.params.date || req.query.day; // YYYY-MM-DD expected
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;

  // Helper to build ISO start/end
  function buildDayRange(input) {
    const d = new Date(input);
    if (isNaN(d.getTime())) return null;
    // Use UTC to avoid TZ ambiguity across clients
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    return { start, end };
  }

  const range = day ? buildDayRange(day) : null;
  const start = range?.start || (startDate ? new Date(startDate) : null);
  const end = range?.end || (endDate ? new Date(endDate) : null);

  if (start && isNaN(start.getTime())) return next();
  if (end && isNaN(end.getTime())) return next();

  if (start || end) {
    const filter = {};
    if (start) filter.gte = start.toISOString();
    if (end) filter.lte = end.toISOString();
    // APIFeatures supports operators when passed as nested object
    req.query.lastRefundAt = filter;
  }

  next();
};

// CRUD/Read-only handlers leveraging the generic factory
exports.getAllRefundStats = handlerFactory.getAll(RefundStat);
exports.getRefundStat = handlerFactory.getOne(RefundStat);
