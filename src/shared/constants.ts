export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const MAX_LEVEL = 15;
export const TEAM_NAMES = ['Dawnguard', 'Duskborn'] as const;
export const TEAM_COLORS = ['#3d8bfd', '#e5484d'] as const;
export const MAX_PLAYERS_PER_TEAM = 5;

/** Cumulative XP needed to reach level index+1. */
export const XP_TABLE = [0, 280, 660, 1140, 1720, 2400, 3180, 4060, 5040, 6120, 7300, 8580, 9960, 11440, 13020];

export const ECON = {
  startGold: 600,
  passiveGoldPerSec: 3,
  heroKill: 300,
  assist: 150,
  streakBonus: 60, // per kill of the victim's current streak above 1, capped
  streakCap: 5,
  bannerCapture: 250,
  bannerHeldPerSec: 1, // per enemy banner currently held, per member
  towerDestroy: 150,
  bossKill: 300,
  sellRatio: 0.6,
};

export const XP = {
  shareRadius: 18,
  heroKillBase: 180,
  heroKillPerLevel: 30,
};

export const SIGHT = { hero: 15, heroNight: 10, minion: 9, tower: 14, fortress: 18, banner: 9, summon: 8, stealthReveal: 2.6 };

export const TIMING = {
  firstWave: 15,
  waveInterval: 30,
  dayLength: 240,
  nightLength: 120,
  bossFirstSpawn: 300,
  bossRespawn: 240,
  campRespawn: 75,
  recallTime: 4,
  bannerCaptureTime: 6,
  shopRadius: 16, // from your fountain
  fountainRadius: 12,
};

export const COMBAT = {
  critMultiplier: 1.75,
  meleeWindup: 0.28, // fraction of the attack period before the hit lands
  towerHeroRamp: 0.25, // +25% per consecutive tower shot on the same hero
  fortressDamageMult: [1.0, 0.6, 0.35, 0], // index = banners still held by the fortress owner
  respawnBase: 6,
  respawnPerLevel: 2.2,
};
