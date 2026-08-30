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
// Shop prices: this is a real shop, not a forced ladder -- a holder can
// buy any item in any order, as long as they can afford it, and once
// bought it's theirs forever (see database/006_shop.sql). Each item has
// its own fixed price, keyed by its own tier number (e.g.
// ITEM_PRICES.weapon[3] is what Trident itself costs, regardless of
// what's currently equipped or already owned). The tier every token
// starts with (weapon/outfit/headwear tier 1, companion tier 0, see
// lib/tiers.js TIER_LIMITS[slot].min) is free -- it's seeded as already
// owned at mint, never actually "bought".
//
// These are still defaults, not fixed numbers -- change freely, nothing
// else needs to change with them. Roughly scaled so higher tiers cost
// more; companion is priced higher per step since each one is a full
// all-or-nothing swap rather than a smooth armor/weapon ladder.
// ---------------------------------------------------------------------

const ITEM_PRICES = {
  weapon: { 1: 0, 2: 150, 3: 300, 4: 500 },
  outfit: { 1: 0, 2: 120, 3: 250, 4: 450, 5: 700 },
  headwear: { 1: 0, 2: 100, 3: 200, 4: 350, 5: 550 },
  companion: { 0: 0, 1: 150, 2: 300, 3: 600 },
};

// ---------------------------------------------------------------------
// Burn reward: points awarded for permanently destroying one Anya on-
// chain (see contracts/LivingAdventurer.sol's burn() and
// api/burn/claim.js). A flat amount per burn, regardless of that
// token's current look -- burning is a supply/resource-sink lever
// ("burn a spare Anya to catch a favorite one up faster"), not a
// refund of whatever happened to be equipped. Roughly worth one mid-
// tier item; again, just a default, change any time.
// ---------------------------------------------------------------------

const BURN_REWARD_POINTS = 400;

module.exports = {
  DAILY_CHECKIN_POINTS,
  WHEEL_STAKE,
  WHEEL_OUTCOMES,
  spinWheel,
  ITEM_PRICES,
  BURN_REWARD_POINTS,
};
