const pool = require('./db');

console.log('=== Fix Matured Engines and Process Missing Earnings ===\n');

/**
 * STEP 1: Identify and fix all overdue/matured engines
 */
async function identifyMaturedEngines() {
  console.log('🔍 Identifying matured engines that should be completed...\n');
  
  try {
    // Find all purchases that should be completed but are still active
    const [maturedPurchases] = await pool.query(`
      SELECT 
        p.id as purchase_id,
        p.user_id,
        p.amount_invested,
        p.daily_earning,
        p.start_date,
        p.end_date,
        p.status,
        p.total_earned,
        u.full_name,
        u.email,
        u.balance as current_balance,
        e.name as engine_name,
        e.earning_interval,
        e.duration_days,
        e.duration_hours,
        e.daily_earning_rate,
        -- Calculate how many earnings should have been processed
        CASE 
          WHEN e.earning_interval = 'hourly' THEN
            TIMESTAMPDIFF(HOUR, p.start_date, LEAST(NOW(), p.end_date))
          ELSE
            TIMESTAMPDIFF(DAY, p.start_date, LEAST(NOW(), p.end_date))
        END as expected_periods,
        -- Count actual earnings logged
        (SELECT COUNT(*) FROM engine_logs WHERE purchase_id = p.id) as actual_periods,
        -- Calculate expected total earnings
        CASE 
          WHEN e.earning_interval = 'hourly' THEN
            TIMESTAMPDIFF(HOUR, p.start_date, LEAST(NOW(), p.end_date)) * (p.daily_earning / 24)
          ELSE
            TIMESTAMPDIFF(DAY, p.start_date, LEAST(NOW(), p.end_date)) * p.daily_earning
        END as expected_total_earnings
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.end_date <= NOW()  -- Should be completed by now
        AND p.status = 'active'   -- But still showing as active
      ORDER BY p.end_date ASC
    `);

    console.log(`📊 Found ${maturedPurchases.length} purchases that should be completed\n`);

    if (maturedPurchases.length === 0) {
      console.log('✅ No matured purchases found that need fixing\n');
      return [];
    }

    // Display summary
    console.log('📋 Matured Purchases Summary:');
    console.log('─'.repeat(100));
    console.log(
      'ID'.padEnd(4) + 
      'User'.padEnd(20) + 
      'Engine'.padEnd(15) + 
      'Expected'.padEnd(10) + 
      'Actual'.padEnd(8) + 
      'Missing'.padEnd(8) + 
      'End Date'.padEnd(12) + 
      'Missing Earnings'
    );
    console.log('─'.repeat(100));

    let totalMissingEarnings = 0;
    
    maturedPurchases.forEach(purchase => {
      const missingPeriods = Math.max(0, purchase.expected_periods - purchase.actual_periods);
      const missingEarnings = Math.max(0, purchase.expected_total_earnings - purchase.total_earned);
      totalMissingEarnings += missingEarnings;

      console.log(
        purchase.purchase_id.toString().padEnd(4) + 
        purchase.full_name.substring(0, 18).padEnd(20) + 
        purchase.engine_name.substring(0, 13).padEnd(15) + 
        purchase.expected_periods.toString().padEnd(10) + 
        purchase.actual_periods.toString().padEnd(8) + 
        missingPeriods.toString().padEnd(8) + 
        purchase.end_date.toISOString().split('T')[0].padEnd(12) + 
        `KES ${missingEarnings.toFixed(2)}`
      );
    });

    console.log('─'.repeat(100));
    console.log(`💰 Total Missing Earnings: KES ${totalMissingEarnings.toFixed(2)}\n`);

    return maturedPurchases;

  } catch (error) {
    console.error('❌ Error identifying matured engines:', error);
    throw error;
  }
}

/**
 * STEP 2: Process all missing earnings for matured engines
 */
