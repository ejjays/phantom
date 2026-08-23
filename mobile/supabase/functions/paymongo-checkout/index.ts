/**
 * paymongo-checkout — creates PayMongo hosted-checkout sessions for support
 * tips (e-wallets deep-link out to their own apps) and reports donation
 * status. paymongo secret key lives only here, never in the app (EXPO_PUBLIC_
 * vars are public). rows are recorded in public.donations (schema.sql) by
 * service role; status flips to paid via paymongo-webhook.
 *
 * contract with the app (mobile/src/components/PayMongoCheckoutModal.tsx):
 * both sides use the phantom-pay:// scheme to signal success/cancel — the
 * webview intercepts navigation to it, so no server page needed.
 *
 * setup (one-time):
 *   1. dashboard.paymongo.com -> Settings -> Developers: copy test key
 *      (sk_test_...) — live key needs completed KYC/business verification
 *   2. run the donations block of mobile/supabase/schema.sql
 *   3. supabase secrets set PAYMONGO_SECRET_KEY=sk_test_...
 *   4. supabase functions deploy paymongo-checkout  (verify JWT ON)
 *   5. app env unchanged: supabase url/anon key already provide the client
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

// matched verbatim in PayMongoCheckoutModal.tsx — keep in sync
const SUCCESS_URL = 'phantom-pay://donation/success';
const CANCEL_URL = 'phantom-pay://donation/cancelled';

const MIN_PESOS = 50;
const MAX_PESOS = 50_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!secret) return json({ error: 'payments not configured' }, 503);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let payload: { action?: string; amount?: number; donationId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  if (payload.action === 'status') {
    const id = payload.donationId ?? '';
    if (!/^[0-9a-f-]{36}$/u.test(id)) return json({ error: 'bad id' }, 400);
    const { data: row } = await sb
      .from('donations')
      .select('status, paid_at')
      .eq('id', id)
      .maybeSingle();
    return json({ status: row?.status ?? 'unknown' });
  }

  const amount = payload.amount;
  if (!Number.isInteger(amount) || amount < MIN_PESOS || amount > MAX_PESOS) {
    return json({ error: `amount must be ₱${MIN_PESOS}–₱${MAX_PESOS}` }, 400);
  }

  let donorId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const userSb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userSb.auth.getUser();
    if (user) {
      const { data: profile } = await sb
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (profile) donorId = user.id;
    }
  }

  const { data: donation, error: insertError } = await sb
    .from('donations')
    .insert({
      amount_centavos: amount * 100,
      donor_id: donorId,
      status: 'pending',
      reference_number: crypto.randomUUID().replaceAll('-', ''),
    })
    .select('id, reference_number')
    .single();
  if (insertError || !donation) {
    return json({ error: 'could not record donation' }, 500);
  }

  const res = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${secret}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              name: 'Support Phantom',
              amount: amount * 100,
              currency: 'PHP',
              quantity: 1,
            },
          ],
                    // wallets (gcash/paymaya/grab_pay) gated behind paymongo business
          // verification — only qrph is live; re-add once verified
          payment_method_types: ['qrph'],
          success_url: SUCCESS_URL,
          cancel_url: CANCEL_URL,
          reference_number: donation.reference_number,
          metadata: { donation_id: donation.id },
        },
      },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    await sb.from('donations').update({ status: 'failed' }).eq('id', donation.id);
    return json(
      { error: body?.errors?.[0]?.detail ?? 'paymongo error' },
      res.status >= 500 ? 502 : 400,
    );
  }

  const checkoutUrl = body.data?.attributes?.checkout_url as string | undefined;
  if (!checkoutUrl) {
    await sb.from('donations').update({ status: 'failed' }).eq('id', donation.id);
    return json({ error: 'paymongo missing checkout url' }, 502);
  }

  await sb
    .from('donations')
    .update({ session_id: body.data.id, status: 'pending' })
    .eq('id', donation.id);

  return json({ checkoutUrl, donationId: donation.id });
});