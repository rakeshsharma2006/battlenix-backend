require('dotenv').config();

const mongoose = require('mongoose');
const Match = require('../models/Match');
const User = require('../models/User');
const WithdrawRequest = require('../models/WithdrawRequest');
const WalletTransaction = require('../models/WalletTransaction');

const WITHDRAW_PENDING_INDEX_NAME = 'userId_1_status_1_pending_unique';
const SLOT_CODE_INDEX_NAME = 'slotCode_1_unique_sparse';
const WITHDRAW_PENDING_INDEX_KEY = { userId: 1, status: 1 };
const SLOT_CODE_INDEX_KEY = { slotCode: 1 };
const SLOT_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const summary = {
  nullSlotCodesUnset: 0,
  duplicatePendingWithdraws: [],
  duplicateSlotCodes: [],
  resolvedWithdrawRequests: [],
  regeneratedSlotCodes: [],
  indexesDropped: [],
  indexesCreated: [],
  indexesKept: [],
  anomalies: [],
};

const stableStringify = (value) => JSON.stringify(value);

const hasSameKeyPattern = (index, expectedKey) => (
  stableStringify(index.key) === stableStringify(expectedKey)
);

const isDesiredWithdrawPendingIndex = (index) => (
  hasSameKeyPattern(index, WITHDRAW_PENDING_INDEX_KEY) &&
  index.unique === true &&
  stableStringify(index.partialFilterExpression || {}) === stableStringify({ status: 'PENDING' })
);

const isDesiredSlotCodeIndex = (index) => (
  hasSameKeyPattern(index, SLOT_CODE_INDEX_KEY) &&
  index.unique === true &&
  index.sparse === true
);

const generateSlotCode = () => {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += SLOT_CODE_CHARS[Math.floor(Math.random() * SLOT_CODE_CHARS.length)];
  }
  return code;
};

const fetchDuplicatePendingWithdraws = async () => WithdrawRequest.aggregate([
  { $match: { status: 'PENDING' } },
  {
    $group: {
      _id: '$userId',
      count: { $sum: 1 },
      requestIds: { $push: '$_id' },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1, _id: 1 } },
]);

const fetchDuplicateSlotCodes = async () => Match.aggregate([
  {
    $match: {
      slotCode: { $exists: true, $ne: null },
    },
  },
  {
    $group: {
      _id: '$slotCode',
      count: { $sum: 1 },
      matchIds: { $push: '$_id' },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1, _id: 1 } },
]);

const unsetNullSlotCodes = async () => {
  const result = await Match.updateMany(
    { slotCode: { $type: 10 } },
    { $unset: { slotCode: '' } }
  );

  summary.nullSlotCodesUnset = result.modifiedCount || 0;
};

const reserveUniqueSlotCode = async (reservedCodes) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slotCode = generateSlotCode();
    if (reservedCodes.has(slotCode)) {
      continue;
    }

    const existing = await Match.exists({ slotCode });
    if (!existing) {
      reservedCodes.add(slotCode);
      return slotCode;
    }
  }

  throw new Error('Could not generate a unique slotCode during migration');
};

const resolveDuplicatePendingWithdraws = async () => {
  const duplicateGroups = await fetchDuplicatePendingWithdraws();

  for (const group of duplicateGroups) {
    const requests = await WithdrawRequest.find({
      userId: group._id,
      status: 'PENDING',
    })
      .sort({ createdAt: 1, _id: 1 })
      .select('_id userId amount createdAt status')
      .lean();

    if (requests.length <= 1) {
      continue;
    }

    summary.duplicatePendingWithdraws.push({
      userId: String(group._id),
      requestIds: requests.map((request) => String(request._id)),
      keptRequestId: String(requests[0]._id),
    });

    const duplicateRequests = requests.slice(1);

    for (const duplicateRequest of duplicateRequests) {
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          const request = await WithdrawRequest.findOne({
            _id: duplicateRequest._id,
            status: 'PENDING',
          }).session(session);

          if (!request) {
            return;
          }

          const user = await User.findById(request.userId)
            .select('winningBalance lockedBalance')
            .session(session);

          if (!user) {
            throw new Error(`User not found for withdraw request ${request._id}`);
          }

          // Refuse to "clean up" a duplicate pending withdraw if escrow no longer matches.
          // That indicates pre-existing money drift and the index rollout should stop.
          if (Number(user.lockedBalance) < Number(request.amount)) {
            throw new Error(
              `Locked balance mismatch for user ${user._id}: locked=${user.lockedBalance}, request=${request.amount}`
            );
          }

          const winningBalanceBefore = Number(user.winningBalance) || 0;
          const lockedBalanceBefore = Number(user.lockedBalance) || 0;
          const now = new Date();

          user.winningBalance = winningBalanceBefore + Number(request.amount);
          user.lockedBalance = lockedBalanceBefore - Number(request.amount);
          await user.save({ session });

          request.status = 'REJECTED';
          request.processedAt = now;
          request.adminNote = 'Resolved duplicate pending withdrawal during database safety migration';
          await request.save({ session });

          await WalletTransaction.create([{
            userId: request.userId,
            type: 'WITHDRAW_REFUND',
            amount: Number(request.amount),
            balanceBefore: winningBalanceBefore,
            balanceAfter: user.winningBalance,
            description: 'Migration cleanup: duplicate pending withdrawal released from escrow',
            withdrawRequestId: request._id,
            createdAt: now,
          }], { session });
        });

        summary.resolvedWithdrawRequests.push({
          requestId: String(duplicateRequest._id),
          action: 'REJECTED_AND_REFUNDED_TO_WINNING_BALANCE',
        });
      } catch (error) {
        summary.anomalies.push({
          type: 'duplicate_pending_withdraw',
          requestId: String(duplicateRequest._id),
          userId: String(duplicateRequest.userId),
          message: error.message,
        });
      } finally {
        await session.endSession();
      }
    }
  }
};

