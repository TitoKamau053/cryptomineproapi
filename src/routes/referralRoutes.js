const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes (no authentication required)
// Validate referral code for signup page
router.get('/validate/:referral_code', referralController.validateReferralCode);

// Protected routes (authentication required)
// User views referral info and commissions
router.get('/', authMiddleware.verifyToken, referralController.getReferralInfo);

// Generate referral link for sharing
router.get('/generate', authMiddleware.verifyToken, referralController.generateReferralLink);

// Get referral commission history
router.get('/commissions', authMiddleware.verifyToken, referralController.getReferralCommissions);

// Get information about who referred the current user
router.get('/my-referrer', authMiddleware.verifyToken, referralController.getMyReferrer);

module.exports = router;
