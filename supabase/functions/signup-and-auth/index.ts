// Combined signup + auth: creates bowler record, auth user, returns session, and sends credentials SMS.
// Called anonymously from the landing page Step 1 form.
// Body: { full_name, first_name, last_name, email, mobile, referrer, country, organization_id }
// Returns: { bowler_id, access_token, refresh_token, sms_sent, sms_error }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) pw += chars[b % chars.length];
  return pw;
}

// --- Twilio helpers (same pattern as enable-portal-login) ---
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

async function getTwilioConfig(
  admin: ReturnType<typeof createClient>,
  organizationId?: string | null,
): Promise<{ accountSid: string; authToken: string; fromNumber: string } | null> {
  const fromEnv = {
    accountSid: getEnv('TWILIO_ACCOUNT_SID'),
    authToken: getEnv('TWILIO_AUTH_TOKEN'),
    fromNumber: getEnv('TWILIO_PHONE_NUMBER'),
  };
  if (fromEnv.accountSid && fromEnv.authToken && fromEnv.fromNumber) {
    return fromEnv as { accountSid: string; authToken: string; fromNumber: string };
  }
  if (!organizationId) return null;
  const { data: org } = await admin
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .single();
  const t = (
    org?.settings as {
      twilio?: { account_sid?: string; auth_token?: string; phone_number?: string };
    }
  )?.twilio;
  if (
    t?.account_sid?.startsWith('AC') &&
    t?.auth_token &&
    (t?.phone_number || fromEnv.fromNumber)
  ) {
    return {
      accountSid: t.account_sid,
      authToken: t.auth_token,
      fromNumber: (t.phone_number ?? fromEnv.fromNumber ?? '').replace(/\s/g, ''),
    };
  }
  return null;
}

interface Body {
  full_name: string;
  first_name: string;
  last_name?: string;
  email: string;
  mobile: string;
  referrer?: string;
  country: string;
  organization_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = (await req.json()) as Body;
    const {
      full_name,
      first_name,
      last_name,
      email,
      mobile,
      referrer,
      country,
      organization_id,
    } = body;

    if (!full_name || !first_name || !email || !mobile || !country) {
      return json({ error: 'Missing required fields' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: 'Server not configured' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Create bowler record
    const { data: bowler, error: insertErr } = await admin
      .from('bowlers')
      .insert({
        full_name,
        first_name,
        last_name: last_name || null,
        email: email.trim().toLowerCase(),
        mobile,
        referrer: referrer || null,
        country,
        organization_id: organization_id || null,
        status: 'lead',
      })
      .select('id')
      .single();

    if (insertErr) {
      const isUnique =
        insertErr.code === '23505' ||
        (insertErr.message && insertErr.message.includes('unique'));
      return json(
        {
          error: isUnique
            ? 'This email or phone is already registered.'
            : insertErr.message,
        },
        isUnique ? 409 : 400,
      );
    }

    const bowlerId = bowler.id;
    const password = generatePassword();

    // 2. Create auth user
    const { data: userData, error: createErr } = await admin.auth.admin.createUser(
      {
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
      },
    );

    if (createErr) {
      await admin.from('bowlers').delete().eq('id', bowlerId);
      return json({ error: createErr.message }, 400);
    }

    const authUserId = userData.user.id;

    // 3. Link auth user to bowler and store password
    const { error: updateErr } = await admin
      .from('bowlers')
      .update({
        auth_user_id: authUserId,
        encrypted_password: password,
      })
      .eq('id', bowlerId);

    if (updateErr) {
      return json({ error: updateErr.message }, 500);
    }

    // 4. Sign in as the user to get session tokens
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } =
      await userClient.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

    if (signInErr) {
      return json(
        { error: 'Account created but sign-in failed: ' + signInErr.message },
        500,
      );
    }

    // 5. Send credentials SMS via Twilio (non-blocking — success still returned even if SMS fails)
    let smsSent = false;
    let smsError: string | null = null;

    try {
      const twilio = await getTwilioConfig(admin, organization_id || null);
      if (twilio) {
        const { accountSid, authToken, fromNumber } = twilio;
        const to = mobile.startsWith('+')
          ? mobile
          : '+' + mobile.replace(/\D/g, '');
        const portalUrl = Deno.env.get('PORTAL_URL') || 'https://your-portal.vercel.app';

        const smsBody =
          `Hey ${first_name}, thanks for joining! Your login details:\n\n` +
          `Email: ${email.trim().toLowerCase()}\n` +
          `Password: ${password}\n\n` +
          `We'll review your application within 24hrs and reach out.\n` +
          `Log in anytime at ${portalUrl}/login.html`;

        const url = `${TWILIO_URL}/${accountSid}/Messages.json`;
        const params = new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: smsBody,
        });
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
      } else {
        smsError = 'Twilio not configured';
      }
    } catch (e) {
      smsError = String(e);
    }

    // Track SMS status on bowler row
    await admin
      .from('bowlers')
      .update(
        smsSent
          ? { landing_sms_sent_at: new Date().toISOString(), landing_sms_error: null }
          : { landing_sms_error: smsError },
      )
      .eq('id', bowlerId);

    return json({
      bowler_id: bowlerId,
      access_token: signInData.session!.access_token,
      refresh_token: signInData.session!.refresh_token,
      sms_sent: smsSent,
      sms_error: smsError,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
