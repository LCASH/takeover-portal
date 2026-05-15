#!/usr/bin/env node
/**
 * Writes public/config.build.js from environment variables.
 * Fails the build if required values are missing so a misconfigured deploy
 * never silently bakes hardcoded fallback creds into the bundle.
 *
 * Required env: SUPABASE_URL, SUPABASE_ANON_KEY, PORTAL_ORGANIZATION_ID
 * Optional env: PORTAL_TELEGRAM_INVITE_URL
 * Local dev: copy .env.example to .env and fill in values, then `npm run build`.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const envPath = path.join(dir, '.env');

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  env.split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const orgId = (process.env.PORTAL_ORGANIZATION_ID || '').trim();
const telegramUrl = (process.env.PORTAL_TELEGRAM_INVITE_URL || '').trim();

const missing = [];
if (!url) missing.push('SUPABASE_URL');
if (!key) missing.push('SUPABASE_ANON_KEY');
if (!orgId) missing.push('PORTAL_ORGANIZATION_ID');
if (missing.length) {
  console.error('[portal build] Missing required env vars: ' + missing.join(', '));
  console.error('[portal build] Set them in Vercel Project Settings → Environment Variables, or in a local .env file.');
  process.exit(1);
}

console.log('[portal build] SUPABASE_URL: ' + url.slice(0, 40) + '...');
console.log('[portal build] SUPABASE_ANON_KEY: set (' + key.length + ' chars)');
console.log('[portal build] PORTAL_ORGANIZATION_ID: ' + orgId);
console.log('[portal build] PORTAL_TELEGRAM_INVITE_URL: ' + (telegramUrl ? 'set' : '(unset)'));

const out = 'window.PORTAL_CONFIG = ' + JSON.stringify({
  supabaseUrl: url,
  supabaseAnonKey: key,
  organizationId: orgId,
  telegramInviteUrl: telegramUrl || null,
}, null, 2) + ';\n';

const publicDir = path.join(dir, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, 'config.build.js'), out, 'utf8');
console.log('[portal build] Wrote public/config.build.js');
