/**
 * r2-upload-url — issues a short-lived presigned R2 PUT URL to an authenticated,
 * non-anonymous user. app uploads the webp bytes straight to R2, then stores the
 * returned publicUrl in comments.image_url. R2 secret keys live only here.
 *
 * images are served back through a Cloudflare Pages Function bound to the bucket
 * (see docs/image-uploads.md), NOT the r2.dev public url — that dev url is
 * rate-limited & not meant for production, so the bucket stays private.
 *
 * setup (one-time, Cloudflare R2 + Supabase dashboard):
 *   1. R2 -> create bucket (phantom-uploads), Standard class; keep it private
 *   2. R2 -> Manage API Tokens -> Create Account API Token: Object Read & Write,
 *        scoped to that bucket -> copy Access Key ID + Secret (secret shown once)
 *   3. deploy this fn (dashboard editor or `supabase functions deploy`), Verify
 *        JWT OFF — auth is done in-code below (rejects anon)
 *   4. set 5 Edge Function secrets: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID,
 *        R2_SECRET_ACCESS_KEY, and R2_PUBLIC_BASE (the Pages image route, e.g.
 *        https://nex-stream.pages.dev/i)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing auth' }, 401);

  // resolve caller from their supabase JWT; reject anon (matches comment RLS)
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return json({ error: 'not signed in' }, 403);

  const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
  const bucket = Deno.env.get('R2_BUCKET')!;
  const publicBase = Deno.env.get('R2_PUBLIC_BASE')!.replace(/\/+$/u, '');

  const key = `comments/${user.id}/${crypto.randomUUID()}.webp`;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: 'auto',
  });

  // presign as query params so the app can PUT with no auth headers; 10 min ttl
  const signUrl = new URL(endpoint);
  signUrl.searchParams.set('X-Amz-Expires', '600');
  const signed = await r2.sign(new Request(signUrl, { method: 'PUT' }), {
    aws: { signQuery: true },
  });

  return json({ uploadUrl: signed.url, publicUrl: `${publicBase}/${key}` });
});
