const bcrypt = require('bcrypt');

const password = 'Crypto%$Admin@2025';
const saltRounds = 12;

bcrypt.hash(password, saltRounds, function(err, hash) {
  if (err) throw err;
  console.log('Hashed password:', hash);
});