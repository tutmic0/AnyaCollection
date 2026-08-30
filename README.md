# Anya — site backend + dashboard

This is the whole deployable site: the dynamic metadata API, check-in,
wheel, and upgrade endpoints (`/api`), and the holder dashboard
(`dashboard.html` + `css/` + `js/`). It's already laid out the way
Vercel expects, so you can upload it as-is.

## 1. Push this to GitHub

1. On github.com, click **New repository**. Name it something like
   `anya-site`. Either Public or Private is fine — no secrets live in
   any of these files (they all come from Vercel environment variables
   instead).
2. On the new, empty repo's page, click **uploading an existing file**
   (or **Add file → Upload files**).
3. Unzip what I sent you, then drag the whole unzipped folder's
   *contents* (not the folder itself — the `api`, `lib`, `css`, `js`
   folders and the loose files alongside them) into that upload box.
4. Commit directly to `main`.

## 2. Connect it to Vercel

1. On vercel.com, **Add New → Project**, and import the `anya-site`
   repo you just created.
2. Framework preset: leave it as **Other** — there's no build step,
   Vercel just serves the static files and turns `/api/*` into
   functions automatically.
3. Before clicking Deploy, open **Environment Variables** and add every
   one from `.env.example` with real values:
   - `SUPABASE_URL` → `https://jvwuejccbervnieaoycl.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` → your service_role key from Supabase
     (paste it directly here, in Vercel — never in a file or in chat)
   - `SESSION_JWT_SECRET` → the random value from `openssl rand -hex 32`
   - `ROBINHOOD_RPC_URL` → `https://rpc.mainnet.chain.robinhood.com`
     for now (fine until real traffic shows up)
   - `CONTRACT_ADDRESS` → leave as the placeholder for now, we don't
     have this yet — update it once the contract is deployed
   - `SITE_URL` → whatever domain Vercel gives this project (you can
     also come back and update this after the first deploy once you
     know the URL)
   - `FALLBACK_IMAGE_URL` → also fine as a placeholder for now
4. Click Deploy.

## 3. Confirm it's actually live

Once deployed, Vercel gives you a URL like
`https://anya-site-yourname.vercel.app`. Open
`https://<that-url>/dashboard.html` — you should see the dashboard
page (Connect wallet button, four empty slot cards). It won't fully
work yet (no contract deployed means `CONTRACT_ADDRESS` is a
placeholder, so ownership checks will fail), but the page loading at
all confirms the deploy worked.

Paste me that Vercel URL once you have it and we'll keep going —
`CONTRACT_ADDRESS` and `SITE_URL` both need updating once the contract
is deployed, which is the next big step after this.
