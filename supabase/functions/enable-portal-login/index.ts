// Create auth user for a bowler and enable portal login.
// Call from the main app with Authorization: Bearer <user access_token>.
// Verifies caller is org owner or admin via organization_members, then uses service role.
// Body: { bowler_id: string, password?: string }. If password omitted, sends invite email.

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
    const { bowler_id, password } = (await req.json()) as { bowler_id?: string; password?: string };
    if (!bowler_id) return new Response(JSON.stringify({ error: 'bowler_id required' }), { status: 400, headers: cors });

    const { data: bowler, error: fetchErr } = await admin.from('bowlers').select('id, email, auth_user_id, login_enabled_at').eq('id', bowler_id).single();
    if (fetchErr || !bowler) return new Response(JSON.stringify({ error: 'Bowler not found' }), { status: 404, headers: cors });
    if (bowler.auth_user_id) return new Response(JSON.stringify({ error: 'Portal login already enabled for this bowler' }), { status: 400, headers: cors });

    let newUserId: string;
    if (password) {
      const { data: userData, error: createErr } = await admin.auth.admin.createUser({
        email: bowler.email,
        password,
        email_confirm: true,
      });
      if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: cors });
      newUserId = userData.user.id;
    } else {
      const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(bowler.email);
      if (inviteErr) return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers: cors });
      newUserId = inviteData.user.id;
    }

    const { error: updateErr } = await admin.from('bowlers').update({
      auth_user_id: newUserId,
      login_enabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', bowler_id);
    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: cors });

    return new Response(JSON.stringify({ ok: true, auth_user_id: newUserId }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
