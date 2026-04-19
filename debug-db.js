const mongoose = require('mongoose');
require('dotenv').config();

async function testConnection() {
  console.log('Testing connection to:', process.env.MONGO_URI.split('@')[1]); // Log without creds
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    console.log('Connection successful!');
    process.exit(0);
  } catch (err) {
    console.error('Connection failed:', err.message);
    if (err.message.includes('alert number 80')) {
      console.error('\nNOTE: SSL alert 80 often means your IP address is not whitelisted in MongoDB Atlas.');
    }
    process.exit(1);
  }
}

testConnection();
