// Enable portal login for a bowler.
// Call from the main app with Authorization: Bearer <user access_token>.
// Verifies caller is org owner or admin via organization_members, then uses service role.
// Body: { bowler_id: string, password?: string }
// If auth_user_id already exists (from signup-and-auth), skips user creation and returns stored credential_password.
// If auth_user_id is null (legacy lead), creates auth user with provided password or sends invite.
// Returns: { ok, auth_user_id, credential_password } — caller is responsible for SMS via messages table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return new Response(JSON.stringify({ error: 'Authorization required' }), { status: 401, headers: cors });

  const userId = getUserIdFromJwt(token);
  if (!userId) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: cors });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: member } = await admin.from('organization_members').select('role').eq('user_id', userId).limit(1).maybeSingle();
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return new Response(JSON.stringify({ error: 'Only org owner or admin can enable portal login' }), { status: 403, headers: cors });
  }

  try {
    const { bowler_id, password: providedPassword } = (await req.json()) as { bowler_id?: string; password?: string };
    if (!bowler_id) return new Response(JSON.stringify({ error: 'bowler_id required' }), { status: 400, headers: cors });

    const { data: bowler, error: fetchErr } = await admin.from('bowlers')
      .select('id, email, first_name, mobile, auth_user_id, login_enabled_at, encrypted_password, organization_id')
      .eq('id', bowler_id).single();
    if (fetchErr || !bowler) return new Response(JSON.stringify({ error: 'Bowler not found' }), { status: 404, headers: cors });

    let authUserId = bowler.auth_user_id;
    let credentialPassword = bowler.encrypted_password || providedPassword || null;

    // If no auth user yet (legacy lead), create one
    if (!authUserId) {
      const pw = providedPassword || crypto.randomUUID().slice(0, 12);
      if (providedPassword) {
        const { data: userData, error: createErr } = await admin.auth.admin.createUser({
          email: bowler.email,
          password: pw,
          email_confirm: true,
        });
        if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: cors });
        authUserId = userData.user.id;
      } else {
        const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(bowler.email);
        if (inviteErr) return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers: cors });
        authUserId = inviteData.user.id;
      }
      credentialPassword = pw;
    }

    // Enable login
    const { error: updateErr } = await admin.from('bowlers').update({
      auth_user_id: authUserId,
      login_enabled_at: new Date().toISOString(),
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    }).eq('id', bowler_id);
    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: cors });

    // Return credential_password so the caller (TAKEOVER UI) can write notes + inbox messages
    // with the correct password (the stored one for new portal leads, or the provided one for legacy leads).
    return new Response(JSON.stringify({
      ok: true,
      auth_user_id: authUserId,
      credential_password: credentialPassword,
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
