const pool = require('../db');

/**
 * Get all mining engines with enhanced filtering and statistics
 */
const getMiningEngines = async (req, res) => {
  try {
    const { 
      include_inactive = 'false',
      earning_interval,
      sort_by = 'created_at',
      sort_order = 'DESC',
      include_stats = 'false'
    } = req.query;

    // Build base query conditions
    let whereConditions = [];
    let queryParams = [];

    if (include_inactive !== 'true') {
      whereConditions.push('me.is_active = TRUE');
    }

    if (earning_interval && ['hourly', 'daily'].includes(earning_interval)) {
      whereConditions.push('me.earning_interval = ?');
      queryParams.push(earning_interval);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Validate sort parameters
    const validSortColumns = ['created_at', 'name', 'price', 'daily_earning_rate', 'duration_days'];
    const sortColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let query = `
      SELECT 
        me.*,
        ${include_stats === 'true' ? `
        (SELECT COUNT(*) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as active_purchases,
        (SELECT COALESCE(SUM(p.amount_invested), 0) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as total_active_investment,
        (SELECT COUNT(DISTINCT p.user_id) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as active_users,
        (SELECT COALESCE(SUM(el.earning_amount), 0) FROM engine_logs el 
         JOIN purchases p ON el.purchase_id = p.id 
         WHERE p.engine_id = me.id AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as earnings_last_30_days,
        ` : ''}
        CASE 
          WHEN me.earning_interval = 'hourly' THEN CONCAT(ROUND(me.daily_earning_rate * 24, 4), '% hourly')
          ELSE CONCAT(me.daily_earning_rate, '% daily')
        END as earning_rate_display
      FROM mining_engines me
      ${whereClause}
      ORDER BY me.${sortColumn} ${sortDirection}
    `;

    const [engines] = await pool.query(query, queryParams);

    // Calculate additional metrics for each engine
    const enhancedEngines = engines.map(engine => {
      const annualRate = engine.earning_interval === 'hourly' 
        ? (engine.daily_earning_rate * 24 * 365).toFixed(2)
        : (engine.daily_earning_rate * 365).toFixed(2);

      const totalPotentialReturn = (engine.price * (annualRate / 100) * (engine.duration_days / 365)).toFixed(2);

      return {
        ...engine,
        calculated_metrics: {
          annual_rate_percentage: parseFloat(annualRate),
          total_potential_return: parseFloat(totalPotentialReturn),
          roi_percentage: ((totalPotentialReturn / engine.price) * 100).toFixed(2),
          daily_earning_amount: (engine.price * (engine.daily_earning_rate / 100)).toFixed(8),
          hourly_earning_amount: (engine.price * (engine.daily_earning_rate / 100) / 24).toFixed(8)
        }
      };
    });

    res.status(200).json({
      engines: enhancedEngines,
      metadata: {
        total_count: engines.length,
        active_count: engines.filter(e => e.is_active).length,
        hourly_count: engines.filter(e => e.earning_interval === 'hourly').length,
        daily_count: engines.filter(e => e.earning_interval === 'daily').length,
        filters_applied: {
          include_inactive: include_inactive === 'true',
          earning_interval: earning_interval || 'all',
          include_stats: include_stats === 'true'
        }
      }
    });

  } catch (error) {
    console.error('Error fetching mining engines:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Get mining engine by ID with comprehensive details
 */
const getMiningEngineById = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { include_stats = 'true' } = req.query;

    // Get engine details
    const [engines] = await pool.query(`
      SELECT 
        me.*,
        ${include_stats === 'true' ? `
        (SELECT COUNT(*) FROM purchases p WHERE p.engine_id = me.id) as total_purchases,
        (SELECT COUNT(*) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as active_purchases,
        (SELECT COUNT(*) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'completed') as completed_purchases,
        (SELECT COALESCE(SUM(p.amount_invested), 0) FROM purchases p WHERE p.engine_id = me.id) as total_investment,
        (SELECT COALESCE(SUM(p.amount_invested), 0) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as active_investment,
        (SELECT COUNT(DISTINCT p.user_id) FROM purchases p WHERE p.engine_id = me.id) as total_users,
        (SELECT COUNT(DISTINCT p.user_id) FROM purchases p WHERE p.engine_id = me.id AND p.status = 'active') as active_users,
        ` : ''}
        CASE 
          WHEN me.earning_interval = 'hourly' THEN CONCAT(ROUND(me.daily_earning_rate * 24, 4), '% hourly')
          ELSE CONCAT(me.daily_earning_rate, '% daily')
        END as earning_rate_display
      FROM mining_engines me
      WHERE me.id = ?
    `, [engineId]);
    
    if (engines.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    const engine = engines[0];

    // Get recent earnings statistics if requested
    let earningsStats = null;
    if (include_stats === 'true') {
      const [stats] = await pool.query(`
        SELECT 
          COUNT(el.id) as total_earning_logs,
          COALESCE(SUM(el.earning_amount), 0) as total_earnings_paid,
          COALESCE(AVG(el.earning_amount), 0) as avg_earning_amount,
          MAX(el.earning_datetime) as last_earning_time,
          COUNT(DISTINCT DATE(el.earning_datetime)) as active_earning_days
        FROM engine_logs el
        JOIN purchases p ON el.purchase_id = p.id
        WHERE p.engine_id = ?
      `, [engineId]);

      const [recentEarnings] = await pool.query(`
        SELECT 
          DATE(el.earning_datetime) as earning_date,
          COUNT(el.id) as earning_count,
          SUM(el.earning_amount) as daily_total
        FROM engine_logs el
        JOIN purchases p ON el.purchase_id = p.id
        WHERE p.engine_id = ? AND el.earning_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(el.earning_datetime)
        ORDER BY earning_date DESC
        LIMIT 30
      `, [engineId]);

      earningsStats = {
        ...stats[0],
        recent_daily_earnings: recentEarnings
      };
    }

    // Calculate performance metrics
    const annualRate = engine.earning_interval === 'hourly' 
      ? (engine.daily_earning_rate * 24 * 365)
      : (engine.daily_earning_rate * 365);

    const totalPotentialReturn = engine.price * (annualRate / 100) * (engine.duration_days / 365);

    const response = {
      ...engine,
      calculated_metrics: {
        annual_rate_percentage: parseFloat(annualRate.toFixed(2)),
        total_potential_return: parseFloat(totalPotentialReturn.toFixed(2)),
        roi_percentage: parseFloat(((totalPotentialReturn / engine.price) * 100).toFixed(2)),
        daily_earning_amount: parseFloat((engine.price * (engine.daily_earning_rate / 100)).toFixed(8)),
        hourly_earning_amount: parseFloat((engine.price * (engine.daily_earning_rate / 100) / 24).toFixed(8)),
        expected_total_earnings: parseFloat(totalPotentialReturn.toFixed(2)),
        break_even_days: Math.ceil(engine.price / (engine.price * (engine.daily_earning_rate / 100) * (engine.earning_interval === 'hourly' ? 24 : 1)))
      }
    };

    if (earningsStats) {
      response.earnings_statistics = earningsStats;
    }
    
    res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Enhanced add mining engine with comprehensive validation
 */
const addMiningEngine = async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      daily_earning_rate, 
      duration_days, 
      duration_hours,
      min_investment, 
      max_investment, 
      image_url, 
      earning_interval,
      is_active = true
    } = req.body;

    // Enhanced validation
    const validationErrors = [];

    if (!name || name.trim().length < 3) {
      validationErrors.push('Name must be at least 3 characters long');
    }

    if (!price || price <= 0) {
      validationErrors.push('Price must be a positive number');
    }

    if (!daily_earning_rate || daily_earning_rate <= 0) {
      validationErrors.push('Daily earning rate must be a positive number');
    }

    if (!earning_interval || !['hourly', 'daily'].includes(earning_interval)) {
      validationErrors.push('Earning interval must be either "hourly" or "daily"');
    }

    if (earning_interval === 'hourly') {
      if (!duration_hours || duration_hours <= 0) {
        validationErrors.push('Duration must be a positive number of hours for hourly earning interval');
      }
    } else {
      if (!duration_days || duration_days <= 0) {
        validationErrors.push('Duration must be a positive number of days for daily earning interval');
      }
    }

    // Validate investment limits
    if (min_investment && min_investment < 0) {
      validationErrors.push('Minimum investment cannot be negative');
    }

    if (max_investment && max_investment <= 0) {
      validationErrors.push('Maximum investment must be positive');
    }

    if (min_investment && max_investment && min_investment > max_investment) {
      validationErrors.push('Minimum investment cannot be greater than maximum investment');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Check for duplicate name
    const [existingEngine] = await pool.query(
      'SELECT id FROM mining_engines WHERE name = ?',
      [name.trim()]
    );

    if (existingEngine.length > 0) {
      return res.status(400).json({ 
        message: 'Mining engine with this name already exists' 
      });
    }

    // Calculate duration_days for storage
    let durationForStorage = duration_days;
    if (earning_interval === 'hourly') {
      durationForStorage = duration_hours;
    }

    // Calculate and validate profitability metrics
    const annualRate = earning_interval === 'hourly' 
      ? (daily_earning_rate * 24 * 365)
      : (daily_earning_rate * 365);

    const totalReturn = price * (annualRate / 100) * (earning_interval === 'hourly' ? durationForStorage / (24 * 365) : durationForStorage / 365);
    const roi = (totalReturn / price) * 100;

    // Warn about unrealistic returns
    if (roi > 1000) { // 1000% ROI
      return res.status(400).json({
        message: 'Engine configuration results in unrealistic returns',
        calculated_roi: `${roi.toFixed(2)}%`,
        suggestion: 'Please review the earning rate and duration'
      });
    }

    // Insert new mining engine
    const [result] = await pool.query(`
      INSERT INTO mining_engines (
        name, description, price, daily_earning_rate, duration_days, duration_hours,
        min_investment, max_investment, image_url, is_active, earning_interval, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      name.trim(),
      description || '',
      price,
      daily_earning_rate,
      earning_interval === 'hourly' ? 0 : duration_days,
      earning_interval === 'hourly' ? duration_hours : 0,
      min_investment || price, // Default min_investment to price
      max_investment || 5000000,
      image_url || null,
      is_active,
      earning_interval
    ]);

    // Log admin action
    if (req.user && req.user.role === 'admin') {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id,
        'mining_engine_created',
        'mining_engine',
        result.insertId,
        JSON.stringify({
          name: name.trim(),
          price,
          daily_earning_rate,
          duration_days: durationForStorage,
          earning_interval,
          calculated_metrics: {
            annual_rate: annualRate.toFixed(2),
            total_return: totalReturn.toFixed(2),
            roi_percentage: roi.toFixed(2)
          }
        })
      ]);
    }

    res.status(201).json({
      message: 'Mining engine created successfully',
      engine_id: result.insertId,
      calculated_metrics: {
        annual_rate_percentage: parseFloat(annualRate.toFixed(2)),
        total_potential_return: parseFloat(totalReturn.toFixed(2)),
        roi_percentage: parseFloat(roi.toFixed(2)),
        daily_earning_for_min_investment: earning_interval === 'hourly'
          ? parseFloat(((min_investment || price) * (daily_earning_rate / 100) * 24).toFixed(8))
          : parseFloat(((min_investment || price) * (daily_earning_rate / 100)).toFixed(2))
      }
    });

  } catch (error) {
    console.error('Error creating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Enhanced update mining engine with validation and change tracking
 */
const updateMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const updateFields = req.body;

    // Check if engine exists
    const [existingEngine] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (existingEngine.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    const currentEngine = existingEngine[0];

    // Validate individual fields
    const validationErrors = [];
    const updates = [];
    const values = [];
    const changes = {};

    // Name validation and update
    if (updateFields.name !== undefined) {
      const trimmedName = updateFields.name.trim();
      if (trimmedName.length < 3) {
        validationErrors.push('Name must be at least 3 characters long');
      } else if (trimmedName !== currentEngine.name) {
        // Check for duplicate name
        const [duplicate] = await pool.query(
          'SELECT id FROM mining_engines WHERE name = ? AND id != ?',
          [trimmedName, engineId]
        );
        if (duplicate.length > 0) {
          validationErrors.push('Mining engine with this name already exists');
        } else {
          updates.push('name = ?');
          values.push(trimmedName);
          changes.name = { from: currentEngine.name, to: trimmedName };
        }
      }
    }

    // Description update
    if (updateFields.description !== undefined) {
      updates.push('description = ?');
      values.push(updateFields.description);
      changes.description = { from: currentEngine.description, to: updateFields.description };
    }

    // Price validation and update
    if (updateFields.price !== undefined) {
      if (updateFields.price <= 0) {
        validationErrors.push('Price must be a positive number');
      } else if (updateFields.price !== currentEngine.price) {
        // Check if there are active purchases - price changes might be risky
        const [activePurchases] = await pool.query(
          'SELECT COUNT(*) as count FROM purchases WHERE engine_id = ? AND status = "active"',
          [engineId]
        );
        
        if (activePurchases[0].count > 0) {
          validationErrors.push(`Cannot change price while there are ${activePurchases[0].count} active purchases`);
        } else {
          updates.push('price = ?');
          values.push(updateFields.price);
          changes.price = { from: parseFloat(currentEngine.price), to: updateFields.price };
        }
      }
    }

    // Daily earning rate validation and update
    if (updateFields.daily_earning_rate !== undefined) {
      if (updateFields.daily_earning_rate <= 0) {
        validationErrors.push('Daily earning rate must be a positive number');
      } else {
        // Validate based on earning interval
        const earningInterval = updateFields.earning_interval || currentEngine.earning_interval;
        if (earningInterval === 'hourly' && updateFields.daily_earning_rate > 10) {
          validationErrors.push('Hourly earning rate seems too high (daily rate > 10%)');
        }
        if (earningInterval === 'daily' && updateFields.daily_earning_rate > 1) {
          validationErrors.push('Daily earning rate seems too high (> 1%)');
        }
        
        if (validationErrors.length === 0) {
          updates.push('daily_earning_rate = ?');
          values.push(updateFields.daily_earning_rate);
          changes.daily_earning_rate = { from: parseFloat(currentEngine.daily_earning_rate), to: updateFields.daily_earning_rate };
        }
      }
    }

    // Duration validation and update
    if (updateFields.duration_days !== undefined || updateFields.duration_hours !== undefined) {
      let newDurationDays = currentEngine.duration_days;
      if (updateFields.duration_hours !== undefined && (updateFields.earning_interval || currentEngine.earning_interval) === 'hourly') {
        if (updateFields.duration_hours <= 0) {
          validationErrors.push('Duration must be a positive number of hours for hourly earning interval');
        } else {
          newDurationDays = updateFields.duration_hours / 24;
          updates.push('duration_days = ?');
          values.push(newDurationDays);
          changes.duration_days = { from: currentEngine.duration_days, to: newDurationDays };
        }
      } else if (updateFields.duration_days !== undefined) {
        if (updateFields.duration_days <= 0) {
          validationErrors.push('Duration must be a positive number of days for daily earning interval');
        } else {
          newDurationDays = updateFields.duration_days;
          updates.push('duration_days = ?');
          values.push(newDurationDays);
          changes.duration_days = { from: currentEngine.duration_days, to: newDurationDays };
        }
      }
    }

    // Earning interval validation and update
    if (updateFields.earning_interval !== undefined) {
      if (!['hourly', 'daily'].includes(updateFields.earning_interval)) {
        validationErrors.push('Earning interval must be either "hourly" or "daily"');
      } else if (updateFields.earning_interval !== currentEngine.earning_interval) {
        // Check if there are active purchases - interval changes are not recommended
        const [activePurchases] = await pool.query(
          'SELECT COUNT(*) as count FROM purchases WHERE engine_id = ? AND status = "active"',
          [engineId]
        );
        
        if (activePurchases[0].count > 0) {
          validationErrors.push(`Cannot change earning interval while there are ${activePurchases[0].count} active purchases`);
        } else {
          updates.push('earning_interval = ?');
          values.push(updateFields.earning_interval);
          changes.earning_interval = { from: currentEngine.earning_interval, to: updateFields.earning_interval };
        }
      }
    }

    // Investment limits validation and update
    if (updateFields.min_investment !== undefined) {
      if (updateFields.min_investment < 0) {
        validationErrors.push('Minimum investment cannot be negative');
      } else {
        updates.push('min_investment = ?');
        values.push(updateFields.min_investment);
        changes.min_investment = { from: parseFloat(currentEngine.min_investment), to: updateFields.min_investment };
      }
    }

    if (updateFields.max_investment !== undefined) {
      if (updateFields.max_investment <= 0) {
        validationErrors.push('Maximum investment must be positive');
      } else {
        const minInvestment = updateFields.min_investment !== undefined 
          ? updateFields.min_investment 
          : currentEngine.min_investment;
        
        if (updateFields.max_investment < minInvestment) {
          validationErrors.push('Maximum investment cannot be less than minimum investment');
        } else {
          updates.push('max_investment = ?');
          values.push(updateFields.max_investment);
          changes.max_investment = { from: parseFloat(currentEngine.max_investment), to: updateFields.max_investment };
        }
      }
    }

    // Other field updates
    if (updateFields.image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(updateFields.image_url);
      changes.image_url = { from: currentEngine.image_url, to: updateFields.image_url };
    }

    if (updateFields.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(updateFields.is_active);
      changes.is_active = { from: Boolean(currentEngine.is_active), to: Boolean(updateFields.is_active) };
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Return early if no changes
    if (updates.length === 0) {
      return res.status(200).json({ 
        message: 'No changes detected',
        engine: currentEngine
      });
    }

    // Calculate new metrics if relevant fields changed
    let newMetrics = null;
    if (changes.price || changes.daily_earning_rate || changes.duration_days || changes.earning_interval) {
      const newPrice = changes.price ? changes.price.to : currentEngine.price;
      const newRate = changes.daily_earning_rate ? changes.daily_earning_rate.to : currentEngine.daily_earning_rate;
      const newDuration = changes.duration_days ? changes.duration_days.to : currentEngine.duration_days;
      const newInterval = changes.earning_interval ? changes.earning_interval.to : currentEngine.earning_interval;

      const annualRate = newInterval === 'hourly' 
        ? (newRate * 24 * 365)
        : (newRate * 365);

      const totalReturn = newPrice * (annualRate / 100) * (newDuration / 365);
      const roi = (totalReturn / newPrice) * 100;

      // Validate new metrics
      if (roi > 1000) {
        return res.status(400).json({
          message: 'Updated configuration results in unrealistic returns',
          calculated_roi: `${roi.toFixed(2)}%`,
          suggestion: 'Please review the earning rate and duration'
        });
      }

      newMetrics = {
        annual_rate_percentage: parseFloat(annualRate.toFixed(2)),
        total_potential_return: parseFloat(totalReturn.toFixed(2)),
        roi_percentage: parseFloat(roi.toFixed(2))
      };
    }

    // Perform the update
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(engineId);

    await pool.query(`
      UPDATE mining_engines 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `, values);

    // Log admin action
    if (req.user && req.user.role === 'admin') {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id,
        'mining_engine_updated',
        'mining_engine',
        engineId,
        JSON.stringify({
          changes,
          new_metrics: newMetrics
        })
      ]);
    }

    res.json({
      message: 'Mining engine updated successfully',
      changes_made: Object.keys(changes),
      updated_fields: changes,
      new_metrics: newMetrics
    });

  } catch (error) {
    console.error('Error updating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Enhanced delete mining engine with safety checks
 */
const deleteMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { force = 'false', confirm = 'false' } = req.query;
    
    // Check if engine exists
    const [existingEngine] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (existingEngine.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    const engine = existingEngine[0];

    // Get comprehensive statistics about this engine
    const [purchaseStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_purchases,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_purchases,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_purchases,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_purchases,
        COALESCE(SUM(amount_invested), 0) as total_investment,
        COALESCE(SUM(CASE WHEN status = 'active' THEN amount_invested ELSE 0 END), 0) as active_investment,
        COUNT(DISTINCT user_id) as unique_users
      FROM purchases 
      WHERE engine_id = ?
    `, [engineId]);

    const [earningStats] = await pool.query(`
      SELECT 
        COUNT(el.id) as total_earnings,
        COALESCE(SUM(el.earning_amount), 0) as total_earnings_paid
      FROM engine_logs el
      JOIN purchases p ON el.purchase_id = p.id
      WHERE p.engine_id = ?
    `, [engineId]);

    const stats = {
      ...purchaseStats[0],
      ...earningStats[0]
    };

    // Safety checks
    if (force !== 'true') {
      if (stats.active_purchases > 0) {
        return res.status(400).json({
          message: 'Cannot delete mining engine with active purchases',
          statistics: stats,
          suggestion: 'Use force=true to override this safety check, or wait for purchases to complete'
        });
      }

      if (stats.total_purchases > 0 && confirm !== 'true') {
        return res.status(400).json({
          message: 'Mining engine has historical data',
          statistics: stats,
          warning: 'Deleting will remove all associated data including earnings history',
          suggestion: 'Add confirm=true to proceed with deletion'
        });
      }
    }

    // Proceed with deletion
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // If force delete, we need to clean up related data
      if (force === 'true' && stats.active_purchases > 0) {
        // Cancel active purchases first
        await connection.query(`
          UPDATE purchases 
          SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
          WHERE engine_id = ? AND status = 'active'
        `, [engineId]);

        // Optionally refund users (this would need additional business logic)
        // For now, just log the action for manual review
        console.warn(`Force deletion: ${stats.active_purchases} active purchases cancelled for engine ${engineId}`);
      }

      // Delete the engine (cascade will handle related records)
      await connection.query('DELETE FROM mining_engines WHERE id = ?', [engineId]);

      // Log admin action
      if (req.user && req.user.role === 'admin') {
        await connection.query(`
          INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          req.user.id,
          'mining_engine_deleted',
          'mining_engine',
          engineId,
          JSON.stringify({
            engine_data: engine,
            statistics: stats,
            force_delete: force === 'true',
            deletion_reason: req.body.reason || 'Not specified'
          })
        ]);
      }

      await connection.commit();

      res.json({
        message: 'Mining engine deleted successfully',
        deleted_engine: {
          id: engine.id,
          name: engine.name,
          earning_interval: engine.earning_interval
        },
        cleanup_summary: {
          ...stats,
          forced_deletion: force === 'true'
        }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Error deleting mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * NEW: Test mining engine configuration
 */
const testMiningEngineConfig = async (req, res) => {
  try {
    const {
      price,
      daily_earning_rate,
      duration_days,
      earning_interval,
      test_investment = null
    } = req.body;

    // Validation
    if (!price || !daily_earning_rate || !duration_days || !earning_interval) {
      return res.status(400).json({
        message: 'Missing required fields: price, daily_earning_rate, duration_days, earning_interval'
      });
    }

    if (!['hourly', 'daily'].includes(earning_interval)) {
      return res.status(400).json({
        message: 'Invalid earning_interval. Must be "hourly" or "daily"'
      });
    }

    const investmentAmount = test_investment || price;

    // Calculate metrics
    const annualRate = earning_interval === 'hourly' 
      ? (daily_earning_rate * 24 * 365)
      : (daily_earning_rate * 365);

    const totalReturn = investmentAmount * (annualRate / 100) * (duration_days / 365);
    const roi = (totalReturn / investmentAmount) * 100;

    const dailyEarning = investmentAmount * (daily_earning_rate / 100);
    const hourlyEarning = dailyEarning / 24;

    // Generate sample earnings schedule
    const sampleEarnings = [];
    const startDate = new Date();
    
    for (let i = 0; i < Math.min(10, duration_days); i++) {
      if (earning_interval === 'hourly') {
        const hourDate = new Date(startDate);
        hourDate.setHours(hourDate.getHours() + i);
        sampleEarnings.push({
          period: i + 1,
          datetime: hourDate.toISOString(),
          earning_amount: parseFloat(hourlyEarning.toFixed(8)),
          type: 'hourly'
        });
      } else {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + i);
        sampleEarnings.push({
          period: i + 1,
          datetime: dayDate.toISOString().split('T')[0],
          earning_amount: parseFloat(dailyEarning.toFixed(2)),
          type: 'daily'
        });
      }
    }

    // Risk assessment
    const riskAssessment = {
      risk_level: roi > 1000 ? 'extreme' : roi > 500 ? 'very_high' : roi > 200 ? 'high' : roi > 100 ? 'moderate' : 'low',
      warnings: [],
      recommendations: []
    };

    if (roi > 1000) {
      riskAssessment.warnings.push('Extremely high ROI - likely unrealistic and may cause user complaints');
    }
    if (earning_interval === 'hourly' && daily_earning_rate > 5) {
      riskAssessment.warnings.push('Very high hourly rate - may be difficult to sustain');
    }
    if (earning_interval === 'daily' && daily_earning_rate > 0.5) {
      riskAssessment.warnings.push('High daily rate - ensure this is sustainable');
    }
    if (duration_days < 30) {
      riskAssessment.recommendations.push('Short duration - consider longer terms for better user retention');
    }

    res.json({
      test_parameters: {
        price,
        daily_earning_rate,
        duration_days,
        earning_interval,
        test_investment: investmentAmount
      },
      calculated_metrics: {
        annual_rate_percentage: parseFloat(annualRate.toFixed(2)),
        total_potential_return: parseFloat(totalReturn.toFixed(2)),
        roi_percentage: parseFloat(roi.toFixed(2)),
        daily_earning_amount: parseFloat(dailyEarning.toFixed(8)),
        hourly_earning_amount: parseFloat(hourlyEarning.toFixed(8)),
        break_even_days: Math.ceil(investmentAmount / dailyEarning),
        total_earning_periods: earning_interval === 'hourly' ? duration_days * 24 : duration_days
      },
      risk_assessment: riskAssessment,
      sample_earnings_schedule: sampleEarnings,
      test_timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error testing mining engine config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getMiningEngines,
  getMiningEngineById,
  addMiningEngine,
  updateMiningEngine,
  deleteMiningEngine,
  testMiningEngineConfig
};