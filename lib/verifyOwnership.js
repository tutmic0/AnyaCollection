const { getContract } = require("./chain");

/// Confirms wallet really owns this exact tokenId RIGHT NOW, by asking
/// the contract directly rather than trusting anything cached in our
/// own database (owner_wallet in the tokens table is only a cache for
/// display -- it can go stale the moment a token is sold or
/// transferred). Every endpoint that lets a wallet act on a specific
/// token (check-in, wheel, upgrade) must call this before writing
/// anything, or a former owner could keep controlling a token they
/// sold.
async function verifyOwnsToken(wallet, tokenId) {
  const contract = getContract();
  let onChainOwner;
  try {
    onChainOwner = await contract.ownerOf(tokenId);
  } catch (err) {
    return false; // token doesn't exist
  }
  return onChainOwner.toLowerCase() === wallet.toLowerCase();
}

module.exports = { verifyOwnsToken };
