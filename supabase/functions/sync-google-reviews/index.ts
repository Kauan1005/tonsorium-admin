// =========================================================
// Edge Function: sync-google-reviews
//
// Busca nota, total e as avaliações mais relevantes da barbearia
// no Google (Places API "New") e grava nas tabelas google_place /
// google_reviews. A chave do Google fica SÓ aqui (secret do
// Supabase) — nunca vai para o navegador.
//
// Quem pode chamar:
//   - o agendamento diário (pg_cron), com o header x-cron-secret;
//   - um admin logado, pelo botão "Sincronizar agora" do painel.
// Qualquer outra chamada recebe 401.
//
// Secrets necessários (supabase secrets set ...):
//   GOOGLE_PLACES_API_KEY, CRON_SECRET
// =========================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ADMIN_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Comparação em tempo constante, para não vazar o segredo por timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get('x-cron-secret') ?? '';
  if (CRON_SECRET && cronHeader && safeEqual(cronHeader, CRON_SECRET)) return true;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.rpc('is_admin');
  return !error && data === true;
}

interface GoogleReview {
  name: string;
  rating?: number;
  relativePublishTimeDescription?: string;
  publishTime?: string;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
}

interface GooglePlace {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: GoogleReview[];
}

function httpsOrEmpty(url: string | undefined): string {
  return url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!(await isAuthorized(req))) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: cfg, error: cfgError } = await admin
    .from('google_place')
    .select('place_id')
    .eq('id', 1)
    .single();

  if (cfgError || !cfg?.place_id) {
    return json({ error: 'Place ID do Google não configurado no painel.' }, 400);
  }
  if (!GOOGLE_API_KEY) {
    return json({ error: 'Secret GOOGLE_PLACES_API_KEY não configurado.' }, 500);
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(cfg.place_id)}?languageCode=pt-BR`,
      {
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviews',
        },
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Google respondeu ${res.status}: ${detail.slice(0, 300)}`);
    }

    const place = (await res.json()) as GooglePlace;
    const reviews = (place.reviews ?? []).filter((r) => r.name && r.rating);

    const rows = reviews.map((r) => ({
      id: r.name,
      author_name: (r.authorAttribution?.displayName ?? 'Cliente Google').slice(0, 120),
      author_photo_url: httpsOrEmpty(r.authorAttribution?.photoUri),
      author_uri: httpsOrEmpty(r.authorAttribution?.uri),
      rating: Math.min(5, Math.max(1, Math.round(r.rating ?? 5))),
      text: (r.text?.text ?? r.originalText?.text ?? '').slice(0, 4000),
      relative_time: (r.relativePublishTimeDescription ?? '').slice(0, 80),
      publish_time: r.publishTime ?? null,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length) {
      const { error } = await admin.from('google_reviews').upsert(rows);
      if (error) throw error;
    }

    // O Google só devolve as ~5 avaliações mais relevantes; as que
    // saíram dessa lista são removidas para o site espelhar o Google.
    const keepIds = rows.map((r) => r.id);
    const del = admin.from('google_reviews').delete();
    const { error: delError } = keepIds.length
      ? await del.not('id', 'in', `(${keepIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`)
      : await del.neq('id', '');
    if (delError) throw delError;

    const { error: placeError } = await admin
      .from('google_place')
      .update({
        rating: place.rating ?? null,
        user_rating_count: place.userRatingCount ?? null,
        maps_uri: httpsOrEmpty(place.googleMapsUri),
        last_synced_at: new Date().toISOString(),
        last_error: '',
      })
      .eq('id', 1);
    if (placeError) throw placeError;

    return json({ ok: true, rating: place.rating, total: place.userRatingCount, synced: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from('google_place').update({ last_error: message.slice(0, 500) }).eq('id', 1);
    return json({ error: message }, 502);
  }
});
