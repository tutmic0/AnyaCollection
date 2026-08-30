const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { getWalletTokenIds } = require("../lib/holdings");
const { getOrCreateWallet } = require("../lib/wallets");

/**
 * GET /api/holdings
 * headers: Authorization: Bearer <session token>
 *
 * Every tokenId the connected wallet currently holds, straight from
 * the chain (replaying Transfer events -- see lib/holdings.js; the
 * contract has no enumeration built in), plus the wallet's points
 * balance. Powers the "your Anyas" sidebar on the Shop page and the
 * token list on the Burn page, so a holder never has to type in a
 * token ID by hand.
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

  const supabase = getSupabaseAdmin();

  let walletRow;
  try {
    walletRow = await getOrCreateWallet(supabase, wallet);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  try {
    const tokenIds = await getWalletTokenIds(wallet);
    res.status(200).json({ tokenIds, pointsBalance: walletRow.points_balance });
  } catch (err) {
    res.status(502).json({ error: "chain_lookup_failed" });
  }
};
