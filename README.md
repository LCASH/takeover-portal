# Takeover Portal

Separate domain/app for bowlers: AI landing page → signup as **lead** → you enable portal login → they log in and complete onboarding → you set status to **confirmed**.

**Live:** [https://your-portal.vercel.app/](https://your-portal.vercel.app/) (landing · [login](https://your-portal.vercel.app/login.html) · [portal](https://your-portal.vercel.app/portal.html) after login)

## Flow

1. **Landing** (`index.html`): Terminal-style typing, eye, Join → form (full name, email, mobile, country, referrer). Submit → row in **bowlers** with `status = 'lead'`, SMS via Twilio.
2. **You enable login**: Generate a password for them (or send magic link). That creates an auth user and sets `bowlers.auth_user_id` + `bowlers.login_enabled_at`. Until then they cannot sign in (“Your account is not yet enabled for portal access”).
3. **They sign in** (`login.html`): Email + password. Only allowed if `login_enabled_at` is set (confirms email/identity is allowed).
4. **Portal** (`portal.html`): If onboarding not complete they only see the onboarding form (with disclaimer). Once they submit, `status = 'onboarding_submitted'` and they see: *“Thanks! The team will reach out to you asap to confirm your details give you your $100 and ongoing $25.”*
5. **You confirm**: Change bowler `status` to `'confirmed'`. In the portal they then also see: *“You're confirmed. We'll be in touch.”*

## Deploy at `/portal`

Use relative paths; the same files work at `/` or `/portal`. Deploy this folder so that:

- Landing: `https://yourdomain.com/` or `https://yourdomain.com/portal/`
- Login: `https://yourdomain.com/login.html` or `https://yourdomain.com/portal/login.html`
- After login: `https://yourdomain.com/portal.html` or `https://yourdomain.com/portal/portal.html`

Configure your static host so the app is served from the path you want.

## Production deployment (Vercel)

1. **Connect repo** to Vercel; build command is `npm run build`, output directory is `.`.
2. **Environment variables** (Project → Settings → Environment Variables): set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PORTAL_ORGANIZATION_ID` for Production (and Preview if needed). The build writes these into `config.js`; never commit `config.js` or `.env`.
3. **Supabase dashboard** (before going live):
   - **Auth → URL configuration**: set **Site URL** to your portal URL (e.g. `https://your-portal.vercel.app`) and **Redirect URLs** to `https://your-portal.vercel.app/**`.
   - **Settings → API → CORS**: allow only your portal origin(s) so the anon key cannot be used from other domains.
4. **Security checklist**: see [docs/SECURITY.md](docs/SECURITY.md) for HTTPS, rate limiting, and optional CAPTCHA.

## Supabase (portal project)

1. Create a project at [supabase.com](https://supabase.com).
2. Run migrations in order (SQL Editor):
   - `supabase/migrations/20250220000000_create_portal_submissions.sql` (optional legacy table)
   - `supabase/migrations/20250220100000_create_bowlers_and_auth.sql` (bowlers table + Storage bucket)
3. **Supabase config** (same project as the main TAKEOVER app so leads appear in Portal leads):
   - **Vercel:** Set **Environment Variables**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and **`PORTAL_ORGANIZATION_ID`** (your org UUID — portal is your org’s landing page; leads are scoped to this org). Build generates `config.js` via `scripts/write-config.js`.
   - **Local:** Copy `config.example.js` to `config.js` and set `supabaseUrl`, `supabaseAnonKey`, and `organizationId`.

### Bowlers table (logins + details)

| Column | Source | Notes |
|--------|--------|--------|
| organization_id | Config / env | Our org — portal is our landing page; required for org-scoped leads |
| email, full_name, first_name, last_name, mobile, referrer, country | Landing form | Unique email/mobile |
| auth_user_id | Set when you enable login | FK to auth.users |
| login_enabled_at | Set when you enable login | Must be set to allow sign-in |
| date_of_birth, address, previous_betting_accounts, banks_consent | Onboarding form | |
| selfie_url, license_front_url, license_back_url | Onboarding uploads | Stored in bucket `portal-documents` |
| accept_betting_tcs_at, accept_bank_paypal_tcs_at, confirm_details_entered_at | Onboarding checkboxes | |
| status | lead → onboarding_submitted → confirmed | You set confirmed |

Country is indexed for search/filter.

## Enabling portal login (generate password / 2FA)

Each bowler can only sign in after you set `auth_user_id` and `login_enabled_at`. Two options:

### Option A: Edge Function (recommended)

1. Deploy: `supabase functions deploy enable-portal-login`
2. The function uses `SUPABASE_SERVICE_ROLE_KEY` (set automatically when deployed, or set in Edge Function secrets).
3. From your admin (or a script), call:
   - `POST .../functions/v1/enable-portal-login`
   - Headers: `Authorization: Bearer <service_role_key>`, `Content-Type: application/json`
   - Body: `{ "bowler_id": "<uuid>" }` or `{ "bowler_id": "<uuid>", "password": "temp-password" }`
   - With `password`: creates auth user with that password (email_confirm: true). Send them the password securely.
   - Without `password`: sends invite email; they set their own password.

### Option B: Main app / admin UI

In your main TAKEOVER app (or any backend with the **service role** key):

1. Create user: `supabase.auth.admin.createUser({ email: bowler.email, password: '...', email_confirm: true })`
2. Update bowler: `supabase.from('bowlers').update({ auth_user_id: user.id, login_enabled_at: new Date().toISOString() }).eq('id', bowlerId)`

Then give the bowler the password (or use invite so they set it).

### Two-factor authentication (2FA)

Use Supabase Auth: enable **Phone** or **TOTP** in Authentication → Providers. Users set 2FA in their account after first login. No change needed in portal code.

### Confirming email is allowed

Portal login is only allowed when `login_enabled_at` is set. So you enable access only after you’re satisfied (e.g. after verifying identity). Optional: use Supabase “Confirm email” and set `login_enabled_at` only after they’ve confirmed (e.g. via webhook or a check in your enable-login flow).

## When you set status to confirmed

In Supabase (or your admin UI), set `bowlers.status = 'confirmed'` for that bowler. The portal shows the extra line: *“You're confirmed. We'll be in touch.”* You can add a trigger or webhook later (e.g. send email) when status changes to confirmed.

## Twilio SMS (after landing submit)

See previous section in this README: deploy `send-portal-sms`, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. Message: *“Hey {first_name}, for authentication reasons...”*

## Local run

- `npx serve -l 8080` then open `http://localhost:8080` (landing), `http://localhost:8080/login.html`, `http://localhost:8080/portal.html` (after login).
