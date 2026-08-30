const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { verifyOwnsToken } = require("../lib/verifyOwnership");
const { getOrCreateToken } = require("../lib/tokens");
const { ensureImageCacheRow } = require("../lib/imageCache");
const { UPGRADE_COSTS } = require("../lib/economy");
const {
  TIER_LIMITS,
  WEAPON_NAMES,
  OUTFIT_NAMES,
  HEADWEAR_NAMES,
  COMPANION_NAMES,
} = require("../lib/tiers");

/**
 * GET /api/state?tokenId=123
 * headers: Authorization: Bearer <session token>
 *
 * Everything the dashboard needs to render in one call: points
 * balance, each slot's current look and what the next tier would cost
 * (or null if already maxed), and whether today's check-in/wheel spin
 * have already been used. Read-only -- this never changes anything,
 * it just describes the token's current state for the UI.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let wallet;
  try {
    wallet = requireSession(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  const tokenId = Number(req.query.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  const supabase = getSupabaseAdmin();

  let token;
  try {
    token = await getOrCreateToken(supabase, tokenId);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const owns = await verifyOwnsToken(wallet, tokenId);
  if (!owns) {
    res.status(403).json({ error: "not_owner" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const checkedInToday = token.last_checkin_at === today;
  const spunToday = token.last_spin_date === today;

  // Same cache lookup the metadata API uses, so the dashboard can show
  // the token's actual current portrait instead of just trait names.
  const cacheRow = await ensureImageCacheRow(supabase, {
    weapon_tier: token.weapon_tier,
    outfit_tier: token.outfit_tier,
    headwear_tier: token.headwear_tier,
    companion_tier: token.companion_tier,
  });
  const imageUrl =
    cacheRow && cacheRow.status === "ready" && cacheRow.image_url
      ? cacheRow.image_url
      : process.env.FALLBACK_IMAGE_URL ||
        `${process.env.SITE_URL || ""}/img/tier1-default.png`;

  function slotInfo(slot, namesMap) {
    const currentTier = token[`${slot}_tier`];
    const maxTier = TIER_LIMITS[slot].max;
    const nextTier = currentTier + 1;
    const maxed = nextTier > maxTier;
    return {
      currentTier,
      currentName: namesMap[currentTier] || "Unknown",
      maxed,
      nextTier: maxed ? null : nextTier,
      nextName: maxed ? null : namesMap[nextTier] || "Unknown",
      cost: maxed ? null : (UPGRADE_COSTS[slot] || {})[nextTier] ?? null,
    };
  }

  res.status(200).json({
    tokenId,
    pointsBalance: token.points_balance,
    imageUrl,
    checkedInToday,
    spunToday,
    slots: {
      weapon: slotInfo("weapon", WEAPON_NAMES),
      outfit: slotInfo("outfit", OUTFIT_NAMES),
      headwear: slotInfo("headwear", HEADWEAR_NAMES),
      companion: slotInfo("companion", COMPANION_NAMES),
    },
  });
};
