# Portal security

## Confirmation: portal login is bowlers only

- **Portal** (this app, separate domain) is for **bowlers only**: people who sign up via the landing form and whom you enable (Generate password / Send invite). They log in at the portal to complete onboarding (DOB, address, docs, etc.).
- **TAKEOVER main app** is for **admins and members** (org owners, admins, members in `organization_members`). They never use the portal login; they use the main app login.
- Same Supabase project, same `auth.users` table, but:
  - **Bowlers**: have a row in `bowlers` with `auth_user_id` and `login_enabled_at`. They have **no** row in `organization_members`. RLS limits them to their own `bowlers` row and their own folder in `portal-documents`.
  - **Admins/members**: have a row in `organization_members`. They use the main TAKEOVER app; RLS there is org-scoped. They do not use the portal for login.

So the portal is a **separate app** for bowlers; admins/members never log in there.

---

## What’s already in place

| Area | Current protection |
|------|--------------------|
| **Auth** | Portal login only works if `bowlers.login_enabled_at` is set (you enable per lead). No org membership = no access to main app data. |
| **RLS – bowlers** | Anon can only INSERT with `status = 'lead'` and no `auth_user_id`. Authenticated can only SELECT/UPDATE their own row (`auth.uid() = auth_user_id`). |
| **RLS – storage** | Authenticated users can only read/upload in `portal-documents/{their_bowler_id}/`. |
| **Enable-login** | Edge Function checks `organization_members.role` (owner/admin only) via JWT; uses service role only server-side. |
| **Config** | `config.js` is gitignored; anon key in frontend is expected; RLS is the main guard. |

---

## What to do to make it as secure and non‑hackable as possible

### 1. Production and transport

- **HTTPS only** for the portal and for Supabase (no mixed content; Supabase is HTTPS by default).
- **Portal URL:** [https://your-portal.vercel.app/](https://your-portal.vercel.app/) — separate from the main TAKEOVER app so bowler sessions and cookies are isolated.

### 2. Supabase (dashboard)

- **Auth → URL configuration**: Set **Site URL** to `https://your-portal.vercel.app` and **Redirect URLs** to include `https://your-portal.vercel.app/**` (and `https://your-portal.vercel.app/login.html`, `https://your-portal.vercel.app/portal.html` if needed). No localhost in production.
- **Auth → Email**: Enable “Confirm email” if you want bowlers to verify email before first login (optional; you already gate on `login_enabled_at`).
- **Auth → Rate limits**: Use Supabase Auth rate limits (e.g. sign-in attempts) to reduce brute force.
- **Database → RLS**: Leave RLS on `bowlers` and storage as-is; no `SELECT` for `anon` on `bowlers` (already the case).
- **API → CORS**: Restrict CORS to your portal domain(s), e.g. `https://your-portal.vercel.app`, so the anon key can’t be abused from other sites (Supabase dashboard → Settings → API).

### 3. Landing form and signup abuse

- **Rate limit signups**: Put an Edge Function in front of the insert (e.g. check IP or email in a short window) or use a reverse proxy/CDN (Vercel, Cloudflare) to rate limit POSTs to the page or to Supabase. Prevents mass signup/spam.
- **Optional**: Add a lightweight CAPTCHA (e.g. Turnstile, hCaptcha) on the landing form before submit.

### 4. Passwords and sessions

- **Password policy**: In Supabase Auth settings, set minimum length and complexity for passwords (applies to invite flow and when you create users).
- **Temp passwords**: When you “Generate password”, use a long random string (e.g. 12+ chars); send it over a secure channel (e.g. SMS or secure email). Don’t log it in plain text in the main app.
- **Session**: Rely on Supabase JWT expiry; optionally shorten JWT expiry for “bowler” users if you add a way to distinguish them (e.g. custom claim or separate project later).

### 5. Edge Function (enable-portal-login)

- **Already**: Accepts only your app’s JWT; verifies caller is org owner/admin; uses service role only in the function.
- **Optional**: Add rate limiting (e.g. per user or per org) so the endpoint can’t be hammered.

### 6. Storage (portal-documents)

- **Already**: Private bucket; RLS so users only access their own folder; `allowed_mime_types` and `file_size_limit` set.
- **Optional**: Add an Edge Function that validates file type/size again after upload and deletes invalid uploads.

### 7. Main TAKEOVER app (admin side)

- **Portal leads**: Only owner/admin can successfully call enable-portal-login (enforced in the Edge Function). The Portal leads page is under the same “bowlers” permission as the rest of Bowlers; you can add a stricter check so only owner/admin see “Generate password” / “Send invite” if you want.
- **Service role key**: Never in frontend or in the portal app; only in Edge Functions or backend.

### 8. Config and secrets

- **Portal**: In production, inject `supabaseUrl` and `supabaseAnonKey` via build or env (e.g. Vercel/Netlify env) so they’re not in repo. Anon key in client JS is normal; RLS protects data.
- **Twilio / any other secrets**: Only in Edge Function secrets or server env; never in portal frontend.

### 9. Hardening checklist summary

- [ ] Portal and Supabase on HTTPS only; portal on its own domain.
- [ ] Supabase Auth URL config and (optional) email confirmation and rate limits.
- [ ] Rate limit landing form signups (Edge Function or CDN).
- [ ] (Optional) CAPTCHA on landing form.
- [ ] Password policy set in Supabase Auth.
- [ ] Temp passwords sent only over secure channel; not logged.
- [ ] CORS restricted to portal domain(s) in Supabase if available.
- [ ] No service role or Twilio keys in frontend; Edge Function only.

---

## What bowlers cannot do

- They **cannot** see other bowlers or any admin data (RLS: only their own `bowlers` row and their own storage folder).
- They **cannot** access the main TAKEOVER app as admins/members (no `organization_members` row).
- They **cannot** call enable-portal-login with any privilege (they don’t have owner/admin role).
