const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// User routes
// User requests withdrawal (email verification removed)
router.post('/request', authMiddleware.verifyToken, withdrawalController.requestWithdrawal);

// User views their withdrawals
router.get('/', authMiddleware.verifyToken, withdrawalController.getUserWithdrawals);

// Admin routes
// Admin approves withdrawal
router.post('/approve/:withdrawalId', authMiddleware.verifyToken, requireAdmin, withdrawalController.approveWithdrawal);

// Admin rejects withdrawal
router.post('/reject/:withdrawalId', authMiddleware.verifyToken, requireAdmin, withdrawalController.rejectWithdrawal);

// M-Pesa callback URL for withdrawal confirmation (no auth required for callbacks)
router.post('/mpesa-callback', withdrawalController.mpesaWithdrawalCallback);

module.exports = router;
