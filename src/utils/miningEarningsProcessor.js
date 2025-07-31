const pool = require('../db');

console.log('=== Corrected Mining Earnings Processor with Exact Timing ===');

// Enhanced logging utility
const log = {
  info: (message, data = {}) => {
    console.log(`[EARNINGS-INFO] ${new Date().toISOString()} - ${message}`, data);
  },
  warn: (message, data = {}) => {
    console.warn(`[EARNINGS-WARN] ${new Date().toISOString()} - ${message}`, data);
  },
  error: (message, error = null) => {
    console.error(`[EARNINGS-ERROR] ${new Date().toISOString()} - ${message}`, error);
  },
  debug: (message, data = {}) => {
    if (process.env.DEBUG_EARNINGS === 'true') {
      console.log(`[EARNINGS-DEBUG] ${new Date().toISOString()} - ${message}`, data);
    }
  }
};

/**
 * Process mining earnings for all active purchases with exact timing
 * This checks for engines that should mature at their exact purchase time + duration
 */
async function processMiningEarnings(intervalType = null) {
  const connection = await pool.getConnection();
  
  try {
    log.info('=== Mining earnings processing started ===', {
      intervalType,
      timestamp: new Date().toISOString()
    });
    
    await connection.beginTransaction();

    // Build query based on interval type if specified
    let intervalCondition = '';
    let queryParams = [];
    
    if (intervalType) {
      intervalCondition = 'AND e.earning_interval = ?';
      queryParams.push(intervalType);
    }

    // Get all active purchases that need processing
    // We'll check each purchase individually for maturity
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
        p.created_at as purchase_time,
        e.earning_interval,
        e.name as engine_name,
        e.daily_earning_rate,
        e.duration_days,
        e.duration_hours,
        e.is_active as engine_active
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.status = 'active' 
        AND e.is_active = TRUE
        AND p.end_date > NOW()
        ${intervalCondition}
      ORDER BY p.created_at ASC
    `, queryParams);

    log.info(`Found ${purchases.length} active purchases to check for maturity`, {
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
        log.debug(`Checking purchase #${purchase.id} for maturity`, {
          userId: purchase.user_id,
          engineName: purchase.engine_name,
          earningInterval: purchase.earning_interval,
          purchaseTime: purchase.purchase_time,
          lastEarningDate: purchase.last_earning_date
        });

        const result = await processPurchaseEarnings(connection, purchase, now);
        
        if (result.periodsProcessed > 0) {
          totalProcessed++;
          totalPeriodsProcessed += result.periodsProcessed;
          totalEarningsAdded += result.totalEarning;
          
          log.info(`Purchase #${purchase.id} processed successfully`, {
            periodsProcessed: result.periodsProcessed,
            totalEarning: result.totalEarning.toFixed(8),
            engineName: purchase.engine_name,
            nextMaturityTime: result.nextMaturityTime
          });
        }
        
        processingResults.push({
          purchaseId: purchase.id,
          userId: purchase.user_id,
          engineName: purchase.engine_name,
          earningInterval: purchase.earning_interval,
          periodsProcessed: result.periodsProcessed,
          totalEarning: result.totalEarning,
          nextMaturityTime: result.nextMaturityTime,
          status: result.status || 'success'
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
 * Process earnings for a single purchase with exact timing logic
 * This implements the correct logic: purchase time + duration = maturity time
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
    engine_name: engineName,
    purchase_time: purchaseTime,
    duration_days: durationDays,
    duration_hours: durationHours
  } = purchase;

  log.debug(`Processing purchase #${purchaseId} (${engineName})`, {
    earningInterval,
    dailyEarning,
    purchaseTime,
    lastEarningDate,
    durationDays,
    durationHours
  });

  const purchaseDateTime = new Date(purchaseTime);
  const endDateTime = new Date(endDate);
  
  // Validate purchase period
  if (currentTime < purchaseDateTime) {
    log.debug(`Purchase #${purchaseId} has not started yet`);
    return { 
      periodsProcessed: 0, 
      totalEarning: 0, 
      status: 'pending_start',
      nextMaturityTime: null 
    };
  }

  if (currentTime >= endDateTime) {
    // Mark as completed if not already
    if (purchase.status === 'active') {
      await connection.query(
        'UPDATE purchases SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [purchaseId]
      );
      log.info(`Purchase #${purchaseId} marked as completed (end date reached)`);
    }
    return { 
      periodsProcessed: 0, 
      totalEarning: 0, 
      status: 'completed',
      nextMaturityTime: null 
    };
  }

  // Calculate maturity times based on exact purchase time + duration
  let periodsProcessed = 0;
  let totalEarning = 0;
  let nextMaturityTime = null;
  const earningsToProcess = [];

  if (earningInterval === 'hourly') {
    const result = await processHourlyEarningsExact(connection, purchase, purchaseDateTime, currentTime, endDateTime);
    periodsProcessed = result.periodsProcessed;
    totalEarning = result.totalEarning;
    nextMaturityTime = result.nextMaturityTime;
    earningsToProcess.push(...result.earnings);
  } else {
    const result = await processDailyEarningsExact(connection, purchase, purchaseDateTime, currentTime, endDateTime);
    periodsProcessed = result.periodsProcessed;
    totalEarning = result.totalEarning;
    nextMaturityTime = result.nextMaturityTime;
    earningsToProcess.push(...result.earnings);
  }

  // Log earnings
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
    earningInterval,
    nextMaturityTime: nextMaturityTime ? nextMaturityTime.toISOString() : null
  });

  return { 
    periodsProcessed, 
    totalEarning,
    nextMaturityTime,
    status: 'success'
  };
}

