const express = require('express');
const router = express.Router();
const miningEngineController = require('../controllers/miningEngineController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// === PUBLIC ROUTES ===
// List all active mining engines (public access for users to view available engines)
router.get('/', miningEngineController.getMiningEngines);

// Get specific mining engine by ID with detailed information
router.get('/:engineId', miningEngineController.getMiningEngineById);

// === ADMIN-ONLY ROUTES ===

// --- Engine Management ---
// Create new mining engine
router.post('/', authMiddleware.verifyToken, requireAdmin, miningEngineController.addMiningEngine);

// Update mining engine
router.put('/:engineId', authMiddleware.verifyToken, requireAdmin, miningEngineController.updateMiningEngine);

// Delete mining engine (with safety checks)
router.delete('/:engineId', authMiddleware.verifyToken, requireAdmin, miningEngineController.deleteMiningEngine);

// --- Testing & Debugging Routes ---
// Test mining engine configuration before creating
router.post('/test/config', authMiddleware.verifyToken, requireAdmin, miningEngineController.testMiningEngineConfig);

// Simulate earnings for an engine (without creating actual records)
router.post('/:engineId/simulate', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { engineId } = req.params;
    const { 
      investment_amount, 
      simulation_periods = 10,
      start_from = 'now'
    } = req.body;

    const pool = require('../db');
    
    // Get engine details
    const [engines] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    
    if (engines.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    const engine = engines[0];
    const investmentAmount = investment_amount || engine.price;
    
    // Calculate earnings
    const dailyEarning = engine.earning_interval === 'hourly'
      ? investmentAmount * (engine.daily_earning_rate / 100) * 24
      : investmentAmount * (engine.daily_earning_rate / 100);

    const hourlyEarning = engine.earning_interval === 'hourly'
      ? investmentAmount * (engine.daily_earning_rate / 100)
      : dailyEarning / 24;

    // Generate simulation
    const simulatedEarnings = [];
    const startDate = start_from === 'now' ? new Date() : new Date(start_from);
    
    for (let i = 0; i < simulation_periods; i++) {
      if (engine.earning_interval === 'hourly') {
        const earningTime = new Date(startDate);
        earningTime.setHours(earningTime.getHours() + i);
        
        simulatedEarnings.push({
          period: i + 1,
          earning_datetime: earningTime.toISOString(),
          earning_amount: parseFloat(hourlyEarning.toFixed(8)),
          cumulative_earnings: parseFloat((hourlyEarning * (i + 1)).toFixed(8))
        });
      } else {
        const earningTime = new Date(startDate);
        earningTime.setDate(earningTime.getDate() + i);
        
        simulatedEarnings.push({
          period: i + 1,
          earning_datetime: earningTime.toISOString().split('T')[0],
          earning_amount: parseFloat(dailyEarning.toFixed(2)),
          cumulative_earnings: parseFloat((dailyEarning * (i + 1)).toFixed(2))
        });
      }
    }

    const totalSimulatedEarnings = simulatedEarnings[simulatedEarnings.length - 1]?.cumulative_earnings || 0;

    res.json({
      message: 'Earnings simulation completed',
      engine_info: {
        id: engine.id,
        name: engine.name,
        earning_interval: engine.earning_interval,
        daily_earning_rate: engine.daily_earning_rate
      },
      simulation_parameters: {
        investment_amount: investmentAmount,
        simulation_periods,
        start_from: startDate.toISOString(),
        total_duration: engine.earning_interval === 'hourly' 
          ? `${simulation_periods} hours`
          : `${simulation_periods} days`
      },
      results: {
        individual_earning_amount: engine.earning_interval === 'hourly' 
          ? parseFloat(hourlyEarning.toFixed(8))
          : parseFloat(dailyEarning.toFixed(2)),
        total_simulated_earnings: totalSimulatedEarnings,
        projected_monthly: engine.earning_interval === 'hourly'
          ? parseFloat((hourlyEarning * 24 * 30).toFixed(2))
          : parseFloat((dailyEarning * 30).toFixed(2)),
        projected_annual: engine.earning_interval === 'hourly'
          ? parseFloat((hourlyEarning * 24 * 365).toFixed(2))
          : parseFloat((dailyEarning * 365).toFixed(2))
      },
      simulated_earnings: simulatedEarnings,
      note: "This is a simulation only - no actual earnings were created"
    });

  } catch (error) {
    console.error('Engine simulation error:', error);
    res.status(500).json({ message: 'Simulation failed', error: error.message });
  }
});

