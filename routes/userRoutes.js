const express = require('express');
const userController = require('./../controllers/userController');
const authController = require('./../controllers/authController');
const User = require('./../models/userModel');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.get('/logout', authController.logout);
router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPasssword);
router.post('/refresh', authController.refresh);

// Protect all routes after this middleware
router.use(authController.protect);

router.patch('/updateMyPassword', authController.updatePassword);

router.get('/me', userController.getMe, userController.getUser);
router.patch(
  '/updateMe',
  userController.updateMe,
);
router.delete('/deleteMe', userController.deleteMe);

// Admin-only user management routes
// Allow both super_admin and platform_admin for listing/updating/deleting users
// Restrict create (POST /) to platform_admin specifically

// Middleware to forbid super_admin from creating platform_admin
function forbidSuperAdminCreatingPlatformAdmin(req, res, next) {
  const requesterRole = req.user?.role;
  const targetRole = req.body?.role || 'refund_agent';
  if (requesterRole === 'super_admin' && targetRole === 'platform_admin') {
    return res.status(403).json({ error: 'super_admin cannot create platform_admin users' });
  }
  next();
}

router
  .route('/')
  .get(authController.restrictTo('super_admin','platform_admin','user_admin'), userController.getAllUsers)
  .post(authController.protect, authController.restrictTo('super_admin','platform_admin','user_admin'), forbidSuperAdminCreatingPlatformAdmin, userController.createUser);

// Middleware to forbid non-platform_admin from deleting platform_admin users
async function forbidDeletingPlatformAdmin(req, res, next) {
  try {
    const targetId = req.params?.id;
    if (!targetId) return next();
    const target = await User.findById(targetId).select('role');
    const requesterRole = req.user?.role;
    if (target && target.role === 'platform_admin' && requesterRole !== 'platform_admin') {
      return res.status(403).json({ error: 'Only platform_admin can delete platform_admin users' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

router
  .route('/:id')
  .get(authController.restrictTo('super_admin','platform_admin','user_admin'), userController.getUser)
  .patch(authController.restrictTo('super_admin','platform_admin','user_admin'), userController.updateUser)
  .delete(authController.restrictTo('super_admin','platform_admin','user_admin'), forbidDeletingPlatformAdmin, userController.deleteUser);

module.exports = router;