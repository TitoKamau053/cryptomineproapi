const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/authMiddleware');

// User purchases a mining engine
router.post('/', authMiddleware.verifyToken, purchaseController.purchaseEngine);

// User views their purchases
router.get('/', authMiddleware.verifyToken, purchaseController.getUserPurchases);

module.exports = router;
