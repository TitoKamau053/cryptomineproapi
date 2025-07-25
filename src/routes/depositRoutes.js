const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkEmailVerification } = require('../middleware/emailVerificationMiddleware');

// User initiates deposit (STK Push) - requires email verification
router.post('/initiate', authMiddleware.verifyToken, checkEmailVerification, depositController.initiateDeposit);

// M-Pesa callback URL for deposit confirmation
router.post('/mpesa-callback', depositController.mpesaDepositCallback);

module.exports = router;
