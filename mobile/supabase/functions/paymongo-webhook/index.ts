/**
 * paymongo-webhook — marks donations paid when PayMongo confirms. verifies
 * the Paymongo-Signature header (HMAC-SHA256 of `t.<payload>` with the
 * webhook's own whsk_... secret, shown on the webhook details page) so
 * stragglers can't fake donations. must deploy with verify JWT OFF —
 * PayMongo POSTs this directly.
 *
 * setup (dashboard, no CLI needed):
 *   1. dashboard.paymongo.com -> Settings -> Webhooks -> add endpoint:
 *        url:   https://<project>.supabase.co/functions/v1/paymongo-webhook
 *        event: checkout_session.payment.paid
 *        -> copy its Secret Key (whsk_...)
 *   2. supabase dashboard -> Project Settings -> Edge Functions -> Secrets:
 *        PAYMONGO_WEBHOOK_SIG = whsk_...
 *        (falls back to PAYMONGO_SECRET_KEY when unset — both work if the
 *        endpoint was created with "Use Account Secret" style older webhooks)
 *   3. deploy in the dashboard Edge Functions editor with Verify JWT OFF,
 *        then re-paste/redeploy whenever this file changes
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function verify(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const mode = parts.find((p) => p.startsWith('li=')) ? 'li' : 'te';
  const expected = parts.find((p) => p.startsWith(`${mode}=`))?.slice(3);
  if (!t || !expected) return false;

  const secret =
    Deno.env.get('PAYMONGO_WEBHOOK_SIG') ?? Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex === expected;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const raw = await req.text();
  if (!(await verify(raw, req.headers.get('Paymongo-Signature')))) {
    return json({ error: 'bad signature' }, 401);
  }

  let event: { type?: string; data?: { attributes?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid payload' }, 400);
  }

  if (event.type !== 'checkout_session.payment.paid') return json({ ok: true });

  // ack fast; the session reference (donation id) uniquely matches our row
  const attrs = event.data?.attributes ?? {};
  const reference = attrs.reference_number as string | undefined;
  if (!reference) return json({ ok: true });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { error } = await sb
    .from('donations')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('reference_number', reference);

  if (error) {
    console.error('donation update failed', error.message);
    return json({ ok: false }, 500);
  }
  return json({ ok: true });
});