const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireSession } = require("../../lib/session");
const { verifyOwnsToken } = require("../../lib/verifyOwnership");
const { getOrCreateToken } = require("../../lib/tokens");
const { getWalletTokenIds } = require("../../lib/holdings");
const { ensureImageCacheRow } = require("../../lib/imageCache");
const { TIER_LIMITS } = require("../../lib/tiers");

/**
 * POST /api/shop/equip
 * headers: Authorization: Bearer <session token>
 * body: { tokenId, slot, tier }
 *
 * Switches which item ONE SPECIFIC Anya currently shows for one slot.
 * Free -- no points move, this only flips that token's <slot>_tier.
 * Ownership is checked against the calling wallet's shared closet (see
 * database/007_wallet_economy.sql): any item that wallet has ever
 * bought, on ANY of its tokens, can be equipped on THIS token too.
 * Fails with "not_owned" if the wallet hasn't bought that item (or it
 * isn't the free starting item).
 *
 * EXCLUSIVITY: a bought item is one physical thing, not an unlimited
 * license -- if it's already equipped on a DIFFERENT Anya this same
 * wallet holds, it can't also be put on this one at the same time.
 * Free it up by equipping something else on that other token first
 * (see lib/holdings.js for how "this wallet's other tokens" is
 * determined -- straight from the chain, not our own cache). The free
 * starting item (tier[slot].min) is exempt -- every Anya starts with
 * it by default, it isn't a scarce purchased item.
 *
 * After a successful equip, registers this token's new combination in
 * image_cache if it's never been reached before, same as the metadata
 * API does.
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

  const { tokenId: tokenIdRaw, slot, tier: tierRaw } = req.body || {};
  const tokenId = Number(tokenIdRaw);
  const tier = Number(tierRaw);

  if (!Number.isInteger(tokenId) || tokenId < 1) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }
  if (!TIER_LIMITS[slot]) {
    res.status(400).json({ error: "invalid_slot" });
    return;
  }
  if (!Number.isInteger(tier) || tier < TIER_LIMITS[slot].min || tier > TIER_LIMITS[slot].max) {
    res.status(400).json({ error: "invalid_tier" });
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

  if (tier !== TIER_LIMITS[slot].min) {
    let heldTokenIds;
    try {
      heldTokenIds = await getWalletTokenIds(wallet);
    } catch (err) {
      res.status(502).json({ error: "chain_lookup_failed" });
      return;
    }

    const otherIds = heldTokenIds.filter((id) => id !== tokenId);
    if (otherIds.length > 0) {
      const column = `${slot}_tier`;
      const { data: conflicting } = await supabase
        .from("tokens")
        .select("token_id")
        .in("token_id", otherIds)
        .eq(column, tier)
        .limit(1);

      if (conflicting && conflicting.length > 0) {
        res.status(409).json({
          error: "item_in_use",
          equippedOnTokenId: conflicting[0].token_id,
        });
        return;
      }
    }
  }

  const { error } = await supabase.rpc("perform_equip", {
    p_wallet: wallet,
    p_token_id: tokenId,
    p_slot: slot,
    p_tier: tier,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("not_owned")) {
      res.status(400).json({ error: "not_owned" });
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

  const newCombo = {
    weapon_tier: slot === "weapon" ? tier : token.weapon_tier,
    outfit_tier: slot === "outfit" ? tier : token.outfit_tier,
    headwear_tier: slot === "headwear" ? tier : token.headwear_tier,
    companion_tier: slot === "companion" ? tier : token.companion_tier,
  };
  const cacheRow = await ensureImageCacheRow(supabase, newCombo);

  res.status(200).json({
    slot,
    tier,
    imageStatus: cacheRow.status,
  });
};