/**
 * Process hourly earnings with exact timing
 * Example: Purchase at 4:00 PM → mature at 5:00 PM, 6:00 PM, 7:00 PM, etc.
 */
async function processHourlyEarningsExact(connection, purchase, purchaseDateTime, currentTime, endDateTime) {
  const { id: purchaseId, daily_earning: dailyEarning, duration_hours: durationHours } = purchase;
  const hourlyEarning = parseFloat((dailyEarning / 24).toFixed(8));
  
  let periodsProcessed = 0;
  let totalEarning = 0;
  let nextMaturityTime = null;
  const earnings = [];
  
  // Calculate total periods this engine should run
  const totalPeriods = durationHours || 24; // Default to 24 hours if not specified
  
  // Calculate maturity times: purchase_time + 1 hour, + 2 hours, + 3 hours, etc.
  for (let period = 1; period <= totalPeriods; period++) {
    const maturityTime = new Date(purchaseDateTime);
    maturityTime.setHours(maturityTime.getHours() + period);
    
    // If this maturity time is in the future, this is our next maturity
    if (maturityTime > currentTime) {
      nextMaturityTime = maturityTime;
      break;
    }
    
    // If this maturity time has passed and is within the engine's lifespan
    if (maturityTime <= currentTime && maturityTime <= endDateTime) {
      // Check if this earning was already processed
      const [existingLog] = await connection.query(
        'SELECT id FROM engine_logs WHERE purchase_id = ? AND earning_datetime = ?',
        [purchaseId, maturityTime]
      );

      if (existingLog.length === 0) {
        earnings.push({
          amount: hourlyEarning,
          datetime: new Date(maturityTime)
        });
        
        periodsProcessed++;
        totalEarning += hourlyEarning;
        
        log.debug(`Hourly earning scheduled: ${maturityTime.toISOString()} = ${hourlyEarning.toFixed(8)}`);
      } else {
        log.debug(`Hourly earning already exists: ${maturityTime.toISOString()}`);
      }
    }
  }
  
  // If we processed all periods, there's no next maturity
  if (periodsProcessed >= totalPeriods) {
    nextMaturityTime = null;
  }

  log.debug(`Hourly earnings processing completed for purchase ${purchaseId}`, {
    totalPeriods,
    periodsProcessed,
    totalEarning: totalEarning.toFixed(8),
    nextMaturityTime: nextMaturityTime ? nextMaturityTime.toISOString() : 'completed'
  });

  return { periodsProcessed, totalEarning, nextMaturityTime, earnings };
}

/**
 * Process daily earnings with exact timing
 * Example: Purchase at 4:00 PM today → mature at 4:00 PM tomorrow, 4:00 PM day after, etc.
 */
