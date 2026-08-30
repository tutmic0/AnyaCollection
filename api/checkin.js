const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { getOrCreateToken } = require("../lib/tokens");
const { getOrCreateWallet } = require("../lib/wallets");
const { getWalletTokenIds } = require("../lib/holdings");
const { DAILY_CHECKIN_POINTS } = require("../lib/economy");

/**
 * POST /api/checkin
 * headers: Authorization: Bearer <session token from /api/auth/verify>
 *
 * One click checks in EVERY Anya the connected wallet currently holds
 * (per database/008_burn_and_holdings.sql's perform_checkin_all) --
 * hold 5, get up to 5x DAILY_CHECKIN_POINTS in one call. Each token
 * still has its own once-per-UTC-day cooldown (a token bought/sold
 * mid-day doesn't get double-counted), but the points all land in the
 * wallet's shared balance. No tokenId in the request at all -- which
 * tokens count comes straight from the chain (lib/holdings.js), not
 * from anything the client sends.
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

  const supabase = getSupabaseAdmin();

  try {
    await getOrCreateWallet(supabase, wallet);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  let tokenIds;
  try {
    tokenIds = await getWalletTokenIds(wallet);
  } catch (err) {
    res.status(502).json({ error: "chain_lookup_failed" });
    return;
  }

  if (tokenIds.length === 0) {
    res.status(400).json({ error: "no_tokens_held" });
    return;
  }

  // A token this wallet holds might not have a row yet -- e.g. bought
  // secondhand and never opened on the dashboard. Make sure each one
  // exists before perform_checkin_all locks/updates them.
  for (const tokenId of tokenIds) {
    await getOrCreateToken(supabase, tokenId).catch(() => null);
  }

  const { data, error } = await supabase.rpc("perform_checkin_all", {
    p_wallet: wallet,
    p_token_ids: tokenIds,
    p_points_per_token: DAILY_CHECKIN_POINTS,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_checked_in")) {
      res.status(400).json({ error: "already_checked_in" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({
    pointsAwarded: data.points_awarded,
    checkedInCount: data.checked_in_count,
    balance: data.balance,
  });
};
