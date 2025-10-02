const express = require('express');
const authController = require('./../controllers/authController');
const userAuditController = require('./../controllers/userAuditController');

const router = express.Router();

// Protect everything
router.use(authController.protect);
// Restrict viewing audits to admin roles
router.use(authController.restrictTo('platform_admin', 'user_admin', 'super_admin'));

router.get('/', userAuditController.listAudits);

module.exports = router;