async function processDailyEarningsExact(connection, purchase, purchaseDateTime, currentTime, endDateTime) {
  const { id: purchaseId, daily_earning: dailyEarning, duration_days: durationDays } = purchase;
  
  let periodsProcessed = 0;
  let totalEarning = 0;
  let nextMaturityTime = null;
  const earnings = [];
  
  // Calculate total periods this engine should run
  const totalPeriods = durationDays || 365; // Default to 365 days if not specified
  
  // Calculate maturity times: purchase_time + 1 day, + 2 days, + 3 days, etc.
  for (let period = 1; period <= totalPeriods; period++) {
    const maturityTime = new Date(purchaseDateTime);
    maturityTime.setDate(maturityTime.getDate() + period);
    
    // If this maturity time is in the future, this is our next maturity
    if (maturityTime > currentTime) {
      nextMaturityTime = maturityTime;
      break;
    }
    
    // If this maturity time has passed and is within the engine's lifespan
    if (maturityTime <= currentTime && maturityTime <= endDateTime) {
      // Check if this earning was already processed (check by exact datetime)
      const [existingLog] = await connection.query(
        'SELECT id FROM engine_logs WHERE purchase_id = ? AND earning_datetime = ?',
        [purchaseId, maturityTime]
      );

      if (existingLog.length === 0) {
        earnings.push({
          amount: parseFloat(dailyEarning),
          datetime: new Date(maturityTime)
        });
        
        periodsProcessed++;
        totalEarning += parseFloat(dailyEarning);
        
        log.debug(`Daily earning scheduled: ${maturityTime.toISOString()} = ${dailyEarning}`);
      } else {
        log.debug(`Daily earning already exists: ${maturityTime.toISOString()}`);
      }
    }
  }
  
  // If we processed all periods, there's no next maturity
  if (periodsProcessed >= totalPeriods) {
    nextMaturityTime = null;
  }

  log.debug(`Daily earnings processing completed for purchase ${purchaseId}`, {
    totalPeriods,
    periodsProcessed,
    totalEarning: totalEarning.toFixed(2),
    nextMaturityTime: nextMaturityTime ? nextMaturityTime.toISOString() : 'completed'
  });

  return { periodsProcessed, totalEarning, nextMaturityTime, earnings };
}

/**
 * Manual earning trigger with enhanced validation
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
        p.last_earning_date, p.status, p.created_at as purchase_time,
        e.earning_interval, e.name as engine_name, e.duration_days, e.duration_hours,
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
          earning_interval: purchase.earning_interval,
          next_maturity_time: result.nextMaturityTime
        })
      ]);
    }
    
    await connection.commit();
    
    log.info(`Manual earning trigger completed for purchase ${purchaseId}`, {
      periodsProcessed: result.periodsProcessed,
      totalEarning: result.totalEarning,
      nextMaturityTime: result.nextMaturityTime,
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
 * Get user earnings summary with next maturity times
 */