// Get engine performance analytics
router.get('/:engineId/analytics', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { engineId } = req.params;
    const { period = '30d' } = req.query;

    const pool = require('../db');
    
    // Validate engine exists
    const [engines] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (engines.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    let dateCondition = 'WHERE p.engine_id = ? AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    
    switch (period) {
      case '7d':
        dateCondition = 'WHERE p.engine_id = ? AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '90d':
        dateCondition = 'WHERE p.engine_id = ? AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
        break;
      case 'all':
        dateCondition = 'WHERE p.engine_id = ?';
        break;
    }

    // Earnings analytics
    const [earningsAnalytics] = await pool.query(`
      SELECT 
        COUNT(el.id) as total_earnings,
        COUNT(DISTINCT el.user_id) as unique_users,
        COUNT(DISTINCT el.purchase_id) as active_purchases,
        SUM(el.earning_amount) as total_amount,
        AVG(el.earning_amount) as avg_earning,
        MIN(el.earning_datetime) as first_earning,
        MAX(el.earning_datetime) as last_earning,
        COUNT(DISTINCT DATE(el.earning_datetime)) as active_days
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      ${dateCondition}
    `, [engineId]);

    // Daily earnings breakdown
    const [dailyBreakdown] = await pool.query(`
      SELECT 
        DATE(el.earning_datetime) as earning_date,
        COUNT(el.id) as earning_count,
        COUNT(DISTINCT el.user_id) as unique_users,
        SUM(el.earning_amount) as daily_total,
        AVG(el.earning_amount) as avg_earning
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      ${dateCondition}
      GROUP BY DATE(el.earning_datetime)
      ORDER BY earning_date DESC
      LIMIT 30
    `, [engineId]);

    // Hourly distribution (for hourly engines)
    const [hourlyDistribution] = await pool.query(`
      SELECT 
        HOUR(el.earning_datetime) as hour_of_day,
        COUNT(el.id) as earning_count,
        SUM(el.earning_amount) as hourly_total
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      ${dateCondition}
      GROUP BY HOUR(el.earning_datetime)
      ORDER BY hour_of_day
    `, [engineId]);

    // Purchase analytics
    const [purchaseAnalytics] = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_purchases,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_purchases,
        AVG(amount_invested) as avg_investment,
        SUM(amount_invested) as total_investment,
        AVG(DATEDIFF(COALESCE(updated_at, NOW()), start_date)) as avg_duration_days,
        COUNT(DISTINCT user_id) as unique_investors
      FROM purchases 
      WHERE engine_id = ?
    `, [engineId]);

    res.json({
      engine_info: engines[0],
      analytics_period: period,
      earnings_analytics: earningsAnalytics[0],
      purchase_analytics: purchaseAnalytics[0],
      daily_breakdown: dailyBreakdown,
      hourly_distribution: engines[0].earning_interval === 'hourly' ? hourlyDistribution : null,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Engine analytics error:', error);
    res.status(500).json({ message: 'Failed to generate analytics', error: error.message });
  }
});

// Batch operations for engines
router.post('/batch/operations', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { operation, engine_ids, parameters = {} } = req.body;

    if (!operation || !engine_ids || !Array.isArray(engine_ids)) {
      return res.status(400).json({ 
        message: 'operation and engine_ids array are required' 
      });
    }

    const pool = require('../db');
    const results = [];

    for (const engineId of engine_ids) {
      try {
        let result = { engine_id: engineId, status: 'success' };

        switch (operation) {
          case 'activate':
            await pool.query('UPDATE mining_engines SET is_active = TRUE WHERE id = ?', [engineId]);
            result.message = 'Engine activated';
            break;

          case 'deactivate':
            await pool.query('UPDATE mining_engines SET is_active = FALSE WHERE id = ?', [engineId]);
            result.message = 'Engine deactivated';
            break;

          case 'update_rate':
            if (!parameters.new_rate) {
              result.status = 'error';
              result.message = 'new_rate parameter required';
              break;
            }
            await pool.query('UPDATE mining_engines SET daily_earning_rate = ? WHERE id = ?', [parameters.new_rate, engineId]);
            result.message = `Earning rate updated to ${parameters.new_rate}`;
            break;

          case 'update_duration':
            if (!parameters.new_duration) {
              result.status = 'error';
              result.message = 'new_duration parameter required';
              break;
            }
            await pool.query('UPDATE mining_engines SET duration_days = ? WHERE id = ?', [parameters.new_duration, engineId]);
            result.message = `Duration updated to ${parameters.new_duration} days`;
            break;

          default:
            result.status = 'error';
            result.message = 'Unknown operation';
        }

        results.push(result);

      } catch (error) {
        results.push({
          engine_id: engineId,
          status: 'error',
          message: error.message
        });
      }
    }

    // Log batch operation
    await pool.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      req.user.id,
      'batch_engine_operation',
      'mining_engine',
      null,
      JSON.stringify({ operation, engine_ids, parameters, results })
    ]);

    res.json({
      message: 'Batch operation completed',
      operation,
      processed_count: engine_ids.length,
      successful_count: results.filter(r => r.status === 'success').length,
      failed_count: results.filter(r => r.status === 'error').length,
      results
    });

  } catch (error) {
    console.error('Batch operation error:', error);
    res.status(500).json({ message: 'Batch operation failed', error: error.message });
  }
});

// Engine comparison tool
router.post('/compare', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { engine_ids, investment_amount = 1000, comparison_period = 30 } = req.body;

    if (!engine_ids || !Array.isArray(engine_ids) || engine_ids.length < 2) {
      return res.status(400).json({ 
        message: 'At least 2 engine IDs required for comparison' 
      });
    }

    const pool = require('../db');
    
    // Get engine details
    const [engines] = await pool.query(
      `SELECT * FROM mining_engines WHERE id IN (${engine_ids.map(() => '?').join(',')})`,
      engine_ids
    );

    if (engines.length !== engine_ids.length) {
      return res.status(404).json({ message: 'One or more engines not found' });
    }

    // Calculate comparison metrics
    const comparisons = engines.map(engine => {
      const dailyEarning = engine.earning_interval === 'hourly'
        ? investment_amount * (engine.daily_earning_rate / 100) * 24
        : investment_amount * (engine.daily_earning_rate / 100);

      const periodEarnings = dailyEarning * comparison_period;
      const annualEarnings = dailyEarning * 365;
      const totalPotentialReturn = dailyEarning * engine.duration_days;

      return {
        engine_id: engine.id,
        engine_name: engine.name,
        earning_interval: engine.earning_interval,
        daily_earning_rate: engine.daily_earning_rate,
        duration_days: engine.duration_days,
        is_active: engine.is_active,
        calculated_metrics: {
          daily_earning_amount: parseFloat(dailyEarning.toFixed(8)),
          period_earnings: parseFloat(periodEarnings.toFixed(2)),
          annual_earnings: parseFloat(annualEarnings.toFixed(2)),
          total_potential_return: parseFloat(totalPotentialReturn.toFixed(2)),
          roi_percentage: parseFloat(((totalPotentialReturn / investment_amount) * 100).toFixed(2)),
          break_even_days: Math.ceil(investment_amount / dailyEarning),
          daily_roi: parseFloat(((dailyEarning / investment_amount) * 100).toFixed(4))
        }
      };
    });

    // Sort by period earnings (descending)
    comparisons.sort((a, b) => b.calculated_metrics.period_earnings - a.calculated_metrics.period_earnings);

    // Add rankings
    comparisons.forEach((comp, index) => {
      comp.ranking = {
        by_period_earnings: index + 1,
        by_roi: comparisons
          .sort((a, b) => b.calculated_metrics.roi_percentage - a.calculated_metrics.roi_percentage)
          .findIndex(c => c.engine_id === comp.engine_id) + 1,
        by_daily_earnings: comparisons
          .sort((a, b) => b.calculated_metrics.daily_earning_amount - a.calculated_metrics.daily_earning_amount)
          .findIndex(c => c.engine_id === comp.engine_id) + 1
      };
    });

    res.json({
      comparison_parameters: {
        investment_amount,
        comparison_period_days: comparison_period,
        engines_compared: engines.length
      },
      comparisons,
      summary: {
        best_for_period_earnings: comparisons[0],
        best_roi: comparisons.reduce((best, current) => 
          current.calculated_metrics.roi_percentage > best.calculated_metrics.roi_percentage ? current : best
        ),
        fastest_break_even: comparisons.reduce((fastest, current) => 
          current.calculated_metrics.break_even_days < fastest.calculated_metrics.break_even_days ? current : fastest
        )
      },
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Engine comparison error:', error);
    res.status(500).json({ message: 'Comparison failed', error: error.message });
  }
});

// Engine health check - verify configuration integrity
router.get('/:engineId/health', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { engineId } = req.params;
    const pool = require('../db');

    // Get engine details
    const [engines] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    
    if (engines.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    const engine = engines[0];
    const healthChecks = [];

    // Check 1: Configuration validity
    const annualRate = engine.earning_interval === 'hourly' 
      ? (engine.daily_earning_rate * 24 * 365)
      : (engine.daily_earning_rate * 365);

    const totalReturn = engine.price * (annualRate / 100) * (engine.duration_days / 365);
    const roi = (totalReturn / engine.price) * 100;

    healthChecks.push({
      check: 'configuration_validity',
      status: roi > 1000 ? 'warning' : roi > 500 ? 'caution' : 'healthy',
      message: roi > 1000 ? 'Extremely high ROI may be unrealistic' : 
               roi > 500 ? 'Very high ROI - verify sustainability' : 'Configuration appears reasonable',
      details: { calculated_roi: parseFloat(roi.toFixed(2)) }
    });

    // Check 2: Active purchases
    const [purchaseCheck] = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_purchases
      FROM purchases WHERE engine_id = ?
    `, [engineId]);

    healthChecks.push({
      check: 'purchase_activity',
      status: purchaseCheck[0].active_purchases > 0 ? 'active' : 'inactive',
      message: `${purchaseCheck[0].active_purchases} active purchases, ${purchaseCheck[0].total_purchases} total`,
      details: purchaseCheck[0]
    });

    // Check 3: Recent earnings processing
    const [earningsCheck] = await pool.query(`
      SELECT 
        COUNT(el.id) as recent_earnings,
        MAX(el.earning_datetime) as last_earning,
        COUNT(DISTINCT el.purchase_id) as earning_purchases
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      WHERE p.engine_id = ? AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `, [engineId]);

    const lastEarningAge = earningsCheck[0].last_earning 
      ? Math.floor((Date.now() - new Date(earningsCheck[0].last_earning).getTime()) / (1000 * 60 * 60))
      : null;

    healthChecks.push({
      check: 'earnings_processing',
      status: earningsCheck[0].recent_earnings > 0 ? 'active' : 
              purchaseCheck[0].active_purchases > 0 ? 'stalled' : 'inactive',
      message: `${earningsCheck[0].recent_earnings} earnings in last 24h, last earning ${lastEarningAge ? lastEarningAge + 'h ago' : 'never'}`,
      details: { ...earningsCheck[0], last_earning_hours_ago: lastEarningAge }
    });

    // Check 4: Investment limits validation
    const limitsCheck = {
      check: 'investment_limits',
      status: 'healthy',
      message: 'Investment limits are properly configured',
      details: {
        min_investment: engine.min_investment,
        max_investment: engine.max_investment,
        price: engine.price
      }
    };

    if (engine.min_investment > engine.price) {
      limitsCheck.status = 'warning';
      limitsCheck.message = 'Minimum investment is higher than engine price';
    }

    if (engine.min_investment > engine.max_investment) {
      limitsCheck.status = 'error';
      limitsCheck.message = 'Minimum investment exceeds maximum investment';
    }

    healthChecks.push(limitsCheck);

    // Overall health assessment
    const errorCount = healthChecks.filter(c => c.status === 'error').length;
    const warningCount = healthChecks.filter(c => c.status === 'warning').length;

    const overallHealth = errorCount > 0 ? 'unhealthy' :
                         warningCount > 0 ? 'warning' : 'healthy';

    res.json({
      engine_info: {
        id: engine.id,
        name: engine.name,
        earning_interval: engine.earning_interval,
        is_active: engine.is_active
      },
      overall_health: overallHealth,
      health_checks: healthChecks,
      summary: {
        total_checks: healthChecks.length,
        errors: errorCount,
        warnings: warningCount,
        healthy: healthChecks.filter(c => c.status === 'healthy' || c.status === 'active').length
      },
      checked_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Engine health check error:', error);
    res.status(500).json({ message: 'Health check failed', error: error.message });
  }
});

module.exports = router;