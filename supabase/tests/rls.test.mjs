// Testes de segurança do banco: roda o schema.sql num Postgres local (PGlite)
// imitando o Supabase (papéis anon/authenticated/service_role, schema auth com
// uid/jwt/2FA e storage) e confere quem pode ler e alterar o quê.
//
//   npm run test:db
//
// Não precisa de Docker nem de conta no Supabase.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const schemaPath = process.argv[2] || fileURLToPath(new URL('../schema.sql', import.meta.url));
const schema = readFileSync(schemaPath, 'utf8');
const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email varchar(255),
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    last_sign_in_at timestamptz
  );
  create table auth.mfa_factors (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    status text not null
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
    declare _parts text[];
    begin
      select string_to_array(name, '/') into _parts;
      return _parts[1:array_length(_parts, 1) - 1];
    end $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated;

  create publication supabase_realtime;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

// Banco "antigo": algumas linhas antes do schema novo (simula o projeto no ar).
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-0000-0000-0000000000a1', 'admin@x.com', now()),
    ('00000000-0000-0000-0000-0000000000c1', 'cliente@x.com', now());
`);

await db.exec(schema);
console.log('schema.sql: 1ª execução OK');
await db.exec(schema);
console.log('schema.sql: 2ª execução OK (idempotente)');

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const CUST = '00000000-0000-0000-0000-0000000000c1';
const UB1 = '00000000-0000-0000-0000-0000000000b1';
const UB2 = '00000000-0000-0000-0000-0000000000b2';
const B1 = '10000000-0000-0000-0000-000000000001';
const B2 = '10000000-0000-0000-0000-000000000002';
const B3 = '10000000-0000-0000-0000-000000000003';

await db.exec(`
  insert into public.barbers (id, name, role, active, position) values
    ('${B1}', 'Guilherme', 'Visagismo', true, 1),
    ('${B2}', 'Mario', 'Platinado', true, 2),
    ('${B3}', 'Oculto', '', false, 3);
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    ('${UB1}', 'gui@tonsorium.app', now(), '{"full_name":"Guilherme"}'),
    ('${UB2}', 'mario@tonsorium.app', now(), '{"full_name":"Mario"}');
  update public.profiles set role = 'admin' where id = '${ADMIN}';
  update public.profiles set role = 'barber', barber_id = '${B1}' where id = '${UB1}';
  update public.profiles set role = 'barber', barber_id = '${B2}' where id = '${UB2}';
  insert into auth.mfa_factors (user_id, status) values ('${ADMIN}', 'verified');
`);

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'OK  ' : 'FALHOU'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function as(uid, aal, fn) {
  await db.exec('reset role');
  const claims = uid ? { sub: uid, role: 'authenticated', aal } : { role: 'anon' };
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [uid ?? '', JSON.stringify(claims)]
  );
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function tryQuery(sql, params) {
  try {
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
  }
}

const day = (h, m = 0) => `(current_date + 1 + time '${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}')::timestamp at time zone 'America/Sao_Paulo'`;

// ---------- Agenda: barbeiro ----------
await as(UB1, 'aal1', async () => {
  let r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at, client_name, service, notes)
    values ('${B1}', ${day(10)}, ${day(11)}, '  João Silva  ', 'Corte + barba', 'Degradê baixo') returning client_name, created_by`);
  check('barbeiro marca horário na própria agenda', r.ok, r.error);
  check('nome do cliente sai sem espaços e created_by = barbeiro', r.ok && r.rows[0].client_name === 'João Silva' && r.rows[0].created_by === UB1);

  r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B2}', ${day(10)}, ${day(11)})`);
  check('barbeiro NÃO marca na agenda de outro', !r.ok && /row-level security/.test(r.error), r.error);

  r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B1}', ${day(10, 30)}, ${day(11, 30)})`);
  check('horário sobreposto é recusado', !r.ok && r.code === '23P01', r.error);

  r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B1}', ${day(11)}, ${day(11, 30)})`);
  check('horário colado (11:00 logo após 10-11) é aceito', r.ok, r.error);

  r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B1}', ${day(12)}, ${day(12)})`);
  check('fim antes/igual ao início é recusado', !r.ok, r.error);

  r = await tryQuery(`select barber_id from public.appointments`);
  check('barbeiro só vê a própria agenda', r.ok && r.rows.length === 2 && r.rows.every((x) => x.barber_id === B1));

  r = await tryQuery(`select * from public.staff_context()`);
  check('staff_context devolve barbeiro + nome', r.ok && r.rows[0]?.role === 'barber' && r.rows[0]?.barber_id === B1 && r.rows[0]?.barber_name === 'Guilherme');

  r = await tryQuery(`select * from public.staff_accounts()`);
  check('barbeiro não lista logins', r.ok && r.rows.length === 0);

  r = await tryQuery(`select public.remove_staff_login('${B2}')`);
  check('barbeiro não remove logins', !r.ok, r.error);

  // Perfil na Equipe
  r = await tryQuery(`update public.barbers set name = 'Hacker', active = false, position = 99, bio = 'Nova bio', role = 'Degradê' where id = '${B1}' returning name, active, position, bio, role`);
  check('barbeiro edita bio/especialidade; nome, visibilidade e ordem ficam travados',
    r.ok && r.rows[0].name === 'Guilherme' && r.rows[0].active === true && r.rows[0].position === 1 && r.rows[0].bio === 'Nova bio' && r.rows[0].role === 'Degradê', JSON.stringify(r.rows ?? r.error));

  r = await tryQuery(`update public.barbers set bio = 'x' where id = '${B2}'`);
  check('barbeiro não edita outro barbeiro', r.ok && r.affected === 0);

  r = await tryQuery(`update public.barbers set photo_url = 'https://evil.com/a.jpg' where id = '${B1}'`);
  check('foto de fora da pasta dele é recusada', !r.ok && /invalid photo url/.test(r.error), r.error);

  r = await tryQuery(`update public.barbers set photo_url = 'https://abc.supabase.co/storage/v1/object/public/site-assets/barbers/${B1}/photo-1.jpg' where id = '${B1}'`);
  check('foto na pasta dele é aceita', r.ok && r.affected === 1, r.error);

  r = await tryQuery(`update public.barbers set bio = 'y' where id = '${B1}'`);
  check('foto antiga sem mexer não bloqueia salvar a bio', r.ok && r.affected === 1, r.error);

  r = await tryQuery(`update public.profiles set role = 'admin', barber_id = '${B2}' where id = '${UB1}' returning role, barber_id`);
  check('barbeiro não vira admin nem troca de barbeiro', r.ok && r.rows[0].role === 'barber' && r.rows[0].barber_id === B1);

  r = await tryQuery(`update public.site_hero set title = 'x' where id = 1`);
  check('barbeiro não edita o conteúdo do site', r.ok && r.affected === 0);

  // Storage
  r = await tryQuery(`insert into storage.objects (bucket_id, name) values ('site-assets', 'barbers/${B1}/photo-2.jpg')`);
  check('barbeiro envia foto na pasta dele', r.ok, r.error);
  r = await tryQuery(`insert into storage.objects (bucket_id, name) values ('site-assets', 'barbers/${B2}/photo-2.jpg')`);
  check('barbeiro NÃO envia na pasta de outro', !r.ok, r.error);
  r = await tryQuery(`insert into storage.objects (bucket_id, name) values ('site-assets', 'hero-123.png')`);
  check('barbeiro NÃO envia fora da pasta barbers', !r.ok, r.error);

  // Avaliações e exclusão de conta
  r = await tryQuery(`insert into public.reviews (rating, comment) values (5, 'top')`);
  check('barbeiro não avalia a própria barbearia', !r.ok, r.error);
  r = await tryQuery(`select public.delete_my_account()`);
  check('barbeiro não apaga a própria conta pelo site', !r.ok && /admin accounts/.test(r.error), r.error);
});