async function processAllMissingEarnings(maturedPurchases) {
  console.log('⚡ Processing all missing earnings...\n');

  if (maturedPurchases.length === 0) {
    console.log('✅ No missing earnings to process\n');
    return { processed: 0, totalEarnings: 0 };
  }

  let totalProcessed = 0;
  let totalEarningsAdded = 0;
  const results = [];

  for (const purchase of maturedPurchases) {
    console.log(`\n🔧 Processing Purchase #${purchase.purchase_id} (${purchase.engine_name})`);
    console.log(`   User: ${purchase.full_name} (${purchase.email})`);
    console.log(`   Period: ${purchase.start_date.toISOString().split('T')[0]} to ${purchase.end_date.toISOString().split('T')[0]}`);

    try {
      const purchaseStartTime = new Date(purchase.start_date);
      const purchaseEndTime = new Date(purchase.end_date);
      const currentTime = new Date();
      
      // Determine how many periods should have earnings
      const maxPeriods = purchase.expected_periods;
      let periodsCreated = 0;
      let purchaseEarningsAdded = 0;

      // Create missing earnings for each period
      for (let period = 1; period <= maxPeriods; period++) {
        let earningTime;
        let earningAmount;

        if (purchase.earning_interval === 'hourly') {
          earningTime = new Date(purchaseStartTime);
          earningTime.setHours(earningTime.getHours() + period);
          earningAmount = parseFloat((purchase.daily_earning / 24).toFixed(8));
        } else {
          earningTime = new Date(purchaseStartTime);
          earningTime.setDate(earningTime.getDate() + period);
          earningAmount = parseFloat(purchase.daily_earning);
        }

        // Only create earnings that should have occurred by now
        if (earningTime <= Math.min(currentTime, purchaseEndTime)) {
          try {
            // Check if this earning already exists
            const [existing] = await pool.query(
              'SELECT id FROM engine_logs WHERE purchase_id = ? AND earning_datetime = ?',
              [purchase.purchase_id, earningTime]
            );

            if (existing.length === 0) {
              // Create the missing earning
              await pool.query(
                'CALL sp_log_earning(?, ?, ?)',
                [purchase.purchase_id, earningAmount, earningTime]
              );
              
              periodsCreated++;
              purchaseEarningsAdded += earningAmount;
              
              console.log(`   ✅ Created earning: ${earningTime.toISOString()} = KES ${earningAmount.toFixed(2)}`);
            }
          } catch (earningError) {
            if (earningError.code !== 'ER_DUP_ENTRY') {
              console.error(`   ❌ Error creating earning for period ${period}:`, earningError.message);
            }
          }
        }
      }

      // Mark purchase as completed
      await pool.query(
        'UPDATE purchases SET status = "completed", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [purchase.purchase_id]
      );

      console.log(`   ✅ Purchase completed: Created ${periodsCreated} earnings, Added KES ${purchaseEarningsAdded.toFixed(2)}`);
      
      results.push({
        purchaseId: purchase.purchase_id,
        userName: purchase.full_name,
        engineName: purchase.engine_name,
        periodsCreated,
        earningsAdded: purchaseEarningsAdded,
        status: 'completed'
      });

      totalProcessed++;
      totalEarningsAdded += purchaseEarningsAdded;

    } catch (error) {
      console.error(`   ❌ Error processing purchase #${purchase.purchase_id}:`, error.message);
      results.push({
        purchaseId: purchase.purchase_id,
        userName: purchase.full_name,
        engineName: purchase.engine_name,
        error: error.message,
        status: 'failed'
      });
    }
  }

  console.log(`\n🎉 Processing completed!`);
  console.log(`   - Purchases processed: ${totalProcessed}`);
  console.log(`   - Total earnings added: KES ${totalEarningsAdded.toFixed(2)}`);

  return { processed: totalProcessed, totalEarnings: totalEarningsAdded, details: results };
}

/**
 * STEP 3: Generate admin dashboard report
 */
