const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Apply auth and admin middleware to all routes
router.use(authMiddleware.verifyToken);
router.use(requireAdmin);

// === SYSTEM MANAGEMENT ===
router.get('/stats', adminController.getAdminStats);
router.get('/settings', adminController.getSystemSettings);
router.put('/settings', adminController.updateSystemSetting);

// === USER MANAGEMENT ===
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.put('/users/:userId/balance', adminController.adjustUserBalance);

// === DEPOSIT MANAGEMENT ===
router.get('/deposits', adminController.getAllDeposits);
router.put('/deposits/:depositId/status', adminController.updateDepositStatus);
router.delete('/deposits/:depositId', adminController.deleteDeposit);

// === WITHDRAWAL MANAGEMENT ===
router.get('/withdrawals', adminController.getAllWithdrawals);
router.put('/withdrawals/:withdrawalId/status', adminController.updateWithdrawalStatus);
router.post('/withdrawals/:withdrawalId/process', adminController.processWithdrawal);

// === MINING ENGINE MANAGEMENT ===
router.get('/mining-engines', adminController.getAllMiningEngines);
router.post('/mining-engines', adminController.createMiningEngine);
router.put('/mining-engines/:engineId', adminController.updateMiningEngine);
router.delete('/mining-engines/:engineId', adminController.deleteMiningEngine);

// === REFERRAL MANAGEMENT ===
router.get('/referrals/stats', adminController.getReferralStats);

// === ADMIN LOGS ===
router.get('/logs', adminController.getAdminLogs);
router.get('/activities', adminController.getAdminActivities);

module.exports = router;
