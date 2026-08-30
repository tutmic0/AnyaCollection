const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { verifyOwnsToken } = require("../lib/verifyOwnership");
const { getOrCreateToken } = require("../lib/tokens");
const { ensureImageCacheRow } = require("../lib/imageCache");
const { UPGRADE_COSTS } = require("../lib/economy");
const { TIER_LIMITS } = require("../lib/tiers");

/**
 * POST /api/upgrade
 * headers: Authorization: Bearer <session token>
 * body: { tokenId, slot }  -- slot is one of "weapon" | "outfit" |
 *                              "headwear" | "companion"
 *
 * Spends points to move exactly one slot forward by one tier. This is
 * the only endpoint allowed to change a token's tier columns -- check-
 * in and the wheel only ever touch points_balance. Cost and the max
 * tier for the slot both come from our own trusted config
 * (lib/economy.js, lib/tiers.js), never from the request body, so
 * there's no way to buy a cheaper upgrade by sending a different cost.
 *
 * After a successful upgrade, this also registers the token's new
 * (possibly never-before-reached) tier combination in image_cache if
 * it isn't there yet, so you have a live, growing list of exactly
 * which combinations still need art generated -- see
 * database/image_cache and lib/imageCache.js.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
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

  const { tokenId: tokenIdRaw, slot } = req.body || {};
  const tokenId = Number(tokenIdRaw);

  if (!Number.isInteger(tokenId) || tokenId < 1) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }
  if (!TIER_LIMITS[slot]) {
    res.status(400).json({ error: "invalid_slot" });
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

  const currentTier = token[`${slot}_tier`];
  const nextTier = currentTier + 1;
  const maxTier = TIER_LIMITS[slot].max;

  if (nextTier > maxTier) {
    res.status(400).json({ error: "max_tier_reached" });
    return;
  }

  const cost = UPGRADE_COSTS[slot] && UPGRADE_COSTS[slot][nextTier];
  if (cost === undefined) {
    // Config drift between lib/economy.js and lib/tiers.js -- should
    // never happen if both are kept in sync, but fail loudly rather
    // than charging an undefined amount.
    res.status(500).json({ error: "missing_cost_config" });
    return;
  }

  const { data, error } = await supabase.rpc("perform_upgrade", {
    p_token_id: tokenId,
    p_slot: slot,
    p_max_tier: maxTier,
    p_cost: cost,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("max_tier_reached")) {
      res.status(400).json({ error: "max_tier_reached" });
      return;
    }
    if (message.includes("insufficient_points")) {
      res.status(400).json({ error: "insufficient_points", required: cost });
      return;
    }
    if (message.includes("token_not_found")) {
      res.status(404).json({ error: "not_minted" });
      return;
    }
    if (message.includes("invalid_slot")) {
      res.status(400).json({ error: "invalid_slot" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  // Build the full new combination (three unchanged slots + the one
  // that just moved) so we can register it in image_cache.
  const newCombo = {
    weapon_tier: slot === "weapon" ? data.newTier : token.weapon_tier,
    outfit_tier: slot === "outfit" ? data.newTier : token.outfit_tier,
    headwear_tier: slot === "headwear" ? data.newTier : token.headwear_tier,
    companion_tier: slot === "companion" ? data.newTier : token.companion_tier,
  };

  const cacheRow = await ensureImageCacheRow(supabase, newCombo);

  res.status(200).json({
    slot,
    newTier: data.newTier,
    cost,
    balance: data.balance,
    imageStatus: cacheRow.status, // "ready" or "pending" -- let the UI show "art coming soon" if pending
  });
};
