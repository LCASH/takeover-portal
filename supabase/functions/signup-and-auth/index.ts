// Combined signup + auth: creates bowler record, auth user, and returns session.
// Called anonymously from the landing page Step 1 form.
// Body: { full_name, first_name, last_name, email, mobile, referrer, country, organization_id }
// Returns: { bowler_id, access_token, refresh_token }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) pw += chars[b % chars.length];
  return pw;
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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as Body;
    const { full_name, first_name, last_name, email, mobile, referrer, country, organization_id } = body;

    if (!full_name || !first_name || !email || !mobile || !country) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // 1. Create bowler record
    const { data: bowler, error: insertErr } = await admin.from('bowlers').insert({
      full_name,
      first_name,
      last_name: last_name || null,
      email: email.trim().toLowerCase(),
      mobile,
      referrer: referrer || null,
      country,
      organization_id: organization_id || null,
      status: 'lead',
    }).select('id').single();

    if (insertErr) {
      const isUnique = insertErr.code === '23505' || (insertErr.message && insertErr.message.includes('unique'));
      if (isUnique) {
        // Returning user — look up existing bowler and re-authenticate
        const { data: existing } = await admin.from('bowlers')
          .select('id, auth_user_id, encrypted_password, required_form_completed_at')
          .eq('email', email.trim().toLowerCase())
          .maybeSingle();

        if (existing && !existing.required_form_completed_at && existing.auth_user_id && existing.encrypted_password) {
          // Form not completed — re-auth so they can resume Step 2
          const userClient = createClient(supabaseUrl, anonKey!, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password: existing.encrypted_password,
          });
          if (signInErr) {
            return new Response(JSON.stringify({ error: 'Could not re-authenticate. Please contact support.' }), {
              status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({
            bowler_id: existing.id,
            access_token: signInData.session!.access_token,
            refresh_token: signInData.session!.refresh_token,
          }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({ error: 'This email or phone is already registered.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bowlerId = bowler.id;
    const password = generatePassword();

    // 2. Create auth user
    const { data: userData, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    });

    if (createErr) {
      // Clean up the bowler row if auth user creation fails
      await admin.from('bowlers').delete().eq('id', bowlerId);
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authUserId = userData.user.id;

    // 3. Link auth user to bowler and store encrypted password
    // NOTE: login_enabled_at is NOT set — that happens when admin approves
    const { error: updateErr } = await admin.from('bowlers').update({
      auth_user_id: authUserId,
      encrypted_password: password,
    }).eq('id', bowlerId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Sign in as the user to get session tokens
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInErr) {
      return new Response(JSON.stringify({ error: 'Account created but sign-in failed: ' + signInErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      bowler_id: bowlerId,
      access_token: signInData.session!.access_token,
      refresh_token: signInData.session!.refresh_token,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
