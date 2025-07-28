const pool = require('../db');

const purchaseEngine = async (req, res) => {
  const userId = req.user.id;
  const { engine_id, amount } = req.body;
  if (!engine_id || !amount) {
    return res.status(400).json({ message: 'Engine ID and amount are required' });
  }
  try {
    const [rows] = await pool.query('CALL sp_purchase_engine(?, ?, ?)', [
      userId,
      engine_id,
      amount
    ]);
    const purchase = rows[0][0];
    res.status(201).json({ purchase });
  } catch (error) {
    // Handle custom SQL errors (e.g., insufficient balance, min/max investment)
    if (error && error.errno === 1644) { // SIGNAL SQLSTATE '45000'
      return res.status(400).json({ message: error.sqlMessage || 'Purchase failed' });
    }
    console.error('Error purchasing engine:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserPurchases = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT p.id, p.engine_id, e.name as engine_name, p.amount_invested, p.daily_earning, p.total_earned, p.start_date, p.end_date, p.status FROM purchases p JOIN mining_engines e ON p.engine_id = e.id WHERE p.user_id = ?', [userId]);
    res.json({ purchases: rows });
  } catch (error) {
    console.error('Error fetching user purchases:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  purchaseEngine,
  getUserPurchases
};
