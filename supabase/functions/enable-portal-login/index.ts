// Admin-only: create auth user for a bowler and enable portal login.
// Call with service role or set SUPABASE_SERVICE_ROLE_KEY in secrets.
// Body: { bowler_id: string, password?: string }. If password omitted, use magic link (user sets password).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500, headers: cors });

  try {
    const { bowler_id, password } = (await req.json()) as { bowler_id?: string; password?: string };
    if (!bowler_id) return new Response(JSON.stringify({ error: 'bowler_id required' }), { status: 400, headers: cors });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: bowler, error: fetchErr } = await admin.from('bowlers').select('id, email, auth_user_id, login_enabled_at').eq('id', bowler_id).single();
    if (fetchErr || !bowler) return new Response(JSON.stringify({ error: 'Bowler not found' }), { status: 404, headers: cors });
    if (bowler.auth_user_id) return new Response(JSON.stringify({ error: 'Portal login already enabled for this bowler' }), { status: 400, headers: cors });

    let userId: string;
    if (password) {
      const { data: userData, error: createErr } = await admin.auth.admin.createUser({
        email: bowler.email,
        password,
        email_confirm: true,
      });
      if (createErr) return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: cors });
      userId = userData.user.id;
    } else {
      const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(bowler.email);
      if (inviteErr) return new Response(JSON.stringify({ error: inviteErr.message }), { status: 400, headers: cors });
      userId = inviteData.user.id;
    }

    const { error: updateErr } = await admin.from('bowlers').update({
      auth_user_id: userId,
      login_enabled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', bowler_id);
    if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: cors });

    return new Response(JSON.stringify({ ok: true, auth_user_id: userId }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
