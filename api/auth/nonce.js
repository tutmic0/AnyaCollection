const crypto = require("crypto");
const { ethers } = require("ethers");
const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");

/**
 * GET /api/auth/nonce?wallet=0x...
 *
 * Step 1 of connecting a wallet: the site asks for a one-time message
 * to sign. We generate a random nonce, save it tied to this wallet
 * (overwriting any previous unused one), and hand back the exact text
 * the wallet must sign. Storing the full message (not just the nonce)
 * means verify.js can check the signature against the identical
 * string it was told to sign -- no risk of reconstructing it slightly
 * differently later.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const wallet = String(req.query.wallet || "");
  if (!ethers.isAddress(wallet)) {
    res.status(400).json({ error: "invalid_wallet" });
    return;
  }
  const walletLower = wallet.toLowerCase();

  const nonce = crypto.randomBytes(16).toString("hex");
  const message =
    `Sign in to Anya\n\n` +
    `Wallet: ${walletLower}\n` +
    `Nonce: ${nonce}\n\n` +
    `This request will not trigger a blockchain transaction or cost any gas.`;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("auth_nonces").upsert({
    wallet: walletLower,
    nonce,
    message,
    used: false,
    created_at: new Date().toISOString(),
  });

  if (error) {
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({ message });
};
