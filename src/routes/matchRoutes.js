const express = require('express');
const router = express.Router();
const {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  deleteMatch,
  publishRoom,
  submitResult,
} = require('../controllers/matchController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { matchSchemas } = require('../validators/schemas');

router.get('/', listMatches);
router.get('/:id', validate({ params: matchSchemas.matchIdParams }), getMatch);

router.post('/', authMiddleware, adminMiddleware, validate({ body: matchSchemas.createMatchBody }), createMatch);
router.patch('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.updateMatchBody }), updateMatch);
router.delete('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams }), deleteMatch);
router.post('/:id/publish-room', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.publishRoomBody }), publishRoom);
router.post('/:id/result', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.submitResultBody }), submitResult);

module.exports = router;
