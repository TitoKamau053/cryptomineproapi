const pool = require('./db');

console.log('=== MinersHub Pro Testing and Migration Script ===\n');

/**
 * STEP 1: MIGRATE EXISTING PURCHASES
 * This will update all existing purchases to work with the new timing logic
 */
async function migrateExistingPurchases() {
  console.log('🔄 Starting migration of existing purchases...\n');
  
  try {
    // Get all existing active purchases that need migration
    const [existingPurchases] = await pool.query(`
      SELECT 
        p.id,
        p.user_id,
        p.engine_id,
        p.amount_invested,
        p.daily_earning,
        p.start_date,
        p.end_date,
        p.created_at,
        p.last_earning_date,
        p.status,
        e.name as engine_name,
        e.earning_interval,
        e.duration_days,
        e.duration_hours,
        e.daily_earning_rate,
        u.full_name as user_name,
        u.email as user_email
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'active'
      ORDER BY p.created_at ASC
    `);

    console.log(`📊 Found ${existingPurchases.length} existing active purchases to migrate`);
    
    if (existingPurchases.length === 0) {
      console.log('✅ No existing purchases need migration\n');
      return { migrated: 0, details: [] };
    }

    const migrationResults = [];
    let totalMigrated = 0;
    
    for (const purchase of existingPurchases) {
      console.log(`\n🔧 Migrating Purchase #${purchase.id} (${purchase.engine_name})`);
      console.log(`   User: ${purchase.user_name} (${purchase.user_email})`);
      console.log(`   Original Purchase: ${new Date(purchase.created_at).toLocaleString()}`);
      
      // Calculate what the earnings should be based on new logic
      const purchaseTime = new Date(purchase.created_at);
      const currentTime = new Date();
      
      let expectedPeriods = 0;
      let expectedEarnings = 0;
      let shouldBeCompleted = false;
      
      if (purchase.earning_interval === 'hourly') {
        const totalHours = purchase.duration_hours || 24;
        const endTime = new Date(purchaseTime);
        endTime.setHours(endTime.getHours() + totalHours);
        
        if (currentTime >= endTime) {
          expectedPeriods = totalHours;
          shouldBeCompleted = true;
        } else {
          expectedPeriods = Math.floor((currentTime - purchaseTime) / (1000 * 60 * 60));
        }
        
        expectedEarnings = expectedPeriods * (purchase.daily_earning / 24);
      } else {
        const totalDays = purchase.duration_days || 365;
        const endTime = new Date(purchaseTime);
        endTime.setDate(endTime.getDate() + totalDays);
        
        if (currentTime >= endTime) {
          expectedPeriods = totalDays;
          shouldBeCompleted = true;
        } else {
          expectedPeriods = Math.floor((currentTime - purchaseTime) / (1000 * 60 * 60 * 24));
        }
        
        expectedEarnings = expectedPeriods * purchase.daily_earning;
      }
      
      // Get actual earnings logged
      const [actualEarnings] = await pool.query(`
        SELECT COUNT(*) as periods_logged, COALESCE(SUM(earning_amount), 0) as total_earned
        FROM engine_logs 
        WHERE purchase_id = ?
      `, [purchase.id]);
      
      const actualPeriodsLogged = actualEarnings[0].periods_logged;
      const actualTotalEarned = parseFloat(actualEarnings[0].total_earned);
      const missingPeriods = Math.max(0, expectedPeriods - actualPeriodsLogged);
      const missingEarnings = Math.max(0, expectedEarnings - actualTotalEarned);
      
      console.log(`   Expected Periods: ${expectedPeriods}`);
      console.log(`   Actual Periods Logged: ${actualPeriodsLogged}`);
      console.log(`   Missing Periods: ${missingPeriods}`);
      console.log(`   Missing Earnings: KES ${missingEarnings.toFixed(2)}`);
      console.log(`   Should Be Completed: ${shouldBeCompleted ? 'YES' : 'NO'}`);
      
      // Create missing earnings
      let periodsCreated = 0;
      if (missingPeriods > 0) {
        for (let period = actualPeriodsLogged + 1; period <= expectedPeriods; period++) {
          let earningTime;
          let earningAmount;
          
          if (purchase.earning_interval === 'hourly') {
            earningTime = new Date(purchaseTime);
            earningTime.setHours(earningTime.getHours() + period);
            earningAmount = purchase.daily_earning / 24;
          } else {
            earningTime = new Date(purchaseTime);
            earningTime.setDate(earningTime.getDate() + period);
            earningAmount = purchase.daily_earning;
          }
          
          // Only create earnings that should have already occurred
          if (earningTime <= currentTime) {
            try {
              await pool.query(
                'CALL sp_log_earning(?, ?, ?)',
                [purchase.id, earningAmount, earningTime]
              );
              periodsCreated++;
            } catch (error) {
              if (error.code !== 'ER_DUP_ENTRY') {
                console.error(`   ❌ Error creating earning for period ${period}:`, error.message);
              }
            }
          }
        }
      }
      
      // Update purchase status if should be completed
      if (shouldBeCompleted && purchase.status === 'active') {
        await pool.query(
          'UPDATE purchases SET status = "completed", is_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [purchase.id]
        );
        console.log(`   ✅ Purchase marked as completed`);
      }
      
      migrationResults.push({
        purchaseId: purchase.id,
        engineName: purchase.engine_name,
        userName: purchase.user_name,
        expectedPeriods,
        actualPeriodsLogged,
        missingPeriods,
        periodsCreated,
        missingEarnings: missingEarnings.toFixed(2),
        wasCompleted: shouldBeCompleted,
        status: 'migrated'
      });
      
      totalMigrated++;
      console.log(`   ✅ Migration completed - Created ${periodsCreated} missing earnings`);
    }
    
    console.log(`\n🎉 Migration completed! Migrated ${totalMigrated} purchases`);
    return { migrated: totalMigrated, details: migrationResults };
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * STEP 2: TEST THE NEW SYSTEM
 */
async function testNewSystem() {
  console.log('\n🧪 Testing the new mining engine system...\n');
  
  try {
    // Test 1: Check database connectivity
    console.log('Test 1: Database Connectivity');
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');
    
    // Test 2: Check earnings processor
    console.log('Test 2: Earnings Processor');
    const { processMiningEarnings } = require('./utils/miningEarningsProcessor');
    const result = await processMiningEarnings();
    console.log(`✅ Earnings processor working`);
    console.log(`   - Processed: ${result.processed} purchases`);
    console.log(`   - Total Periods: ${result.totalPeriods}`);
    console.log(`   - Total Earnings: KES ${result.totalEarnings}\n`);
    
    // Test 3: Check cron job status
    console.log('Test 3: Cron Job Status');
    const { getJobStatus } = require('./utils/cronJobs');
    const jobStatus = getJobStatus();
    console.log(`✅ Cron jobs status retrieved`);
    console.log(`   - Uptime: ${Math.floor(jobStatus.uptime / 60)} minutes`);
    console.log(`   - Memory Usage: ${Math.floor(jobStatus.memory_usage.heapUsed / 1024 / 1024)} MB`);
    console.log(`   - Current Time: ${jobStatus.current_time}\n`);
    
    // Test 4: Check for overdue earnings
    console.log('Test 4: Overdue Earnings Check');
    const [overdueHourly] = await pool.query(`
      SELECT COUNT(*) as count
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active' 
        AND me.earning_interval = 'hourly'
        AND TIMESTAMPDIFF(HOUR, p.created_at, NOW()) > 
            (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) + 1
        AND p.end_date > NOW()
    `);
    
    const [overdueDaily] = await pool.query(`
      SELECT COUNT(*) as count
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active' 
        AND me.earning_interval = 'daily'
        AND TIMESTAMPDIFF(DAY, p.created_at, NOW()) > 
            (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) + 1
        AND p.end_date > NOW()
    `);
    
    console.log(`✅ Overdue earnings check completed`);
    console.log(`   - Overdue Hourly: ${overdueHourly[0].count}`);
    console.log(`   - Overdue Daily: ${overdueDaily[0].count}\n`);
    
    // Test 5: Sample purchase maturity schedule
    console.log('Test 5: Sample Purchase Schedule');
    const [samplePurchase] = await pool.query(`
      SELECT p.id, p.created_at, e.earning_interval, e.duration_days, e.duration_hours
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.status = 'active'
      LIMIT 1
    `);
    
    if (samplePurchase.length > 0) {
      const purchase = samplePurchase[0];
      const { getPurchaseMaturitySchedule } = require('./utils/miningEarningsProcessor');
      const schedule = await getPurchaseMaturitySchedule(purchase.id);
      
      console.log(`✅ Sample purchase schedule generated`);
      console.log(`   - Purchase ID: ${purchase.id}`);
      console.log(`   - Total Periods: ${schedule.total_periods}`);
      console.log(`   - Mature Periods: ${schedule.mature_periods}`);
      console.log(`   - Next 3 Maturities:`);
      
      schedule.maturity_schedule.slice(schedule.mature_periods, schedule.mature_periods + 3).forEach((maturity, index) => {
        console.log(`     ${index + 1}. ${new Date(maturity.maturity_time).toLocaleString()} - KES ${maturity.earning_amount}`);
      });
    } else {
      console.log('⚠️  No active purchases found to test schedule');
    }
    
    console.log('\n🎉 All tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Testing failed:', error);
    return false;
  }
}

/**
 * STEP 3: GENERATE SYSTEM REPORT
 */
async function generateSystemReport() {
  console.log('\n📊 Generating System Report...\n');
  
  try {
    // Overall statistics
    const [overallStats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT p.id) as total_purchases,
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_purchases,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as completed_purchases,
        COALESCE(SUM(p.amount_invested), 0) as total_invested,
        COALESCE(SUM(el.earning_amount), 0) as total_earnings_paid,
        COUNT(DISTINCT el.id) as total_earning_logs
      FROM users u
      LEFT JOIN purchases p ON u.id = p.user_id
      LEFT JOIN engine_logs el ON p.id = el.purchase_id
    `);
    
    // Engine breakdown
    const [engineStats] = await pool.query(`
      SELECT 
        e.name,
        e.earning_interval,
        COUNT(p.id) as total_purchases,
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_purchases,
        COALESCE(SUM(p.amount_invested), 0) as total_invested,
        COALESCE(SUM(el.earning_amount), 0) as total_earnings
      FROM mining_engines e
      LEFT JOIN purchases p ON e.id = p.engine_id
      LEFT JOIN engine_logs el ON p.id = el.purchase_id
      WHERE e.is_active = TRUE
      GROUP BY e.id, e.name, e.earning_interval
      ORDER BY total_invested DESC
    `);
    
    // Recent activity
    const [recentActivity] = await pool.query(`
      SELECT 
        DATE(el.earning_datetime) as date,
        COUNT(el.id) as earnings_count,
        SUM(el.earning_amount) as daily_total
      FROM engine_logs el
      WHERE el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(el.earning_datetime)
      ORDER BY date DESC
    `);
    
    console.log('=== SYSTEM REPORT ===');
    console.log(`Report Generated: ${new Date().toLocaleString()}\n`);
    
    console.log('📈 Overall Statistics:');
    console.log(`   Total Users: ${overallStats[0].total_users}`);
    console.log(`   Total Purchases: ${overallStats[0].total_purchases}`);
    console.log(`   Active Purchases: ${overallStats[0].active_purchases}`);
    console.log(`   Completed Purchases: ${overallStats[0].completed_purchases}`);
    console.log(`   Total Invested: KES ${parseFloat(overallStats[0].total_invested).toLocaleString()}`);
    console.log(`   Total Earnings Paid: KES ${parseFloat(overallStats[0].total_earnings_paid).toLocaleString()}`);
    console.log(`   Total Earning Logs: ${overallStats[0].total_earning_logs}\n`);
    
    console.log('🏭 Engine Performance:');
    engineStats.forEach(engine => {
      console.log(`   ${engine.name} (${engine.earning_interval}):`);
      console.log(`     Purchases: ${engine.total_purchases} (${engine.active_purchases} active)`);
      console.log(`     Invested: KES ${parseFloat(engine.total_invested).toLocaleString()}`);
      console.log(`     Earnings: KES ${parseFloat(engine.total_earnings).toLocaleString()}`);
    });
    
    console.log('\n📅 Recent Activity (Last 7 Days):');
    recentActivity.forEach(day => {
      console.log(`   ${day.date}: ${day.earnings_count} earnings, KES ${parseFloat(day.daily_total).toLocaleString()}`);
    });
    
    return {
      overall: overallStats[0],
      engines: engineStats,
      recent_activity: recentActivity
    };
    
  } catch (error) {
    console.error('❌ Report generation failed:', error);
    throw error;
  }
}

/**
 * MAIN EXECUTION FUNCTION
 */
async function runTestingAndMigration() {
  console.log('🚀 Starting MinersHub Pro Testing and Migration...\n');
  
  try {
    // Step 1: Migrate existing purchases
    const migrationResult = await migrateExistingPurchases();
    
    // Step 2: Test the new system
    const testResult = await testNewSystem();
    
    if (!testResult) {
      console.log('❌ Testing failed. Please check the errors above.');
      return;
    }
    
    // Step 3: Generate system report
    const report = await generateSystemReport();
    
    console.log('\n🎉 TESTING AND MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('\n📋 Summary:');
    console.log(`   - Migrated Purchases: ${migrationResult.migrated}`);
    console.log(`   - System Tests: All Passed ✅`);
    console.log(`   - Total Active Purchases: ${report.overall.active_purchases}`);
    console.log(`   - Total Earnings Paid: KES ${parseFloat(report.overall.total_earnings_paid).toLocaleString()}`);
    
    console.log('\n🔍 What to monitor:');
    console.log('   1. Check server logs for cron job execution');
    console.log('   2. Monitor /api/admin/system-status endpoint');
    console.log('   3. Watch for new earnings being processed');
    console.log('   4. Verify users receive earnings at correct times');
    
  } catch (error) {
    console.error('💥 Testing and migration failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case 'migrate':
    migrateExistingPurchases().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'test':
    testNewSystem().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'report':
    generateSystemReport().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'all':
  default:
    runTestingAndMigration();
    break;
}

module.exports = {
  migrateExistingPurchases,
  testNewSystem,
  generateSystemReport,
  runTestingAndMigration
};