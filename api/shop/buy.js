const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireSession } = require("../../lib/session");
const { getOrCreateWallet } = require("../../lib/wallets");
const { ITEM_PRICES } = require("../../lib/economy");
const { TIER_LIMITS } = require("../../lib/tiers");

/**
 * POST /api/shop/buy
 * headers: Authorization: Bearer <session token>
 * body: { slot, tier }  -- slot is one of "weapon" | "outfit" |
 *                          "headwear" | "companion"; tier is the
 *                          SPECIFIC item's own tier number, not "next
 *                          tier" -- items can be bought in any order.
 *
 * Permanently unlocks one item for the CALLING WALLET (see
 * database/007_wallet_economy.sql) -- not for one particular token.
 * Once bought, every Anya that wallet holds can equip it. This never
 * equips it -- call /api/shop/equip separately (per-token, since each
 * Anya shows its own look) once it's owned. Price comes from our own
 * trusted config (lib/economy.js ITEM_PRICES), never from the request
 * body. No tokenId is needed here at all: the wallet's identity is
 * already proven by its signed session, and that's the only thing
 * this purchase is "for".
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

  const { slot, tier: tierRaw } = req.body || {};
  const tier = Number(tierRaw);

  if (!TIER_LIMITS[slot]) {
    res.status(400).json({ error: "invalid_slot" });
    return;
  }
  if (!Number.isInteger(tier) || tier < TIER_LIMITS[slot].min || tier > TIER_LIMITS[slot].max) {
    res.status(400).json({ error: "invalid_tier" });
    return;
  }

  const supabase = getSupabaseAdmin();

  try {
    await getOrCreateWallet(supabase, wallet);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const cost = ITEM_PRICES[slot] && ITEM_PRICES[slot][tier];
  if (cost === undefined) {
    res.status(500).json({ error: "missing_price_config" });
    return;
  }
  if (cost === 0) {
    // Tier[slot].min (or companion 0) is the free starting item -- it's
    // seeded as owned the moment a wallet is first seen, so there's
    // never anything to "buy" here.
    res.status(400).json({ error: "already_owned" });
    return;
  }

  const { data, error } = await supabase.rpc("perform_purchase", {
    p_wallet: wallet,
    p_slot: slot,
    p_tier: tier,
    p_cost: cost,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_owned")) {
      res.status(400).json({ error: "already_owned" });
      return;
    }
    if (message.includes("insufficient_points")) {
      res.status(400).json({ error: "insufficient_points", required: cost });
      return;
    }
    if (message.includes("invalid_slot")) {
      res.status(400).json({ error: "invalid_slot" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({
    slot,
    tier,
    cost,
    balance: data.balance,
  });
};
