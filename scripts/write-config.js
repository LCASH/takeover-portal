#!/usr/bin/env node
/**
 * Writes config.js from environment variables (for Vercel/build).
 * For local dev: copy .env.example to .env and set SUPABASE_URL, SUPABASE_ANON_KEY, PORTAL_ORGANIZATION_ID, then run npm run build.
 */
const fs = require('fs');
const path = require('path');

// Load .env from project root if present (local dev)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  env.split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
}

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
const orgId = process.env.PORTAL_ORGANIZATION_ID || '';

const out = `// Generated at build time from env (SUPABASE_*, PORTAL_ORGANIZATION_ID)
window.PORTAL_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
  organizationId: ${orgId ? JSON.stringify(orgId) : 'null'}
};
`;

const dir = path.join(__dirname, '..');
fs.writeFileSync(path.join(dir, 'config.js'), out, 'utf8');
console.log('Wrote config.js (supabaseUrl:', url ? url.slice(0, 30) + '...' : 'not set', ')');
