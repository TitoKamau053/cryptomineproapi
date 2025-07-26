const pool = require('../db');

// Get recent transaction activities for dashboard live feed
const getRecentActivities = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // Get recent activities from multiple sources
    const activities = [];
    
    // Recent deposits
    const [deposits] = await pool.query(`
      SELECT 
        u.full_name,
        d.amount,
        d.created_at,
        'deposit' as activity_type,
        d.status
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'completed'
      ORDER BY d.created_at DESC
      LIMIT ?
    `, [Math.floor(limit / 4)]);
    
    // Recent withdrawals
    const [withdrawals] = await pool.query(`
      SELECT 
        u.full_name,
        w.amount,
        w.created_at,
        'withdrawal' as activity_type,
        w.status
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'completed'
      ORDER BY w.created_at DESC
      LIMIT ?
    `, [Math.floor(limit / 4)]);
    
    // Recent earnings (mining rewards)
    const [earnings] = await pool.query(`
      SELECT 
        u.full_name,
        el.earning_amount as amount,
        el.earning_date as created_at,
        'mining_reward' as activity_type,
        'completed' as status
      FROM engine_logs el
      JOIN users u ON el.user_id = u.id
      ORDER BY el.earning_date DESC
      LIMIT ?
    `, [Math.floor(limit / 4)]);
    
    // Recent purchases
    const [purchases] = await pool.query(`
      SELECT 
        u.full_name,
        p.amount_invested as amount,
        p.created_at,
        'purchase' as activity_type,
        p.status
      FROM purchases p
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT ?
    `, [Math.floor(limit / 4)]);
    
    // Format activities
    const formatActivity = (item, type) => {
      const firstName = item.full_name ? item.full_name.split(' ')[0] : 'User';
      const avatar = firstName.charAt(0).toUpperCase();
      const timeAgo = getTimeAgo(new Date(item.created_at));
      
      let action, color, crypto;
      
      switch (type) {
        case 'deposit':
          action = 'Deposit Success';
          color = 'bg-green-500';
          crypto = 'USDT';
          break;
        case 'withdrawal':
          action = 'Withdrawal Processed';
          color = 'bg-blue-500';
          crypto = 'KES';
          break;
        case 'mining_reward':
          action = 'Mining Reward';
          color = 'bg-purple-500';
          crypto = 'ETH';
          break;
        case 'purchase':
          action = 'Investment Started';
          color = 'bg-orange-500';
          crypto = 'BTC';
          break;
        default:
          action = 'Transaction';
          color = 'bg-gray-500';
          crypto = 'KES';
      }
      
      return {
        name: `${firstName} ${item.full_name ? item.full_name.split(' ').slice(1).join(' ').charAt(0) + '.' : ''}`,
        avatar,
        action,
        amount: `+KES ${parseFloat(item.amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        time: timeAgo,
        crypto,
        color
      };
    };
    
    // Add all activities
    deposits.forEach(item => activities.push(formatActivity(item, 'deposit')));
    withdrawals.forEach(item => activities.push(formatActivity(item, 'withdrawal')));
    earnings.forEach(item => activities.push(formatActivity(item, 'mining_reward')));
    purchases.forEach(item => activities.push(formatActivity(item, 'purchase')));
    
    // Sort by time and limit
    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const limitedActivities = activities.slice(0, parseInt(limit));
    
    res.json({ activities: limitedActivities });
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Helper function to get time ago
const getTimeAgo = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) {
    return `${diffInSeconds} sec ago`;
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} min ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
};

// Get user transactions with date filtering
const getUserTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 30, page = 1, limit = 20, type } = req.query;
    const offset = (page - 1) * limit;
    
    // Calculate date range based on period
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const transactions = [];
    
    // Get deposits
    if (!type || type === 'deposit') {
      const [deposits] = await pool.query(`
        SELECT 
          'deposit' as type,
          id,
          amount,
          status,
          method,
          COALESCE(transaction_id, CONCAT('DP', id)) as transaction_id,
          created_at,
          'Deposit' as description
        FROM deposits 
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at DESC
      `, [userId, startDate]);
      
      transactions.push(...deposits);
    }
    
    // Get withdrawals
    if (!type || type === 'withdrawal') {
      const [withdrawals] = await pool.query(`
        SELECT 
          'withdrawal' as type,
          id,
          amount,
          status,
          method,
          CONCAT('WD', id) as transaction_id,
          created_at,
          'Withdrawal' as description
        FROM withdrawals 
        WHERE user_id = ? AND created_at >= ?
        ORDER BY created_at DESC
      `, [userId, startDate]);
      
      transactions.push(...withdrawals);
    }
    
    // Get purchases
    if (!type || type === 'purchase') {
      const [purchases] = await pool.query(`
        SELECT 
          'purchase' as type,
          p.id,
          p.amount_invested as amount,
          p.status,
          'investment' as method,
          CONCAT('PU', p.id) as transaction_id,
          p.created_at,
          CONCAT('Mining Engine: ', m.name) as description
        FROM purchases p
        JOIN mining_engines m ON p.engine_id = m.id
        WHERE p.user_id = ? AND p.created_at >= ?
        ORDER BY p.created_at DESC
      `, [userId, startDate]);
      
      transactions.push(...purchases);
    }
    
    // Get earnings
    if (!type || type === 'earning') {
      const [earnings] = await pool.query(`
        SELECT 
          'earning' as type,
          el.id,
          el.earning_amount as amount,
          'completed' as status,
          'mining' as method,
          CONCAT('ER', el.id) as transaction_id,
          el.earning_date as created_at,
          'Mining Reward' as description
        FROM engine_logs el 
        WHERE el.user_id = ? AND el.earning_date >= ?
        ORDER BY el.earning_date DESC
      `, [userId, startDate]);
      
      transactions.push(...earnings);
    }
    
    // Sort all transactions by date
    transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Apply pagination
    const paginatedTransactions = transactions.slice(offset, offset + parseInt(limit));
    
    // Format transactions for UI
    const formattedTransactions = paginatedTransactions.map(transaction => ({
      id: transaction.id,
      type: transaction.type,
      amount: parseFloat(transaction.amount),
      status: transaction.status,
      method: transaction.method,
      description: transaction.description,
      transaction_id: transaction.transaction_id,
      created_at: transaction.created_at,
      formatted_amount: `KES ${parseFloat(transaction.amount).toLocaleString('en-KE', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      })}`,
      formatted_date: new Date(transaction.created_at).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }));
    
    res.json({
      transactions: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: transactions.length,
        pages: Math.ceil(transactions.length / limit)
      },
      period: parseInt(period)
    });
  } catch (error) {
    console.error('Error fetching user transactions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getRecentActivities,
  getUserTransactions
};
