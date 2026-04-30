const mongoose = require('mongoose');
require('dotenv').config();

const addIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 10,
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      retryReads: true,
      tlsAllowInvalidCertificates: process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true',
    });
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // User
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('users').createIndex({ isBanned: 1, isFlagged: 1 });
    console.log('User indexes created');

    // Match
    await db.collection('matches').createIndex({ status: 1, startTime: 1 });
    await db.collection('matches').createIndex({ players: 1 });
    await db.collection('matches').createIndex({ status: 1, game: 1 });
    await db.collection('matches').createIndex({ createdBy: 1 });
    console.log('Match indexes created');

    // Payment
    await db.collection('payments').createIndex({ userId: 1, matchId: 1, status: 1 });
    // Use sparse or ignore if exists error since razorpay_order_id might not be strictly unique if null.
    // Assuming schema handles uniqueness or will throw if duplicates exist.
    await db.collection('payments').createIndex({ razorpay_order_id: 1 }, { unique: true, sparse: true });
    await db.collection('payments').createIndex(
      { createdAt: 1 },
      {
        expireAfterSeconds: 86400,
        partialFilterExpression: { status: 'FAILED' }
      }
    );
    console.log('Payment indexes created');

    // Chat
    await db.collection('chats').createIndex({ matchId: 1, userId: 1 });
    await db.collection('chats').createIndex({ chatType: 1, userId: 1 });
    await db.collection('chats').createIndex({ lastMessageAt: -1 });
    console.log('Chat indexes created');

    // SupportTicket (if exists)
    const collections = await db.listCollections().toArray();
    if (collections.some(c => c.name === 'supporttickets')) {
      await db.collection('supporttickets').createIndex({ status: 1, priority: -1 });
      await db.collection('supporttickets').createIndex({ userId: 1 });
      console.log('SupportTicket indexes created');
    }

    console.log('All indexes added successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error adding indexes:', error);
    process.exit(1);
  }
};

addIndexes();
