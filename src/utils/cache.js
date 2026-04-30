const NodeCache = require('node-cache');

const cache = new NodeCache({
  stdTTL: 60,        // Default 60 seconds
  checkperiod: 120,  // Check expired every 2 min
  useClones: false,  // Better performance
});

cache.deleteByPrefix = (prefix) => {
  const keys = cache.keys().filter((key) => key.startsWith(prefix));
  if (keys.length > 0) {
    cache.del(keys);
  }
};

module.exports = cache;
