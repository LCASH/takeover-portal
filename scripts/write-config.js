#!/usr/bin/env node
/**
 * Writes config.build.js from environment variables (for Vercel/build).
 * We use config.build.js (not config.js) so it can be committed as placeholder and is never gitignored – Vercel then includes it in the deployment after the build overwrites it.
 * For local dev: copy .env.example to .env and set SUPABASE_URL, SUPABASE_ANON_KEY, PORTAL_ORGANIZATION_ID, then run npm run build.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const envPath = path.join(dir, '.env');
const envExamplePath = path.join(dir, '.env.example');

// Create .env from .env.example if missing (so you can fill in values; .env is gitignored)
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('Created .env from .env.example – add your SUPABASE_URL, SUPABASE_ANON_KEY, PORTAL_ORGANIZATION_ID');
}

// Load .env from project root if present (local dev)
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  env.split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
}

// Vercel injects project env vars into process.env at build time. If not set, use same project as TAKEOVER (anon key is public; RLS protects data).
const defaultUrl = 'https://mqikfwwbrrqkcrwrsfyg.supabase.co';
const defaultKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaWtmd3dicnJxa2Nyd3JzZnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTgxMjUsImV4cCI6MjA4NTk3NDEyNX0.kMOs49xw72Vy_SUHcHzMqU1j2YqcHqVU7mRnlUu109U';
const defaultOrgId = 'ee059661-dfe0-4f81-8c4f-70338fb6b4e8';

const url = (process.env.SUPABASE_URL || defaultUrl).trim();
const key = (process.env.SUPABASE_ANON_KEY || defaultKey).trim();
const orgId = (process.env.PORTAL_ORGANIZATION_ID || defaultOrgId).trim();
const discordUrl = (process.env.PORTAL_DISCORD_INVITE_URL || '').trim();

console.log('[portal build] SUPABASE_URL:', url ? url.slice(0, 40) + '...' : '(not set)');
console.log('[portal build] SUPABASE_ANON_KEY:', key ? 'set (' + key.length + ' chars)' : '(not set)');
console.log('[portal build] Wrote config.build.js – configured: true');

const out = `// From env or fallback (same Supabase project as TAKEOVER)
window.PORTAL_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
  organizationId: ${orgId ? JSON.stringify(orgId) : 'null'},
  discordInviteUrl: ${discordUrl ? JSON.stringify(discordUrl) : 'null'}
};
`;

fs.writeFileSync(path.join(dir, 'config.build.js'), out, 'utf8');
