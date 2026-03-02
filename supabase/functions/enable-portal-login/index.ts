// Enable portal login and send credentials SMS.
// Call from the main app with Authorization: Bearer <user access_token>.
// Verifies caller is org owner or admin via organization_members, then uses service role.
// Body: { bowler_id: string, password?: string }
// If auth_user_id already exists (from signup-and-auth), skips user creation and sends stored credentials.
// If auth_user_id is null (legacy lead), creates auth user as before.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const ENV_ALIASES: Record<string, string[]> = {
  TWILIO_ACCOUNT_SID: ['TWILIO_ACCOUNT_SID', 'twilio_account_sid'],
  TWILIO_AUTH_TOKEN: ['TWILIO_AUTH_TOKEN', 'twilio_auth_token'],
  TWILIO_PHONE_NUMBER: ['TWILIO_PHONE_NUMBER', 'twilio_phone_number'],
};

function getEnv(name: string): string | null {
  const aliases = ENV_ALIASES[name] || [name];
  for (const key of aliases) {
    const v = Deno.env.get(key);
    if (v) return v;
  }
  return null;
}

async function getTwilioConfig(admin: ReturnType<typeof createClient>, bowlerId?: string): Promise<{ accountSid: string; authToken: string; fromNumber: string }> {
  const fromEnv = { accountSid: getEnv('TWILIO_ACCOUNT_SID'), authToken: getEnv('TWILIO_AUTH_TOKEN'), fromNumber: getEnv('TWILIO_PHONE_NUMBER') };
  if (fromEnv.accountSid && fromEnv.authToken && fromEnv.fromNumber) return fromEnv as { accountSid: string; authToken: string; fromNumber: string };
  let organizationId: string | null = null;
  if (bowlerId) {
    const { data: bowler } = await admin.from('bowlers').select('organization_id').eq('id', bowlerId).single();
    organizationId = bowler?.organization_id ?? null;
  }
  if (!organizationId) throw new Error('Missing Twilio (set env TWILIO_* or add Twilio in org Settings > Integrations)');
  const { data: org } = await admin.from('organizations').select('settings').eq('id', organizationId).single();
  const t = (org?.settings as { twilio?: { account_sid?: string; auth_token?: string; phone_number?: string } })?.twilio;
  if (t?.account_sid?.startsWith('AC') && t?.auth_token && (t?.phone_number || fromEnv.fromNumber))
    return { accountSid: t.account_sid, authToken: t.auth_token, fromNumber: (t.phone_number ?? fromEnv.fromNumber ?? '').replace(/\s/g, '') };
  throw new Error('Missing Twilio in org settings. Go to Settings > Integrations.');
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

    // Send credentials SMS via Twilio
    let smsSent = false;
    let smsError: string | null = null;
    try {
      const twilio = await getTwilioConfig(admin, bowler_id);
      const { accountSid, authToken, fromNumber } = twilio;
      const to = bowler.mobile.startsWith('+') ? bowler.mobile : '+' + bowler.mobile.replace(/\D/g, '');
      const portalUrl = Deno.env.get('PORTAL_URL') || 'the portal';
      const smsBody = credentialPassword
        ? `Hey ${bowler.first_name}, your application has been approved! Login: ${bowler.email} / Password: ${credentialPassword}. To cancel or update your partnership, log in at ${portalUrl}/login`
        : `Hey ${bowler.first_name}, your application has been approved! Log in at ${portalUrl}/login with your email ${bowler.email}. To cancel or update your partnership, visit Account after logging in.`;

      const url = `${TWILIO_URL}/${accountSid}/Messages.json`;
      const params = new URLSearchParams({ To: to, From: fromNumber, Body: smsBody });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + btoa(accountSid + ':' + authToken),
        },
        body: params.toString(),
      });
      const data = await res.json();
      if (!res.ok) {
        smsError = (data?.message || 'Twilio error') as string;
      } else {
        smsSent = true;
      }
    } catch (e) {
      smsError = String(e);
    }

    // Update SMS tracking
    await admin.from('bowlers').update(
      smsSent
        ? { credentials_sms_sent_at: new Date().toISOString(), credentials_sms_error: null }
        : { credentials_sms_error: smsError }
    ).eq('id', bowler_id);

    return new Response(JSON.stringify({
      ok: true,
      auth_user_id: authUserId,
      sms_sent: smsSent,
      sms_error: smsError,
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
