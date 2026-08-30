const crypto = require("crypto");

// ---------------------------------------------------------------------
// Default economy numbers. You didn't give me exact figures, so these
// are reasonable starting defaults, not something carved in stone --
// change them any time, nothing else in the codebase needs to change
// with them (the SQL functions in database/003_checkin_wheel.sql take
// the point values as parameters rather than hardcoding them).
// ---------------------------------------------------------------------

const DAILY_CHECKIN_POINTS = 10;

const WHEEL_STAKE = 20; // points staked per spin, once per UTC day

// Weights are in basis points out of 10,000 for precision (must sum to
// 10000). Expected value per spin: 0.50*(-20) + 0.30*(0) + 0.15*(+20) +
// 0.05*(+80) = -3 points on average -- a small house edge, like a real
// wheel, so the points economy doesn't inflate just from spinning.
const WHEEL_OUTCOMES = [
  { label: "lose", multiplier: 0, weight: 5000 }, // 50%: lose the stake
  { label: "push", multiplier: 1, weight: 3000 }, // 30%: stake back, no change
  { label: "win_2x", multiplier: 2, weight: 1500 }, // 15%: double the stake
  { label: "win_5x", multiplier: 5, weight: 500 }, // 5%: jackpot, 5x the stake
];

const TOTAL_WEIGHT = WHEEL_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
if (TOTAL_WEIGHT !== 10000) {
  throw new Error(
    `WHEEL_OUTCOMES weights must sum to 10000, got ${TOTAL_WEIGHT}`
  );
}

/// Cryptographically-secure pick (never Math.random() for anything
/// stake-related) of which wheel segment this spin lands on.
function spinWheel() {
  const roll = crypto.randomInt(0, 10000);
  let cumulative = 0;
  for (const outcome of WHEEL_OUTCOMES) {
    cumulative += outcome.weight;
    if (roll < cumulative) {
      return outcome;
    }
  }
  // Unreachable if weights sum to 10000, but fall back safely.
  return WHEEL_OUTCOMES[WHEEL_OUTCOMES.length - 1];
}

// ---------------------------------------------------------------------
// Upgrade costs: how many points it costs to move a slot from its
// current tier to the next one, keyed by the tier being BOUGHT (e.g.
// UPGRADE_COSTS.weapon[2] is the cost to go from tier 1 to tier 2).
// These are also defaults, not fixed numbers -- roughly scaled so
// higher tiers cost more and outfit/headwear (5 tiers) cost a bit less
// per step than weapon (4 tiers) to land in a similar total range.
// Companion is priced higher per step since it's a single all-or-
// nothing swap rather than a smooth ladder.
// ---------------------------------------------------------------------

const UPGRADE_COSTS = {
  weapon: { 2: 50, 3: 100, 4: 200 },
  outfit: { 2: 40, 3: 80, 4: 150, 5: 300 },
  headwear: { 2: 30, 3: 60, 4: 120, 5: 250 },
  companion: { 1: 50, 2: 150, 3: 400 },
};

module.exports = {
  DAILY_CHECKIN_POINTS,
  WHEEL_STAKE,
  WHEEL_OUTCOMES,
  spinWheel,
  UPGRADE_COSTS,
};
