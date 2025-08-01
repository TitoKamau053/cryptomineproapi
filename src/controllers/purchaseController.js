const pool = require('../db');

/**
 * Enhanced purchase controller with proper timing logic for hourly/daily engines
 */
const safeParseFloat = (value, defaultValue = 0) => {
  if (value === null || value === undefined || value === '') return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const safeParseInt = (value, defaultValue = 0) => {
  if (value === null || value === undefined || value === '') return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const safeToFixed = (value, decimals = 2, defaultValue = 0) => {
  const num = safeParseFloat(value, defaultValue);
  return num.toFixed(decimals);
};

const purchaseEngine = async (req, res) => {
  const userId = req.user.id;
  const { engine_id, amount } = req.body;
  
  if (!engine_id || !amount) {
    return res.status(400).json({ message: 'Engine ID and amount are required' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Get engine details first to validate and calculate properly
    const [engineRows] = await connection.query(`
      SELECT 
        id, name, price, daily_earning_rate, duration_days, duration_hours,
        min_investment, max_investment, earning_interval, is_active
      FROM mining_engines 
      WHERE id = ? AND is_active = TRUE
    `, [engine_id]);
    
    if (engineRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Mining engine not found or inactive' });
    }
    
    const engine = engineRows[0];
    
    // Validation checks
    const minInvestment = engine.min_investment || engine.price;
    const maxInvestment = engine.max_investment || 5000000;
    
    if (amount < minInvestment) {
      await connection.rollback();
      return res.status(400).json({ 
        message: `Minimum investment for this engine is KES ${minInvestment}` 
      });
    }
    
    if (amount > maxInvestment) {
      await connection.rollback();
      return res.status(400).json({ 
        message: `Maximum investment for this engine is KES ${maxInvestment}` 
      });
    }
    
    // Check user balance
    const [userRows] = await connection.query('SELECT balance FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0 || userRows[0].balance < amount) {
      await connection.rollback();
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    
    // Calculate earnings based on interval type with exact timing
    let dailyEarning, periodEarning, totalDuration, endDate;
    const purchaseTime = new Date(); // Exact purchase time
    
    if (engine.earning_interval === 'hourly') {
      // For hourly engines: each period earns hourly_rate, daily_earning is total per day
      periodEarning = parseFloat((amount * (engine.daily_earning_rate / 100)).toFixed(8));
      dailyEarning = parseFloat((periodEarning * 24).toFixed(8));
      totalDuration = engine.duration_hours || 24; // Default to 24 hours if not set
      
      // End date = purchase time + total duration in hours
      endDate = new Date(purchaseTime);
      endDate.setHours(endDate.getHours() + totalDuration);
    } else {
      // For daily engines: each period earns daily_rate
      dailyEarning = parseFloat((amount * (engine.daily_earning_rate / 100)).toFixed(2));
      periodEarning = dailyEarning;
      totalDuration = engine.duration_days || 365; // Default to 365 days if not set
      
      // End date = purchase time + total duration in days
      endDate = new Date(purchaseTime);
      endDate.setDate(endDate.getDate() + totalDuration);
    }
    
    // Update user balance
    await connection.query(
      'UPDATE users SET balance = balance - ? WHERE id = ?',
      [amount, userId]
    );
    
    // Create purchase record with exact timing
    const [purchaseResult] = await connection.query(`
      INSERT INTO purchases (
        user_id, engine_id, amount_invested, daily_earning, 
        total_earned, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, 'active', ?)
    `, [
      userId, 
      engine_id, 
      amount, 
      dailyEarning,
      purchaseTime, // start_date is the exact purchase time
      endDate,      // end_date is purchase_time + duration
      purchaseTime  // created_at is also the exact purchase time
    ]);
    
    const purchaseId = purchaseResult.insertId;
    
    // Get the created purchase with engine details
    const [purchaseDetails] = await connection.query(`
      SELECT 
        p.id, p.user_id, p.engine_id, p.amount_invested, p.daily_earning,
        p.total_earned, p.start_date, p.end_date, p.status,
        e.name as engine_name, e.earning_interval, e.daily_earning_rate,
        e.duration_days, e.duration_hours
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      WHERE p.id = ?
    `, [purchaseId]);
    
    await connection.commit();
    
    // Calculate next earning time for response with exact timing
    let nextEarningTime;
    if (engine.earning_interval === 'hourly') {
      // First earning is exactly 1 hour after purchase
      nextEarningTime = new Date(purchaseTime);
      nextEarningTime.setHours(nextEarningTime.getHours() + 1);
    } else {
      // First earning is exactly 1 day (24 hours) after purchase
      nextEarningTime = new Date(purchaseTime);
      nextEarningTime.setDate(nextEarningTime.getDate() + 1);
    }
    
    const purchase = purchaseDetails[0];
    
    res.status(201).json({ 
      success: true,
      message: 'Mining engine purchased successfully',
      purchase: {
        ...purchase,
        period_earning: periodEarning,
        next_earning_time: nextEarningTime.toISOString(),
        total_earning_periods: engine.earning_interval === 'hourly' ? totalDuration : totalDuration,
        earning_frequency: engine.earning_interval === 'hourly' ? 'Every hour' : 'Every 24 hours'
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error purchasing engine:', error);
    
    // Handle specific SQL errors
    if (error.errno === 1644) {
      return res.status(400).json({ message: error.sqlMessage || 'Purchase failed' });
    }
    
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    connection.release();
  }
};

const getUserPurchases = async (req, res) => {
  const userId = req.user.id;
  const { status = 'all', page = 1, limit = 20, include_timing, include_progress } = req.query;
  
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let whereClause = 'WHERE p.user_id = ?';
    const queryParams = [userId];
    
    if (status !== 'all') {
      whereClause += ' AND p.status = ?';
      queryParams.push(status);
    }
    
    const [purchases] = await pool.query(`
      SELECT 
        p.id, 
        p.engine_id, 
        COALESCE(e.name, 'Unknown Engine') as engine_name,
        COALESCE(e.earning_interval, 'daily') as earning_interval,
        COALESCE(e.daily_earning_rate, 0) as daily_earning_rate,
        COALESCE(e.duration_days, 0) as duration_days,
        COALESCE(e.duration_hours, 0) as duration_hours,
        COALESCE(p.amount_invested, 0) as amount_invested, 
        COALESCE(p.daily_earning, 0) as daily_earning, 
        COALESCE(p.total_earned, 0) as total_earned, 
        p.start_date, 
        p.end_date, 
        p.last_earning_date,
        p.status,
        p.created_at,
        -- Add safe defaults for new columns
        COALESCE(p.expected_earnings, 0) as expected_earnings,
        COALESCE(p.earning_deficit, 0) as earning_deficit,
        COALESCE(p.progress_percentage, 0) as progress_percentage,
        COALESCE(p.periods_elapsed, 0) as stored_periods_elapsed,
        COALESCE(p.total_periods, 0) as stored_total_periods,
        COALESCE(p.is_earning_up_to_date, TRUE) as is_earning_up_to_date,
        COALESCE(p.days_remaining, 0) as stored_days_remaining,
        COALESCE(p.is_completed, FALSE) as is_completed,
        -- Calculate periods dynamically if not stored
        CASE 
          WHEN COALESCE(e.earning_interval, 'daily') = 'hourly' THEN 
            COALESCE(TIMESTAMPDIFF(HOUR, p.start_date, LEAST(NOW(), p.end_date)), 0)
          ELSE 
            COALESCE(DATEDIFF(LEAST(NOW(), p.end_date), p.start_date), 0)
        END as calculated_periods_elapsed,
        CASE 
          WHEN COALESCE(e.earning_interval, 'daily') = 'hourly' THEN 
            COALESCE(TIMESTAMPDIFF(HOUR, p.start_date, p.end_date), 0)
          ELSE 
            COALESCE(DATEDIFF(p.end_date, p.start_date), 0)
        END as calculated_total_periods,
        CASE 
          WHEN p.status = 'active' AND NOW() < p.end_date THEN
            CASE 
              WHEN COALESCE(e.earning_interval, 'daily') = 'hourly' THEN
                DATE_ADD(COALESCE(p.last_earning_date, p.start_date), INTERVAL 1 HOUR)
              ELSE
                DATE_ADD(COALESCE(p.last_earning_date, p.start_date), INTERVAL 1 DAY)
            END
          ELSE NULL
        END as next_earning_time
      FROM purchases p 
      LEFT JOIN mining_engines e ON p.engine_id = e.id 
      ${whereClause}
      ORDER BY p.created_at DESC 
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), offset]);
    
    // Get total count for pagination
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM purchases p 
      LEFT JOIN mining_engines e ON p.engine_id = e.id 
      ${whereClause}
    `, queryParams);
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(limit));
    
    // Enhanced purchases with proper number handling
    const enhancedPurchases = purchases.map(purchase => {
      // Safe number parsing with defaults
      const amountInvested = safeParseFloat(purchase.amount_invested, 0);
      const dailyEarning = safeParseFloat(purchase.daily_earning, 0);
      const totalEarned = safeParseFloat(purchase.total_earned, 0);
      const expectedEarnings = safeParseFloat(purchase.expected_earnings, 0);
      const earningDeficit = safeParseFloat(purchase.earning_deficit, 0);
      
      // Use stored values if available, otherwise calculate
      const periodsElapsed = Math.max(0, 
        safeParseInt(purchase.stored_periods_elapsed, 0) || 
        safeParseInt(purchase.calculated_periods_elapsed, 0)
      );
      
      const totalPeriods = Math.max(1, 
        safeParseInt(purchase.stored_total_periods, 0) || 
        safeParseInt(purchase.calculated_total_periods, 1)
      );
      
      // Calculate period earning based on interval
      const earningInterval = purchase.earning_interval || 'daily';
      let periodEarning = dailyEarning;
      if (earningInterval === 'hourly') {
        periodEarning = dailyEarning / 24;
      }
      
      // Ensure periodEarning is a valid number
      periodEarning = safeParseFloat(periodEarning, 0);
      
      // Calculate progress percentage
      const progressPercentage = totalPeriods > 0 
        ? Math.min(100, (periodsElapsed / totalPeriods) * 100) 
        : 0;
      
      // Calculate expected vs actual earnings if not stored
      const calculatedExpectedEarnings = expectedEarnings > 0 
        ? expectedEarnings 
        : periodsElapsed * periodEarning;
        
      const calculatedEarningDeficit = earningDeficit > 0 
        ? earningDeficit 
        : Math.max(0, calculatedExpectedEarnings - totalEarned);
      
      // Calculate days remaining
      const now = new Date();
      const endDate = new Date(purchase.end_date);
      const daysRemaining = purchase.status === 'active' && now < endDate
        ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: purchase.id,
        engine_id: purchase.engine_id,
        engine_name: purchase.engine_name,
        user_id: userId,
        amount_invested: safeToFixed(amountInvested, 2),
        daily_earning: safeToFixed(dailyEarning, 2),
        period_earning: safeToFixed(periodEarning, 8),
        total_earned: safeToFixed(totalEarned, 2),
        expected_earnings: safeToFixed(calculatedExpectedEarnings, 2),
        earning_deficit: safeToFixed(calculatedEarningDeficit, 2),
        start_date: purchase.start_date,
        end_date: purchase.end_date,
        last_earning_date: purchase.last_earning_date,
        next_earning_time: purchase.next_earning_time,
        status: purchase.status || 'active',
        earning_interval: earningInterval,
        periods_elapsed: periodsElapsed,
        total_periods: totalPeriods,
        progress_percentage: safeToFixed(progressPercentage, 2),
        days_remaining: daysRemaining,
        is_earning_up_to_date: calculatedEarningDeficit < 0.01,
        is_completed: purchase.is_completed || purchase.status === 'completed',
        formatted_next_earning: purchase.next_earning_time 
          ? new Date(purchase.next_earning_time).toLocaleString()
          : null
      };
    });
    
    res.json({ 
      success: true,
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
    console.error('Error fetching user purchases:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get detailed purchase information by ID
 */
const getPurchaseDetails = async (req, res) => {
  const userId = req.user.id;
  const { purchaseId } = req.params;
  
  try {
    const [purchases] = await pool.query(`
      SELECT 
        p.*,
        e.name as engine_name,
        e.earning_interval,
        e.daily_earning_rate,
        e.duration_days,
        e.duration_hours,
        e.image_url as engine_image,
        u.full_name,
        u.email
      FROM purchases p
      JOIN mining_engines e ON p.engine_id = e.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ? AND p.user_id = ?
    `, [purchaseId, userId]);
    
    if (purchases.length === 0) {
      return res.status(404).json({ message: 'Purchase not found' });
    }
    
    const purchase = purchases[0];
    
    // Get earning logs for this purchase
    const [earningLogs] = await pool.query(`
      SELECT 
        earning_amount,
        earning_datetime,
        notes,
        created_at
      FROM engine_logs 
      WHERE purchase_id = ? 
      ORDER BY earning_datetime DESC 
      LIMIT 50
    `, [purchaseId]);
    
    // Calculate comprehensive statistics
    const now = new Date();
    const startDate = new Date(purchase.start_date);
    const endDate = new Date(purchase.end_date);
    
    let periodsElapsed, totalPeriods, nextEarningTime, periodEarning;
    
    if (purchase.earning_interval === 'hourly') {
      periodsElapsed = Math.floor((Math.min(now, endDate) - startDate) / (1000 * 60 * 60));
      totalPeriods = Math.floor((endDate - startDate) / (1000 * 60 * 60));
      periodEarning = purchase.daily_earning / 24;
      
      if (purchase.status === 'active' && now < endDate) {
        nextEarningTime = new Date(purchase.last_earning_date || startDate);
        nextEarningTime.setHours(nextEarningTime.getHours() + 1, 0, 0, 0);
      }
    } else {
      periodsElapsed = Math.floor((Math.min(now, endDate) - startDate) / (1000 * 60 * 60 * 24));
      totalPeriods = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
      periodEarning = purchase.daily_earning;
      
      if (purchase.status === 'active' && now < endDate) {
        nextEarningTime = new Date(purchase.last_earning_date || startDate);
        nextEarningTime.setDate(nextEarningTime.getDate() + 1);
        nextEarningTime.setHours(0, 0, 0, 0);
      }
    }
    

    
    // Replace the calculation section with safe number handling:
      const expectedEarnings = safeParseFloat(periodsElapsed * periodEarning);
      const progressPercentage = totalPeriods > 0 ? (periodsElapsed / totalPeriods) * 100 : 0;

    res.json({
      purchase: {
        ...purchase,
        periods_elapsed: Math.max(0, periodsElapsed),
        total_periods: totalPeriods,
        period_earning: safeToFixed(periodEarning, 8),
        expected_earnings: safeToFixed(expectedEarnings, 8),
        progress_percentage: safeToFixed(Math.min(100, progressPercentage), 2),
        next_earning_time: nextEarningTime ? nextEarningTime.toISOString() : null,
        earning_deficit: safeToFixed(Math.max(0, expectedEarnings - safeParseFloat(purchase.total_earned)), 8),
        is_completed: purchase.status === 'completed' || now >= endDate,
        days_remaining: purchase.status === 'active' && now < endDate 
          ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24))
          : 0
      },
      earning_history: earningLogs.map(log => ({
        ...log,
        formatted_datetime: new Date(log.earning_datetime).toLocaleString(),
        formatted_amount: `KES ${safeToFixed(log.earning_amount, 2)}`
      }))
    });
    
  } catch (error) {
    console.error('Error fetching purchase details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  purchaseEngine,
  getUserPurchases,
  getPurchaseDetails
};