await as(UB2, 'aal1', async () => {
  const r = await tryQuery(`update public.appointments set notes = 'x'`);
  check('outro barbeiro não altera a agenda alheia', r.ok && r.affected === 0);
  const d = await tryQuery(`delete from public.appointments`);
  check('outro barbeiro não apaga a agenda alheia', d.ok && d.affected === 0);
  const u = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B2}', ${day(10)}, ${day(11)})`);
  check('mesmo horário em barbeiros diferentes é permitido', u.ok, u.error);
  const mv = await tryQuery(`update public.appointments set barber_id = '${B1}' where barber_id = '${B2}'`);
  check('barbeiro não move horário dele para outro barbeiro', !mv.ok || mv.affected === 0, mv.error);
});

// Histórico: atendimento de 30 dias atrás e um daqui a 90 dias (fora da janela).
await db.exec(`
  insert into public.appointments (barber_id, starts_at, ends_at, client_name) values
    ('${B1}', now() - interval '30 days', now() - interval '30 days' + interval '1 hour', 'Antigo'),
    ('${B1}', now() + interval '90 days', now() + interval '90 days' + interval '1 hour', 'Futuro');
`);

// ---------- Público (anon) ----------
await as(null, null, async () => {
  let r = await tryQuery(`select * from public.appointments`);
  check('visitante NÃO lê a tabela da agenda', !r.ok && /permission denied/.test(r.error), r.error);

  r = await tryQuery(`select * from public.busy_slots(current_date, 14)`);
  const cols = r.ok && r.rows[0] ? Object.keys(r.rows[0]).sort().join(',') : '';
  check('visitante vê horários ocupados (só barbeiro/início/fim)', r.ok && r.rows.length === 3 && cols === 'barber_id,ends_at,starts_at', cols || r.error);

  r = await tryQuery(`select starts_at from public.busy_slots(current_date - 60, 62) where starts_at < now() - interval '2 days'`);
  check('busy_slots não devolve histórico antigo', r.ok && r.rows.length === 0, String(r.rows?.length ?? r.error));

  r = await tryQuery(`select * from public.busy_slots(current_date, 500)`);
  check('busy_slots limita a janela (62 dias)', r.ok && r.rows.every((x) => new Date(x.starts_at) < new Date(Date.now() + 64 * 864e5)));

  r = await tryQuery(`select * from public.staff_context()`);
  check('visitante não chama staff_context', !r.ok, r.error);

  r = await tryQuery(`select id, place_id, show_on_site, rating, user_rating_count, maps_uri from public.google_place`);
  check('site continua lendo google_place (colunas públicas)', r.ok && r.rows.length === 1, r.error);
  r = await tryQuery(`select last_error from public.google_place`);
  check('visitante NÃO lê last_error do Google', !r.ok && /permission denied/.test(r.error), r.error);
  r = await tryQuery(`select public.google_sync_error()`);
  check('visitante não chama google_sync_error', !r.ok, r.error);

  r = await tryQuery(`select name from public.barbers where active order by position`);
  check('site continua lendo a Equipe', r.ok && r.rows.length === 2);
});

