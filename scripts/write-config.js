#!/usr/bin/env node
/**
 * Writes config.js from environment variables (for Vercel/build).
 * Set SUPABASE_URL and SUPABASE_ANON_KEY in your deployment env.
 */
const fs = require('fs');
const path = require('path');

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
