const pool = require('../db');

/**
 * Script to check and report discrepancies between stored daily_earning and
 * calculated daily earning based on invested amount and engine ROI.
 */
async function checkEarningsDiscrepancies() {
  try {
    const [rows] = await pool.query(`
      SELECT 
        p.id AS purchase_id,
        p.user_id,
        p.engine_id,
        p.amount_invested,
        p.daily_earning AS stored_daily_earning,
        me.daily_earning_rate,
        ROUND(p.amount_invested * (me.daily_earning_rate / 100), 2) AS calculated_daily_earning,
        ABS(p.daily_earning - ROUND(p.amount_invested * (me.daily_earning_rate / 100), 2)) AS difference
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active'
      ORDER BY difference DESC
      LIMIT 100
    `);

    const discrepancies = rows.filter(row => row.difference > 0.01);

    if (discrepancies.length === 0) {
      console.log('No significant discrepancies found in active purchases.');
    } else {
      console.log('Discrepancies found in the following purchases:');
      discrepancies.forEach(row => {
        console.log(`Purchase ID: ${row.purchase_id}, User ID: ${row.user_id}, Engine ID: ${row.engine_id}`);
        console.log(`  Stored Daily Earning: ${row.stored_daily_earning}`);
        console.log(`  Calculated Daily Earning: ${row.calculated_daily_earning}`);
        console.log(`  Difference: ${row.difference}`);
      });
    }
  } catch (error) {
    console.error('Error checking earnings discrepancies:', error);
  }
}

// Run the check if this script is executed directly
if (require.main === module) {
  checkEarningsDiscrepancies().then(() => process.exit());
}

module.exports = {
  checkEarningsDiscrepancies
};
