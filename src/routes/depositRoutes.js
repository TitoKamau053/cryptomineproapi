const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const authMiddleware = require('../middleware/authMiddleware');

// User initiates deposit (STK Push) - email verification removed
router.post('/initiate', authMiddleware.verifyToken, depositController.initiateDeposit);

// M-Pesa callback URL for deposit confirmation
router.post('/mpesa-callback', depositController.mpesaDepositCallback);

module.exports = router;
