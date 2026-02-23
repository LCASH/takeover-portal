// Portal welcome SMS via Twilio. Twilio from env TWILIO_* or from bowler's org (organizations.settings.twilio).
// Body: { bowler_id?, first_name, mobile }. Updates bowlers.landing_sms_sent_at / landing_sms_error.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

interface Body {
  bowler_id?: string;
  first_name: string;
  mobile: string;
}

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

async function updateBowlerSmsStatus(bowlerId: string, success: boolean, errorMessage?: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await admin.from('bowlers').update(
    success ? { landing_sms_sent_at: new Date().toISOString(), landing_sms_error: null } : { landing_sms_error: errorMessage ?? 'Unknown error' }
  ).eq('id', bowlerId);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
  let bowler_id: string | undefined;
  try {
    const body = (await req.json()) as Body;
    bowler_id = typeof body.bowler_id === 'string' ? body.bowler_id : undefined;
    const { first_name, mobile } = body;
    if (!first_name || !mobile) {
      return new Response(JSON.stringify({ error: 'first_name and mobile required' }), { status: 400, headers: cors });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Server config missing' }), { status: 500, headers: cors });
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const twilio = await getTwilioConfig(admin, bowler_id);
    const { accountSid, authToken, fromNumber } = twilio;
    const to = mobile.startsWith('+') ? mobile : '+' + mobile.replace(/\D/g, '');
    const smsBody =
      `Hey ${first_name}, for authentication reasons i need to make sure you are who you say you are. In order to do this i just need you to record a video saying: "hey this is (your name)"`;
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
      const errMsg = (data?.message || 'Twilio error') as string;
      if (bowler_id) await updateBowlerSmsStatus(bowler_id, false, errMsg);
      return new Response(JSON.stringify({ error: errMsg }), { status: res.status, headers: cors });
    }
    if (bowler_id) await updateBowlerSmsStatus(bowler_id, true);
    return new Response(JSON.stringify({ sid: data.sid }), { status: 200, headers: cors });
  } catch (e) {
    const errMsg = String(e);
    if (bowler_id) await updateBowlerSmsStatus(bowler_id, false, errMsg);
    return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers: cors });
  }
});
