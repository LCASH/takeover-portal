// Supabase Edge Function: send portal welcome SMS via Twilio (default number).
// Set secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (E.164).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts';

interface Body {
  first_name: string;
  mobile: string;
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const { first_name, mobile } = (await req.json()) as Body;
    if (!first_name || !mobile) {
      return new Response(JSON.stringify({ error: 'first_name and mobile required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const accountSid = getEnv('TWILIO_ACCOUNT_SID');
    const authToken = getEnv('TWILIO_AUTH_TOKEN');
    const fromNumber = getEnv('TWILIO_PHONE_NUMBER');
    const to = mobile.startsWith('+') ? mobile : '+' + mobile.replace(/\D/g, '');
    const body =
      `Hey ${first_name}, for authentication reasons i need to make sure you are who you say you are. In order to do this i just need you to record a video saying "hey this is (your name)"`;
    const url = `${TWILIO_URL}/${accountSid}/Messages.json`;
    const params = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
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
      return new Response(JSON.stringify({ error: data.message || 'Twilio error' }), { status: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response(JSON.stringify({ sid: data.sid }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
});
