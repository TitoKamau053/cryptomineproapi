const cron = require('node-cron');
const { processMiningEarnings } = require('./miningEarningsProcessor');

console.log('=== Corrected Cron Scheduler for Exact Timing ===');

// Job status tracking
const jobStatus = {
  earnings: { running: false, lastRun: null, lastResult: null, errors: 0 },
  maintenance: { running: false, lastRun: null, lastResult: null, errors: 0 }
};

// Enhanced logging
const log = {
  info: (message, data = {}) => console.log(`[CRON-INFO] ${new Date().toISOString()} - ${message}`, data),
  warn: (message, data = {}) => console.warn(`[CRON-WARN] ${new Date().toISOString()} - ${message}`, data),
  error: (message, error = null) => console.error(`[CRON-ERROR] ${new Date().toISOString()} - ${message}`, error),
  debug: (message, data = {}) => {
    if (process.env.DEBUG_CRON === 'true') {
      console.log(`[CRON-DEBUG] ${new Date().toISOString()} - ${message}`, data);
    }
  }
};

/**
 * FREQUENT EARNINGS PROCESSING
 * Runs every 5 minutes to check for any engines that should have matured
 * This handles all engines regardless of their duration (1hr, 2hrs, 1day, 2days, etc.)
 */
const scheduleFrequentEarningsProcessing = () => {
  const task = cron.schedule('*/5 * * * *', async () => {
    const startTime = new Date();
    log.info('=== FREQUENT EARNINGS CHECK STARTED ===', {
      checkTime: startTime.toISOString(),
      timezone: 'Africa/Nairobi'
    });
    
    // Prevent concurrent executions
    if (jobStatus.earnings.running) {
      log.warn('Earnings processing already running, skipping this execution');
      return;
    }

    jobStatus.earnings.running = true;
    jobStatus.earnings.lastRun = startTime;
    
    try {
      // Process all engines (both hourly and daily)
      const result = await processMiningEarnings();
      
      jobStatus.earnings.lastResult = {
        success: true,
        ...result,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      jobStatus.earnings.errors = 0; // Reset error counter on success
      
      // Only log if we actually processed something
      if (result.totalPeriods > 0) {
        log.info('EARNINGS CHECK: Matured engines found and processed', {
          processed: result.processed,
          totalPeriods: result.totalPeriods,
          totalEarnings: result.totalEarnings,
          duration: `${Date.now() - startTime.getTime()}ms`,
          hourlyEngines: result.details?.filter(d => d.earningInterval === 'hourly' && d.periodsProcessed > 0).length || 0,
          dailyEngines: result.details?.filter(d => d.earningInterval === 'daily' && d.periodsProcessed > 0).length || 0
        });
      } else {
        log.debug('EARNINGS CHECK: No matured engines found', {
          totalChecked: result.processed,
          duration: `${Date.now() - startTime.getTime()}ms`
        });
      }

      // Performance monitoring
      const duration = Date.now() - startTime.getTime();
      if (duration > 60000) { // 1 minute
        log.warn('EARNINGS CHECK: Processing took longer than expected', { 
          duration: `${duration}ms`,
          suggestion: 'Consider optimizing database queries'
        });
      }

    } catch (error) {
      jobStatus.earnings.errors++;
      jobStatus.earnings.lastResult = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      log.error('EARNINGS CHECK FAILED', error);
      
      // Alert on repeated failures
      if (jobStatus.earnings.errors >= 5) {
        log.error('EARNINGS CHECK: Multiple consecutive failures detected', { 
          errorCount: jobStatus.earnings.errors,
          lastError: error.message,
          action: 'Manual intervention may be required'
        });
        await sendAdminAlert('Frequent earnings check failures', {
          errorCount: jobStatus.earnings.errors,
          lastError: error.message,
          timestamp: startTime.toISOString()
        });
      }
    } finally {
      jobStatus.earnings.running = false;
      const totalDuration = Date.now() - startTime.getTime();
      log.debug('=== FREQUENT EARNINGS CHECK ENDED ===', {
        duration: `${totalDuration}ms`,
        status: jobStatus.earnings.lastResult?.success ? 'SUCCESS' : 'FAILED'
      });
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });

  log.info('✅ Frequent earnings processing scheduled (every 5 minutes)');
  return task;
};

/**
 * INTENSIVE EARNINGS PROCESSING
 * Runs every minute during peak hours (6 AM - 11 PM) for more responsive processing
 * This ensures users get their earnings as close to maturity time as possible
 */
const scheduleIntensiveEarningsProcessing = () => {
  const task = cron.schedule('* 6-23 * * *', async () => {
    const startTime = new Date();
    log.debug('=== INTENSIVE EARNINGS CHECK STARTED ===', {
      checkTime: startTime.toISOString()
    });
    
    // Prevent concurrent executions
    if (jobStatus.earnings.running) {
      return; // Silently skip if already running
    }

    jobStatus.earnings.running = true;
    
    try {
      // Quick check for any matured engines
      const result = await processMiningEarnings();
      
      // Only log if we found something to process
      if (result.totalPeriods > 0) {
        log.info('INTENSIVE CHECK: Matured engines processed', {
          totalPeriods: result.totalPeriods,
          totalEarnings: result.totalEarnings,
          duration: `${Date.now() - startTime.getTime()}ms`
        });
      }

    } catch (error) {
      log.warn('INTENSIVE CHECK: Error occurred', { error: error.message });
    } finally {
      jobStatus.earnings.running = false;
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });

  log.info('✅ Intensive earnings processing scheduled (every minute 6 AM - 11 PM)');
  return task;
};

/**
 * COMPREHENSIVE SYSTEM MAINTENANCE
 * Runs every day at 02:00 (2:00 AM) when traffic is low
 */
const scheduleDailyMaintenance = () => {
  const task = cron.schedule('0 2 * * *', async () => {
    const startTime = new Date();
    log.info('=== DAILY MAINTENANCE STARTED ===');
    
    if (jobStatus.maintenance.running) {
      log.warn('Daily maintenance already running, skipping this execution');
      return;
    }

    jobStatus.maintenance.running = true;
    jobStatus.maintenance.lastRun = startTime;
    
    const maintenanceResults = {};
    
    try {
      // 1. Update completed purchases
      log.info('MAINTENANCE: Updating completed purchases...');
      const purchaseUpdateResult = await updateCompletedPurchases();
      maintenanceResults.purchaseUpdates = purchaseUpdateResult;
      
      // 2. Clean up old logs and data
      log.info('MAINTENANCE: Starting system cleanup...');
      const cleanupResult = await performSystemCleanup();
      maintenanceResults.cleanup = cleanupResult;
      
      // 3. Update user statistics
      log.info('MAINTENANCE: Updating user statistics...');
      const statsUpdateResult = await updateUserStatistics();
      maintenanceResults.statsUpdate = statsUpdateResult;
      
      // 4. Generate daily reports
      log.info('MAINTENANCE: Generating daily reports...');
      const reportResult = await generateSystemReports();
      maintenanceResults.reports = reportResult;
      
      // 5. Database optimization
      log.info('MAINTENANCE: Optimizing database...');
      const optimizationResult = await optimizeDatabase();
      maintenanceResults.optimization = optimizationResult;
      
      // 6. Check for stuck/overdue earnings
      log.info('MAINTENANCE: Checking for stuck earnings...');
      const stuckEarningsResult = await checkForStuckEarnings();
      maintenanceResults.stuckEarnings = stuckEarningsResult;
      
      jobStatus.maintenance.lastResult = {
        success: true,
        results: maintenanceResults,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      jobStatus.maintenance.errors = 0;
      
      log.info('MAINTENANCE: All tasks completed successfully', {
        duration: `${Date.now() - startTime.getTime()}ms`,
        tasksCompleted: Object.keys(maintenanceResults).length
      });

    } catch (error) {
      jobStatus.maintenance.errors++;
      jobStatus.maintenance.lastResult = {
        success: false,
        error: error.message,
        partialResults: maintenanceResults,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      log.error('MAINTENANCE: Task failed', error);
      
      await sendAdminAlert('Daily maintenance failed', {
        error: error.message,
        partialResults: maintenanceResults,
        timestamp: startTime.toISOString()
      });
    } finally {
      jobStatus.maintenance.running = false;
      log.info('=== DAILY MAINTENANCE ENDED ===', {
        duration: `${Date.now() - startTime.getTime()}ms`
      });
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });

  log.info('✅ Daily maintenance scheduled (02:00 daily)');
  return task;
};

/**
 * Update purchases that have reached their end date
 */
async function updateCompletedPurchases() {
  try {
    const pool = require('../db');
    
    // Update purchases that have reached their end date
    const [result] = await pool.query(`
      UPDATE purchases 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active' AND end_date <= NOW()
    `);
    
    // Get details of newly completed purchases
    if (result.affectedRows > 0) {
      const [completedPurchases] = await pool.query(`
        SELECT 
          p.id, p.user_id, p.amount_invested, p.total_earned,
          me.name as engine_name, me.earning_interval,
          u.email as user_email, u.full_name,
          p.created_at as purchase_time,
          p.end_date
        FROM purchases p
        JOIN mining_engines me ON p.engine_id = me.id
        JOIN users u ON p.user_id = u.id
        WHERE p.status = 'completed' 
          AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        LIMIT 20
      `);
      
      log.info('Purchase completion update completed', {
        purchasesCompleted: result.affectedRows,
        sampleCompleted: completedPurchases.slice(0, 5)
      });
      
      return {
        purchases_completed: result.affectedRows,
        sample_completed: completedPurchases
      };
    }
    
    return { purchases_completed: 0 };
    
  } catch (error) {
    log.error('Purchase status update failed', error);
    throw error;
  }
}

/**
 * Check for stuck earnings (purchases that should have earned but haven't)
 */
async function checkForStuckEarnings() {
  try {
    const pool = require('../db');
    
    // Check for hourly engines that are overdue (more than 1 hour behind)
    const [stuckHourly] = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.created_at as purchase_time,
        me.name as engine_name,
        me.duration_hours,
        TIMESTAMPDIFF(HOUR, p.created_at, NOW()) as hours_since_purchase,
        (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) as earnings_logged
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active'
        AND me.earning_interval = 'hourly' 
        AND me.is_active = TRUE
        AND TIMESTAMPDIFF(HOUR, p.created_at, NOW()) >= 1
        AND (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) < 
            LEAST(TIMESTAMPDIFF(HOUR, p.created_at, NOW()), COALESCE(me.duration_hours, 24))
        AND p.end_date > NOW()
      LIMIT 50
    `);
    
    // Check for daily engines that are overdue (more than 1 day behind)
    const [stuckDaily] = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.created_at as purchase_time,
        me.name as engine_name,
        me.duration_days,
        TIMESTAMPDIFF(DAY, p.created_at, NOW()) as days_since_purchase,
        (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) as earnings_logged
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active'
        AND me.earning_interval = 'daily' 
        AND me.is_active = TRUE
        AND TIMESTAMPDIFF(DAY, p.created_at, NOW()) >= 1
        AND (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) < 
            LEAST(TIMESTAMPDIFF(DAY, p.created_at, NOW()), COALESCE(me.duration_days, 365))
        AND p.end_date > NOW()
      LIMIT 50
    `);
    
    const totalStuck = stuckHourly.length + stuckDaily.length;
    
    if (totalStuck > 0) {
      log.warn('MAINTENANCE: Found stuck earnings', {
        stuckHourly: stuckHourly.length,
        stuckDaily: stuckDaily.length,
        totalStuck
      });
      
      // Alert if too many stuck earnings
      if (totalStuck > 10) {
        await sendAdminAlert('High number of stuck earnings detected', {
          stuckHourly: stuckHourly.length,
          stuckDaily: stuckDaily.length,
          totalStuck,
          sampleStuck: [...stuckHourly.slice(0, 3), ...stuckDaily.slice(0, 3)]
        });
      }
    }
    
    return {
      stuck_hourly: stuckHourly.length,
      stuck_daily: stuckDaily.length,
      total_stuck: totalStuck,
      sample_stuck: totalStuck > 0 ? [...stuckHourly.slice(0, 3), ...stuckDaily.slice(0, 3)] : []
    };
    
  } catch (error) {
    log.error('Stuck earnings check failed', error);
    throw error;
  }
}

/**
 * Comprehensive system cleanup
 */
async function performSystemCleanup() {
  try {
    const pool = require('../db');
    
    // Clean up old engine logs (keep last 180 days)
    const [logsResult] = await pool.query(`
      DELETE FROM engine_logs 
      WHERE earning_datetime < DATE_SUB(NOW(), INTERVAL 180 DAY)
    `);
    
    // Clean up old admin logs (keep last 365 days)
    const [adminLogsResult] = await pool.query(`
      DELETE FROM admin_logs 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 365 DAY)
    `);
    
    // Clean up old verification tokens
    const [tokensResult] = await pool.query(`
      DELETE FROM email_verification_tokens 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND (used = 1 OR expires_at < NOW())
    `);
    
    // Clean up old mpesa callbacks
    const [callbacksResult] = await pool.query(`
      DELETE FROM mpesa_callbacks 
      WHERE processed_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    
    const result = {
      engine_logs_cleaned: logsResult.affectedRows,
      admin_logs_cleaned: adminLogsResult.affectedRows,
      tokens_cleaned: tokensResult.affectedRows,
      callbacks_cleaned: callbacksResult.affectedRows,
      total_cleaned: logsResult.affectedRows + adminLogsResult.affectedRows + 
                    tokensResult.affectedRows + callbacksResult.affectedRows
    };
    
    log.info('System cleanup completed', result);
    return result;
    
  } catch (error) {
    log.error('System cleanup failed', error);
    throw error;
  }
}

/**
 * Update user statistics
 */
async function updateUserStatistics() {
  try {
    const pool = require('../db');
    
    // Update user total earnings from engine logs
    const [earningsUpdate] = await pool.query(`
      UPDATE users u
      SET total_earnings = (
        SELECT COALESCE(SUM(el.earning_amount), 0)
        FROM engine_logs el 
        WHERE el.user_id = u.id
      ),
      updated_at = CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM engine_logs el WHERE el.user_id = u.id
      )
    `);
    
    return {
      earnings_updated: earningsUpdate.affectedRows
    };
    
  } catch (error) {
    log.error('User statistics update failed', error);
    throw error;
  }
}

/**
 * Generate daily system reports
 */
async function generateSystemReports() {
  try {
    const pool = require('../db');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const reportDate = yesterday.toISOString().split('T')[0];
    
    // Generate earnings report
    const [earningsReport] = await pool.query(`
      SELECT 
        COUNT(DISTINCT el.user_id) as active_users,
        COUNT(DISTINCT el.purchase_id) as earning_purchases,
        COUNT(el.id) as total_earnings_logged,
        SUM(el.earning_amount) as total_amount_paid,
        AVG(el.earning_amount) as avg_earning,
        me.earning_interval,
        COUNT(el.id) as earning_count
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE DATE(el.earning_datetime) = ?
      GROUP BY me.earning_interval
    `, [reportDate]);
    
    // Generate purchase report
    const [purchaseReport] = await pool.query(`
      SELECT 
        COUNT(*) as new_purchases,
        SUM(amount_invested) as total_invested,
        AVG(amount_invested) as avg_investment,
        COUNT(DISTINCT user_id) as unique_investors
      FROM purchases
      WHERE DATE(created_at) = ?
    `, [reportDate]);
    
    const report = {
      date: reportDate,
      earnings: earningsReport,
      purchases: purchaseReport[0],
      generated_at: new Date().toISOString()
    };
    
    // Save report to database
    await pool.query(`
      INSERT INTO system_settings (setting_key, setting_value, category, description, created_at, updated_at)
      VALUES (?, ?, 'reports', 'Daily system report', NOW(), NOW())
      ON DUPLICATE KEY UPDATE 
        setting_value = VALUES(setting_value),
        updated_at = NOW()
    `, [`daily_system_report_${reportDate}`, JSON.stringify(report)]);
    
    log.info(`Daily system report generated for ${reportDate}`, {
      totalEarnings: earningsReport.reduce((sum, r) => sum + parseFloat(r.total_amount_paid || 0), 0),
      newPurchases: purchaseReport[0].new_purchases
    });
    
    return report;
    
  } catch (error) {
    log.error('Report generation failed', error);
    throw error;
  }
}

/**
 * Database optimization
 */
async function optimizeDatabase() {
  try {
    const pool = require('../db');
    
    const tablesToOptimize = ['engine_logs', 'purchases', 'users', 'deposits', 'withdrawals'];
    const optimizationResults = {};
    
    for (const table of tablesToOptimize) {
      try {
        await pool.query(`ANALYZE TABLE ${table}`);
        await pool.query(`OPTIMIZE TABLE ${table}`);
        optimizationResults[table] = 'success';
      } catch (error) {
        optimizationResults[table] = `failed: ${error.message}`;
        log.warn(`Failed to optimize table ${table}`, error);
      }
    }
    
    return {
      tables_processed: tablesToOptimize.length,
      results: optimizationResults
    };
    
  } catch (error) {
    log.error('Database optimization failed', error);
    throw error;
  }
}

/**
 * Send alert to administrators
 */
async function sendAdminAlert(subject, details) {
  try {
    log.warn(`ADMIN ALERT: ${subject}`, details);
    
    const pool = require('../db');
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (1, 'system_alert', 'system', NULL, ?, CURRENT_TIMESTAMP)
    `, [JSON.stringify({ subject, details, severity: 'warning', timestamp: new Date().toISOString() })]);
    
    return true;
  } catch (error) {
    log.error('Failed to send admin alert', error);
    return false;
  }
}

/**
 * Manual trigger for earnings processing
 */
const triggerManualProcessing = async (options = {}) => {
  const { intervalType, force = false, dryRun = false } = options;
  
  log.info('MANUAL: Starting manual earnings processing...', options);
  
  try {
    if (dryRun) {
      log.info('MANUAL: DRY RUN MODE - No actual processing will occur');
      const pool = require('../db');
      const [purchases] = await pool.query(`
        SELECT COUNT(*) as count FROM purchases p
        JOIN mining_engines e ON p.engine_id = e.id
        WHERE p.status = 'active' AND e.is_active = TRUE
        ${intervalType ? 'AND e.earning_interval = ?' : ''}
      `, intervalType ? [intervalType] : []);
      
      return {
        dryRun: true,
        wouldProcess: purchases[0].count,
        intervalType: intervalType || 'all'
      };
    }
    
    // Check if any job is currently running (unless forced)
    if (!force && jobStatus.earnings.running) {
      throw new Error('Earnings processing job is currently running. Use force=true to override.');
    }
    
    const result = await processMiningEarnings(intervalType);
    log.info('MANUAL: Processing completed', result);
    return result;
    
  } catch (error) {
    log.error('MANUAL ERROR:', error);
    throw error;
  }
};

/**
 * Get comprehensive job status
 */
const getJobStatus = () => {
  return {
    jobs: jobStatus,
    uptime: process.uptime(),
    memory_usage: process.memoryUsage(),
    current_time: new Date().toISOString(),
    timezone: 'Africa/Nairobi',
    scheduled_jobs: {
      frequent_earnings: 'Every 5 minutes',
      intensive_earnings: 'Every minute (6 AM - 11 PM)',
      maintenance: 'Daily at 02:00'
    }
  };
};

/**
 * Start all cron jobs with the corrected timing logic
 */
const startCronJobs = () => {
  log.info('Starting corrected cron job scheduler with exact timing...');
  
  const jobs = {
    frequent: scheduleFrequentEarningsProcessing(),
    intensive: scheduleIntensiveEarningsProcessing(),
    maintenance: scheduleDailyMaintenance()
  };
  
  // Health check every 30 minutes
  const healthCheckJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const pool = require('../db');
      
      // Quick health check
      const [overdue] = await pool.query(`
        SELECT COUNT(*) as count
        FROM purchases p
        JOIN mining_engines me ON p.engine_id = me.id
        WHERE p.status = 'active' 
          AND me.is_active = TRUE
          AND (
            (me.earning_interval = 'hourly' AND 
             TIMESTAMPDIFF(HOUR, p.created_at, NOW()) > 
             (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) + 1)
            OR
            (me.earning_interval = 'daily' AND 
             TIMESTAMPDIFF(DAY, p.created_at, NOW()) > 
             (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) + 1)
          )
          AND p.end_date > NOW()
      `);
      
      if (overdue[0].count > 20) {
        await sendAdminAlert('High number of overdue earnings detected', {
          overdue_count: overdue[0].count,
          check_time: new Date().toISOString()
        });
      }
      
    } catch (error) {
      log.error('Health check failed', error);
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });
  
  jobs.healthCheck = healthCheckJob;
  
  log.info('All cron jobs started successfully!', {
    jobs: Object.keys(jobs),
    timezone: 'Africa/Nairobi',
    schedules: {
      frequent_earnings: '*/5 * * * * (every 5 minutes)',
      intensive_earnings: '* 6-23 * * * (every minute 6 AM - 11 PM)',
      maintenance: '0 2 * * * (02:00 daily)',
      health_check: '*/30 * * * * (every 30 minutes)'
    }
  });
  
  return jobs;
};

/**
 * Stop all cron jobs gracefully
 */
const stopCronJobs = () => {
  const tasks = cron.getTasks();
  let stoppedCount = 0;
  
  tasks.forEach((task) => {
    try {
      task.stop();
      stoppedCount++;
    } catch (error) {
      log.error('Error stopping cron task', error);
    }
  });
  
  log.info(`All cron jobs stopped (${stoppedCount} tasks)`);
  return stoppedCount;
};

// Graceful shutdown handling
process.on('SIGINT', () => {
  log.info('Received SIGINT. Gracefully shutting down...');
  
  const shutdownTimeout = setTimeout(() => {
    log.warn('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000); // 30 seconds
  
  const checkRunningJobs = () => {
    const runningJobs = Object.entries(jobStatus)
      .filter(([_, status]) => status.running)
      .map(([name]) => name);
    
    if (runningJobs.length === 0) {
      clearTimeout(shutdownTimeout);
      stopCronJobs();
      log.info('Graceful shutdown completed');
      process.exit(0);
    } else {
      log.info(`Waiting for running jobs to complete: ${runningJobs.join(', ')}`);
      setTimeout(checkRunningJobs, 1000);
    }
  };
  
  checkRunningJobs();
});

process.on('SIGTERM', () => {
  log.info('Received SIGTERM. Stopping cron jobs...');
  stopCronJobs();
  process.exit(0);
});

module.exports = {
  startCronJobs,
  stopCronJobs,
  triggerManualProcessing,
  getJobStatus,
  sendAdminAlert,
  jobStatus
};