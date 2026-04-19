const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, {
  tlsAllowInvalidCertificates: true
}).then(async () => {
  const User = require('./src/models/User');
  const result = await User.deleteMany({
    email: { $ne: 'admin@battlenix.com' },
    role: 'admin'
  });
  console.log('Deleted:', result.deletedCount, 'fake admins');
  process.exit(0);
});