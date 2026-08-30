const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireSession } = require("../../lib/session");
const { verifyOwnsToken } = require("../../lib/verifyOwnership");
const { getOrCreateToken } = require("../../lib/tokens");
const { WHEEL_STAKE, spinWheel } = require("../../lib/economy");

/**
 * POST /api/wheel/spin
 * headers: Authorization: Bearer <session token>
 * body: { tokenId }
 *
 * The RNG happens HERE, server-side, using a cryptographically secure
 * source (see lib/economy.js) -- never on the client, and never
 * influenced by anything the client sends. The client only finds out
 * the outcome after it's already been decided and applied. This is
 * the whole reason a "wheel with real randomness" is safe to run at
 * all: nothing about the result can be predicted or tampered with from
 * the browser.
 *
 * Once per UTC day per token, same as check-in -- enforced by
 * perform_wheel_spin locking the token's row.
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

  const outcome = spinWheel();
  const payout = WHEEL_STAKE * outcome.multiplier;

  const { data, error } = await supabase.rpc("perform_wheel_spin", {
    p_token_id: tokenId,
    p_stake: WHEEL_STAKE,
    p_payout: payout,
    p_outcome_label: outcome.label,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_spun_today")) {
      res.status(400).json({ error: "already_spun_today" });
      return;
    }
    if (message.includes("insufficient_points")) {
      res.status(400).json({ error: "insufficient_points", required: WHEEL_STAKE });
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
    outcome: outcome.label,
    multiplier: outcome.multiplier,
    stake: WHEEL_STAKE,
    payout,
    delta: data.delta,
    balance: data.balance,
  });
};
