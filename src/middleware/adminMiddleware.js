const pool = require('../db');

const verifyAdminRole = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: No user ID found' });
    }

    const [rows] = await pool.query('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userRole = rows[0].role;
    if (userRole !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: Admins only' });
    }

    next();
  } catch (error) {
    console.error('Error verifying admin role:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = { verifyAdminRole };
