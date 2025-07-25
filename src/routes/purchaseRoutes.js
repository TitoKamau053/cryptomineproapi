const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkEmailVerification } = require('../middleware/emailVerificationMiddleware');

// User purchases a mining engine (requires email verification)
router.post('/', authMiddleware.verifyToken, checkEmailVerification, purchaseController.purchaseEngine);

// User views their purchases
router.get('/', authMiddleware.verifyToken, purchaseController.getUserPurchases);

module.exports = router;
