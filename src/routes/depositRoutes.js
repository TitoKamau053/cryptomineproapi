const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const authMiddleware = require('../middleware/authMiddleware');

// User initiates deposit (STK Push)
router.post('/initiate', authMiddleware.verifyToken, depositController.initiateDeposit);

// M-Pesa callback URL for deposit confirmation
// Note: This route needs to be publicly accessible without authentication
// because it's called by the M-Pesa service
router.post('/mpesa-callback', depositController.mpesaDepositCallback);

module.exports = router;
