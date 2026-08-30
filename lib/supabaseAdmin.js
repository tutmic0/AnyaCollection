const { createClient } = require("@supabase/supabase-js");

// Server-side only. Uses the SERVICE ROLE key, which bypasses Row Level
// Security -- this file must never be imported into anything that ships
// to the browser. Every /api function that needs to write to the
// database (metadata's lazy-init, check-in, wheel, upgrades) imports
// this same client instead of constructing its own.
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
