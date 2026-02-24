# Vercel env vars (one-time setup)

Add these in **Vercel → your portal project → Settings → Environment Variables** for **Production** (and Preview if you use it).

Copy the values from the `.env` file in this repo (same folder as this `scripts/` folder). If you don’t have `.env`, create it from `.env.example` and use the same Supabase project as TAKEOVER:

- **SUPABASE_URL** – e.g. `https://mqikfwwbrrqkcrwrsfyg.supabase.co` (from TAKEOVER `app/src/lib/supabase.ts` or Supabase dashboard)
- **SUPABASE_ANON_KEY** – anon/public key from Supabase → Project Settings → API
- **PORTAL_ORGANIZATION_ID** – your org UUID (e.g. from `organizations` table or TAKEOVER when signed in)

Then **redeploy** the portal so the build runs and generates `config.js` with these values.
