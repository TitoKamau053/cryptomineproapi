const pool = require('../db');

const getReferralInfo = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(
      "SELECT r.id as referral_id, r.commission_rate, r.total_commission, r.status, " +
      "u.email as referred_email, u.full_name as referred_name, u.created_at as referred_date, " +
      "COALESCE(SUM(rc.commission_amount), 0) as total_commission_earned " +
      "FROM referrals r " +
      "JOIN users u ON r.referred_id = u.id " +
      "LEFT JOIN referral_commissions rc ON rc.referral_id = r.id " +
      "WHERE r.referrer_id = ? " +
      "GROUP BY r.id, u.email, u.full_name, u.created_at, r.commission_rate, r.total_commission, r.status " +
      "ORDER BY u.created_at DESC",
      [userId]
    );
    
    // Get referral statistics
    const [statsRows] = await pool.query(
      "SELECT COUNT(r.id) as total_referrals, " +
      "COUNT(CASE WHEN u.status = 'active' THEN 1 END) as active_referrals, " +
      "COALESCE(SUM(rc.commission_amount), 0) as total_commissions_earned, " +
      "COALESCE(AVG(rc.commission_amount), 0) as avg_commission_per_referral " +
      "FROM referrals r " +
      "JOIN users u ON r.referred_id = u.id " +
      "LEFT JOIN referral_commissions rc ON rc.referral_id = r.id " +
      "WHERE r.referrer_id = ?",
      [userId]
    );
    
    res.json({ 
      referrals: rows,
      statistics: statsRows[0]
    });
  } catch (error) {
    console.error('Error fetching referral info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const generateReferralLink = async (req, res) => {
  const userId = req.user.id;
  try {
    // Get user's referral code
    const [userRows] = await pool.query(
      'SELECT referral_code, full_name FROM users WHERE id = ?',
      [userId]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { referral_code, full_name } = userRows[0];
    
    // Generate shareable link by combining referral code with app's registration URL
    const baseUrl = process.env.APP_BASE_URL || 'https://cryptominepro.com';
    const referralLink = `${baseUrl}/register?ref=${referral_code}`;
    
    // Get referral statistics
    const [statsRows] = await pool.query(
      "SELECT COUNT(*) as total_referrals, " +
      "COALESCE(SUM(rc.commission_amount), 0) as total_commissions " +
      "FROM referrals r " +
      "LEFT JOIN referral_commissions rc ON rc.referral_id = r.id " +
      "WHERE r.referrer_id = ?",
      [userId]
    );
    
    const stats = statsRows[0];
    
    res.json({
      success: true,
      data: {
        referral_code,
        referral_link: referralLink,
        share_message: `Join ${full_name} on CryptoMinePro and start earning through cryptocurrency mining! Use my referral link: ${referralLink}`,
        stats: {
          total_referrals: stats.total_referrals,
          total_commissions: parseFloat(stats.total_commissions)
        }
      }
    });
  } catch (error) {
    console.error('Error generating referral link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getReferralCommissions = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    // Get commission history
    const [commissions] = await pool.query(`
      SELECT rc.id, rc.commission_amount, rc.commission_type, rc.created_at,
             r.referred_id, u.full_name as referred_name, u.email as referred_email
      FROM referral_commissions rc
      JOIN referrals r ON rc.referral_id = r.id
      JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = ?
      ORDER BY rc.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);
    
    // Get total count
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM referral_commissions rc
      JOIN referrals r ON rc.referral_id = r.id
      WHERE r.referrer_id = ?
    `, [userId]);
    
    const total = countResult[0].total;
    
    res.json({
      commissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching referral commissions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getMyReferrer = async (req, res) => {
  const userId = req.user.id;
  
  try {
    // Get user's referrer information
    const [userRows] = await pool.query(`
      SELECT u.referred_by, r.full_name as referrer_name, r.email as referrer_email,
             r.referral_code as referrer_code
      FROM users u
      LEFT JOIN users r ON u.referred_by = r.id
      WHERE u.id = ?
    `, [userId]);
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userRows[0];
    
    if (!user.referred_by) {
      return res.json({ 
        message: 'No referrer found',
        referrer: null
      });
    }
    
    res.json({
      referrer: {
        id: user.referred_by,
        name: user.referrer_name,
        email: user.referrer_email,
        referral_code: user.referrer_code
      }
    });
  } catch (error) {
    console.error('Error fetching referrer info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getReferralInfo,
  generateReferralLink,
  getReferralCommissions,
  getMyReferrer
};
