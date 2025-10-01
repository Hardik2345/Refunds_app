const express = require('express');
const authController = require('../controllers/authController');
const tenantController = require('../controllers/tenantController');
const tenantMiddleware = require('../middlewares/tenantMiddleware');

const router = express.Router();

// Protect routes
router.use(authController.protect);

// Optional: for per-tenant context on non-admin ops
// router.use(tenantMiddleware);

router
  .route('/')
  .get(
    authController.restrictTo('platform_admin'),
    tenantController.getAllTenants
  )
  .post(
    authController.restrictTo('platform_admin'),
    tenantController.createTenant
  );

router
  .route('/:id')
  .get(
    authController.restrictTo('platform_admin'),
    tenantController.getTenant
  )
  .patch(
    authController.restrictTo('platform_admin'),
    tenantController.updateTenant
  )
  .delete(
    authController.restrictTo('platform_admin'),
    tenantController.deleteTenant
  );

module.exports = router;
