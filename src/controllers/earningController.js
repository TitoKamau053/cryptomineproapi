const pool = require('../db');

const logEarning = async (req, res) => {
  const { purchase_id, earning_amount } = req.body;
  if (!purchase_id || !earning_amount) {
    return res.status(400).json({ message: 'Purchase ID and earning amount are required' });
  }
  try {
    const [rows] = await pool.query('CALL sp_log_earning(?, ?)', [
      purchase_id,
      earning_amount
    ]);
    const log = rows[0][0];
    res.status(201).json({ log });
  } catch (error) {
    console.error('Error logging earning:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getEarnings = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT * FROM engine_logs WHERE user_id = ? ORDER BY earning_date DESC', [userId]);
    res.json({ earnings: rows });
  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  logEarning,
  getEarnings
};
