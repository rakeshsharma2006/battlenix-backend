const mongoose = require('mongoose');

const jobLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    ownerId: {
      type: String,
      required: true,
    },
    lockedUntil: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('JobLock', jobLockSchema);
