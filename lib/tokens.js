const { getOnChainOwner } = require("./chain");

/// Shared by every endpoint that needs a token's row to exist before it
/// can act (metadata, check-in, wheel, upgrade): look it up, and if
/// this is the first time anyone has ever asked about this tokenId,
/// confirm it's actually been minted and create its tier-1 starting
/// row. Throws an Error with .statusCode set so callers can just
/// forward that straight into an HTTP response.
async function getOrCreateToken(supabase, tokenId) {
  const { data: existing, error } = await supabase
    .from("tokens")
    .select("*")
    .eq("token_id", tokenId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error("database_error"), { statusCode: 500 });
  }
  if (existing) {
    return existing;
  }

  const owner = await getOnChainOwner(tokenId);
  if (!owner) {
    throw Object.assign(new Error("not_minted"), { statusCode: 404 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("tokens")
    .insert({ token_id: tokenId, owner_wallet: owner.toLowerCase() })
    .select("*")
    .single();

  if (insertError) {
    throw Object.assign(new Error("database_error"), { statusCode: 500 });
  }
  return inserted;
}

module.exports = { getOrCreateToken };
