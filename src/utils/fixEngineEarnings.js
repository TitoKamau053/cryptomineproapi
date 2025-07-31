const pool = require('../db');

/**
 * Script to update miscalculated daily_earning values in purchases
 * based on the correct calculation: invested amount * engine daily earning rate
 */
async function fixMiscalculatedEarnings() {
  try {
    // Select purchases with discrepancies
    const [discrepancies] = await pool.query(`
      SELECT 
        p.id AS purchase_id,
        p.daily_earning AS stored_daily_earning,
        ROUND(p.amount_invested * (me.daily_earning_rate / 100), 2) AS correct_daily_earning
      FROM purchases p
      JOIN mining_engines me ON p.engine_id = me.id
      WHERE p.status = 'active'
        AND ABS(p.daily_earning - ROUND(p.amount_invested * (me.daily_earning_rate / 100), 2)) > 0.01
    `);

    if (discrepancies.length === 0) {
      console.log('No miscalculated earnings found.');
      return;
    }

    console.log(`Found ${discrepancies.length} purchases with miscalculated earnings. Updating...`);

    for (const purchase of discrepancies) {
      await pool.query(
        'UPDATE purchases SET daily_earning = ? WHERE id = ?',
        [purchase.correct_daily_earning, purchase.purchase_id]
      );
      console.log(`Updated purchase ID ${purchase.purchase_id}: daily_earning set to ${purchase.correct_daily_earning}`);
    }

    console.log('All miscalculated earnings have been updated.');
  } catch (error) {
    console.error('Error updating miscalculated earnings:', error);
  }
}

// Run the fix if this script is executed directly
if (require.main === module) {
  fixMiscalculatedEarnings().then(() => process.exit());
}

module.exports = {
  fixMiscalculatedEarnings
};