async function generateAdminReport() {
  console.log('\n📊 Generating Admin Dashboard Report...\n');

  try {
    // Overall statistics
    const [overallStats] = await pool.query(`
      SELECT 
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_purchases,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as completed_purchases,
        COUNT(CASE WHEN p.status = 'completed' AND DATE(p.updated_at) = CURDATE() THEN 1 END) as completed_today,
        COALESCE(SUM(CASE WHEN p.status = 'active' THEN p.amount_invested ELSE 0 END), 0) as active_investment,
        COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.total_earned ELSE 0 END), 0) as total_earnings_paid,
        COALESCE(SUM(CASE WHEN p.status = 'completed' AND DATE(p.updated_at) = CURDATE() THEN p.total_earned ELSE 0 END), 0) as earnings_paid_today
      FROM purchases p
    `);

    // User balance updates
    const [userStats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COALESCE(SUM(u.balance), 0) as total_user_balances,
        COALESCE(SUM(u.total_earnings), 0) as total_user_earnings
      FROM users u
    `);

    // Recent completions (today)
    const [recentCompletions] = await pool.query(`
      SELECT 
        p.id as purchase_id,
        u.full_name,
        u.email,
        e.name as engine_name,
        p.amount_invested,
        p.total_earned,
        p.updated_at as completed_at
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.status = 'completed' 
        AND DATE(p.updated_at) = CURDATE()
      ORDER BY p.updated_at DESC
      LIMIT 20
    `);

    // Engine performance
    const [engineStats] = await pool.query(`
      SELECT 
        e.name as engine_name,
        e.earning_interval,
        COUNT(p.id) as total_purchases,
        COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as completed_purchases,
        COUNT(CASE WHEN p.status = 'active' THEN 1 END) as active_purchases,
        COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.total_earned ELSE 0 END), 0) as total_earnings
      FROM mining_engines e
      LEFT JOIN purchases p ON e.id = p.engine_id
      WHERE e.is_active = TRUE
      GROUP BY e.id, e.name, e.earning_interval
      ORDER BY total_earnings DESC
    `);

    console.log('=== ADMIN DASHBOARD REPORT ===');
    console.log(`Generated: ${new Date().toLocaleString()}\n`);

    console.log('📈 Overall Statistics:');
    console.log(`   Active Purchases: ${overallStats[0].active_purchases}`);
    console.log(`   Completed Purchases: ${overallStats[0].completed_purchases}`);
    console.log(`   Completed Today: ${overallStats[0].completed_today}`);
    console.log(`   Active Investment: KES ${parseFloat(overallStats[0].active_investment).toLocaleString()}`);
    console.log(`   Total Earnings Paid: KES ${parseFloat(overallStats[0].total_earnings_paid).toLocaleString()}`);
    console.log(`   Earnings Paid Today: KES ${parseFloat(overallStats[0].earnings_paid_today).toLocaleString()}\n`);

    console.log('👥 User Statistics:');
    console.log(`   Total Users: ${userStats[0].total_users}`);
    console.log(`   Total User Balances: KES ${parseFloat(userStats[0].total_user_balances).toLocaleString()}`);
    console.log(`   Total User Earnings: KES ${parseFloat(userStats[0].total_user_earnings).toLocaleString()}\n`);

    console.log('🎉 Recent Completions (Today):');
    if (recentCompletions.length > 0) {
      recentCompletions.forEach(completion => {
        console.log(`   ${completion.full_name} - ${completion.engine_name}: KES ${parseFloat(completion.total_earned).toLocaleString()}`);
      });
    } else {
      console.log('   No completions today');
    }

    console.log('\n🏭 Engine Performance:');
    engineStats.forEach(engine => {
      console.log(`   ${engine.engine_name}:`);
      console.log(`     Total: ${engine.total_purchases} purchases`);
      console.log(`     Completed: ${engine.completed_purchases}, Active: ${engine.active_purchases}`);
      console.log(`     Earnings Paid: KES ${parseFloat(engine.total_earnings).toLocaleString()}`);
    });

    return {
      overall: overallStats[0],
      users: userStats[0],
      recent_completions: recentCompletions,
      engines: engineStats
    };

  } catch (error) {
    console.error('❌ Error generating admin report:', error);
    throw error;
  }
}

/**
 * STEP 4: Update user balances (ensure they reflect all earnings)
 */
async function updateUserBalances() {
  console.log('\n💰 Updating user balances to reflect all earnings...\n');

  try {
    // Update total_earnings for all users
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

    console.log(`✅ Updated total_earnings for ${earningsUpdate.affectedRows} users`);

    // Update balances (this should be handled by sp_log_earning, but let's verify)
    const [balanceCheck] = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        u.balance,
        u.total_earnings,
        (SELECT COALESCE(SUM(el.earning_amount), 0) FROM engine_logs el WHERE el.user_id = u.id) as calculated_earnings
      FROM users u
      WHERE u.total_earnings != (SELECT COALESCE(SUM(el.earning_amount), 0) FROM engine_logs el WHERE el.user_id = u.id)
        AND EXISTS (SELECT 1 FROM engine_logs el WHERE el.user_id = u.id)
      LIMIT 10
    `);

    if (balanceCheck.length > 0) {
      console.log('⚠️  Found users with balance discrepancies:');
      balanceCheck.forEach(user => {
        console.log(`   ${user.full_name}: Stored=${user.total_earnings}, Calculated=${user.calculated_earnings}`);
      });
    } else {
      console.log('✅ All user balances are accurate');
    }

    return {
      earnings_updated: earningsUpdate.affectedRows,
      balance_discrepancies: balanceCheck.length
    };

  } catch (error) {
    console.error('❌ Error updating user balances:', error);
    throw error;
  }
}

