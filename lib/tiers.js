// Single source of truth for the tier ladder. Every backend endpoint
// (metadata API, upgrade/shop, dashboard data) imports from here instead
// of redefining these maps -- if a tier is ever renamed or a new tier
// added, this is the only file that needs to change (plus the matching
// `check` constraint in database/schema.sql).

const TIER_LIMITS = {
  weapon: { min: 1, max: 4 },
  outfit: { min: 1, max: 5 },
  headwear: { min: 1, max: 5 },
  companion: { min: 0, max: 3 },
};

const WEAPON_NAMES = {
  1: "Ranger Axe",
  2: "Red-Eye Axe",
  3: "Trident",
  4: "Runic Axe",
};

const OUTFIT_NAMES = {
  1: "Explorer",
  2: "Ranger",
  3: "Scale Armor",
  4: "Griffin Knight",
  5: "Ornate",
};

const HEADWEAR_NAMES = {
  1: "Bandana",
  2: "Skull Bandana",
  3: "Orc Mask",
  4: "Tribal Ram Band",
  5: "Full Ram Horns",
};

const COMPANION_NAMES = {
  0: "None",
  1: "Cat",
  2: "Dog",
  3: "Lion",
};

module.exports = {
  TIER_LIMITS,
  WEAPON_NAMES,
  OUTFIT_NAMES,
  HEADWEAR_NAMES,
  COMPANION_NAMES,
};
