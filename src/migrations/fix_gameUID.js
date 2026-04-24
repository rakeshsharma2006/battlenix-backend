const mongoose = require('mongoose');
require('dotenv').config();

const runMigration = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/battlenix';
    console.log(`Connecting to ${mongoUri}...`);
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const db = mongoose.connection.db;
    const result = await db.collection('users').updateMany(
      { gameUid: { $exists: true, $ne: null } },
      [
        { $set: { gameUID: '$gameUid' } },
        { $unset: 'gameUid' }
      ]
    );

    console.log('Migration completed successfully.');
    console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

runMigration();