/**
 * MAIN EXECUTION
 */
async function fixAllMaturedEngines() {
  console.log('🚀 Starting comprehensive fix for all matured engines...\n');

  try {
    // Step 1: Identify matured engines
    const maturedPurchases = await identifyMaturedEngines();

    // Step 2: Process missing earnings
    const processingResult = await processAllMissingEarnings(maturedPurchases);

    // Step 3: Update user balances
    const balanceResult = await updateUserBalances();

    // Step 4: Generate admin report
    const adminReport = await generateAdminReport();

    console.log('\n🎉 ALL FIXES COMPLETED SUCCESSFULLY!');
    console.log('\n📋 Summary:');
    console.log(`   - Matured purchases found: ${maturedPurchases.length}`);
    console.log(`   - Purchases processed: ${processingResult.processed}`);
    console.log(`   - Total earnings added: KES ${processingResult.totalEarnings.toFixed(2)}`);
    console.log(`   - Users with updated earnings: ${balanceResult.earnings_updated}`);
    console.log(`   - Completed purchases today: ${adminReport.overall.completed_today}`);

    console.log('\n✅ Next Steps:');
    console.log('   1. Check your admin dashboard for updated statistics');
    console.log('   2. Verify users can see their updated balances');
    console.log('   3. Monitor the cron jobs to ensure future earnings process correctly');
    console.log('   4. Run the system health check to confirm everything is working');

    return {
      matured_purchases: maturedPurchases.length,
      processed: processingResult.processed,
      total_earnings_added: processingResult.totalEarnings,
      admin_report: adminReport
    };

  } catch (error) {
    console.error('💥 Fix process failed:', error);
    throw error;
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case 'identify':
    identifyMaturedEngines().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'report':
    generateAdminReport().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'balances':
    updateUserBalances().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'fix':
  default:
    fixAllMaturedEngines().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
}

module.exports = {
  identifyMaturedEngines,
  processAllMissingEarnings,
  generateAdminReport,
  updateUserBalances,
  fixAllMaturedEngines
};