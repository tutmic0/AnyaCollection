const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireSession } = require("../../lib/session");
const { getBurnTransfer } = require("../../lib/chain");
const { getOrCreateWallet } = require("../../lib/wallets");
const { BURN_REWARD_POINTS } = require("../../lib/economy");

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * POST /api/burn/claim
 * headers: Authorization: Bearer <session token>
 * body: { tokenId, txHash }
 *
 * The FRONTEND sends the burn(tokenId) transaction itself (see
 * js/burn.js) -- that's a real on-chain call the holder pays gas for
 * and signs with their own wallet, so this endpoint's only job is to
 * verify it actually happened and pay out the points exactly once.
 *
 * Verification looks at the MINED TRANSACTION ITSELF (its receipt's
 * logs), not our own database or the contract's current state -- so
 * this works even for a token our backend has never touched before
 * (e.g. a wallet that bought it secondhand and burns it without ever
 * loading the dashboard first). It must contain a Transfer(wallet,
 * 0x0, tokenId) event on OUR contract, or this rejects it outright.
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

  const { txHash, tokenId: tokenIdRaw } = req.body || {};
  const tokenId = Number(tokenIdRaw);

  if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
    res.status(400).json({ error: "invalid_tx_hash" });
    return;
  }
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  let transfer;
  try {
    transfer = await getBurnTransfer(txHash);
  } catch (err) {
    res.status(502).json({ error: "chain_lookup_failed" });
    return;
  }

  if (!transfer) {
    res.status(400).json({ error: "not_a_burn_transaction" });
    return;
  }
  if (transfer.tokenId !== tokenId) {
    res.status(400).json({ error: "token_id_mismatch" });
    return;
  }
  if (transfer.from.toLowerCase() !== wallet.toLowerCase()) {
    res.status(403).json({ error: "not_the_burner" });
    return;
  }

  const supabase = getSupabaseAdmin();

  try {
    await getOrCreateWallet(supabase, wallet);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const { data, error } = await supabase.rpc("perform_burn_claim", {
    p_wallet: wallet,
    p_token_id: tokenId,
    p_tx_hash: txHash.toLowerCase(),
    p_points: BURN_REWARD_POINTS,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_claimed")) {
      res.status(400).json({ error: "already_claimed" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({
    pointsAwarded: BURN_REWARD_POINTS,
    balance: data.balance,
  });
};
