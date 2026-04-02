const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { authLimiter } = require('../middlewares/rateLimiters');
const { authSchemas } = require('../validators/schemas');

router.post('/register', authLimiter, validate({ body: authSchemas.registerBody }), register);
router.post('/login', authLimiter, validate({ body: authSchemas.loginBody }), login);
router.get('/me', authMiddleware, getMe);

module.exports = router;
