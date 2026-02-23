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

// Vercel injects project env vars into process.env at build time
const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const orgId = (process.env.PORTAL_ORGANIZATION_ID || '').trim();

// Log so you can see in Vercel build logs whether env was picked up
console.log('[portal build] SUPABASE_URL:', url ? url.slice(0, 40) + '...' : '(not set)');
console.log('[portal build] SUPABASE_ANON_KEY:', key ? 'set (' + key.length + ' chars)' : '(not set)');
console.log('[portal build] PORTAL_ORGANIZATION_ID:', orgId || '(not set)');

const out = `// Generated at build time from env (SUPABASE_*, PORTAL_ORGANIZATION_ID)
window.PORTAL_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
  organizationId: ${orgId ? JSON.stringify(orgId) : 'null'}
};
`;

fs.writeFileSync(path.join(dir, 'config.build.js'), out, 'utf8');
console.log('[portal build] Wrote config.build.js – configured:', !!(url && key));
