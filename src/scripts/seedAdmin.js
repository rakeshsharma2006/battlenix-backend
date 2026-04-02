require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const ADMIN_EMAIL = 'admin@battlenix.com';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      console.log('Admin already exists. Skipping.');
      process.exit(0);
    }

    const admin = await User.create({
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
    });

    console.log(`Admin created: ${admin.email} (role: ${admin.role})`);
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error.message);
    process.exit(1);
  }
};

seedAdmin();
