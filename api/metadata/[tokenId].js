const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { getOrCreateToken } = require("../../lib/tokens");
const { ensureImageCacheRow } = require("../../lib/imageCache");
const {
  WEAPON_NAMES,
  OUTFIT_NAMES,
  HEADWEAR_NAMES,
  COMPANION_NAMES,
} = require("../../lib/tiers");

const MAX_SUPPLY = 8888;

/**
 * GET /api/metadata/:tokenId
 *
 * This is what the smart contract's tokenURI() points to. OpenSea calls
 * this on mint and again whenever a holder clicks "Refresh metadata" --
 * every response reflects the token's CURRENT tier state, not a frozen
 * snapshot. That's the entire trick behind the upgrade mechanic: this
 * endpoint is the only thing that needs to know about tiers at all.
 *
 * Flow:
 *  1. Look up the token in Supabase.
 *  2. If it's not there yet, this might be the very first time anyone
 *     (or OpenSea) has asked about it -- check on-chain whether it's
 *     actually been minted, and if so, lazily create its row at the
 *     tier-1 starting state. This means nothing needs to "push" new
 *     tokens into the database at mint time; the metadata API creates
 *     them on first read.
 *  3. Look up the cached image for this exact tier combination. If it
 *     doesn't exist yet, record that it's needed (image_cache row,
 *     status 'pending') and fall back to a placeholder/default image
 *     rather than erroring -- OpenSea should never see a broken token.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const tokenId = Number(req.query.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > MAX_SUPPLY) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  let token;
  try {
    token = await getOrCreateToken(supabase, tokenId);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const { weapon_tier, outfit_tier, headwear_tier, companion_tier } = token;

  const cacheRow = await ensureImageCacheRow(supabase, {
    weapon_tier,
    outfit_tier,
    headwear_tier,
    companion_tier,
  });

  const imageUrl =
    cacheRow && cacheRow.status === "ready" && cacheRow.image_url
      ? cacheRow.image_url
      : process.env.FALLBACK_IMAGE_URL ||
        `${process.env.SITE_URL || ""}/img/tier1-default.png`;

  const siteUrl = process.env.SITE_URL || "";

  const metadata = {
    name: `Anya #${tokenId}`,
    description:
      "Anya -- a voxel adventurer that levels up with its holder. Weapon, outfit, headwear, and companion all upgrade over time as points are earned and spent -- this token's art changes as its holder progresses.",
    image: imageUrl,
    external_url: siteUrl ? `${siteUrl}/token/${tokenId}` : undefined,
    attributes: [
      { trait_type: "Weapon", value: WEAPON_NAMES[weapon_tier] || "Unknown" },
      { trait_type: "Outfit", value: OUTFIT_NAMES[outfit_tier] || "Unknown" },
      {
        trait_type: "Headwear",
        value: HEADWEAR_NAMES[headwear_tier] || "Unknown",
      },
      {
        trait_type: "Companion",
        value: COMPANION_NAMES[companion_tier] || "Unknown",
      },
      { trait_type: "Weapon Tier", value: weapon_tier, display_type: "number" },
      { trait_type: "Outfit Tier", value: outfit_tier, display_type: "number" },
      {
        trait_type: "Headwear Tier",
        value: headwear_tier,
        display_type: "number",
      },
    ],
  };

  // Short cache: OpenSea only re-fetches on manual refresh anyway, but
  // this keeps repeated crawler hits from hammering the database.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.status(200).json(metadata);
};
