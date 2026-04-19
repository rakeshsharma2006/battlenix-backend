const express = require('express');
const router = express.Router();
const {
  sendMatchMessage,
  getMatchChatHistory,
  sendMessage,
  getChat,
  getMatchChats,
  sendDirectMessage,
  getDirectChatHistory,
  sendSupportMessage,
  getSupportChatHistory,
} = require('../controllers/chatController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const checkBan = require('../middlewares/checkBan');
const validate = require('../middlewares/validationMiddleware');
const { chatSchemas } = require('../validators/schemas');

// Send a message (user or admin)
router.post(
  '/send',
  authMiddleware,
  checkBan,
  validate({ body: chatSchemas.sendMessageBody }),
  sendMessage
);

router.post(
  '/support',
  authMiddleware,
  checkBan,
  sendSupportMessage
);

router.get(
  '/support',
  authMiddleware,
  getSupportChatHistory
);

router.post(
  '/direct/:userId',
  authMiddleware,
  checkBan,
  sendDirectMessage
);

router.get(
  '/direct/:userId',
  authMiddleware,
  getDirectChatHistory
);

// Admin: get all chat threads for a match
router.get(
  '/:matchId/threads',
  authMiddleware,
  adminMiddleware,
  validate({ params: chatSchemas.matchIdParams }),
  getMatchChats
);

// User or admin: get specific chat thread
router.get(
  '/:matchId/user/:userId',
  authMiddleware,
  validate({ params: chatSchemas.chatParams }),
  getChat
);

router.post(
  '/:matchId',
  authMiddleware,
  checkBan,
  validate({
    params: chatSchemas.matchIdParams,
    body: chatSchemas.matchMessageBody,
  }),
  sendMatchMessage
);

router.get(
  '/:matchId',
  authMiddleware,
  validate({ params: chatSchemas.matchIdParams }),
  getMatchChatHistory
);

module.exports = router;
