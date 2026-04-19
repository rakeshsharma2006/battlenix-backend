const GAME_CONFIG = {
  BGMI: {
    maps: {
      Erangel: 100,
      Livik: 52,
    },
  },
  FREE_FIRE: {
    maps: {
      Bermuda: 52,
      Purgatory: 52,
      Kalahari: 52,
    },
  },
};

const MODE_TEAM_SIZE = {
  Solo: 1,
  Duo: 2,
  Squad: 4,
};

const PRIZE_PROFILES = {
  100: {
    20: { playerPrize: 1300, managerCut: 200, totalPool: 2000 },
    30: { playerPrize: 2000, managerCut: 250, totalPool: 3000 },
    50: { playerPrize: 3700, managerCut: 300, totalPool: 5000 },
    100: { playerPrize: 7500, managerCut: 500, totalPool: 10000 },
  },
  52: {
    20: { playerPrize: 540, managerCut: 200, totalPool: 1040 },
    30: { playerPrize: 1000, managerCut: 200, totalPool: 1560 },
    50: { playerPrize: 1800, managerCut: 300, totalPool: 2600 },
    100: { playerPrize: 4000, managerCut: 300, totalPool: 5200 },
  },
};

const VALID_GAMES = Object.keys(GAME_CONFIG);
const VALID_MODES = Object.keys(MODE_TEAM_SIZE);
const VALID_FEES = [20, 30, 50, 100];
const VALID_MAPS = [...new Set(
  VALID_GAMES.flatMap((game) => Object.keys(GAME_CONFIG[game].maps))
)];

const normalizeGame = (game) => (game || 'BGMI').toUpperCase();

const inferGameFromMap = (map) => {
  if (!map) return null;

  const matchingGames = VALID_GAMES.filter((game) => GAME_CONFIG[game].maps[map]);
  if (matchingGames.length === 1) {
    return matchingGames[0];
  }

  return null;
};

const resolveGameAndMap = (game, map) => {
  const normalizedGame = normalizeGame(game);

  if (map && GAME_CONFIG[normalizedGame]?.maps?.[map]) {
    return { game: normalizedGame, map };
  }

  if (!game && map) {
    const inferredGame = inferGameFromMap(map);
    if (inferredGame) {
      return { game: inferredGame, map };
    }
  }

  if (!VALID_GAMES.includes(normalizedGame)) {
    throw new Error(`game must be one of: ${VALID_GAMES.join(', ')}`);
  }

  if (!map) {
    throw new Error('map is required');
  }

  const validMaps = Object.keys(GAME_CONFIG[normalizedGame].maps);
  throw new Error(`map must be one of: ${validMaps.join(', ')} for game ${normalizedGame}`);
};

const getValidMapsForGame = (game) => {
  const normalizedGame = normalizeGame(game);
  if (!GAME_CONFIG[normalizedGame]) {
    throw new Error(`game must be one of: ${VALID_GAMES.join(', ')}`);
  }

  return Object.keys(GAME_CONFIG[normalizedGame].maps);
};

const getNearestPrizeProfileKey = (maxPlayers) => (
  [100, 52].reduce((closest, current) => (
    Math.abs(current - maxPlayers) < Math.abs(closest - maxPlayers) ? current : closest
  ), 100)
);

const calculatePrize = (entryFee, maxPlayers, mode) => {
  const normalizedEntryFee = Number(entryFee);
  const normalizedMaxPlayers = Number(maxPlayers);

  if (!VALID_FEES.includes(normalizedEntryFee)) {
    throw new Error(`entryFee must be one of: ${VALID_FEES.join(', ')}`);
  }

  if (!VALID_MODES.includes(mode)) {
    throw new Error(`mode must be one of: ${VALID_MODES.join(', ')}`);
  }

  if (!Number.isInteger(normalizedMaxPlayers) || normalizedMaxPlayers < 1) {
    throw new Error('maxPlayers must be a positive integer');
  }

  const profileKey = getNearestPrizeProfileKey(normalizedMaxPlayers);
  const profile = PRIZE_PROFILES[profileKey][normalizedEntryFee];
  const totalPool = normalizedEntryFee * normalizedMaxPlayers;
  const scale = totalPool / profile.totalPool;
  const playerPrize = Math.floor(profile.playerPrize * scale);
  const managerCut = Math.floor(profile.managerCut * scale);
  const adminCut = Math.max(0, totalPool - playerPrize - managerCut);
  const teamSize = MODE_TEAM_SIZE[mode];

  return {
    playerPrize,
    managerCut,
    adminCut,
    teamSize,
    prizePerMember: Math.floor(playerPrize / teamSize),
  };
};

const getMaxPlayers = (gameOrMap, maybeMap) => {
  const { game, map } = maybeMap
    ? resolveGameAndMap(gameOrMap, maybeMap)
    : resolveGameAndMap(undefined, gameOrMap);

  return GAME_CONFIG[game].maps[map];
};

const getPrizeBreakdown = (gameOrMap, mapOrMode, modeOrEntryFee, maybeEntryFee) => {
  let resolvedGame;
  let resolvedMap;
  let resolvedMode;
  let resolvedEntryFee;

  if (maybeEntryFee !== undefined) {
    ({ game: resolvedGame, map: resolvedMap } = resolveGameAndMap(gameOrMap, mapOrMode));
    resolvedMode = modeOrEntryFee;
    resolvedEntryFee = maybeEntryFee;
  } else {
    ({ game: resolvedGame, map: resolvedMap } = resolveGameAndMap(undefined, gameOrMap));
    resolvedMode = mapOrMode;
    resolvedEntryFee = modeOrEntryFee;
  }

  return calculatePrize(
    resolvedEntryFee,
    getMaxPlayers(resolvedGame, resolvedMap),
    resolvedMode
  );
};

const getResolvedMatchConfig = ({ game, map, mode, entryFee }) => {
  const resolvedGameAndMap = resolveGameAndMap(game, map);

  if (!VALID_MODES.includes(mode)) {
    throw new Error(`mode must be one of: ${VALID_MODES.join(', ')}`);
  }

  const normalizedEntryFee = Number(entryFee);
  if (!VALID_FEES.includes(normalizedEntryFee)) {
    throw new Error(`entryFee must be one of: ${VALID_FEES.join(', ')}`);
  }

  const maxPlayers = getMaxPlayers(resolvedGameAndMap.game, resolvedGameAndMap.map);

  return {
    game: resolvedGameAndMap.game,
    map: resolvedGameAndMap.map,
    mode,
    entryFee: normalizedEntryFee,
    maxPlayers,
    prizeBreakdown: calculatePrize(normalizedEntryFee, maxPlayers, mode),
  };
};

module.exports = {
  GAME_CONFIG,
  MODE_TEAM_SIZE,
  PRIZE_PROFILES,
  VALID_GAMES,
  VALID_MAPS,
  VALID_MODES,
  VALID_FEES,
  normalizeGame,
  inferGameFromMap,
  resolveGameAndMap,
  getValidMapsForGame,
  calculatePrize,
  getMaxPlayers,
  getPrizeBreakdown,
  getResolvedMatchConfig,
};
