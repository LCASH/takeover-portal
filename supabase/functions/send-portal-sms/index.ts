// Portal SMS via Twilio. Called from the landing form after a successful
// signup-and-auth. The only input the client controls is `bowler_id`; every
// other value (recipient mobile, first name, organization) is loaded from the
// bowler row server-side. This closes the SMS-pumping/phishing vector where
// an attacker with the anon JWT could send arbitrary SMS to any number.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';

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

const RATE_LIMIT_SECONDS = 300; // one SMS per bowler per 5 minutes

const ENV_ALIASES: Record<string, string[]> = {
  TWILIO_ACCOUNT_SID: ['TWILIO_ACCOUNT_SID', 'twilio_account_sid'],
  TWILIO_AUTH_TOKEN: ['TWILIO_AUTH_TOKEN', 'twilio_auth_token'],
  TWILIO_PHONE_NUMBER: ['TWILIO_PHONE_NUMBER', 'twilio_phone_number'],
};

function getEnv(name: string): string | null {
  for (const k of ENV_ALIASES[name] || [name]) {
    const v = Deno.env.get(k);
    if (v) return v;
  }
  return null;
}

interface TwilioCfg { accountSid: string; authToken: string; fromNumber: string }

async function getTwilioConfig(admin: SupabaseClient, organizationId: string | null): Promise<TwilioCfg> {
  const fromEnv = {
    accountSid: getEnv('TWILIO_ACCOUNT_SID'),
    authToken: getEnv('TWILIO_AUTH_TOKEN'),
    fromNumber: getEnv('TWILIO_PHONE_NUMBER'),
  };
  if (fromEnv.accountSid && fromEnv.authToken && fromEnv.fromNumber) return fromEnv as TwilioCfg;

  if (!organizationId) throw new Error('Missing Twilio config and no organization on bowler');
  const { data: org } = await admin.from('organizations').select('settings').eq('id', organizationId).single();
  const t = (org?.settings as { twilio?: { account_sid?: string; auth_token?: string; phone_number?: string } })?.twilio;
  if (t?.account_sid?.startsWith('AC') && t?.auth_token && (t?.phone_number || fromEnv.fromNumber)) {
    return {
      accountSid: t.account_sid,
      authToken: t.auth_token,
      fromNumber: (t.phone_number ?? fromEnv.fromNumber ?? '').replace(/\s/g, ''),
    };
  }
  throw new Error('Missing Twilio config');
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server config missing' }), { status: 500, headers });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let bowlerId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    bowlerId = typeof body?.bowler_id === 'string' ? body.bowler_id : undefined;
    if (!bowlerId) {
      return new Response(JSON.stringify({ error: 'bowler_id required' }), { status: 400, headers });
    }

    const { data: bowler, error: fetchErr } = await admin.from('bowlers')
      .select('id, first_name, mobile, organization_id, landing_sms_sent_at')
      .eq('id', bowlerId).maybeSingle();
    if (fetchErr || !bowler) {
      return new Response(JSON.stringify({ error: 'Bowler not found' }), { status: 404, headers });
    }

    if (bowler.landing_sms_sent_at) {
      const last = new Date(bowler.landing_sms_sent_at).getTime();
      if (Date.now() - last < RATE_LIMIT_SECONDS * 1000) {
        return new Response(JSON.stringify({ error: 'SMS already sent recently', already_sent: true }), { status: 429, headers });
      }
    }

    if (!bowler.mobile) {
      return new Response(JSON.stringify({ error: 'Bowler has no mobile' }), { status: 400, headers });
    }

    const twilio = await getTwilioConfig(admin, bowler.organization_id ?? null);

    const { data: org } = await admin.from('organizations').select('settings').eq('id', bowler.organization_id).maybeSingle();
    const telegramUrl = (org?.settings as { portal?: { telegram_invite_url?: string } })?.portal?.telegram_invite_url
      || Deno.env.get('PORTAL_TELEGRAM_INVITE_URL') || '';

    const to = bowler.mobile.startsWith('+') ? bowler.mobile : '+' + bowler.mobile.replace(/\D/g, '');
    const firstName = (bowler.first_name || 'there').slice(0, 80);
    const smsBody = telegramUrl
      ? `Hey ${firstName}, thanks for signing up! You can reach out here if you have questions about how we use your betting account or chat with our community here: ${telegramUrl}`
      : `Hey ${firstName}, thanks for signing up! We're reviewing your application and will be in touch soon.`;

    const url = `${TWILIO_URL}/${twilio.accountSid}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: twilio.fromNumber, Body: smsBody });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(twilio.accountSid + ':' + twilio.authToken),
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = (data?.message || 'Twilio error') as string;
      await admin.from('bowlers').update({ landing_sms_error: errMsg }).eq('id', bowlerId);
      return new Response(JSON.stringify({ error: errMsg }), { status: res.status, headers });
    }
    await admin.from('bowlers').update({ landing_sms_sent_at: new Date().toISOString(), landing_sms_error: null }).eq('id', bowlerId);
    return new Response(JSON.stringify({ sid: data.sid }), { status: 200, headers });
  } catch (e) {
    const errMsg = String(e);
    if (bowlerId) await admin.from('bowlers').update({ landing_sms_error: errMsg }).eq('id', bowlerId);
    return new Response(JSON.stringify({ error: errMsg }), { status: 500, headers });
  }
});
