const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { verifyOwnsToken } = require("../lib/verifyOwnership");
const { getOrCreateToken } = require("../lib/tokens");
const { getOrCreateWallet } = require("../lib/wallets");
const { getWalletTokenIds } = require("../lib/holdings");
const { ensureImageCacheRow } = require("../lib/imageCache");
const { ITEM_PRICES } = require("../lib/economy");
const {
  TIER_LIMITS,
  WEAPON_NAMES,
  OUTFIT_NAMES,
  HEADWEAR_NAMES,
  COMPANION_NAMES,
} = require("../lib/tiers");

/**
 * GET /api/state?tokenId=123
 * headers: Authorization: Bearer <session token>
 *
 * Everything the dashboard needs to render in one call. Points balance
 * and the shop catalog (owned/equipped/price per item) are WALLET-wide
 * (see database/007_wallet_economy.sql) -- they're the same no matter
 * which of the wallet's tokens you load. Only the equipped look and
 * today's check-in/wheel flags are specific to this one tokenId.
 *
 * Each catalog item also carries `equippedOnTokenId`: if this wallet
 * owns the item but it's currently worn by a DIFFERENT Anya it holds,
 * this names that token so the UI can show "on Anya #17" instead of an
 * Equip button (see api/shop/equip.js for the matching enforcement).
 *
 * Read-only -- this never changes anything, it just describes current
 * state for the UI.
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

  const tokenId = Number(req.query.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  const supabase = getSupabaseAdmin();

  let token, walletRow;
  try {
    token = await getOrCreateToken(supabase, tokenId);
    walletRow = await getOrCreateWallet(supabase, wallet);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
    return;
  }

  const owns = await verifyOwnsToken(wallet, tokenId);
  if (!owns) {
    res.status(403).json({ error: "not_owner" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const checkedInToday = token.last_checkin_at === today;
  const spunToday = token.last_spin_date === today;

  // Same cache lookup the metadata API uses, so the dashboard can show
  // the token's actual current portrait instead of just trait names.
  const cacheRow = await ensureImageCacheRow(supabase, {
    weapon_tier: token.weapon_tier,
    outfit_tier: token.outfit_tier,
    headwear_tier: token.headwear_tier,
    companion_tier: token.companion_tier,
  });
  const imageUrl =
    cacheRow && cacheRow.status === "ready" && cacheRow.image_url
      ? cacheRow.image_url
      : process.env.FALLBACK_IMAGE_URL ||
        `${process.env.SITE_URL || ""}/img/tier1-default.png`;

  // Shop catalog: every item in every slot, with price + owned/equipped
  // state. Ownership is keyed by wallet_address now, not tokenId -- an
  // item bought while managing token #1 shows up as owned here too
  // when token #2 (same wallet) is loaded.
  const { data: ownedRows } = await supabase
    .from("owned_items")
    .select("slot, tier")
    .eq("wallet_address", wallet);

  const ownedSet = new Set((ownedRows || []).map((r) => `${r.slot}:${r.tier}`));

  // Which of this wallet's OTHER Anyas currently wear what, so the
  // catalog can flag an owned-but-unavailable item (see
  // api/shop/equip.js for the matching exclusivity rule). Best-effort:
  // if the chain lookup fails, just skip the "in use elsewhere" flags
  // rather than breaking the whole page.
  let otherTokenRows = [];
  try {
    const heldTokenIds = await getWalletTokenIds(wallet);
    const otherIds = heldTokenIds.filter((id) => id !== tokenId);
    if (otherIds.length > 0) {
      const { data } = await supabase
        .from("tokens")
        .select("token_id, weapon_tier, outfit_tier, headwear_tier, companion_tier")
        .in("token_id", otherIds);
      otherTokenRows = data || [];
    }
  } catch (err) {
    otherTokenRows = [];
  }

  function findElsewhere(slot, tier) {
    if (tier === TIER_LIMITS[slot].min) return null; // the free default isn't exclusive
    const column = `${slot}_tier`;
    const row = otherTokenRows.find((r) => r[column] === tier);
    return row ? row.token_id : null;
  }

  function buildCatalog(slot, namesMap) {
    const { min, max } = TIER_LIMITS[slot];
    const equippedTier = token[`${slot}_tier`];
    const items = [];
    for (let tier = min; tier <= max; tier++) {
      items.push({
        tier,
        name: namesMap[tier] || "Unknown",
        price: (ITEM_PRICES[slot] || {})[tier] ?? 0,
        owned: tier === min ? true : ownedSet.has(`${slot}:${tier}`),
        equipped: tier === equippedTier,
        equippedOnTokenId: tier === equippedTier ? null : findElsewhere(slot, tier),
      });
    }
    return items;
  }

  res.status(200).json({
    tokenId,
    pointsBalance: walletRow.points_balance,
    imageUrl,
    checkedInToday,
    spunToday,
    slots: {
      weapon: buildCatalog("weapon", WEAPON_NAMES),
      outfit: buildCatalog("outfit", OUTFIT_NAMES),
      headwear: buildCatalog("headwear", HEADWEAR_NAMES),
      companion: buildCatalog("companion", COMPANION_NAMES),
    },
  });
};
