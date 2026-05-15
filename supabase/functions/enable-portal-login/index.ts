// Enable portal login for a bowler.
// Call from the main app with Authorization: Bearer <user access_token>.
// Verifies caller is org owner or admin via organization_members, then uses service role.
// Body: { bowler_id: string, password?: string }
// If auth_user_id already exists (from signup-and-auth), skips user creation and returns stored credential_password.
// If auth_user_id is null (legacy lead), creates auth user with provided password or sends invite.
// Returns: { ok, auth_user_id, credential_password } — caller is responsible for SMS via messages table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function corsHeaders(origin: string | null): HeadersInit {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || 'null');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

function getUserIdFromJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return new Response(JSON.stringify({ error: 'Authorization required' }), { status: 401, headers });

  const userId = getUserIdFromJwt(token);
  if (!userId) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: member } = await admin.from('organization_members').select('role').eq('user_id', userId).limit(1).maybeSingle();
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return new Response(JSON.stringify({ error: 'Only org owner or admin can enable portal login' }), { status: 403, headers });
  }

  try {
    const { bowler_id, password: providedPassword } = (await req.json()) as { bowler_id?: string; password?: string };
    if (!bowler_id) return new Response(JSON.stringify({ error: 'bowler_id required' }), { status: 400, headers });

    const { data: bowler, error: fetchErr } = await admin.from('bowlers')
      .select('id, email, first_name, mobile, auth_user_id, login_enabled_at, organization_id')
      .eq('id', bowler_id).single();
    if (fetchErr || !bowler) return new Response(JSON.stringify({ error: 'Bowler not found' }), { status: 404, headers });

    let authUserId = bowler.auth_user_id;

    if (!authUserId) {
      if (providedPassword) {
        const { data: userData, error: createErr } = await admin.auth.admin.createUser({
          email: bowler.email,
          password: providedPassword,
          email_confirm: true,
        });
        if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers });
        authUserId = userData.user.id;
      } else {
        const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(bowler.email);
        if (inviteErr) return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers });
        authUserId = inviteData.user.id;
      }
    } else if (providedPassword) {
      // Existing auth user — admin is rotating the password.
      const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, { password: providedPassword });
      if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 400, headers });
    }

    const { error: updateErr } = await admin.from('bowlers').update({
      auth_user_id: authUserId,
      login_enabled_at: new Date().toISOString(),
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    }).eq('id', bowler_id);
    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers });

    // Never return passwords. The caller must collect a password from the admin
    // before calling (providedPassword) or use the invite-email flow.
    return new Response(JSON.stringify({
      ok: true,
      auth_user_id: authUserId,
      password_set: Boolean(providedPassword),
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});
