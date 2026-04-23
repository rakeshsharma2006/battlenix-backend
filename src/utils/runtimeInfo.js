const packageJson = require('../../package.json');

const STARTED_AT = new Date();
const LEGACY_READY_GUARD_MESSAGE = 'Need at least 2 players to start match';

const getDeploymentProvider = () => {
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return 'render';
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return 'railway';
  if (process.env.VERCEL || process.env.VERCEL_ENV) return 'vercel';
  return 'unknown';
};

const getCommitSha = () => (
  process.env.RENDER_GIT_COMMIT
  || process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.GIT_COMMIT
  || process.env.COMMIT_SHA
  || null
);

const getServiceInstance = () => (
  process.env.RENDER_SERVICE_NAME
  || process.env.RAILWAY_SERVICE_NAME
  || process.env.VERCEL_URL
  || null
);

const getRuntimeInfo = () => ({
  service: packageJson.name || 'battlenix-backend',
  version: packageJson.version || null,
  environment: process.env.NODE_ENV || 'development',
  startedAt: STARTED_AT.toISOString(),
  uptimeSeconds: Math.floor(process.uptime()),
  gitCommitSha: getCommitSha(),
  deployment: {
    provider: getDeploymentProvider(),
    instance: getServiceInstance(),
  },
});

const getAdminDiagnostics = () => ({
  runtime: getRuntimeInfo(),
  matchStatus: {
    readyStatusRequiresMinimumPlayers: false,
    legacyReadyGuardMessage: LEGACY_READY_GUARD_MESSAGE,
  },
  issues: [
    {
      code: 'STALE_BACKEND_DEPLOYMENT',
      severity: 'warning',
      title: 'Old backend deployment detected if READY still returns the legacy 2-player guard',
      detectWhen: {
        endpoint: 'PATCH /matches/:id/status',
        requestBody: { status: 'READY' },
        responseMessage: LEGACY_READY_GUARD_MESSAGE,
      },
      explanation: 'This codebase no longer blocks READY when a match has fewer than 2 players. If production still returns the legacy message, the deployed backend is stale.',
      action: 'Redeploy or restart the production backend service so the current src/controllers/matchController.js is running.',
    },
  ],
});

module.exports = {
  getRuntimeInfo,
  getAdminDiagnostics,
};
