const express = require('express');
const router = express.Router();
const earningController = require('../controllers/earningController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// === USER ROUTES (Protected) ===
// Get user's earnings with pagination and filtering
router.get('/', authMiddleware.verifyToken, earningController.getEarnings);

// Get user's earnings summary for dashboard
router.get('/summary', authMiddleware.verifyToken, earningController.getEarningsSummary);

// === ADMIN ROUTES (Protected + Admin Only) ===

// --- Earnings Management ---
// Manually log an earning (for testing or corrections)
router.post('/log', authMiddleware.verifyToken, requireAdmin, earningController.logEarning);

// Trigger manual earning processing for a specific purchase
router.post('/trigger/:purchase_id', authMiddleware.verifyToken, requireAdmin, earningController.triggerEarningProcess);

// Get earnings statistics for admin dashboard
router.get('/admin/stats', authMiddleware.verifyToken, requireAdmin, earningController.getEarningsStats);

// Get all earnings for admin (with pagination and filtering)
router.get('/admin/earnings', authMiddleware.verifyToken, requireAdmin, earningController.getAllEarnings);

// --- DEBUGGING & MONITORING ROUTES ---
// Debug specific purchase earnings
router.get('/debug/purchase/:purchase_id', authMiddleware.verifyToken, requireAdmin, earningController.debugPurchaseEarnings);

// System health check for earnings processing
router.get('/debug/health', authMiddleware.verifyToken, requireAdmin, earningController.systemHealthCheck);

// Test earnings processing for a specific interval type
router.post('/debug/test-processing', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { interval_type, purchase_id } = req.body; // 'hourly', 'daily', or specific purchase_id
    const { processMiningEarnings, triggerManualEarning } = require('../utils/miningEarningsProcessor');
    
    let result;
    if (purchase_id) {
      // Test specific purchase
      result = await triggerManualEarning(purchase_id, req.user.id);
      result.test_type = 'single_purchase';
      result.purchase_id = purchase_id;
    } else {
      // Test by interval type
      result = await processMiningEarnings(interval_type);
      result.test_type = 'interval_processing';
      result.interval_type = interval_type || 'all';
    }
    
    res.json({
      message: 'Test processing completed',
      timestamp: new Date().toISOString(),
      admin_id: req.user.id,
      ...result
    });
    
  } catch (error) {
    console.error('Debug test processing error:', error);
    res.status(500).json({ 
      message: 'Test processing failed', 
      error: error.message 
    });
  }
});

// Simulate earnings for testing (creates test earnings without affecting balances)
router.post('/debug/simulate', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { purchase_id, periods = 1, interval_type = 'hourly' } = req.body;
    
    if (!purchase_id) {
      return res.status(400).json({ message: 'Purchase ID is required' });
    }
    
    const pool = require('../db');
    
    // Get purchase details
    const [purchases] = await pool.query(`
      SELECT p.*, me.earning_interval, me.name as engine_name
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.id = ? AND p.status = 'active'
    `, [purchase_id]);
    
    if (purchases.length === 0) {
      return res.status(404).json({ message: 'Active purchase not found' });
    }
    
    const purchase = purchases[0];
    const simulationResults = [];
    
    // Simulate earnings
    for (let i = 0; i < periods; i++) {
      const simulationTime = new Date();
      if (interval_type === 'hourly') {
        simulationTime.setHours(simulationTime.getHours() - (periods - i - 1));
        var earningAmount = purchase.daily_earning / 24;
      } else {
        simulationTime.setDate(simulationTime.getDate() - (periods - i - 1));
        var earningAmount = purchase.daily_earning;
      }
      
      simulationResults.push({
        period: i + 1,
        earning_amount: parseFloat(earningAmount.toFixed(8)),
        earning_datetime: simulationTime.toISOString(),
        interval_type: interval_type
      });
    }
    
    res.json({
      message: 'Earnings simulation completed',
      purchase_info: {
        id: purchase.id,
        engine_name: purchase.engine_name,
        daily_earning: purchase.daily_earning,
        earning_interval: purchase.earning_interval
      },
      simulation_params: {
        periods_simulated: periods,
        interval_type: interval_type,
        total_simulated_earnings: simulationResults.reduce((sum, r) => sum + r.earning_amount, 0)
      },
      simulated_earnings: simulationResults,
      note: "This is a simulation only - no actual earnings were logged"
    });
    
  } catch (error) {
    console.error('Earnings simulation error:', error);
    res.status(500).json({ message: 'Simulation failed', error: error.message });
  }
});

// Get processing queue status
router.get('/debug/queue-status', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const pool = require('../db');
    
    // Get purchases that need processing
    const [hourlyPending] = await pool.query(`
      SELECT 
        COUNT(*) as count,
        MIN(COALESCE(last_earning_date, start_date)) as oldest_pending
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active' 
        AND me.earning_interval = 'hourly'
        AND me.is_active = TRUE
        AND COALESCE(p.last_earning_date, p.start_date) < DATE_SUB(NOW(), INTERVAL 1 HOUR)
        AND p.end_date >= NOW()
    `);
    
    const [dailyPending] = await pool.query(`
      SELECT 
        COUNT(*) as count,
        MIN(COALESCE(last_earning_date, start_date)) as oldest_pending
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active' 
        AND me.earning_interval = 'daily'
        AND me.is_active = TRUE
        AND COALESCE(p.last_earning_date, p.start_date) < DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND p.end_date >= NOW()
    `);
    
    // Get recent processing activity
    const [recentActivity] = await pool.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as hour,
        COUNT(*) as earnings_processed
      FROM engine_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')
      ORDER BY hour DESC
    `);
    
    res.json({
      timestamp: new Date().toISOString(),
      queue_status: {
        hourly_pending: {
          count: hourlyPending[0].count,
          oldest_pending: hourlyPending[0].oldest_pending
        },
        daily_pending: {
          count: dailyPending[0].count,
          oldest_pending: dailyPending[0].oldest_pending
        }
      },
      recent_activity: recentActivity,
      recommendations: {
        immediate_action_needed: (hourlyPending[0].count > 100 || dailyPending[0].count > 50),
        suggested_action: hourlyPending[0].count > 0 || dailyPending[0].count > 0 
          ? 'Consider running manual processing' 
          : 'System appears up to date'
      }
    });
    
  } catch (error) {
    console.error('Queue status error:', error);
    res.status(500).json({ message: 'Failed to get queue status', error: error.message });
  }
});

module.exports = router;