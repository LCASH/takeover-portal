#!/usr/bin/env node
/**
 * Test insert into bowlers as anon (same as portal form). Run from repo root: node scripts/test-form-insert.mjs
 */
import { createClient } from '@supabase/supabase-js';

const config = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://mqikfwwbrrqkcrwrsfyg.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaWtmd3dicnJxa2Nyd3JzZnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzOTgxMjUsImV4cCI6MjA4NTk3NDEyNX0.kMOs49xw72Vy_SUHcHzMqU1j2YqcHqVU7mRnlUu109U',
  organizationId: process.env.PORTAL_ORGANIZATION_ID || 'ee059661-dfe0-4f81-8c4f-70338fb6b4e8',
};

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const payload = {
  full_name: 'Browser Test User',
  first_name: 'Browser Test',
  last_name: 'User',
  email: `test-${Date.now()}@example.com`,
  mobile: `+1555${String(Date.now()).slice(-7)}`,
  referrer: null,
  country: 'United States',
  status: 'lead',
  organization_id: config.organizationId,
};

const { data, error } = await supabase.from('bowlers').insert(payload).select('id').single();
if (error) {
  console.error('Insert failed:', error.message);
  process.exit(1);
}
console.log('Insert OK, id:', data.id);
process.exit(0);
