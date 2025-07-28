const pool = require('../db');

const getMiningEngines = async (req, res) => {
  try {
    const { include_inactive } = req.query;
    let query = 'SELECT * FROM mining_engines';
    
    // Only show active engines unless specifically requested
    if (!include_inactive || include_inactive !== 'true') {
      query += ' WHERE is_active = TRUE';
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.query(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching mining engines:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getMiningEngineById = async (req, res) => {
  try {
    const { engineId } = req.params;
    const [rows] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }
    
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const addMiningEngine = async (req, res) => {
  try {
    const { name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url } = req.body;
    
    // Validation
    if (!name || !price || !daily_earning_rate || !duration_days) {
      return res.status(400).json({ 
        message: 'Name, price, daily earning rate, and duration are required' 
      });
    }

    if (price <= 0 || daily_earning_rate <= 0 || duration_days <= 0) {
      return res.status(400).json({ 
        message: 'Price, daily earning rate, and duration must be positive numbers' 
      });
    }

    const [result] = await pool.query(`
      INSERT INTO mining_engines (
        name, description, price, daily_earning_rate, duration_days, 
        min_investment, max_investment, image_url, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP)
    `, [
      name, 
      description || '', 
      price, 
      daily_earning_rate, 
      duration_days, 
      min_investment || 0, 
      5000000, 
      image_url || null
    ]);

    // Log admin action if user is admin
    if (req.user && req.user.role === 'admin') {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id, 
        'mining_engine_created', 
        'mining_engine', 
        result.insertId, 
        JSON.stringify({ name, price, daily_earning_rate, duration_days })
      ]);
    }

    res.status(201).json({ 
      message: 'Mining engine created successfully',
      engine_id: result.insertId 
    });
  } catch (error) {
    console.error('Error creating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { name, description, price, daily_earning_rate, duration_days, min_investment, max_investment, image_url, is_active } = req.body;
    
    // Check if engine exists
    const [existingEngine] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (existingEngine.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (price !== undefined) { 
      if (price <= 0) {
        return res.status(400).json({ message: 'Price must be a positive number' });
      }
      updates.push('price = ?'); 
      values.push(price); 
    }
    if (daily_earning_rate !== undefined) {
      if (daily_earning_rate <= 0) {
        return res.status(400).json({ message: 'Daily earning rate must be a positive number' });
      }
      updates.push('daily_earning_rate = ?'); 
      values.push(daily_earning_rate); 
    }
    if (duration_days !== undefined) {
      if (duration_days <= 0) {
        return res.status(400).json({ message: 'Duration must be a positive number' });
      }
      updates.push('duration_days = ?'); 
      values.push(duration_days); 
    }
    if (min_investment !== undefined) { updates.push('min_investment = ?'); values.push(min_investment); }
    // Always set max_investment to 5,000,000
    updates.push('max_investment = ?'); values.push(5000000);
    if (image_url !== undefined) { updates.push('image_url = ?'); values.push(image_url); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }
    
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
        JSON.stringify(req.body)
      ]);
    }

    res.json({ message: 'Mining engine updated successfully' });
  } catch (error) {
    console.error('Error updating mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteMiningEngine = async (req, res) => {
  try {
    const { engineId } = req.params;
    const { force } = req.query; // Allow force deletion via query parameter
    
    // Check if engine exists
    const [existingEngine] = await pool.query('SELECT * FROM mining_engines WHERE id = ?', [engineId]);
    if (existingEngine.length === 0) {
      return res.status(404).json({ message: 'Mining engine not found' });
    }

    // Check if engine has active purchases (unless force delete)
    if (force !== 'true') {
      const [activePurchases] = await pool.query(`
        SELECT COUNT(*) as count FROM purchases 
        WHERE engine_id = ? AND status IN ('active', 'pending')
      `, [engineId]);
      
      if (activePurchases[0].count > 0) {
        return res.status(400).json({ 
          message: 'Cannot delete mining engine with active purchases. Use force=true to override.',
          active_purchases: activePurchases[0].count
        });
      }
    }

    await pool.query('DELETE FROM mining_engines WHERE id = ?', [engineId]);

    // Log admin action
    if (req.user && req.user.role === 'admin') {
      await pool.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        req.user.id, 
        'mining_engine_deleted', 
        'mining_engine', 
        engineId, 
        JSON.stringify({ engine: existingEngine[0], force: force === 'true' })
      ]);
    }

    res.json({ message: 'Mining engine deleted successfully' });
  } catch (error) {
    console.error('Error deleting mining engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getMiningEngines,
  getMiningEngineById,
  addMiningEngine,
  updateMiningEngine,
  deleteMiningEngine,
};