// ---------- Cliente ----------
await as(CUST, 'aal1', async () => {
  let r = await tryQuery(`select * from public.appointments`);
  check('cliente logado não vê a agenda', r.ok && r.rows.length === 0, r.error);
  r = await tryQuery(`insert into public.appointments (barber_id, starts_at, ends_at) values ('${B1}', ${day(15)}, ${day(16)})`);
  check('cliente logado não marca horário', !r.ok, r.error);
  r = await tryQuery(`select * from public.staff_context()`);
  check('cliente não tem acesso ao painel (staff_context vazio)', r.ok && r.rows.length === 0);
  r = await tryQuery(`update public.barbers set bio = 'x'`);
  check('cliente não edita barbeiros', r.ok && r.affected === 0);
  r = await tryQuery(`insert into public.reviews (rating, comment) values (5, 'ótimo')`);
  check('cliente com e-mail confirmado continua avaliando', r.ok, r.error);
});

// ---------- Admin com 2FA ativado ----------
await as(ADMIN, 'aal1', async () => {
  let r = await tryQuery(`select public.is_admin() as v`);
  check('admin SEM o código do app (aal1) não é admin', r.ok && r.rows[0].v === false);
  r = await tryQuery(`select * from public.appointments`);
  check('admin aal1 não vê a agenda', r.ok && r.rows.length === 0);
  r = await tryQuery(`update public.site_hero set title = 'x' where id = 1`);
  check('admin aal1 não edita o site', r.ok && r.affected === 0);
  r = await tryQuery(`select public.delete_my_account()`);
  check('senha de admin sem 2FA não apaga a conta', !r.ok, r.error);
  r = await tryQuery(`select * from public.staff_context()`);
  check('staff_context informa papel admin (para pedir o código)', r.ok && r.rows[0]?.role === 'admin');
});