const resolveDuplicateSlotCodes = async () => {
  const duplicateGroups = await fetchDuplicateSlotCodes();
  const reservedCodes = new Set();

  for (const group of duplicateGroups) {
    const matches = await Match.find({ slotCode: group._id })
      .sort({ createdAt: 1, _id: 1 })
      .select('_id slotCode createdAt')
      .lean();

    if (matches.length <= 1) {
      continue;
    }

    summary.duplicateSlotCodes.push({
      slotCode: group._id,
      matchIds: matches.map((match) => String(match._id)),
      keptMatchId: String(matches[0]._id),
    });

    for (const duplicateMatch of matches.slice(1)) {
      const nextSlotCode = await reserveUniqueSlotCode(reservedCodes);
      const updatedMatch = await Match.findOneAndUpdate(
        {
          _id: duplicateMatch._id,
          slotCode: group._id,
        },
        {
          $set: { slotCode: nextSlotCode },
        },
        { new: true }
      ).select('_id slotCode');

      if (!updatedMatch) {
        continue;
      }

      summary.regeneratedSlotCodes.push({
        matchId: String(updatedMatch._id),
        oldSlotCode: group._id,
        newSlotCode: updatedMatch.slotCode,
      });
    }
  }
};

const dropConflictingIndexes = async ({ collection, desiredKey, isDesiredIndex }) => {
  const indexes = await collection.indexes();
  let keptDesiredIndex = false;

  for (const index of indexes) {
    if (index.name === '_id_' || !hasSameKeyPattern(index, desiredKey)) {
      continue;
    }

    if (isDesiredIndex(index) && !keptDesiredIndex) {
      keptDesiredIndex = true;
      summary.indexesKept.push(index.name);
      continue;
    }

    await collection.dropIndex(index.name);
    summary.indexesDropped.push(index.name);
  }

  return keptDesiredIndex;
};

const ensureWithdrawPendingIndex = async () => {
  const collection = WithdrawRequest.collection;
  const hasDesiredIndex = await dropConflictingIndexes({
    collection,
    desiredKey: WITHDRAW_PENDING_INDEX_KEY,
    isDesiredIndex: isDesiredWithdrawPendingIndex,
  });

  if (hasDesiredIndex) {
    return;
  }

  const createdName = await collection.createIndex(
    WITHDRAW_PENDING_INDEX_KEY,
    {
      name: WITHDRAW_PENDING_INDEX_NAME,
      unique: true,
      partialFilterExpression: { status: 'PENDING' },
    }
  );

  summary.indexesCreated.push(createdName);
};

const ensureSlotCodeIndex = async () => {
  const collection = Match.collection;
  const hasDesiredIndex = await dropConflictingIndexes({
    collection,
    desiredKey: SLOT_CODE_INDEX_KEY,
    isDesiredIndex: isDesiredSlotCodeIndex,
  });

  if (hasDesiredIndex) {
    return;
  }

  const createdName = await collection.createIndex(
    SLOT_CODE_INDEX_KEY,
    {
      name: SLOT_CODE_INDEX_NAME,
      unique: true,
      sparse: true,
    }
  );

  summary.indexesCreated.push(createdName);
};

const verifyIndexPresent = async ({ collection, indexName }) => {
  const indexes = await collection.indexes();
  return indexes.some((index) => index.name === indexName);
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGO_URI);

  console.log('Connected to MongoDB');

  await resolveDuplicatePendingWithdraws();
  await unsetNullSlotCodes();
  await resolveDuplicateSlotCodes();

  // Never create uniqueness indexes on top of unresolved money anomalies.
  if (summary.anomalies.length > 0) {
    throw new Error('Aborting index creation because unresolved migration anomalies were detected');
  }

  await ensureWithdrawPendingIndex();
  await ensureSlotCodeIndex();

  const hasPendingWithdrawIndex = await verifyIndexPresent({
    collection: WithdrawRequest.collection,
    indexName: WITHDRAW_PENDING_INDEX_NAME,
  });
  const hasSlotCodeIndex = await verifyIndexPresent({
    collection: Match.collection,
    indexName: SLOT_CODE_INDEX_NAME,
  });

  if (!hasPendingWithdrawIndex || !hasSlotCodeIndex) {
    throw new Error('Index verification failed after migration');
  }

  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error(error.message);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
