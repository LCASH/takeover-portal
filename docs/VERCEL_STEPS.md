# Portal on Vercel – clear steps

Do these once so the portal works on Vercel (no “Portal is not configured”, login works).

---

## 1. Connect the repo

- Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
- Import the **takeover-portal** repo (e.g. `LCASH/takeover-portal`).
- **Root Directory:** leave as repo root (or the folder that contains `index.html`, `vercel.json`, `package.json`).
- **Build Command:** `npm run build` (default from `vercel.json`).
- **Output Directory:** `.` (default from `vercel.json`).
- Deploy. The first deploy will show “Portal is not configured” until step 2 is done.

---

## 2. Set environment variables

- In Vercel: open the **takeover-portal** project → **Settings** → **Environment Variables**.
- Add these for **Production** (and **Preview** if you use preview deployments):

| Name | Value | Where to get it |
|------|--------|------------------|
| `SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` | Supabase Dashboard → Project Settings → API → Project URL (same as TAKEOVER app). |
| `SUPABASE_ANON_KEY` | Your anon (public) key | Supabase Dashboard → Project Settings → API → anon public (same as TAKEOVER `app/src/lib/supabase.ts`). |
| `PORTAL_ORGANIZATION_ID` | Your org UUID | TAKEOVER app when signed in (e.g. from auth/org), or Supabase → `organizations` table → copy `id` for your org. |

- Save. Do **not** commit these values; they stay only in Vercel.

---

## 3. Redeploy

- **Deployments** → open the **⋮** menu on the latest deployment → **Redeploy** (or push a new commit).
- The build runs again, reads the env vars, and writes `config.build.js` with real values. The site will then load with config and login will work.

---

## 4. (Optional) Supabase Auth settings

- **Supabase Dashboard** → your project → **Authentication** → **URL Configuration**:
  - **Site URL:** your portal URL, e.g. `https://your-portal.vercel.app`
  - **Redirect URLs:** add `https://your-portal.vercel.app/**`
- **Settings** → **API** → **CORS:** add your portal origin (e.g. `https://your-portal.vercel.app`) so the anon key can be used from the portal.

---

## Checklist

- [ ] Repo connected to Vercel, build = `npm run build`, output = `.`
- [ ] `SUPABASE_URL` set in Vercel env
- [ ] `SUPABASE_ANON_KEY` set in Vercel env
- [ ] `PORTAL_ORGANIZATION_ID` set in Vercel env
- [ ] Redeployed after adding env vars
- [ ] (Optional) Supabase Site URL and Redirect URLs set for the portal domain

After that, open the portal URL → **Login** → enter a bowler’s email/password (one you enabled via “Generate password” in TAKEOVER) → sign in should succeed.
