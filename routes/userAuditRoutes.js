const express = require('express');
const authController = require('./../controllers/authController');
const userAuditController = require('./../controllers/userAuditController');
const tenantMiddleware = require('./../middlewares/tenantMiddleware');

const router = express.Router();

// Protect everything
router.use(authController.protect);
// Restrict viewing audits to admin roles
router.use(authController.restrictTo('platform_admin', 'user_admin', 'super_admin'));
// Resolve tenant: platform_admin via x-tenant-id; super_admin bound to assigned tenant
router.use(tenantMiddleware);

router.get('/', userAuditController.listAudits);
// Delete audits (platform_admin only). Tenant scoping via middleware; x-tenant-id=ALL allows cross-tenant delete.
router.delete('/', authController.restrictTo('platform_admin'), userAuditController.deleteAudits);

module.exports = router;
