const pool = require('../db');

console.log('=== Enhanced Mining Earnings Processor Loaded ===');

// Enhanced logging utility
const log = {
  info: (message, data = {}) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data);
  },
  warn: (message, data = {}) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data);
  },
  error: (message, error = null) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
  },
  debug: (message, data = {}) => {
    if (process.env.DEBUG_EARNINGS === 'true') {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, data);
    }
  }
};

// Catch all unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection detected:', reason);
});

/**
 * Enhanced process mining earnings for all active purchases
 * Handles both hourly and daily earning intervals with improved debugging
 */
async function processMiningEarnings(intervalType = null) {
  const connection = await pool.getConnection();
  
  try {
    log.info('=== Mining earnings processing started ===', {
      intervalType,
      timestamp: new Date().toISOString()
    });
    
    await connection.beginTransaction();

    // Build query based on interval type
    let intervalCondition = '';
    let queryParams = [];
    
    if (intervalType) {
      intervalCondition = 'AND e.earning_interval = ?';
      queryParams.push(intervalType);
    }

    // Get all active purchases with their engine details
    const [purchases] = await connection.query(`
      SELECT 
        p.id, 
        p.user_id, 
        p.engine_id,
        p.daily_earning, 
        p.start_date, 
        p.end_date, 
        p.last_earning_date, 
        p.status,
        p.amount_invested,
        p.total_earned,
        e.earning_interval,
        e.name as engine_name,
        e.daily_earning_rate,
        e.is_active as engine_active
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.status = 'active' 
        AND e.is_active = TRUE
        AND p.end_date >= CURDATE()
        ${intervalCondition}
      ORDER BY p.id
    `, queryParams);

    log.info(`Found ${purchases.length} active purchases to process`, {
      intervalType: intervalType || 'all',
      totalPurchases: purchases.length
    });
    
    if (!purchases || purchases.length === 0) {
      log.info('No active purchases found for processing');
      await connection.commit();
      return { 
        processed: 0, 
        totalPeriods: 0,
        totalEarnings: 0,
        message: 'No active purchases found',
        intervalType: intervalType || 'all'
      };
    }

    const now = new Date();
    let totalProcessed = 0;
    let totalPeriodsProcessed = 0;
    let totalEarningsAdded = 0;
    const processingResults = [];

    for (const purchase of purchases) {
      try {
        log.debug(`Processing purchase #${purchase.id}`, {
          userId: purchase.user_id,
          engineName: purchase.engine_name,
          earningInterval: purchase.earning_interval,
          dailyEarning: purchase.daily_earning
        });

        const result = await processPurchaseEarnings(connection, purchase, now);
        
        totalProcessed++;
        totalPeriodsProcessed += result.periodsProcessed;
        totalEarningsAdded += result.totalEarning;
        
        processingResults.push({
          purchaseId: purchase.id,
          userId: purchase.user_id,
          engineName: purchase.engine_name,
          earningInterval: purchase.earning_interval,
          periodsProcessed: result.periodsProcessed,
          totalEarning: result.totalEarning,
          status: result.status || 'success'
        });
        
        log.info(`Purchase #${purchase.id} processed successfully`, {
          periodsProcessed: result.periodsProcessed,
          totalEarning: result.totalEarning.toFixed(8),
          engineName: purchase.engine_name
        });

      } catch (error) {
        log.error(`Error processing purchase #${purchase.id}`, error);
        
        processingResults.push({
          purchaseId: purchase.id,
          userId: purchase.user_id,
          engineName: purchase.engine_name,
          error: error.message,
          status: 'failed'
        });
        
        // Continue with other purchases even if one fails
      }
    }

    await connection.commit();
    
    const summary = {
      processed: totalProcessed,
      totalPeriods: totalPeriodsProcessed,
      totalEarnings: parseFloat(totalEarningsAdded.toFixed(8)),
      intervalType: intervalType || 'all',
      timestamp: now.toISOString(),
      message: 'Mining earnings processed successfully'
    };

    log.info('=== Mining earnings processing completed ===', summary);
    
    // Log detailed results if debug mode is enabled
    if (process.env.DEBUG_EARNINGS === 'true') {
      log.debug('Detailed processing results:', processingResults);
    }
    
    return {
      ...summary,
      details: processingResults
    };

  } catch (error) {
    await connection.rollback();
    log.error('Critical error in mining earnings processing:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Enhanced process earnings for a single purchase with improved logic
 */
async function processPurchaseEarnings(connection, purchase, currentTime) {
  const {
    id: purchaseId,
    user_id: userId,
    daily_earning: dailyEarning,
    start_date: startDate,
    end_date: endDate,
    last_earning_date: lastEarningDate,
    earning_interval: earningInterval,
    engine_name: engineName
  } = purchase;

  log.debug(`Processing purchase #${purchaseId} (${engineName})`, {
    earningInterval,
    dailyEarning,
    startDate,
    endDate,
    lastEarningDate
  });

  const startDateTime = new Date(startDate);
  const endDateTime = new Date(endDate);
  
  // Validate purchase period
  if (currentTime < startDateTime) {
    log.debug(`Purchase #${purchaseId} has not started yet`);
    return { periodsProcessed: 0, totalEarning: 0, status: 'pending_start' };
  }

  if (currentTime > endDateTime) {
    // Mark as completed if not already
    if (purchase.status === 'active') {
      await connection.query(
        'UPDATE purchases SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [purchaseId]
      );
      log.info(`Purchase #${purchaseId} marked as completed (end date reached)`);
    }
    return { periodsProcessed: 0, totalEarning: 0, status: 'completed' };
  }

  // Determine the starting point for earning calculations
  let lastProcessedTime;
  if (lastEarningDate) {
    lastProcessedTime = new Date(lastEarningDate);
  } else {
    // First time processing - start from purchase start date
    lastProcessedTime = new Date(startDateTime);
    if (earningInterval === 'hourly') {
      // For hourly, we want to start from the first complete hour
      lastProcessedTime.setMinutes(0, 0, 0);
    } else {
      // For daily, start from the beginning of the start date
      lastProcessedTime.setHours(0, 0, 0, 0);
    }
  }

  let periodsProcessed = 0;
  let totalEarning = 0;
  const earningsToProcess = [];

  if (earningInterval === 'hourly') {
    const result = await processHourlyEarnings(connection, purchase, lastProcessedTime, currentTime, endDateTime);
    periodsProcessed = result.periodsProcessed;
    totalEarning = result.totalEarning;
    earningsToProcess.push(...result.earnings);
  } else {
    const result = await processDailyEarnings(connection, purchase, lastProcessedTime, currentTime, endDateTime);
    periodsProcessed = result.periodsProcessed;
    totalEarning = result.totalEarning;
    earningsToProcess.push(...result.earnings);
  }

  // Log earnings in batch for better performance
  if (earningsToProcess.length > 0) {
    for (const earning of earningsToProcess) {
      try {
        await connection.query(
          'CALL sp_log_earning(?, ?, ?)',
          [purchaseId, earning.amount, earning.datetime]
        );
      } catch (logError) {
        if (logError.code === 'ER_DUP_ENTRY') {
          log.debug(`Duplicate earning entry for purchase ${purchaseId} at ${earning.datetime}`);
        } else {
          throw logError;
        }
      }
    }
  }

  log.debug(`Purchase #${purchaseId} processing completed`, {
    periodsProcessed,
    totalEarning: totalEarning.toFixed(8),
    earningInterval
  });

  return { 
    periodsProcessed, 
    totalEarning,
    status: 'success'
  };
}

/**
 * Process hourly earnings with precision
 */
async function processHourlyEarnings(connection, purchase, lastProcessedTime, currentTime, endDateTime) {
  const { id: purchaseId, daily_earning: dailyEarning } = purchase;
  const hourlyEarning = parseFloat((dailyEarning / 24).toFixed(8));
  
  let periodsProcessed = 0;
  let totalEarning = 0;
  const earnings = [];
  
  // Start from the next hour after last processed time
  let nextEarningTime = new Date(lastProcessedTime);
  nextEarningTime.setHours(nextEarningTime.getHours() + 1, 0, 0, 0);
  
  log.debug(`Processing hourly earnings for purchase ${purchaseId}`, {
    hourlyEarning,
    startFrom: nextEarningTime.toISOString(),
    endAt: Math.min(currentTime, endDateTime).toISOString()
  });

  while (nextEarningTime <= currentTime && nextEarningTime <= endDateTime) {
    // Check if this earning period was already processed
    const [existingLog] = await connection.query(
      'SELECT id FROM engine_logs WHERE purchase_id = ? AND earning_datetime = ?',
      [purchaseId, nextEarningTime]
    );

    if (existingLog.length === 0) {
      earnings.push({
        amount: hourlyEarning,
        datetime: new Date(nextEarningTime)
      });
      
      periodsProcessed++;
      totalEarning += hourlyEarning;
      
      log.debug(`Hourly earning scheduled: ${nextEarningTime.toISOString()} = ${hourlyEarning.toFixed(8)}`);
    } else {
      log.debug(`Hourly earning already exists: ${nextEarningTime.toISOString()}`);
    }
    
    nextEarningTime.setHours(nextEarningTime.getHours() + 1);
  }

  return { periodsProcessed, totalEarning, earnings };
}

/**
 * Process daily earnings with precision
 */
async function processDailyEarnings(connection, purchase, lastProcessedTime, currentTime, endDateTime) {
  const { id: purchaseId, daily_earning: dailyEarning } = purchase;
  
  let periodsProcessed = 0;
  let totalEarning = 0;
  const earnings = [];
  
  // Start from the next day after last processed time
  let nextEarningTime = new Date(lastProcessedTime);
  nextEarningTime.setDate(nextEarningTime.getDate() + 1);
  nextEarningTime.setHours(0, 0, 0, 0); // Set to start of day
  
  log.debug(`Processing daily earnings for purchase ${purchaseId}`, {
    dailyEarning,
    startFrom: nextEarningTime.toISOString(),
    endAt: Math.min(currentTime, endDateTime).toISOString()
  });

  while (nextEarningTime <= currentTime && nextEarningTime <= endDateTime) {
    // Check if this earning period was already processed (check by date only)
    const [existingLog] = await connection.query(
      'SELECT id FROM engine_logs WHERE purchase_id = ? AND DATE(earning_datetime) = DATE(?)',
      [purchaseId, nextEarningTime]
    );

    if (existingLog.length === 0) {
      earnings.push({
        amount: parseFloat(dailyEarning),
        datetime: new Date(nextEarningTime)
      });
      
      periodsProcessed++;
      totalEarning += parseFloat(dailyEarning);
      
      log.debug(`Daily earning scheduled: ${nextEarningTime.toISOString().split('T')[0]} = ${dailyEarning}`);
    } else {
      log.debug(`Daily earning already exists: ${nextEarningTime.toISOString().split('T')[0]}`);
    }
    
    nextEarningTime.setDate(nextEarningTime.getDate() + 1);
  }

  return { periodsProcessed, totalEarning, earnings };
}

/**
 * Enhanced manual earning trigger with better error handling
 */
async function triggerManualEarning(purchaseId, adminId = null) {
  const connection = await pool.getConnection();
  
  try {
    log.info(`Manual earning trigger started for purchase ${purchaseId}`, { adminId });
    
    await connection.beginTransaction();
    
    // Get purchase details with validation
    const [purchases] = await connection.query(`
      SELECT 
        p.id, p.user_id, p.daily_earning, p.start_date, p.end_date, 
        p.last_earning_date, p.status, e.earning_interval, e.name as engine_name,
        e.is_active as engine_active
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.id = ?
    `, [purchaseId]);
    
    if (purchases.length === 0) {
      throw new Error('Purchase not found');
    }
    
    const purchase = purchases[0];
    
    if (purchase.status !== 'active') {
      throw new Error(`Purchase is not active (status: ${purchase.status})`);
    }
    
    if (!purchase.engine_active) {
      throw new Error('Mining engine is not active');
    }
    
    const result = await processPurchaseEarnings(connection, purchase, new Date());
    
    // Log admin action if admin triggered
    if (adminId) {
      await connection.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, 'manual_earning_trigger', 'purchase', ?, ?, CURRENT_TIMESTAMP)
      `, [
        adminId,
        purchaseId,
        JSON.stringify({ 
          periods_processed: result.periodsProcessed,
          total_earning: result.totalEarning,
          engine_name: purchase.engine_name,
          earning_interval: purchase.earning_interval
        })
      ]);
    }
    
    await connection.commit();
    
    log.info(`Manual earning trigger completed for purchase ${purchaseId}`, {
      periodsProcessed: result.periodsProcessed,
      totalEarning: result.totalEarning,
      adminId
    });
    
    return result;
    
  } catch (error) {
    await connection.rollback();
    log.error(`Manual earning trigger failed for purchase ${purchaseId}`, error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Enhanced user earnings summary with more details
 */
async function getUserEarningsSummary(userId) {
  try {
    log.debug(`Fetching earnings summary for user ${userId}`);
    
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT el.purchase_id) as active_purchases,
        COALESCE(SUM(el.earning_amount), 0) as total_logged_earnings,
        COALESCE(MAX(el.earning_datetime), NULL) as last_earning_time,
        COUNT(el.id) as total_earning_logs,
        COALESCE(SUM(CASE WHEN DATE(el.earning_datetime) = CURDATE() THEN el.earning_amount ELSE 0 END), 0) as todays_earnings,
        COALESCE(SUM(CASE WHEN el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN el.earning_amount ELSE 0 END), 0) as last_7_days_earnings
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      WHERE el.user_id = ? AND p.status = 'active'
    `, [userId]);
    
    const [recentEarnings] = await pool.query(`
      SELECT 
        el.earning_amount,
        el.earning_datetime,
        me.name as engine_name,
        me.earning_interval,
        p.amount_invested,
        p.id as purchase_id
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE el.user_id = ?
      ORDER BY el.earning_datetime DESC
      LIMIT 10
    `, [userId]);
    
    // Get active purchases summary
    const [activePurchases] = await pool.query(`
      SELECT 
        p.id,
        p.amount_invested,
        p.daily_earning,
        p.start_date,
        p.end_date,
        p.total_earned,
        me.name as engine_name,
        me.earning_interval,
        DATEDIFF(p.end_date, CURDATE()) as days_remaining
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.user_id = ? AND p.status = 'active'
      ORDER BY p.created_at DESC
    `, [userId]);
    
    return {
      summary: {
        ...summary[0],
        active_purchases_detail: activePurchases
      },
      recent_earnings: recentEarnings
    };
    
  } catch (error) {
    log.error('Error fetching user earnings summary:', error);
    throw error;
  }
}

/**
 * NEW: Get detailed earnings analytics for admin
 */
async function getEarningsAnalytics(timeframe = '7d') {
  try {
    let dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
    
    switch (timeframe) {
      case '24h':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
        break;
      case '30d':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      case '90d':
        dateCondition = 'WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
        break;
    }
    
    const [intervalStats] = await pool.query(`
      SELECT 
        me.earning_interval,
        COUNT(el.id) as total_logs,
        COUNT(DISTINCT el.purchase_id) as active_purchases,
        COUNT(DISTINCT el.user_id) as active_users,
        SUM(el.earning_amount) as total_earnings,
        AVG(el.earning_amount) as avg_earning,
        MIN(el.earning_datetime) as earliest_earning,
        MAX(el.earning_datetime) as latest_earning
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      ${dateCondition}
      GROUP BY me.earning_interval
    `);
    
    const [hourlyDistribution] = await pool.query(`
      SELECT 
        HOUR(el.earning_datetime) as hour_of_day,
        COUNT(el.id) as earnings_count,
        SUM(el.earning_amount) as total_amount
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      ${dateCondition}
      GROUP BY HOUR(el.earning_datetime)
      ORDER BY hour_of_day
    `);
    
    return {
      timeframe,
      interval_statistics: intervalStats,
      hourly_distribution: hourlyDistribution,
      generated_at: new Date().toISOString()
    };
    
  } catch (error) {
    log.error('Error fetching earnings analytics:', error);
    throw error;
  }
}

module.exports = {
  processMiningEarnings,
  triggerManualEarning,
  getUserEarningsSummary,
  getEarningsAnalytics,
  // Export utility functions for testing
  processHourlyEarnings,
  processDailyEarnings,
  log
};