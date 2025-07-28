// Phone number utility functions

/**
 * Formats phone number from 0711111111 to 254711111111 format for M-Pesa
 * @param {string} phone - Phone number in format 0711111111 or 0111111111
 * @returns {string} - Formatted phone number for M-Pesa (254711111111)
 */
const formatPhoneForMpesa = (phone) => {
  if (!phone) return null;
  
  // Remove any spaces, dashes, or other characters
  let cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  
  // If phone starts with 0, replace with 254
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '254' + cleanPhone.substring(1);
  }
  
  // If phone already starts with 254, keep as is
  if (cleanPhone.startsWith('254')) {
    return cleanPhone;
  }
  
  // If phone starts with +254, remove the +
  if (cleanPhone.startsWith('+254')) {
    return cleanPhone.substring(1);
  }
  
  // Log formatted number for debugging
  console.log(`Original phone: ${phone}, formatted: ${cleanPhone}`);
  
  // Validate the final number format (must be 12 digits starting with 254)
  if (!/^254\d{9}$/.test(cleanPhone)) {
    console.warn(`Warning: Phone number ${cleanPhone} may not be in the correct format for M-Pesa`);
  }
  
  return cleanPhone;
};

/**
 * Validates Kenyan phone number format (only accepts 0711111111 or 0111111111 format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid Kenyan phone number
 */
const isValidKenyanPhone = (phone) => {
  if (!phone) return false;
  
  // Remove any spaces, dashes, or other characters
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  
  // Only accept 0711111111 or 0111111111 format (no international formats)
  const patterns = [
    /^07\d{8}$/, // 0712345678 (Safaricom, Airtel)
    /^01\d{8}$/, // 0112345678 (Telkom)
  ];
  
  return patterns.some(pattern => pattern.test(cleanPhone));
};

/**
 * Formats phone number for display (converts to 07xxxxxxxx format)
 * @param {string} phone - Phone number in any format
 * @returns {string} - Formatted phone number for display (0711111111)
 */
const formatPhoneForDisplay = (phone) => {
  if (!phone) return '';
  
  // Remove any spaces, dashes, or other characters
  let cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  
  // If phone starts with +254, convert to 0
  if (cleanPhone.startsWith('+254')) {
    return '0' + cleanPhone.substring(4);
  }
  
  // If phone starts with 254, convert to 0
  if (cleanPhone.startsWith('254')) {
    return '0' + cleanPhone.substring(3);
  }
  
  // If already starts with 0, return as is
  if (cleanPhone.startsWith('0')) {
    return cleanPhone;
  }
  
  return cleanPhone;
};

module.exports = {
  formatPhoneForMpesa,
  isValidKenyanPhone,
  formatPhoneForDisplay
};
