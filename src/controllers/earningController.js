const pool = require('../db');
const { triggerManualEarning, getUserEarningsSummary } = require('../utils/miningEarningsProcessor');

/**
 * Log earning manually (Admin only or system cron)
 */
const logEarning = async (req, res) => {
  try {
    const { purchase_id, earning_amount, earning_datetime } = req.body;
    
    // Validation
    if (!purchase_id || !earning_amount) {
      return res.status(400).json({ 
        message: 'Purchase ID and earning amount are required' 
      });
    }

    if (earning_amount <= 0) {
      return res.status(400).json({ 
        message: 'Earning amount must be positive' 
      });
    }

    // Use current datetime if not provided
    const earningTime = earning_datetime ? new Date(earning_datetime) : new Date();

    // Verify purchase exists and is active
    const [purchase] = await pool.query(
      'SELECT id, user_id, status FROM purchases WHERE id = ?',
      [purchase_id]
    );

    if (purchase.length === 0) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (purchase[0].status !== 'active') {
      return res.status(400).json({ message: 'Purchase is not active' });
    }

    // Log the earning using stored procedure
    const [result] = await pool.query('CALL sp_log_earning(?, ?, ?)', [
      purchase_id,
      earning_amount,
      earningTime
    ]);

    const logEntry = result[0][0];

    // Log admin action if user is admin
    if (req.user && req.user.role === 'admin') {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id,
        'manual_earning_log',
        'purchase',
        purchase_id,
        JSON.stringify({ earning_amount, earning_datetime: earningTime })
      ]);
    }

    res.status(201).json({
      message: 'Earning logged successfully',
      log: logEntry
    });

  } catch (error) {
    console.error('Error logging earning:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        message: 'Earning for this time period already exists' 
      });
    }
    
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Get user's earnings with pagination and filtering
 */
const getEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 20, 
      purchase_id, 
      start_date, 
      end_date,
      engine_id 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build dynamic query
    let whereConditions = ['el.user_id = ?'];
    let queryParams = [userId];

    if (purchase_id) {
      whereConditions.push('el.purchase_id = ?');
      queryParams.push(purchase_id);
    }

    if (engine_id) {
      whereConditions.push('me.id = ?');
      queryParams.push(engine_id);
    }

    if (start_date) {
      whereConditions.push('DATE(el.earning_datetime) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(el.earning_datetime) <= ?');
      queryParams.push(end_date);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get earnings with engine details
    const [earnings] = await pool.query(`
      SELECT 
        el.id,
        el.purchase_id,
        el.earning_amount,
        el.earning_datetime,
        el.notes,
        el.created_at,
        me.name as engine_name,
        me.earning_interval,
        p.amount_invested,
        p.daily_earning,
        p.start_date as purchase_start_date,
        p.end_date as purchase_end_date
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE ${whereClause}
      ORDER BY el.earning_datetime DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    // Get total count for pagination
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE ${whereClause}
    `, queryParams);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      earnings,
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
    console.error('Error fetching earnings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Get earnings summary for user dashboard
 */
const getEarningsSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await getUserEarningsSummary(userId);
    res.json(summary);
  } catch (error) {
    console.error('Error fetching earnings summary:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Trigger manual earning processing for a purchase (Admin only)
 */
const triggerEarningProcess = async (req, res) => {
  try {
    const { purchase_id } = req.params;
    
    if (!purchase_id) {
      return res.status(400).json({ message: 'Purchase ID is required' });
    }

    const result = await triggerManualEarning(purchase_id, req.user.id);
    
    res.json({
      message: 'Earning process triggered successfully',
      periods_processed: result.periodsProcessed,
      total_earning: result.totalEarning
    });

  } catch (error) {
    console.error('Error triggering earning process:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ message: error.message });
    }
    
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Get earnings statistics for admin dashboard
 */
const getEarningsStats = async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    let dateCondition = '';
    switch (period) {
      case '24h':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
        break;
      case '7d':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '30d':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      default:
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
    }

    const [stats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT el.user_id) as active_earners,
        COUNT(DISTINCT el.purchase_id) as earning_purchases,
        COUNT(el.id) as total_earning_logs,
        COALESCE(SUM(el.earning_amount), 0) as total_earnings_paid,
        COALESCE(AVG(el.earning_amount), 0) as avg_earning_amount,
        MIN(el.earning_datetime) as earliest_earning,
        MAX(el.earning_datetime) as latest_earning
      FROM engine_logs el
      ${dateCondition}
    `);

    const [dailyStats] = await pool.query(`
      SELECT 
        DATE(el.earning_datetime) as earning_date,
        COUNT(el.id) as logs_count,
        COALESCE(SUM(el.earning_amount), 0) as daily_total
      FROM engine_logs el
      ${dateCondition}
      GROUP BY DATE(el.earning_datetime)
      ORDER BY earning_date DESC
      LIMIT 30
    `);

    const [engineStats] = await pool.query(`
      SELECT 
        me.name as engine_name,
        me.earning_interval,
        COUNT(el.id) as earning_logs,
        COALESCE(SUM(el.earning_amount), 0) as total_earnings
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      ${dateCondition}
      GROUP BY me.id, me.name, me.earning_interval
      ORDER BY total_earnings DESC
    `);

    res.json({
      summary: stats[0],
      daily_breakdown: dailyStats,
      engine_breakdown: engineStats,
      period
    });

  } catch (error) {
    console.error('Error fetching earnings stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * NEW: Get all earnings for admin with advanced filtering
 */
const getAllEarnings = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      user_id,
      purchase_id, 
      start_date, 
      end_date,
      engine_id,
      earning_interval,
      sort_by = 'earning_datetime',
      sort_order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build dynamic query
    let whereConditions = [];
    let queryParams = [];

    if (user_id) {
      whereConditions.push('el.user_id = ?');
      queryParams.push(user_id);
    }

    if (purchase_id) {
      whereConditions.push('el.purchase_id = ?');
      queryParams.push(purchase_id);
    }

    if (engine_id) {
      whereConditions.push('me.id = ?');
      queryParams.push(engine_id);
    }

    if (earning_interval) {
      whereConditions.push('me.earning_interval = ?');
      queryParams.push(earning_interval);
    }

    if (start_date) {
      whereConditions.push('DATE(el.earning_datetime) >= ?');
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push('DATE(el.earning_datetime) <= ?');
      queryParams.push(end_date);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    const validSortColumns = ['earning_datetime', 'earning_amount', 'user_id', 'purchase_id'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'earning_datetime';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get earnings with user and engine details
    const [earnings] = await pool.query(`
      SELECT 
        el.id,
        el.purchase_id,
        el.user_id,
        el.earning_amount,
        el.earning_datetime,
        el.notes,
        el.created_at,
        u.full_name as user_name,
        u.email as user_email,
        me.name as engine_name,
        me.earning_interval,
        p.amount_invested,
        p.daily_earning,
        p.start_date as purchase_start_date,
        p.end_date as purchase_end_date,
        p.status as purchase_status
      FROM engine_logs el
      JOIN users u ON el.user_id = u.id
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      ${whereClause}
      ORDER BY el.${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);

    // Get total count for pagination
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM engine_logs el
      JOIN users u ON el.user_id = u.id
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      ${whereClause}
    `, queryParams);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      earnings,
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
    console.error('Error fetching all earnings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * NEW: Debug endpoint to get detailed purchase earning status
 */
const debugPurchaseEarnings = async (req, res) => {
  try {
    const { purchase_id } = req.params;

    if (!purchase_id) {
      return res.status(400).json({ message: 'Purchase ID is required' });
    }

    // Get detailed purchase information
    const [purchaseDetails] = await pool.query(`
      CALL sp_get_purchase_earning_status(?)
    `, [purchase_id]);

    if (!purchaseDetails[0] || purchaseDetails[0].length === 0) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    const purchase = purchaseDetails[0][0];

    // Get earning logs for this purchase
    const [earningLogs] = await pool.query(`
      SELECT 
        id,
        earning_amount,
        earning_datetime,
        notes,
        created_at
      FROM engine_logs 
      WHERE purchase_id = ?
      ORDER BY earning_datetime DESC
      LIMIT 50
    `, [purchase_id]);

    // Calculate expected vs actual earnings
    const now = new Date();
    const startDate = new Date(purchase.start_date);
    const endDate = new Date(purchase.end_date);
    const isHourly = purchase.earning_interval === 'hourly';

    let expectedPeriods = 0;
    let expectedTotalEarnings = 0;

    if (isHourly) {
      const endTime = now < endDate ? now : endDate;
      expectedPeriods = Math.floor((endTime - startDate) / (1000 * 60 * 60)); // Hours
      expectedTotalEarnings = expectedPeriods * (purchase.daily_earning / 24);
    } else {
      const endTime = now < endDate ? now : endDate;
      expectedPeriods = Math.floor((endTime - startDate) / (1000 * 60 * 60 * 24)); // Days
      expectedTotalEarnings = expectedPeriods * purchase.daily_earning;
    }

    const actualEarnings = earningLogs.reduce((sum, log) => sum + parseFloat(log.earning_amount), 0);
    const earningDeficit = expectedTotalEarnings - actualEarnings;

    res.json({
      purchase_info: purchase,
      earning_analysis: {
        expected_periods: expectedPeriods,
        actual_periods: earningLogs.length,
        expected_total_earnings: parseFloat(expectedTotalEarnings.toFixed(8)),
        actual_total_earnings: parseFloat(actualEarnings.toFixed(8)),
        earning_deficit: parseFloat(earningDeficit.toFixed(8)),
        is_up_to_date: Math.abs(earningDeficit) < 0.01,
        earning_interval: purchase.earning_interval,
        next_earning_due: purchase.next_earning_time
      },
      recent_earnings: earningLogs.slice(0, 10),
      debug_info: {
        current_time: now.toISOString(),
        purchase_start: startDate.toISOString(),
        purchase_end: endDate.toISOString(),
        is_active: purchase.status === 'active',
        is_within_period: now >= startDate && now <= endDate
      }
    });

  } catch (error) {
    console.error('Error debugging purchase earnings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * NEW: System health check for earnings processing
 */
const systemHealthCheck = async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Check recent earnings processing
    const [recentEarnings] = await pool.query(`
      SELECT COUNT(*) as count, MAX(earning_datetime) as last_earning
      FROM engine_logs 
      WHERE created_at >= ?
    `, [oneDayAgo]);

    // Check overdue purchases
    const [overduePurchases] = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.start_date,
        p.last_earning_date,
        me.earning_interval,
        me.name as engine_name,
        CASE 
          WHEN me.earning_interval = 'hourly' THEN
            TIMESTAMPDIFF(HOUR, COALESCE(p.last_earning_date, p.start_date), NOW())
          ELSE
            DATEDIFF(NOW(), COALESCE(p.last_earning_date, p.start_date))
        END as periods_behind
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active' 
        AND p.end_date >= CURDATE()
        AND (
          (me.earning_interval = 'hourly' AND 
           COALESCE(p.last_earning_date, p.start_date) < DATE_SUB(NOW(), INTERVAL 1 HOUR))
          OR
          (me.earning_interval = 'daily' AND 
           COALESCE(p.last_earning_date, p.start_date) < DATE_SUB(NOW(), INTERVAL 1 DAY))
        )
      ORDER BY periods_behind DESC
      LIMIT 20
    `);

    // Check system stats
    const [systemStats] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM purchases WHERE status = 'active') as active_purchases,
        (SELECT COUNT(*) FROM mining_engines WHERE is_active = TRUE) as active_engines,
        (SELECT COUNT(*) FROM engine_logs WHERE DATE(created_at) = CURDATE()) as todays_earnings,
        (SELECT COUNT(*) FROM engine_logs WHERE created_at >= ?) as recent_earnings
    `, [oneHourAgo]);

    const health = {
      status: 'healthy',
      timestamp: now.toISOString(),
      earnings_processing: {
        recent_earnings_count: recentEarnings[0].count,
        last_earning_time: recentEarnings[0].last_earning,
        todays_earnings: systemStats[0].todays_earnings,
        last_hour_earnings: systemStats[0].recent_earnings
      },
      system_overview: {
        active_purchases: systemStats[0].active_purchases,
        active_engines: systemStats[0].active_engines,
        overdue_purchases: overduePurchases.length
      },
      overdue_purchases: overduePurchases.slice(0, 10)
    };

    // Determine overall health status
    if (overduePurchases.length > 10) {
      health.status = 'warning';
    }
    if (overduePurchases.length > 50 || recentEarnings[0].count === 0) {
      health.status = 'critical';
    }

    res.json(health);

  } catch (error) {
    console.error('Error performing health check:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Health check failed',
      error: error.message 
    });
  }
};

module.exports = {
  logEarning,
  getEarnings,
  getEarningsSummary,
  triggerEarningProcess,
  getEarningsStats,
  getAllEarnings,
  debugPurchaseEarnings,
  systemHealthCheck
};