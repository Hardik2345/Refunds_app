const express = require('express');
const authController = require('../controllers/authController');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const statsController = require('../controllers/refundStatController');

const router = express.Router();

// secure all endpoints
const secure = [authController.protect, tenantMiddleware];
const adminsOnly = authController.restrictTo('platform_admin', 'super_admin');

// Common middlewares to scope and interpret filters
const filters = [statsController.scopeToTenant, statsController.setDateFilters];

// GET /api/v1/refund-stats -> list all with filters
router.get('/', secure, adminsOnly, filters, statsController.getAllRefundStats);
router.delete('/', secure, authController.restrictTo('platform_admin'), filters, statsController.deleteRefundStats);

// GET /api/v1/refund-stats/user/:userId -> list all for a specific user
router.get('/user/:userId', secure, adminsOnly, filters, statsController.setUserFilter, statsController.getAllRefundStats);

// GET /api/v1/refund-stats/day/:date -> list all for a specific day (YYYY-MM-DD)
router.get('/day/:date', secure, adminsOnly, filters, statsController.getAllRefundStats);

// Optionally: fetch a single stat by id (if needed by UI)
router.get('/:id', secure, adminsOnly, filters, statsController.getRefundStat);

module.exports = router;
