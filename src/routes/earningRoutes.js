const express = require('express');
const router = express.Router();
const earningController = require('../controllers/earningController');
const authMiddleware = require('../middleware/authMiddleware');

// Admin or cron job logs daily earnings
router.post('/log', authMiddleware.verifyToken, earningController.logEarning);

// User views earnings logs
router.get('/', authMiddleware.verifyToken, earningController.getEarnings);

module.exports = router;