await as(ADMIN, 'aal2', async () => {
  let r = await tryQuery(`select public.is_admin() as v`);
  check('admin com código do app (aal2) é admin', r.ok && r.rows[0].v === true);
  r = await tryQuery(`select barber_id, client_name, notes from public.appointments`);
  check('admin vê a agenda de todos, com dados do cliente', r.ok && r.rows.length === 5 && r.rows.some((x) => x.notes === 'Degradê baixo'));
  r = await tryQuery(`update public.appointments set notes = 'Admin editou' where barber_id = '${B2}'`);
  check('admin edita agenda de outro barbeiro', r.ok && r.affected === 1, r.error);
  r = await tryQuery(`update public.barbers set name = 'Guilherme S.' where id = '${B1}' returning name`);
  check('admin edita o nome do barbeiro', r.ok && r.rows[0]?.name === 'Guilherme S.', r.error);
  r = await tryQuery(`update public.barbers set photo_url = 'https://abc.supabase.co/storage/v1/object/public/site-assets/barber-123.jpg' where id = '${B2}'`);
  check('admin pode usar foto em qualquer pasta', r.ok && r.affected === 1, r.error);
  r = await tryQuery(`select barber_id, email, mfa_enabled from public.staff_accounts() order by email`);
  check('admin lista os logins dos barbeiros', r.ok && r.rows.length === 2 && r.rows[0].email === 'gui@tonsorium.app');
  r = await tryQuery(`update public.google_place set place_id = 'ChIJabc', show_on_site = true where id = 1`);
  check('admin salva Place ID (update com colunas restritas)', r.ok && r.affected === 1, r.error);
  r = await tryQuery(`select public.google_sync_error() as e`);
  check('admin lê o último erro do Google pela função', r.ok && r.rows[0].e === '', r.error);
  r = await tryQuery(`select public.remove_staff_login('${B2}')`);
  check('admin remove login do Mario', r.ok, r.error);
});

{
  const r = await db.query(`select count(*)::int as n from auth.users where id = '${UB2}'`);
  check('login do Mario apagado (cadastro na Equipe continua)', r.rows[0].n === 0);
  const b = await db.query(`select count(*)::int as n from public.barbers where id = '${B2}'`);
  check('cadastro do Mario na Equipe continua', b.rows[0].n === 1);
}

// Barbeiro com 2FA ativado precisa do código
await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${UB1}', 'verified')`);
await as(UB1, 'aal1', async () => {
  const r = await tryQuery(`select * from public.appointments`);
  check('barbeiro com 2FA ativado, sem o código, não vê a agenda', r.ok && r.rows.length === 0);
});
await as(UB1, 'aal2', async () => {
  const r = await tryQuery(`select * from public.appointments`);
  check('barbeiro com 2FA e código vê a agenda', r.ok && r.rows.length === 4);
});

// Admin remove o barbeiro: login e agenda saem juntos
await as(ADMIN, 'aal2', async () => {
  const r = await tryQuery(`delete from public.barbers where id = '${B1}'`);
  check('admin remove o barbeiro Guilherme', r.ok && r.affected === 1, r.error);
});
{
  const u = await db.query(`select count(*)::int as n from auth.users where id = '${UB1}'`);
  const a = await db.query(`select count(*)::int as n from public.appointments where barber_id = '${B1}'`);
  check('login e agenda do barbeiro removido foram apagados', u.rows[0].n === 0 && a.rows[0].n === 0);
}

// Cliente apaga a própria conta
await as(CUST, 'aal1', async () => {
  const r = await tryQuery(`select public.delete_my_account()`);
  check('cliente continua podendo apagar a própria conta', r.ok, r.error);
});

console.log(`\n${passes} ok, ${failures} falhas`);
process.exit(failures ? 1 : 0);
