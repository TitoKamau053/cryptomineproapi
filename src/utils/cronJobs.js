const cron = require('node-cron');
const { processMiningEarnings } = require('../utils/miningEarningsProcessor');

console.log('=== Enhanced Cron Job Manager Loaded ===');

// Job status tracking
const jobStatus = {
  hourly: { running: false, lastRun: null, lastResult: null, errors: 0 },
  daily: { running: false, lastRun: null, lastResult: null, errors: 0 },
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
 * Enhanced hourly earnings processing with monitoring
 * Runs every hour at minute 0 (e.g., 1:00, 2:00, 3:00, etc.)
 */
const scheduleHourlyEarningsProcessing = () => {
  const task = cron.schedule('0 * * * *', async () => {
    const startTime = new Date();
    log.info('=== HOURLY EARNINGS PROCESSING STARTED ===');
    
    // Prevent concurrent executions
    if (jobStatus.hourly.running) {
      log.warn('Hourly earnings processing already running, skipping this execution');
      return;
    }

    jobStatus.hourly.running = true;
    jobStatus.hourly.lastRun = startTime;
    
    try {
      // Process only hourly earnings
      const result = await processMiningEarnings('hourly');
      
      jobStatus.hourly.lastResult = {
        success: true,
        ...result,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      jobStatus.hourly.errors = 0; // Reset error counter on success
      
      log.info('HOURLY: Earnings processing completed successfully', {
        processed: result.processed,
        totalPeriods: result.totalPeriods,
        totalEarnings: result.totalEarnings,
        duration: `${Date.now() - startTime.getTime()}ms`
      });

      // Alert if processing took too long
      const duration = Date.now() - startTime.getTime();
      if (duration > 300000) { // 5 minutes
        log.warn('HOURLY: Processing took longer than expected', { duration });
      }

    } catch (error) {
      jobStatus.hourly.errors++;
      jobStatus.hourly.lastResult = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      log.error('HOURLY: Earnings processing failed', error);
      
      // Alert on repeated failures
      if (jobStatus.hourly.errors >= 3) {
        log.error('HOURLY: Multiple consecutive failures detected', { 
          errorCount: jobStatus.hourly.errors 
        });
        // Here you could send alerts to administrators
        await sendAdminAlert('Hourly earnings processing failures', {
          errorCount: jobStatus.hourly.errors,
          lastError: error.message
        });
      }
    } finally {
      jobStatus.hourly.running = false;
      log.info('=== HOURLY EARNINGS PROCESSING ENDED ===', {
        duration: `${Date.now() - startTime.getTime()}ms`
      });
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });

  log.info('✅ Hourly earnings processing cron job scheduled (every hour at :00)');
  return task;
};

/**
 * Enhanced daily earnings processing with monitoring
 * Runs every day at midnight (00:00)
 */
const scheduleDailyEarningsProcessing = () => {
  const task = cron.schedule('0 0 * * *', async () => {
    const startTime = new Date();
    log.info('=== DAILY EARNINGS PROCESSING STARTED ===');
    
    // Prevent concurrent executions
    if (jobStatus.daily.running) {
      log.warn('Daily earnings processing already running, skipping this execution');
      return;
    }

    jobStatus.daily.running = true;
    jobStatus.daily.lastRun = startTime;
    
    try {
      // Process only daily earnings
      const result = await processMiningEarnings('daily');
      
      jobStatus.daily.lastResult = {
        success: true,
        ...result,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      jobStatus.daily.errors = 0; // Reset error counter on success
      
      log.info('DAILY: Earnings processing completed successfully', {
        processed: result.processed,
        totalPeriods: result.totalPeriods,
        totalEarnings: result.totalEarnings,
        duration: `${Date.now() - startTime.getTime()}ms`
      });

    } catch (error) {
      jobStatus.daily.errors++;
      jobStatus.daily.lastResult = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      log.error('DAILY: Earnings processing failed', error);
      
      // Alert on failures (daily is more critical)
      await sendAdminAlert('Daily earnings processing failed', {
        error: error.message,
        timestamp: startTime.toISOString()
      });
    } finally {
      jobStatus.daily.running = false;
      log.info('=== DAILY EARNINGS PROCESSING ENDED ===', {
        duration: `${Date.now() - startTime.getTime()}ms`
      });
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });

  log.info('✅ Daily earnings processing cron job scheduled (midnight daily)');
  return task;
};

/**
 * Enhanced daily maintenance with comprehensive tasks
 * Runs every day at 2:00 AM (after daily earnings processing)
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
      // 1. Clean up old logs
      log.info('MAINTENANCE: Starting log cleanup...');
      const cleanupResult = await cleanupOldLogs();
      maintenanceResults.cleanup = cleanupResult;
      
      // 2. Update completed purchases
      log.info('MAINTENANCE: Updating completed purchases...');
      const purchaseUpdateResult = await updateCompletedPurchases();
      maintenanceResults.purchaseUpdates = purchaseUpdateResult;
      
      // 3. Generate daily earnings report
      log.info('MAINTENANCE: Generating daily earnings report...');
      const reportResult = await generateDailyEarningsReport();
      maintenanceResults.report = reportResult;
      
      // 4. Database optimization
      log.info('MAINTENANCE: Optimizing database...');
      const optimizationResult = await optimizeDatabase();
      maintenanceResults.optimization = optimizationResult;
      
      // 5. System health check
      log.info('MAINTENANCE: Performing system health check...');
      const healthResult = await performSystemHealthCheck();
      maintenanceResults.healthCheck = healthResult;
      
      jobStatus.maintenance.lastResult = {
        success: true,
        results: maintenanceResults,
        duration: Date.now() - startTime.getTime(),
        timestamp: startTime.toISOString()
      };
      
      jobStatus.maintenance.errors = 0;
      
      log.info('MAINTENANCE: All tasks completed successfully', {
        duration: `${Date.now() - startTime.getTime()}ms`,
        results: maintenanceResults
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
        partialResults: maintenanceResults
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

  log.info('✅ Daily maintenance cron job scheduled (2:00 AM daily)');
  return task;
};

/**
 * Enhanced cleanup function with detailed reporting
 */
async function cleanupOldLogs() {
  try {
    const pool = require('../db');
    
    // Clean up old engine logs (keep last 90 days)
    const [logsResult] = await pool.query(`
      DELETE FROM engine_logs 
      WHERE earning_datetime < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    
    // Clean up old admin logs (keep last 180 days)
    const [adminLogsResult] = await pool.query(`
      DELETE FROM admin_logs 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
    `);
    
    // Clean up old email verification tokens (keep last 7 days)
    const [tokensResult] = await pool.query(`
      DELETE FROM email_verification_tokens 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND (used = 1 OR expires_at < NOW())
    `);
    
    const result = {
      engine_logs_cleaned: logsResult.affectedRows,
      admin_logs_cleaned: adminLogsResult.affectedRows,
      tokens_cleaned: tokensResult.affectedRows,
      total_cleaned: logsResult.affectedRows + adminLogsResult.affectedRows + tokensResult.affectedRows
    };
    
    log.info('Cleanup completed', result);
    return result;
    
  } catch (error) {
    log.error('Cleanup failed', error);
    throw error;
  }
}

/**
 * Enhanced purchase status update with detailed reporting
 */
async function updateCompletedPurchases() {
  try {
    const pool = require('../db');
    
    // Update purchases that have reached their end date
    const [result] = await pool.query(`
      UPDATE purchases 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active' AND end_date < CURDATE()
    `);
    
    // Get details of completed purchases for reporting
    if (result.affectedRows > 0) {
      const [completedPurchases] = await pool.query(`
        SELECT 
          p.id, p.user_id, p.amount_invested, p.total_earned,
          me.name as engine_name, u.email as user_email
        FROM purchases p
        JOIN mining_engines me ON p.engine_id = me.id
        JOIN users u ON p.user_id = u.id
        WHERE p.status = 'completed' AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        LIMIT 10
      `);
      
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
 * Enhanced daily earnings report generation
 */
async function generateDailyEarningsReport() {
  try {
    const pool = require('../db');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    // Overall statistics
    const [overallStats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT el.user_id) as active_users,
        COUNT(DISTINCT el.purchase_id) as active_purchases,
        COUNT(el.id) as total_earnings,
        SUM(el.earning_amount) as total_amount,
        AVG(el.earning_amount) as avg_earning
      FROM engine_logs el 
      WHERE DATE(el.earning_datetime) = ?
    `, [dateStr]);
    
    // Earnings by interval type
    const [intervalStats] = await pool.query(`
      SELECT 
        me.earning_interval,
        COUNT(el.id) as earning_count,
        SUM(el.earning_amount) as total_amount,
        COUNT(DISTINCT el.user_id) as unique_users
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE DATE(el.earning_datetime) = ?
      GROUP BY me.earning_interval
    `, [dateStr]);
    
    // Top performing engines
    const [topEngines] = await pool.query(`
      SELECT 
        me.name as engine_name,
        me.earning_interval,
        COUNT(el.id) as earning_count,
        SUM(el.earning_amount) as total_earnings,
        COUNT(DISTINCT el.user_id) as unique_users
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE DATE(el.earning_datetime) = ?
      GROUP BY me.id, me.name, me.earning_interval
      ORDER BY total_earnings DESC
      LIMIT 5
    `, [dateStr]);
    
    const report = {
      date: dateStr,
      overall: overallStats[0],
      by_interval: intervalStats,
      top_engines: topEngines,
      generated_at: new Date().toISOString()
    };
    
    // Save report to database (optional)
    await pool.query(`
      INSERT INTO system_settings (setting_key, setting_value, category, description, created_at, updated_at)
      VALUES (?, ?, 'reports', 'Daily earnings report', NOW(), NOW())
      ON DUPLICATE KEY UPDATE 
        setting_value = VALUES(setting_value),
        updated_at = NOW()
    `, [`daily_earnings_report_${dateStr}`, JSON.stringify(report)]);
    
    log.info(`Daily earnings report generated for ${dateStr}`, report.overall);
    return report;
    
  } catch (error) {
    log.error('Daily report generation failed', error);
    throw error;
  }
}

/**
 * Database optimization tasks
 */
async function optimizeDatabase() {
  try {
    const pool = require('../db');
    
    // Analyze and optimize key tables
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
    
    // Update table statistics
    await pool.query('FLUSH TABLES');
    
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
 * System health check
 */
async function performSystemHealthCheck() {
  try {
    const pool = require('../db');
    
    // Check database connectivity
    await pool.query('SELECT 1');
    
    // Check for long-running processes
    const [processes] = await pool.query('SHOW PROCESSLIST');
    const longRunning = processes.filter(p => p.Time > 300); // 5 minutes
    
    // Check disk space (if possible)
    const [diskInfo] = await pool.query(`
      SELECT 
        table_schema as 'database',
        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as 'size_mb'
      FROM information_schema.tables 
      WHERE table_schema = DATABASE()
      GROUP BY table_schema
    `);
    
    // Check recent errors in logs
    const errorCount = jobStatus.hourly.errors + jobStatus.daily.errors + jobStatus.maintenance.errors;
    
    return {
      database_connectivity: 'ok',
      database_size_mb: diskInfo[0]?.size_mb || 'unknown',
      long_running_processes: longRunning.length,
      recent_job_errors: errorCount,
      last_hourly_run: jobStatus.hourly.lastRun,
      last_daily_run: jobStatus.daily.lastRun,
      status: errorCount > 5 ? 'warning' : 'healthy'
    };
    
  } catch (error) {
    log.error('System health check failed', error);
    return {
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Send alert to administrators (placeholder implementation)
 */
async function sendAdminAlert(subject, details) {
  try {
    // This is a placeholder - implement your preferred alerting method
    // Options: Email, Slack, SMS, Push notifications, etc.
    
    log.warn(`ADMIN ALERT: ${subject}`, details);
    
    // Example: Save alert to database for admin dashboard
    const pool = require('../db');
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (1, 'system_alert', 'system', NULL, ?, CURRENT_TIMESTAMP)
    `, [JSON.stringify({ subject, details, severity: 'warning' })]);
    
    return true;
  } catch (error) {
    log.error('Failed to send admin alert', error);
    return false;
  }
}

/**
 * Manual trigger for earnings processing (enhanced with options)
 */
const triggerManualProcessing = async (options = {}) => {
  const { intervalType, force = false, dryRun = false } = options;
  
  log.info('MANUAL: Starting manual earnings processing...', options);
  
  try {
    if (dryRun) {
      log.info('MANUAL: DRY RUN MODE - No actual processing will occur');
      // In dry run, just return what would be processed
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
    if (!force && (jobStatus.hourly.running || jobStatus.daily.running)) {
      throw new Error('Another processing job is currently running. Use force=true to override.');
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
 * Get job status and statistics
 */
const getJobStatus = () => {
  return {
    jobs: jobStatus,
    uptime: process.uptime(),
    memory_usage: process.memoryUsage(),
    current_time: new Date().toISOString(),
    timezone: 'Africa/Nairobi'
  };
};

/**
 * Start all cron jobs with monitoring
 */
const startCronJobs = () => {
  log.info('Starting all cron jobs...');
  
  const jobs = {
    hourly: scheduleHourlyEarningsProcessing(),
    daily: scheduleDailyEarningsProcessing(),
    maintenance: scheduleDailyMaintenance()
  };
  
  // Schedule a health check every 6 hours
  const healthCheckJob = cron.schedule('0 */6 * * *', async () => {
    log.info('=== SCHEDULED HEALTH CHECK ===');
    try {
      const health = await performSystemHealthCheck();
      if (health.status !== 'healthy') {
        await sendAdminAlert('System health check warning', health);
      }
    } catch (error) {
      log.error('Scheduled health check failed', error);
    }
  }, {
    scheduled: true,
    timezone: "Africa/Nairobi"
  });
  
  jobs.healthCheck = healthCheckJob;
  
  log.info('All cron jobs started successfully!', {
    jobs: Object.keys(jobs),
    next_hourly: '0 * * * *',
    next_daily: '0 0 * * *',
    next_maintenance: '0 2 * * *',
    next_health_check: '0 */6 * * *'
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
  
  // Wait for running jobs to complete (with timeout)
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
  scheduleHourlyEarningsProcessing,
  scheduleDailyEarningsProcessing,
  scheduleDailyMaintenance,
  getJobStatus,
  performSystemHealthCheck,
  sendAdminAlert,
  // Export job status for monitoring
  jobStatus
};