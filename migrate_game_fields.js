const mongoose = require('mongoose');
require('dotenv').config();

const migrate = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

    console.log('Migrating existing profiles to BGMI fields...');

    // Find all users who have gameUID but NO bgmiUID
    const users = await User.find({
      gameUID: { $exists: true, $ne: null },
      bgmiUID: { $exists: false }
    });

    console.log(`Found ${users.length} users to migrate.`);

    let migratedCount = 0;
    for (const user of users) {
      const updates = {};
      
      if (user.gameUID) updates.bgmiUID = user.gameUID;
      if (user.gameName) updates.bgmiName = user.gameName;
      if (user.upiId) updates.bgmiUpiId = user.upiId;

      if (Object.keys(updates).length > 0) {
        await User.updateOne({ _id: user._id }, { $set: updates });
        migratedCount++;
      }
    }

    console.log(`Migration completed. ${migratedCount} users updated.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrate();
