const express = require('express');
const router = express.Router();
const miningEngineController = require('../controllers/miningEngineController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Public routes
// List all active mining engines (public access for users to view available engines)
router.get('/', miningEngineController.getMiningEngines);

// Get specific mining engine by ID
router.get('/:engineId', miningEngineController.getMiningEngineById);

// Admin-only routes
// Create new mining engine
router.post('/', authMiddleware.verifyToken, requireAdmin, miningEngineController.addMiningEngine);

// Update mining engine
router.put('/:engineId', authMiddleware.verifyToken, requireAdmin, miningEngineController.updateMiningEngine);

// Delete mining engine
router.delete('/:engineId', authMiddleware.verifyToken, requireAdmin, miningEngineController.deleteMiningEngine);

module.exports = router;
