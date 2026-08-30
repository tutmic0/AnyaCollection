const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { verifyOwnsToken } = require("../lib/verifyOwnership");
const { getOrCreateToken } = require("../lib/tokens");
const { DAILY_CHECKIN_POINTS } = require("../lib/economy");

/**
 * POST /api/checkin
 * headers: Authorization: Bearer <session token from /api/auth/verify>
 * body: { tokenId }
 *
 * Awards DAILY_CHECKIN_POINTS once per UTC calendar day, per token
 * (not per wallet -- a wallet holding several tokens checks each one
 * in separately, since points feed each token's own upgrades). The
 * actual "only once a day" enforcement lives in the perform_checkin
 * SQL function (database/003_checkin_wheel.sql), which locks the
 * token's row for the duration of the check so two near-simultaneous
 * requests can't both succeed.
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

  const tokenId = Number((req.body || {}).tokenId);
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

  const { data, error } = await supabase.rpc("perform_checkin", {
    p_token_id: tokenId,
    p_points: DAILY_CHECKIN_POINTS,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_checked_in")) {
      res.status(400).json({ error: "already_checked_in" });
      return;
    }
    if (message.includes("token_not_found")) {
      res.status(404).json({ error: "not_minted" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({
    pointsAwarded: DAILY_CHECKIN_POINTS,
    balance: data.balance,
  });
};
