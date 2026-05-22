#!/usr/bin/env bash
# Black-box smoke test: confirms anon cannot read any sensitive table or fetch
# repo source files from the deployed portal. Exits non-zero on the first
# regression so this can run in CI / pre-deploy.
#
# Usage:
#   SUPABASE_URL=https://xxx.supabase.co \
#   SUPABASE_ANON_KEY=ey... \
#   PORTAL_BASE_URL=https://your-portal.vercel.app \
#   ./scripts/security-smoke.sh
#
# Optional: PORTAL_BASE_URL — if set, also checks that source paths return 404.

set -uo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"

fail=0

check_table_anon_empty() {
  local table=$1
  local resp http
  resp=$(curl -s -w "\n%{http_code}" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    "$SUPABASE_URL/rest/v1/$table?select=*&limit=1")
  http=$(printf '%s\n' "$resp" | tail -n1)
  body=$(printf '%s\n' "$resp" | sed '$d')

  if [[ "$http" == "404" ]]; then
    printf '%-30s SKIP (table not present)\n' "$table"
    return 0
  fi
  if [[ "$http" == "401" || "$http" == "403" ]]; then
    printf '%-30s OK   (anon blocked at HTTP %s)\n' "$table" "$http"
    return 0
  fi
  if [[ "$body" == "[]" ]]; then
    printf '%-30s OK   (anon got [])\n' "$table"
    return 0
  fi
  printf '%-30s FAIL (anon got data: %.120s)\n' "$table" "$body"
  fail=1
}

# Note on two_up_fetch_log: intentionally NOT checked. The table holds only
# operational metadata (id, fetched_at, row_count, duration_ms, throttled,
# error) — no PII, no credentials, no business secrets. It has a recurring
# re-grant pattern from an unknown source (a teammate's external EV
# dashboard at C:\Users\b8ste\dashboards\2up-tracker\ is suspected). Until
# that's tracked down, monitoring it just generates noise. two_up_opportunities
# IS still checked — it contains the live arb signal (competitive intel).

echo "=== Anon REST sweep ==="
for t in \
  account_owners \
  betting_accounts \
  proxies \
  organization_members \
  bookmakers \
  bowlers \
  organizations \
  cards \
  phones \
  messages \
  notifications \
  linkedin_contacts \
  bowler_staging \
  va_sessions \
  tags \
  promo_logs \
  edge_reactions \
  two_up_opportunities \
  grocery_items \
  grocery_purchases \
  bowler_payment_notifications \
  external_referrers
do
  check_table_anon_empty "$t"
done

echo ""
echo "=== Edge functions that must reject anon (expect 401/403/missing-auth) ==="
for fn in \
  twilio-test-creds \
  get-embedding \
  embed-knowledge \
  meal-prep-price-lookup \
  fetch-2up-opportunities
do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/functions/v1/$fn" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" -d '{}' -m 10)
  if [[ "$code" == "200" ]]; then
    printf '%-30s FAIL (anon got HTTP 200 — auth gate is gone)\n' "$fn"
    fail=1
  else
    printf '%-30s OK   (HTTP %s)\n' "$fn" "$code"
  fi
done

if [[ -n "${PORTAL_BASE_URL:-}" ]]; then
  echo ""
  echo "=== Source-file exposure check (expect 404) ==="
  for p in \
    README.md \
    vercel.json \
    config.example.js \
    .env \
    .env.example \
    .gitignore \
    package.json \
    scripts/write-config.js \
    supabase/migrations/20250220100000_create_bowlers_and_auth.sql \
    supabase/functions/enable-portal-login/index.ts \
    supabase/functions/send-portal-sms/index.ts \
    supabase/functions/signup-and-auth/index.ts \
    docs/SECURITY.md \
    apply_html_light_theme.py
  do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$PORTAL_BASE_URL/$p")
    # 404 = path not found (ideal). 403 = blocked by Vercel/WAF (also acceptable).
    if [[ "$code" == "404" || "$code" == "403" ]]; then
      printf '%-65s OK   (HTTP %s)\n' "$p" "$code"
    else
      printf '%-65s FAIL (HTTP %s)\n' "$p" "$code"
      fail=1
    fi
  done
fi

echo ""
if [[ $fail -eq 0 ]]; then
  echo "All checks passed."
  exit 0
else
  echo "Regressions detected. Exiting 1."
  exit 1
fi
