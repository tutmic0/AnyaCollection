/// Shared by the metadata endpoint and the upgrade endpoint: given an
/// exact tier combination, look up whether art already exists for it.
/// If nobody has ever reached this exact combination before, record it
/// as 'pending' so you have a running list of exactly which images
/// still need to be generated -- see database's image_cache table.
async function ensureImageCacheRow(supabase, combo) {
  const { weapon_tier, outfit_tier, headwear_tier, companion_tier } = combo;

  const { data: existing } = await supabase
    .from("image_cache")
    .select("*")
    .eq("weapon_tier", weapon_tier)
    .eq("outfit_tier", outfit_tier)
    .eq("headwear_tier", headwear_tier)
    .eq("companion_tier", companion_tier)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: inserted } = await supabase
    .from("image_cache")
    .insert({ weapon_tier, outfit_tier, headwear_tier, companion_tier, status: "pending" })
    .select("*")
    .maybeSingle();

  return inserted || { weapon_tier, outfit_tier, headwear_tier, companion_tier, status: "pending", image_url: null };
}

module.exports = { ensureImageCacheRow };
