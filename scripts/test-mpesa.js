require('dotenv').config();
const mpesa = require('../src/utils/mpesa');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testMpesaConfig() {
  console.log('======= M-PESA CONFIGURATION TEST =======');
  
  // Check environment variables
  console.log('\n== Environment Variables ==');
  console.log('MPESA_CONSUMER_KEY:', process.env.MPESA_CONSUMER_KEY ? '***set***' : 'MISSING');
  console.log('MPESA_CONSUMER_SECRET:', process.env.MPESA_CONSUMER_SECRET ? '***set***' : 'MISSING');
  console.log('MPESA_SHORTCODE:', process.env.MPESA_SHORTCODE || 'MISSING');
  console.log('MPESA_PASSKEY:', process.env.MPESA_PASSKEY ? '***set***' : 'MISSING');
  console.log('MPESA_ENV:', process.env.MPESA_ENV || 'MISSING');
  console.log('MPESA_STK_CALLBACK_URL:', process.env.MPESA_STK_CALLBACK_URL || 'MISSING');
  console.log('MPESA_INITIATOR_NAME:', process.env.MPESA_INITIATOR_NAME || 'MISSING');

  // Check if callback URL looks valid
  if (process.env.MPESA_STK_CALLBACK_URL) {
    if (process.env.MPESA_STK_CALLBACK_URL.includes('ngrok') && 
        process.env.MPESA_STK_CALLBACK_URL.includes('.io')) {
      console.log('\n⚠️ WARNING: Your callback URL appears to use an ngrok tunnel.');
      console.log('    These URLs expire and need to be updated when you restart ngrok.');
    }
    
    if (!process.env.MPESA_STK_CALLBACK_URL.startsWith('https://')) {
      console.log('\n⚠️ WARNING: Your callback URL should use HTTPS.');
    }
  }

  // Test getting access token
  try {
    console.log('\n== Testing M-Pesa Access Token ==');
    const accessToken = await mpesa.getAccessToken();
    console.log('✅ Successfully retrieved access token');
  } catch (error) {
    console.error('❌ Failed to get access token:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    return;
  }
}

async function testStkPush() {
  // Prompt for phone number
  rl.question('\n== Test STK Push ==\nEnter phone number to test (e.g., 0712345678): ', async (phoneNumber) => {
    try {
      console.log(`\nTesting STK Push to ${phoneNumber}...`);
      
      // Use minimal amount for testing
      const amount = 1; // 1 KES
      const accountReference = `TEST_${Date.now()}`;
      const transactionDesc = 'API Test';
      
      const result = await mpesa.stkPush(
        phoneNumber, 
        amount, 
        accountReference, 
        transactionDesc
      );
      
      console.log('\n✅ STK Push initiated successfully!');
      console.log(JSON.stringify(result, null, 2));
      
      console.log('\n🔍 Check your phone for the STK push prompt.');
      console.log('   If you received the prompt, the basic STK Push flow is working.');
      console.log('   If no prompt appeared, check:');
      console.log('   1. Is the phone number correct and registered for M-Pesa?');
      console.log('   2. Are all M-Pesa credentials correct?');
      console.log('   3. Is the M-Pesa shortcode properly set up for STK Push?');
      
      console.log('\n📝 Note: Even if the STK Push works, the callback might not.');
      console.log('   For callbacks to work correctly, your MPESA_STK_CALLBACK_URL must be:');
      console.log('   1. Publicly accessible (not localhost)');
      console.log('   2. Using HTTPS');
      console.log('   3. Currently valid (if using ngrok, tunnels expire when restarted)');
      
    } catch (error) {
      console.error('\n❌ STK Push failed:', error.message);
      if (error.response) {
        console.error('API Response:', JSON.stringify(error.response.data, null, 2));
      }
    } finally {
      rl.close();
    }
  });
}

async function main() {
  await testMpesaConfig();
  await testStkPush();
}

main();
