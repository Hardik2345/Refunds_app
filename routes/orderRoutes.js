const express = require('express');
const { getOrders, refundOrderByPhone,approvePendingRefund, denyPendingRefund, bulkPreviewRefunds } = require('../controllers/refundsController');
const { buildRefundContext, applyRefundRules} = require("../middlewares/rules");
const authController = require('../controllers/authController');
const tenantMiddleware = require('../middlewares/tenantMiddleware');
const router = express.Router();

// Apply auth + tenant context only to this router's endpoints
const secure = [authController.protect, tenantMiddleware];

function requireSuperAdmin(req, res, next) {
  if (!req.user?.roles?.includes('super_admin')) {
    return res.status(403).json({ error: 'Super admin required' });
  }
  next();
}


router.route('/orders').get(secure, getOrders);

router.route('/refund')
  .post(
    secure, 
    buildRefundContext,
    applyRefundRules,
    refundOrderByPhone
  );
  
router.post('/refund/preview/bulk', secure, bulkPreviewRefunds);

router.post(
  '/refund/:pendingId/approve',
  secure,
  requireSuperAdmin,
  approvePendingRefund
);

router.post(
  '/refund/:pendingId/deny',
  secure,
  requireSuperAdmin,
  denyPendingRefund
);


module.exports = router;