async function getUserEarningsSummary(userId) {
  try {
    log.debug(`Fetching earnings summary for user ${userId}`);
    
    const [summary] = await pool.query(`
      SELECT 
        COUNT(DISTINCT p.id) as active_purchases,
        COALESCE(SUM(el.earning_amount), 0) as total_logged_earnings,
        COALESCE(MAX(el.earning_datetime), NULL) as last_earning_time,
        COUNT(el.id) as total_earning_logs,
        COALESCE(SUM(CASE WHEN DATE(el.earning_datetime) = CURDATE() THEN el.earning_amount ELSE 0 END), 0) as todays_earnings,
        COALESCE(SUM(CASE WHEN el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN el.earning_amount ELSE 0 END), 0) as last_7_days_earnings,
        COALESCE(SUM(CASE WHEN el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN el.earning_amount ELSE 0 END), 0) as last_hour_earnings
      FROM purchases p
      LEFT JOIN engine_logs el ON p.id = el.purchase_id
      WHERE p.user_id = ? AND p.status = 'active'
    `, [userId]);
    
    // Get upcoming maturity times
    const [upcomingMaturities] = await pool.query(`
      SELECT 
        p.id as purchase_id,
        e.name as engine_name,
        e.earning_interval,
        e.duration_days,
        e.duration_hours,
        p.created_at as purchase_time,
        CASE 
          WHEN e.earning_interval = 'hourly' THEN
            DATE_ADD(p.created_at, INTERVAL 
              (FLOOR(TIMESTAMPDIFF(HOUR, p.created_at, NOW())) + 1) HOUR)
          ELSE
            DATE_ADD(p.created_at, INTERVAL 
              (FLOOR(TIMESTAMPDIFF(DAY, p.created_at, NOW())) + 1) DAY)
        END as next_maturity_time,
        CASE 
          WHEN e.earning_interval = 'hourly' THEN ROUND(p.daily_earning / 24, 8)
          ELSE p.daily_earning
        END as next_earning_amount
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.user_id = ? 
        AND p.status = 'active' 
        AND p.end_date > NOW()
        AND (
          (e.earning_interval = 'hourly' AND 
           FLOOR(TIMESTAMPDIFF(HOUR, p.created_at, NOW())) < COALESCE(e.duration_hours, 24))
          OR
          (e.earning_interval = 'daily' AND 
           FLOOR(TIMESTAMPDIFF(DAY, p.created_at, NOW())) < COALESCE(e.duration_days, 365))
        )
      ORDER BY next_maturity_time ASC
      LIMIT 5
    `, [userId]);
    
    return {
      summary: summary[0],
      upcoming_maturities: upcomingMaturities.map(maturity => ({
        ...maturity,
        next_maturity_time: maturity.next_maturity_time ? maturity.next_maturity_time.toISOString() : null,
        minutes_until_maturity: maturity.next_maturity_time ? 
          Math.max(0, Math.floor((new Date(maturity.next_maturity_time) - new Date()) / (1000 * 60))) : null,
        formatted_amount: `KES ${parseFloat(maturity.next_earning_amount).toFixed(2)}`,
        purchase_time: maturity.purchase_time.toISOString()
      }))
    };
    
  } catch (error) {
    log.error('Error fetching user earnings summary:', error);
    throw error;
  }
}

/**
 * Get detailed maturity schedule for a purchase
 */
async function getPurchaseMaturitySchedule(purchaseId) {
  try {
    const [purchases] = await pool.query(`
      SELECT 
        p.*, e.name as engine_name, e.earning_interval, 
        e.duration_days, e.duration_hours
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.id = ?
    `, [purchaseId]);
    
    if (purchases.length === 0) {
      throw new Error('Purchase not found');
    }
    
    const purchase = purchases[0];
    const purchaseTime = new Date(purchase.created_at);
    const schedule = [];
    
    if (purchase.earning_interval === 'hourly') {
      const totalHours = purchase.duration_hours || 24;
      for (let hour = 1; hour <= totalHours; hour++) {
        const maturityTime = new Date(purchaseTime);
        maturityTime.setHours(maturityTime.getHours() + hour);
        
        schedule.push({
          period: hour,
          maturity_time: maturityTime.toISOString(),
          earning_amount: parseFloat((purchase.daily_earning / 24).toFixed(8)),
          status: maturityTime <= new Date() ? 'mature' : 'pending'
        });
      }
    } else {
      const totalDays = purchase.duration_days || 365;
      for (let day = 1; day <= totalDays; day++) {
        const maturityTime = new Date(purchaseTime);
        maturityTime.setDate(maturityTime.getDate() + day);
        
        schedule.push({
          period: day,
          maturity_time: maturityTime.toISOString(),
          earning_amount: parseFloat(purchase.daily_earning),
          status: maturityTime <= new Date() ? 'mature' : 'pending'
        });
      }
    }
    
    return {
      purchase_info: purchase,
      maturity_schedule: schedule.slice(0, 50), // Limit to first 50 for performance
      total_periods: schedule.length,
      mature_periods: schedule.filter(s => s.status === 'mature').length
    };
    
  } catch (error) {
    log.error('Error fetching purchase maturity schedule:', error);
    throw error;
  }
}

module.exports = {
  processMiningEarnings,
  triggerManualEarning,
  getUserEarningsSummary,
  getPurchaseMaturitySchedule,
  processHourlyEarningsExact,
  processDailyEarningsExact,
  log
};