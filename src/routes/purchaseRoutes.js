const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// === USER ROUTES (Protected) ===

// User purchases a mining engine with enhanced timing logic
router.post('/', authMiddleware.verifyToken, purchaseController.purchaseEngine);

// User views their purchases with pagination and filtering
router.get('/', authMiddleware.verifyToken, purchaseController.getUserPurchases);

// Get detailed information about a specific purchase
router.get('/:purchaseId', authMiddleware.verifyToken, purchaseController.getPurchaseDetails);

// === ADMIN ROUTES (Protected + Admin Only) ===

// Get all purchases for admin with advanced filtering
router.get('/admin/all', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      engine_id, 
      user_id, 
      earning_interval,
      start_date,
      end_date,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build dynamic query
    let whereConditions = [];
    let queryParams = [];

    if (status) {
      whereConditions.push('p.status = ?');
      queryParams.push(status);
    }

    if (engine_id) {
      whereConditions.push('p.engine_id = ?');
      queryParams.push(engine_id);
    }

    if (user_id) {
      whereConditions.push('p.user_id = ?');
      queryParams.push(user_id);
    }

    if (earning_interval) {
      whereConditions.push('e.earning_interval = ?');
      queryParams.push(earning_interval);
    }

    if (start_date) {
      whereConditions.push('DATE(p.created_at) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(p.created_at) <= ?');
      queryParams.push(end_date);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    // Validate sort parameters
    const validSortColumns = ['created_at', 'amount_invested', 'daily_earning', 'total_earned', 'start_date', 'end_date'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const pool = require('../db');
    
    const [purchases] = await pool.query(`
      SELECT 
        p.id, p.user_id, p.engine_id, p.amount_invested, p.daily_earning,
        p.total_earned, p.start_date, p.end_date, p.last_earning_date,
        p.status, p.created_at,
        u.full_name as user_name, u.email as user_email,
        e.name as engine_name, e.earning_interval, e.daily_earning_rate,
        e.duration_days, e.duration_hours,
        CASE 
          WHEN e.earning_interval = 'hourly' THEN 
            TIMESTAMPDIFF(HOUR, p.start_date, LEAST(NOW(), p.end_date))
          ELSE 
            DATEDIFF(LEAST(NOW(), p.end_date), p.start_date)
        END as periods_elapsed,
        CASE 
          WHEN e.earning_interval = 'hourly' THEN 
            TIMESTAMPDIFF(HOUR, p.start_date, p.end_date)
          ELSE 
            DATEDIFF(p.end_date, p.start_date)
        END as total_periods,
        (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) as earning_logs_count
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN mining_engines e ON p.engine_id = e.id
      ${whereClause}
      ORDER BY p.${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    // Get total count for pagination
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN mining_engines e ON p.engine_id = e.id
      ${whereClause}
    `, queryParams);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));

    // Enhance purchases with calculations
    const enhancedPurchases = purchases.map(purchase => {
      const periodsElapsed = Math.max(0, purchase.periods_elapsed || 0);
      const totalPeriods = purchase.total_periods || 0;
      const progressPercentage = totalPeriods > 0 ? (periodsElapsed / totalPeriods) * 100 : 0;
      
      const periodEarning = purchase.earning_interval === 'hourly' 
        ? purchase.daily_earning / 24 
        : purchase.daily_earning;
      
      const expectedEarnings = periodsElapsed * periodEarning;
      const earningDeficit = Math.max(0, expectedEarnings - purchase.total_earned);

      return {
        ...purchase,
        periods_elapsed: periodsElapsed,
        progress_percentage: parseFloat(Math.min(100, progressPercentage).toFixed(2)),
        period_earning: parseFloat(periodEarning.toFixed(8)),
        expected_earnings: parseFloat(expectedEarnings.toFixed(8)),
        earning_deficit: parseFloat(earningDeficit.toFixed(8)),
        is_earning_up_to_date: earningDeficit < 0.01
      };
    });

    res.json({
      purchases: enhancedPurchases,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_records: total,
        per_page: parseInt(limit),
        has_next: parseInt(page) < totalPages,
        has_prev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error fetching admin purchases:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get purchase statistics for admin dashboard
router.get('/admin/stats', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    let dateCondition = 'WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    
    switch (period) {
      case '7d':
        dateCondition = 'WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '90d':
        dateCondition = 'WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
        break;
      case 'all':
        dateCondition = '';
        break;
    }

    const pool = require('../db');
    
    const [overallStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_purchases,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as completed_purchases,
        COUNT(CASE WHEN p.status = 'cancelled' THEN 1 END) as cancelled_purchases,
        COALESCE(SUM(p.amount_invested), 0) as total_invested,
        COALESCE(SUM(CASE WHEN p.status = 'active' THEN p.amount_invested ELSE 0 END), 0) as active_invested,
        COALESCE(SUM(p.total_earned), 0) as total_earned,
        COALESCE(AVG(p.amount_invested), 0) as avg_investment,
        COUNT(DISTINCT p.user_id) as unique_investors
      FROM purchases p
      ${dateCondition}
    `);

    const [intervalStats] = await pool.query(`
      SELECT 
        e.earning_interval,
        COUNT(p.id) as purchase_count,
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_count,
        COALESCE(SUM(p.amount_invested), 0) as total_invested,
        COALESCE(SUM(p.total_earned), 0) as total_earned
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      ${dateCondition}
      GROUP BY e.earning_interval
    `);

    const [engineStats] = await pool.query(`
      SELECT 
        e.id, e.name, e.earning_interval,
        COUNT(p.id) as purchase_count,
        COALESCE(SUM(p.amount_invested), 0) as total_invested,
        COALESCE(SUM(p.total_earned), 0) as total_earned,
        COALESCE(AVG(p.amount_invested), 0) as avg_investment
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      ${dateCondition}
      GROUP BY e.id, e.name, e.earning_interval
      ORDER BY total_invested DESC
      LIMIT 10
    `);

    res.json({
      period,
      overall_statistics: overallStats[0],
      by_interval: intervalStats,
      top_engines: engineStats,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching purchase stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Manually trigger earnings for a specific purchase (admin only)
router.post('/admin/:purchaseId/trigger-earnings', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { triggerManualEarning } = require('../utils/miningEarningsProcessor');
    
    const result = await triggerManualEarning(purchaseId, req.user.id);
    
    res.json({
      success: true,
      message: 'Earnings processing triggered successfully',
      purchase_id: parseInt(purchaseId),
      periods_processed: result.periodsProcessed,
      total_earning: result.totalEarning,
      admin_id: req.user.id
    });

  } catch (error) {
    console.error('Error triggering earnings:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Failed to trigger earnings processing',
      error: error.message 
    });
  }
});

// Update purchase status (admin only)
router.patch('/admin/:purchaseId/status', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const { status, reason } = req.body;
    
    if (!['active', 'completed', 'cancelled', 'paused'].includes(status)) {
      return res.status(400).json({ 
        message: 'Invalid status. Must be one of: active, completed, cancelled, paused' 
      });
    }

    const pool = require('../db');
    
    // Check if purchase exists
    const [existingPurchase] = await pool.query(
      'SELECT id, status, user_id FROM purchases WHERE id = ?',
      [purchaseId]
    );

    if (existingPurchase.length === 0) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    const oldStatus = existingPurchase[0].status;

    // Update purchase status
    await pool.query(
      'UPDATE purchases SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, purchaseId]
    );

    // Log admin action
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      req.user.id,
      'purchase_status_update',
      'purchase',
      purchaseId,
      JSON.stringify({ 
        old_status: oldStatus, 
        new_status: status, 
        reason: reason || 'No reason provided',
        user_id: existingPurchase[0].user_id
      })
    ]);

    res.json({
      success: true,
      message: 'Purchase status updated successfully',
      purchase_id: parseInt(purchaseId),
      old_status: oldStatus,
      new_status: status
    });

  } catch (error) {
    console.error('Error updating purchase status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get purchase earning history
router.get('/:purchaseId/earnings', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Verify purchase belongs to user (or admin)
    const pool = require('../db');
    const [purchaseCheck] = await pool.query(
      'SELECT user_id FROM purchases WHERE id = ?',
      [purchaseId]
    );
    
    if (purchaseCheck.length === 0) {
      return res.status(404).json({ message: 'Purchase not found' });
    }
    
    if (purchaseCheck[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const [earnings] = await pool.query(`
      SELECT 
        el.id,
        el.earning_amount,
        el.earning_datetime,
        el.notes,
        el.created_at
      FROM engine_logs el
      WHERE el.purchase_id = ?
      ORDER BY el.earning_datetime DESC
      LIMIT ? OFFSET ?
    `, [purchaseId, parseInt(limit), offset]);
    
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM engine_logs WHERE purchase_id = ?',
      [purchaseId]
    );
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));
    
    res.json({
      earnings: earnings.map(earning => ({
        ...earning,
        formatted_amount: `KES ${parseFloat(earning.earning_amount).toFixed(2)}`,
        formatted_datetime: new Date(earning.earning_datetime).toLocaleString()
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_records: total,
        per_page: parseInt(limit),
        has_next: parseInt(page) < totalPages,
        has_prev: parseInt(page) > 1
      }
    });
    
  } catch (error) {
    console.error('Error fetching purchase earnings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;