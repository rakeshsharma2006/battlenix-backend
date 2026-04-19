const DEFAULT_MANAGER_WITHDRAW_LIMIT = Number(process.env.MANAGER_WITHDRAW_APPROVAL_LIMIT || 0);

const ROLE_PERMISSIONS = {
  admin: new Set(['*']),
  manager: new Set([
    'users.read',
    'payments.read',
    'refunds.read',
    'matches.read',
    'matches.manage',
    'matches.status',
    'slots.manage',
    'flags.read',
    'flags.review',
    'withdraw.read',
    'withdraw.approve',
    'withdraw.reject',
    'withdraw.mark_paid',
  ]),
};

const hasPermission = (user, permission) => {
  if (!user?.role) return false;
  const permissions = ROLE_PERMISSIONS[user.role] || new Set();
  return permissions.has('*') || permissions.has(permission);
};

const canBanUsers = (user) => user?.role === 'admin';

const getWithdrawApprovalLimit = (user) => {
  if (user?.role === 'admin') {
    return Number.POSITIVE_INFINITY;
  }

  if (user?.role === 'manager') {
    return DEFAULT_MANAGER_WITHDRAW_LIMIT > 0
      ? DEFAULT_MANAGER_WITHDRAW_LIMIT
      : Number.POSITIVE_INFINITY;
  }

  return 0;
};

const canApproveWithdrawAmount = (user, amount) => Number(amount) <= getWithdrawApprovalLimit(user);

module.exports = {
  ROLE_PERMISSIONS,
  hasPermission,
  canBanUsers,
  getWithdrawApprovalLimit,
  canApproveWithdrawAmount,
};
