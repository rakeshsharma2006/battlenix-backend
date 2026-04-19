# BattleNix Backend

## Tech Stack
Node.js, Express, MongoDB, Redis, Socket.IO, Razorpay

## Quick Start
1. Clone repo
2. `npm install`
3. Copy `.env.example` to `.env` and fill values
4. Seed admin: `node src/scripts/seedAdmin.js`
5. Start: `npm run dev`

## API Docs
Visit `http://localhost:3000/docs` after starting server

## Environment Setup
- `PORT`: Server listening port
- `NODE_ENV`: Application environment (development/production)
- `MONGO_URI`: MongoDB connection string
- `REDIS_URL`: Redis connection URL
- `JWT_SECRET`: Secret used to sign JSON Web Tokens
- `RAZORPAY_KEY_ID`: Razorpay API Key ID
- `RAZORPAY_KEY_SECRET`: Razorpay API Key Secret
- `RAZORPAY_WEBHOOK_SECRET`: Secret to verify Razorpay webhook signatures
- `SOCKET_CORS_ORIGIN`: Allowed origins for WebSocket connections

## Socket.IO Events
- `match_updated`, `match_ready`, `match_live`, `match_completed`
- `leaderboard_update`
- `new_message`
- `withdraw_status_update`

## Project Structure
`src/`
├── `controllers/`: Handles inbound HTTP requests
├── `middlewares/`: Express interceptors (auth, error-handling)
├── `models/`: Mongoose schemas
├── `routes/`: Express route definitions
├── `services/`: Business logic and third-party integrations
├── `utils/`: Reusable helpers
└── `scripts/`: Initialization and seeding scripts
