-- =========================================================
-- TONSORIUM — schema completo do site + admin + avaliações
--
-- Rode este arquivo inteiro no SQL Editor do Supabase
-- (Project > SQL Editor > New query > cole tudo > Run).
--
-- Ele é IDEMPOTENTE: serve tanto para um projeto novo quanto
-- para atualizar o banco que já está no ar. Pode rodar de novo
-- sempre que este arquivo mudar — não apaga conteúdo e não
-- duplica os dados iniciais.
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- 1. PERFIS E PAPEL DE ADMIN
-- Toda conta (admin ou cliente) tem uma linha em profiles.
-- Só quem tem role = 'admin' pode alterar o conteúdo do site.
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer',
  full_name text not null default '',
  -- Foto de perfil: 'auto' = foto da conta Google, 'custom' = enviada pelo
  -- cliente, 'none' = o cliente removeu (nunca é recolocada sozinha).
  avatar_url text not null default '',
  avatar_choice text not null default 'auto' check (avatar_choice in ('auto', 'custom', 'none')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists avatar_choice text not null default 'auto';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
-- Conta de barbeiro (role = 'barber'): qual cadastro da Equipe ela representa.
-- A ligação com a tabela barbers é criada na seção 8.
alter table public.profiles add column if not exists barber_id uuid;
alter table public.profiles drop constraint if exists profiles_avatar_choice_check;
alter table public.profiles add constraint profiles_avatar_choice_check check (avatar_choice in ('auto', 'custom', 'none'));

-- Se um perfil antigo limitava os valores de role (ex: só 'admin'/'client'),
-- o cadastro de clientes falharia. Remove essas restrições antigas.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles alter column role set default 'customer';

-- Contas que já existiam antes deste script ganham um perfil de cliente.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Verificação em duas etapas (2FA): quem já ativou o código do app
-- autenticador só passa depois de digitar o código (sessão "aal2").
-- Assim, uma senha vazada sozinha não abre o painel. Quem ainda não
-- ativou passa só com a senha (o painel obriga o admin a ativar).
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;

-- Verdadeiro só para o admin logado (e com o 2FA em dia). SECURITY
-- DEFINER para poder ler profiles sem depender das regras de RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ) and public.mfa_ok();
$$;

-- Id do barbeiro (tabela barbers) ligado à conta logada, ou null se a
-- conta não for de barbeiro. Também exige o 2FA, se ele estiver ativado.
create or replace function public.my_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.barber_id from public.profiles p
  where p.id = auth.uid() and p.role = 'barber' and public.mfa_ok();
$$;

-- Verdadeiro se a conta logada é de barbeiro (independe do 2FA).
create or replace function public.is_barber_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'barber'
  );
$$;

-- Verdadeiro se o usuário logado já confirmou o e-mail.
create or replace function public.email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null
  );
$$;

-- Nome que vem do cadastro (e-mail) ou da conta Google.
create or replace function public.metadata_name(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(coalesce(nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), '')), 80);
$$;

-- Foto da conta Google (só aceita endereços do próprio Google).
create or replace function public.metadata_avatar(meta jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when url ~ '^https://[a-z0-9.-]+\.googleusercontent\.com/[^\s"''<>]*$' then url else '' end
  from (select coalesce(nullif(meta->>'avatar_url', ''), nullif(meta->>'picture', ''), '') as url) s;
$$;

-- Cria o perfil automaticamente quando alguém se cadastra.
-- O papel é SEMPRE 'customer' — nada que venha do cadastro
-- (raw_user_meta_data é controlado pelo usuário) define o papel.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, avatar_url)
  values (
    new.id,
    'customer',
    public.metadata_name(new.raw_user_meta_data),
    public.metadata_avatar(new.raw_user_meta_data)
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Nunca impede o cadastro/login por causa do perfil.
  raise warning 'handle_new_user: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quando a conta recebe dados novos (ex: alguém que já tinha conta passa a
-- entrar com Google), completa o nome se estiver vazio e atualiza a foto do
-- Google — a não ser que o cliente tenha enviado ou removido a própria foto.
create or replace function public.handle_user_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set
    full_name = case when p.full_name = '' then public.metadata_name(new.raw_user_meta_data) else p.full_name end,
    avatar_url = case when p.avatar_choice = 'auto' then public.metadata_avatar(new.raw_user_meta_data) else p.avatar_url end
  where p.id = new.id
    and (
      (p.full_name = '' and public.metadata_name(new.raw_user_meta_data) <> '')
      or (p.avatar_choice = 'auto' and p.avatar_url is distinct from public.metadata_avatar(new.raw_user_meta_data))
    );
  return new;
exception when others then
  raise warning 'handle_user_metadata_update: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_user_metadata_update();

-- Impede que um usuário comum mude o próprio papel para 'admin' ou se
-- ligue a um barbeiro pela API (isso só o admin faz, pelo painel) e só
-- aceita foto de perfil da pasta do próprio cliente ou da conta Google.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.id := old.id;
    new.role := old.role;
    new.barber_id := old.barber_id;
    new.created_at := old.created_at;
    if new.avatar_url is distinct from old.avatar_url
       and new.avatar_url <> ''
       and new.avatar_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/' || auth.uid()::text || '/[A-Za-z0-9._-]+$')
       and new.avatar_url !~ '^https://[a-z0-9.-]+\.googleusercontent\.com/[^\s"''<>]*$' then
      raise exception 'invalid avatar url' using errcode = '22023';
    end if;
  end if;
  new.full_name := left(trim(coalesce(new.full_name, '')), 80);
  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

alter table public.profiles enable row level security;

-- Remove QUALQUER regra antiga de profiles (algumas podiam deixar
-- o usuário editar o próprio papel) e recria só as necessárias.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;

create policy "profile read own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (select public.is_admin()));

create policy "profile update own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke insert, delete on public.profiles from anon, authenticated;

-- Exclusão da própria conta (LGPD). Apaga o usuário e, em cascata,
-- o perfil e a avaliação dele.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Olha o papel direto (e não is_admin(), que depende do 2FA): uma senha
  -- de admin vazada, sem o código do app, não pode apagar a conta.
  if exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'barber')) then
    raise exception 'admin accounts must be removed from the Supabase dashboard';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =========================================================
-- 2. CONTEÚDO DO SITE
-- =========================================================

-- ---------- HERO (linha única) ----------
create table if not exists site_hero (
  id int primary key default 1,
  badge_text text not null default '',
  title text not null default '',
  tagline text not null default '',
  subtitle text not null default '',
  whatsapp_number text not null default '',
  hero_media_url text not null default '',
  hero_media_type text not null default 'none',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
alter table site_hero add column if not exists hero_media_url text not null default '';
alter table site_hero add column if not exists hero_media_type text not null default 'none';
alter table site_hero drop constraint if exists hero_media_type_check;
alter table site_hero drop constraint if exists site_hero_hero_media_type_check;
alter table site_hero add constraint hero_media_type_check check (hero_media_type in ('none', 'image', 'video'));

-- ---------- CONCEITO (linha única) ----------
create table if not exists site_concept (
  id int primary key default 1,
  eyebrow text not null default '',
  title text not null default '',
  paragraph_1 text not null default '',
  paragraph_2 text not null default '',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- ---------- PILARES do conceito (lista) ----------
create table if not exists site_pillars (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null default '',
  description text not null default ''
);

-- ---------- SERVIÇOS ESPECIAIS (lista) ----------
create table if not exists services_special (
  id uuid primary key default gen_random_uuid(),
  tag text not null default '',
  title text not null default '',
  description text not null default '',
  price_label text not null default '',
  position int not null default 0,
  active boolean not null default true
);
alter table services_special add column if not exists price_label text not null default '';

-- ---------- SERVIÇOS CLÁSSICOS (lista) ----------
create table if not exists services_classic (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  price_label text not null default '',
  position int not null default 0,
  active boolean not null default true
);
alter table services_classic add column if not exists price_label text not null default '';

-- ---------- DIFERENCIAIS (lista) ----------
create table if not exists differentiators (
  id uuid primary key default gen_random_uuid(),
  icon text not null default 'clock', -- clock | shield | home | chart | calendar | heart
  title text not null default '',
  description text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- LOCALIZAÇÃO (linha única) ----------
-- Este é o ÚNICO lugar do WhatsApp usado pelo site.
create table if not exists site_location (
  id int primary key default 1,
  address text not null default '',
  neighborhood_city text not null default '',
  hours_weekday text not null default '',
  hours_saturday text not null default '',
  hours_sunday text not null default '',
  whatsapp_number text not null default '',
  maps_url text not null default '',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- ---------- LOGO / CONTATO (linha única) ----------
create table if not exists site_settings (
  id int primary key default 1,
  logo_url text not null default '',
  instagram_handle text not null default '',
  phone_display text not null default '',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- ---------- GALERIA DE CORTES (lista) ----------
create table if not exists gallery_photos (
  id uuid primary key default gen_random_uuid(),
  image_url text not null default '',
  caption text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- EQUIPE / BARBEIROS (lista) ----------
create table if not exists barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  role text not null default '',  -- especialidade
  bio text not null default '',   -- descrição
  quote text not null default '',
  photo_url text not null default '',
  position int not null default 0,
  active boolean not null default true
);
alter table barbers add column if not exists quote text not null default '';
alter table barbers add column if not exists bio text not null default '';

-- ---------- HORÁRIO DE ATENDIMENTO (um registro por dia) ----------
create table if not exists business_hours (
  id uuid primary key default gen_random_uuid(),
  day_of_week int not null check (day_of_week between 0 and 6), -- 0 = domingo
  is_closed boolean not null default false,
  open_time time not null default '09:00',
  close_time time not null default '20:00'
);
do $$
begin
  create unique index if not exists business_hours_day_uidx on business_hours (day_of_week);
exception when others then
  raise notice 'business_hours tem dias repetidos — apague os duplicados e rode de novo: %', sqlerrm;
end $$;

-- ---------- PRODUTOS (lista) ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  description text not null default '',
  price numeric(10, 2) not null default 0,
  photo_url text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- VISAGISMO (linha única + pontos) ----------
create table if not exists site_visagism (
  id int primary key default 1,
  active boolean not null default true,
  eyebrow text not null default '',
  title text not null default '',
  intro text not null default '',
  cta_label text not null default '',
  service_name text not null default '',
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

create table if not exists visagism_points (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- A EXPERIÊNCIA (passos do atendimento) ----------
create table if not exists experience_steps (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- PERGUNTAS FREQUENTES ----------
create table if not exists faq_items (
  id uuid primary key default gen_random_uuid(),
  question text not null default '',
  answer text not null default '',
  position int not null default 0,
  active boolean not null default true
);

-- ---------- GOOGLE: configuração e resumo (linha única) ----------
create table if not exists google_place (
  id int primary key default 1,
  place_id text not null default '',
  show_on_site boolean not null default true,
  rating numeric(2, 1),
  user_rating_count int,
  maps_uri text not null default '',
  last_synced_at timestamptz,
  last_error text not null default '',
  constraint single_row check (id = 1)
);

-- ---------- GOOGLE: avaliações sincronizadas ----------
-- Só a Edge Function (com a service role) escreve aqui.
create table if not exists google_reviews (
  id text primary key,
  author_name text not null default '',
  author_photo_url text not null default '',
  author_uri text not null default '',
  rating smallint not null check (rating between 1 and 5),
  text text not null default '',
  relative_time text not null default '',
  publish_time timestamptz,
  synced_at timestamptz not null default now()
);

-- ---------- Validações de formato ----------
-- NOT VALID: vale para tudo que for gravado daqui pra frente sem
-- travar o script por causa de algum dado antigo fora do padrão.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('site_location', 'site_location_whatsapp_fmt', 'whatsapp_number ~ ''^([0-9]{10,15})?$'''),
      ('site_hero', 'site_hero_whatsapp_fmt', 'whatsapp_number ~ ''^([0-9]{10,15})?$'''),
      ('site_settings', 'site_settings_instagram_fmt', 'instagram_handle ~ ''^[A-Za-z0-9._]{0,30}$'''),
      ('products', 'products_price_positive', 'price >= 0'),
      ('site_location', 'site_location_maps_https', 'maps_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('site_settings', 'site_settings_logo_https', 'logo_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('site_hero', 'site_hero_media_https', 'hero_media_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('gallery_photos', 'gallery_photos_url_https', 'image_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('barbers', 'barbers_photo_https', 'photo_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('products', 'products_photo_https', 'photo_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('google_place', 'google_place_id_fmt', 'place_id ~ ''^[A-Za-z0-9_-]*$'' and char_length(place_id) <= 300'),
      ('profiles', 'profiles_avatar_https', 'avatar_url ~ ''^(https://[^\s"''''<>]+)?$'''),
      ('barbers', 'barbers_text_len', 'char_length(name) <= 80 and char_length(role) <= 120 and char_length(bio) <= 600 and char_length(quote) <= 240')
    ) as t(tbl, name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table %I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end $$;

-- =========================================================
-- 3. AVALIAÇÕES DOS CLIENTES (feitas no site)
-- =========================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '',
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  admin_reply text not null default '' check (char_length(admin_reply) <= 1000),
  author_avatar_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz -- preenchido só quando o cliente muda nota ou comentário
);
-- Cada conta pode avaliar mais de uma vez (o limite de frequência está no reviews_guard).
alter table public.reviews drop constraint if exists reviews_one_per_user;
alter table public.reviews add column if not exists author_avatar_url text not null default '';
alter table public.reviews add column if not exists edited_at timestamptz;
create index if not exists reviews_status_created_idx on public.reviews (status, created_at desc);
create index if not exists reviews_user_created_idx on public.reviews (user_id, created_at desc);

-- "Kauan Almeida" -> "Kauan A." (não expõe sobrenome nem e-mail).
create or replace function public.short_name(full_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(array_length(parts, 1), 0) = 0 or parts[1] = '' then 'Cliente'
    when array_length(parts, 1) = 1 then left(initcap(parts[1]), 40)
    else left(initcap(parts[1]), 40) || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.'
  end
  from (select regexp_split_to_array(trim(coalesce(full_name, '')), '\s+') as parts) s;
$$;

-- Garante pelo banco (e não pela tela) o que cada um pode mudar:
--   cliente: só nota e comentário das PRÓPRIAS avaliações, e no máximo
--            uma avaliação nova a cada 24 horas (contra spam);
--   admin:   só status (publicar/ocultar) e resposta.
-- Nome e foto do autor vêm sempre do perfil, nunca do que o cliente envia.
create or replace function public.reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_avatar text;
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') then
      new.user_id := auth.uid();
      new.status := 'published';
      new.admin_reply := '';
      if not public.is_admin() and exists (
        select 1 from public.reviews r
        where r.user_id = auth.uid() and r.created_at > now() - interval '24 hours'
      ) then
        raise exception 'review rate limit' using errcode = 'TS429';
      end if;
    end if;
    select p.full_name, p.avatar_url into v_name, v_avatar from public.profiles p where p.id = new.user_id;
    new.author_name := public.short_name(v_name);
    new.author_avatar_url := coalesce(v_avatar, '');
    new.created_at := now();
    new.edited_at := null;
  else
    if current_user in ('anon', 'authenticated') then
      new.id := old.id;
      new.user_id := old.user_id;
      new.author_name := old.author_name;
      new.author_avatar_url := old.author_avatar_url;
      new.created_at := old.created_at;
      new.edited_at := old.edited_at;
      if not public.is_admin() then
        new.status := old.status;
        new.admin_reply := old.admin_reply;
      end if;
      if auth.uid() is distinct from old.user_id then
        new.rating := old.rating;
        new.comment := old.comment;
      elsif new.rating is distinct from old.rating or trim(new.comment) is distinct from old.comment then
        new.edited_at := now();
      end if;
    end if;
  end if;
  new.comment := trim(new.comment);
  new.admin_reply := trim(new.admin_reply);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reviews_guard on public.reviews;
create trigger reviews_guard
  before insert or update on public.reviews
  for each row execute function public.reviews_guard();

alter table public.reviews enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'reviews' loop
    execute format('drop policy %I on public.reviews', p.policyname);
  end loop;
end $$;

create policy "reviews read" on public.reviews
  for select
  using (status = 'published' or user_id = auth.uid() or (select public.is_admin()));

-- Só conta logada E com e-mail confirmado pode avaliar. Conta de
-- barbeiro não avalia a própria barbearia.
create policy "reviews insert own" on public.reviews
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (select public.email_confirmed())
    and not (select public.is_barber_account())
  );

create policy "reviews update own or admin" on public.reviews
  for update to authenticated
  using (user_id = auth.uid() or (select public.is_admin()))
  with check (user_id = auth.uid() or (select public.is_admin()));

create policy "reviews delete own or admin" on public.reviews
  for delete to authenticated
  using (user_id = auth.uid() or (select public.is_admin()));

revoke all on public.reviews from anon;
grant select on public.reviews to anon;

create or replace view public.review_stats
with (security_invoker = true) as
select
  count(*)::int as total,
  coalesce(round(avg(rating)::numeric, 1), 0)::numeric(2, 1) as average
from public.reviews
where status = 'published';

grant select on public.review_stats to anon, authenticated;

-- Quando o cliente troca o nome ou a foto, as avaliações dele acompanham.
-- SECURITY DEFINER: roda como dono, então pode atualizar autor/foto que o
-- reviews_guard bloqueia para o cliente (e não marca a avaliação como editada).
create or replace function public.sync_review_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_name is distinct from old.full_name or new.avatar_url is distinct from old.avatar_url then
    update public.reviews
    set author_name = public.short_name(new.full_name),
        author_avatar_url = new.avatar_url
    where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_review_author on public.profiles;
create trigger sync_review_author
  after update on public.profiles
  for each row execute function public.sync_review_author();

-- Tempo real: o site recebe na hora quando uma avaliação muda.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table public.reviews;
  end if;
end $$;

-- =========================================================
-- 4. RLS DO CONTEÚDO: leitura pública, escrita SÓ DO ADMIN
-- (antes era "qualquer usuário logado" — qualquer cliente
-- cadastrado conseguia editar o site pela API)
-- =========================================================
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'site_hero','site_concept','site_pillars','services_special',
    'services_classic','differentiators','site_location','site_settings',
    'gallery_photos','barbers','business_hours','products','google_place',
    'site_visagism','visagism_points','experience_steps','faq_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format(
      'create policy "admin write" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t
    );
  end loop;
end $$;

-- google_place: o público lê só o que o site mostra. O último erro da
-- sincronização (pode trazer detalhes técnicos da conta Google) fica
-- só para o admin, pela função google_sync_error().
revoke select on public.google_place from anon, authenticated;
grant select (id, place_id, show_on_site, rating, user_rating_count, maps_uri, last_synced_at)
  on public.google_place to anon, authenticated;

create or replace function public.google_sync_error()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select g.last_error from public.google_place g
  where g.id = 1 and public.is_admin();
$$;

revoke execute on function public.google_sync_error() from public, anon;
grant execute on function public.google_sync_error() to authenticated;

-- google_reviews: leitura pública, escrita só pela service role (Edge Function).
alter table public.google_reviews enable row level security;
drop policy if exists "public read" on public.google_reviews;
create policy "public read" on public.google_reviews for select using (true);

-- =========================================================
-- 5. STORAGE: bucket de imagens/vídeos do site
-- Público para leitura direta pela URL; só o admin envia,
-- troca ou apaga. Tamanho e tipos de arquivo limitados.
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets', 'site-assets', true, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read assets" on storage.objects;
drop policy if exists "auth write assets" on storage.objects;
drop policy if exists "admin read assets" on storage.objects;
drop policy if exists "admin insert assets" on storage.objects;
drop policy if exists "admin update assets" on storage.objects;
drop policy if exists "admin delete assets" on storage.objects;

-- Sem leitura pública via API (impede listar todos os arquivos);
-- as imagens continuam abrindo normalmente pela URL pública.
create policy "admin read assets" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-assets' and (select public.is_admin()));

create policy "admin insert assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-assets' and (select public.is_admin()));

create policy "admin update assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-assets' and (select public.is_admin()))
  with check (bucket_id = 'site-assets' and (select public.is_admin()));

create policy "admin delete assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-assets' and (select public.is_admin()));

-- Barbeiro: só a própria pasta de fotos, site-assets/barbers/<id-do-barbeiro>/
drop policy if exists "barber read own photos" on storage.objects;
drop policy if exists "barber insert own photos" on storage.objects;
drop policy if exists "barber update own photos" on storage.objects;
drop policy if exists "barber delete own photos" on storage.objects;

create policy "barber read own photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'barbers'
         and (storage.foldername(name))[2] = (select public.my_barber_id()::text));

create policy "barber insert own photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'barbers'
              and (storage.foldername(name))[2] = (select public.my_barber_id()::text));

create policy "barber update own photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'barbers'
         and (storage.foldername(name))[2] = (select public.my_barber_id()::text))
  with check (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'barbers'
              and (storage.foldername(name))[2] = (select public.my_barber_id()::text));

create policy "barber delete own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-assets' and (storage.foldername(name))[1] = 'barbers'
         and (storage.foldername(name))[2] = (select public.my_barber_id()::text));

-- ---------- Fotos de perfil dos clientes ----------
-- Cada cliente só mexe na própria pasta: avatars/<id-do-cliente>/...
-- Leitura pela URL pública; 2MB e só JPG/PNG/WEBP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar owner read" on storage.objects;
drop policy if exists "avatar owner insert" on storage.objects;
drop policy if exists "avatar owner update" on storage.objects;
drop policy if exists "avatar owner delete" on storage.objects;

create policy "avatar owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatar owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatar owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "avatar owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- =========================================================
-- 6. SEED: conteúdo inicial (só entra se a tabela estiver vazia)
-- =========================================================
insert into site_hero (id, badge_text, title, tagline, subtitle, whatsapp_number)
values (1, 'Barbearia · Itapevi, SP', 'Tonsorium', 'Um conceito criado para você',
  'Corte, barba e cuidado com hora marcada — técnica antes de tendência, em um ambiente pensado em cada detalhe.',
  '5511912369764')
on conflict (id) do nothing;

insert into site_concept (id, eyebrow, title, paragraph_1, paragraph_2)
values (1, 'O Conceito', 'Não é só um corte. É um padrão.',
  'A Tonsorium nasceu para ser diferente do convencional — cada atendimento é pensado com atenção ao detalhe, do primeiro contato até o resultado final.',
  'Técnica, precisão e cuidado se encontram para entregar um visual que combina com quem você é, não só com o que está na moda.')
on conflict (id) do nothing;

insert into site_pillars (position, title, description)
select * from (values
  (1, 'Hora marcada', 'Atendimento agendado, sem espera e sem pressa.'),
  (2, 'Técnica antes de tendência', 'Cada corte é decidido com base no que valoriza você.'),
  (3, 'Ambiente cuidado', 'Espaço pensado para o seu conforto do início ao fim.')
) v(position, title, description)
where not exists (select 1 from site_pillars);

insert into services_special (tag, title, description, position)
select * from (values
  ('Técnico', 'Platinado', 'Descoloração completa com controle de dano, do zero ao tom platinado uniforme.', 1),
  ('Técnico', 'Nevou / Mechas', 'Reflexos e mechas para dar profundidade e movimento ao corte.', 2),
  ('Assinatura', 'Desenho freehand', 'Riscos e desenhos à mão livre — acabamento de precisão no degradê.', 3),
  ('Cuidado', 'Camuflagem de barba branca', 'Coloração natural para disfarçar fios brancos sem perder a textura.', 4),
  ('Cuidado', 'Spa capilar', 'Hidratação profunda de couro cabeludo e fios, com massagem.', 5),
  ('Experiência', 'Day Use Tonsorium', 'Corte, barba, skincare facial e bebida — a experiência completa.', 6)
) v(tag, title, description, position)
where not exists (select 1 from services_special);

insert into services_classic (title, description, position)
select * from (values
  ('Corte', 'Tesoura e máquina, lavagem e finalização inclusas.', 1),
  ('Barba', 'Toalha quente, navalha e hidratação.', 2),
  ('Corte + Barba', 'O combo completo, cabeça e rosto.', 3),
  ('Sobrancelha', 'Design e alinhamento na navalha.', 4)
) v(title, description, position)
where not exists (select 1 from services_classic);

insert into differentiators (icon, title, description, position)
select * from (values
  ('clock', 'Hora marcada', 'Atendimento agendado, sem fila e sem espera.', 1),
  ('shield', 'Materiais esterilizados', 'Instrumentos higienizados a cada atendimento.', 2),
  ('home', 'Ambiente cuidado', 'Espaço pensado para o seu conforto durante o serviço.', 3),
  ('chart', 'Recorrência quinzenal', 'Próximo horário garantido, com desconto na mantença.', 4),
  ('calendar', 'Agenda pelo WhatsApp', 'Confirmação rápida, sem burocracia.', 5),
  ('heart', 'Atendimento próximo', 'Na Vila Aurora, fácil de chegar de qualquer ponto de Itapevi.', 6)
) v(icon, title, description, position)
where not exists (select 1 from differentiators);

insert into site_location (id, address, neighborhood_city, whatsapp_number, maps_url)
values (1, 'Rua Rosangela Mariana Limas, 14', 'Vila Aurora — Itapevi, SP', '5511912369764',
  'https://www.google.com/maps/search/?api=1&query=Rua+Rosangela+Mariana+Limas+14+Vila+Aurora+Itapevi')
on conflict (id) do nothing;

insert into site_settings (id, logo_url, instagram_handle, phone_display)
values (1, '', 'barbeariatonsorium', '(11) 91236-9764')
on conflict (id) do nothing;

insert into business_hours (day_of_week, is_closed, open_time, close_time)
select d, d = 0, '09:00', case when d = 6 then '18:00'::time else '20:00'::time end
from generate_series(0, 6) d
where not exists (select 1 from business_hours b where b.day_of_week = d);

insert into google_place (id) values (1) on conflict (id) do nothing;

insert into site_visagism (id, active, eyebrow, title, intro, cta_label, service_name)
values (1, true, 'Visagismo', 'O corte certo começa pelo seu rosto.',
  'Antes da máquina, a conversa. Analisamos o formato do seu rosto, a textura do cabelo e da barba e a sua rotina para indicar o corte que valoriza seus traços — e que você consegue manter no dia a dia.',
  'Agendar com visagismo', 'Consultoria de visagismo')
on conflict (id) do nothing;

insert into visagism_points (title, description, position)
select * from (values
  ('Formato do rosto', 'Oval, quadrado, redondo ou triangular: cada formato pede volumes e linhas diferentes.', 1),
  ('Cabelo e barba', 'Textura, densidade e direção dos fios definem o que fica bem — e o que dura.', 2),
  ('Estilo e rotina', 'Seu trabalho, o tempo que você tem para arrumar e como você quer ser visto.', 3),
  ('Manutenção', 'Você sai sabendo como finalizar em casa e quando voltar para manter o desenho.', 4)
) v(title, description, position)
where not exists (select 1 from visagism_points);

insert into experience_steps (title, description, position)
select * from (values
  ('Recepção e conversa', 'Você chega no horário marcado, sem fila. Conversamos sobre o que você quer e o que combina com você.', 1),
  ('Preparação', 'Lavagem e preparo dos fios — e toalha quente na barba, que amacia os pelos e prepara a pele.', 2),
  ('Execução de precisão', 'Tesoura, máquina e navalha, cada uma no momento certo, com acabamento detalhado.', 3),
  ('Finalização', 'Finalização com os produtos da casa e dicas para manter o resultado até a próxima visita.', 4)
) v(title, description, position)
where not exists (select 1 from experience_steps);

insert into faq_items (question, answer, position)
select * from (values
  ('Preciso agendar horário?', 'Sim. Trabalhamos com hora marcada para você ser atendido sem espera. Agende pelo botão “Agendar horário” ou direto no WhatsApp.', 1),
  ('O que é visagismo?', 'É a análise do seu rosto, do seu cabelo e da sua barba para indicar o corte e o desenho que mais valorizam seus traços. A conversa acontece antes do atendimento.', 2),
  ('Posso escolher o barbeiro?', 'Pode. Ao agendar, é só dizer com quem prefere ser atendido — ou deixar que a gente indique.', 3),
  ('E se eu me atrasar ou precisar desmarcar?', 'Avise pelo WhatsApp o quanto antes. Assim conseguimos remarcar seu horário e liberar o espaço para outro cliente.', 4),
  ('Como funciona a recorrência quinzenal?', 'Você já sai com o próximo horário garantido e tem desconto na manutenção do corte.', 5),
  ('Os produtos usados no atendimento estão à venda?', 'Sim. Os produtos que usamos na cadeira estão à venda na barbearia — pergunte ao seu barbeiro qual é o ideal para o seu cabelo.', 6)
) v(question, answer, position)
where not exists (select 1 from faq_items);

-- =========================================================
-- 7. ACERTOS DE DADOS (seguro rodar de novo)
-- =========================================================
-- Perfis sem nome/foto ganham os dados da conta (ex: admin criado pelo
-- painel do Supabase que depois entrou com Google).
update public.profiles p
set full_name = public.metadata_name(u.raw_user_meta_data)
from auth.users u
where u.id = p.id and p.full_name = '' and public.metadata_name(u.raw_user_meta_data) <> '';

update public.profiles p
set avatar_url = public.metadata_avatar(u.raw_user_meta_data)
from auth.users u
where u.id = p.id and p.avatar_choice = 'auto' and p.avatar_url = ''
  and public.metadata_avatar(u.raw_user_meta_data) <> '';

-- Avaliações antigas passam a mostrar o nome e a foto atuais do autor.
update public.reviews r
set author_name = public.short_name(p.full_name),
    author_avatar_url = p.avatar_url
from public.profiles p
where p.id = r.user_id
  and (r.author_name is distinct from public.short_name(p.full_name)
       or r.author_avatar_url is distinct from p.avatar_url);

-- =========================================================
-- 8. EQUIPE: LOGINS DE BARBEIRO E AGENDA
--
-- Papéis:
--   admin    — vê e edita tudo e cria/remove os logins dos barbeiros;
--   barber   — edita só a própria foto, especialidade e descrição e a
--              própria agenda (nome, serviço e observações do cliente);
--   customer — cliente do site (só avaliações).
-- Os logins de barbeiro são criados pelo painel (Edge Function
-- manage-staff); ninguém vira barbeiro ou admin pela API.
-- =========================================================

-- Liga a conta ao cadastro da Equipe (um login por barbeiro).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_barber_id_fkey') then
    alter table public.profiles
      add constraint profiles_barber_id_fkey
      foreign key (barber_id) references public.barbers(id) on delete set null;
  end if;
end $$;
create unique index if not exists profiles_barber_id_uidx
  on public.profiles (barber_id) where barber_id is not null;

-- Papel da conta logada, para o painel montar as abas certas.
-- (Quem decide o acesso aos dados continua sendo o RLS.)
create or replace function public.staff_context()
returns table (role text, barber_id uuid, barber_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.role, p.barber_id, coalesce(b.name, '')
  from public.profiles p
  left join public.barbers b on b.id = p.barber_id
  where p.id = auth.uid() and p.role in ('admin', 'barber');
$$;

revoke execute on function public.staff_context() from public, anon;
grant execute on function public.staff_context() to authenticated;

-- Logins de barbeiro (só o admin vê): e-mail, último acesso e 2FA.
create or replace function public.staff_accounts()
returns table (barber_id uuid, user_id uuid, email text, last_sign_in_at timestamptz, mfa_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.barber_id, p.id, u.email::text, u.last_sign_in_at,
    exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'barber' and public.is_admin();
$$;

revoke execute on function public.staff_accounts() from public, anon;
grant execute on function public.staff_accounts() to authenticated;

-- Remove o login de um barbeiro (o cadastro dele na Equipe continua).
create or replace function public.remove_staff_login(p_barber_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from auth.users u
  using public.profiles p
  where p.id = u.id and p.role = 'barber' and p.barber_id = p_barber_id;
end;
$$;

revoke execute on function public.remove_staff_login(uuid) from public, anon;
grant execute on function public.remove_staff_login(uuid) to authenticated;

-- Quando o admin remove um barbeiro da Equipe, o login dele sai junto
-- (e a agenda dele é apagada em cascata).
create or replace function public.barbers_remove_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users u
  using public.profiles p
  where p.id = u.id and p.role = 'barber' and p.barber_id = old.id;
  return old;
end;
$$;

drop trigger if exists barbers_remove_login on public.barbers;
create trigger barbers_remove_login
  before delete on public.barbers
  for each row execute function public.barbers_remove_login();

-- Barbeiro edita só foto, especialidade, descrição e frase do próprio
-- cadastro. Nome, visibilidade e ordem no site ficam com o admin. A foto
-- precisa estar na pasta dele no storage.
create or replace function public.protect_barber_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    new.id := old.id;
    new.name := old.name;
    new.active := old.active;
    new.position := old.position;
    if new.photo_url is distinct from old.photo_url
       and new.photo_url <> ''
       and new.photo_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/site-assets/barbers/' || old.id::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'invalid photo url' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_barber_columns on public.barbers;
create trigger protect_barber_columns
  before update on public.barbers
  for each row execute function public.protect_barber_columns();

drop policy if exists "barber update own" on public.barbers;
create policy "barber update own" on public.barbers
  for update to authenticated
  using (id = (select public.my_barber_id()))
  with check (id = (select public.my_barber_id()));

-- ---------- AGENDA (horários ocupados) ----------
-- Cada linha é um horário ocupado de um barbeiro: atendimento marcado
-- (com nome, serviço e observações do cliente) ou bloqueio (folga,
-- almoço...). Só o próprio barbeiro e o admin enxergam esta tabela; o
-- site público recebe apenas início e fim, pela função busy_slots().
create extension if not exists btree_gist with schema extensions;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  client_name text not null default '',
  service text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at),
  constraint appointments_max_length check (ends_at - starts_at <= interval '16 hours'),
  constraint appointments_text_len check (
    char_length(client_name) <= 80 and char_length(service) <= 120 and char_length(notes) <= 1000
  )
);

create index if not exists appointments_barber_start_idx on public.appointments (barber_id, starts_at);

-- Um barbeiro não pode ter dois horários que se sobrepõem.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table public.appointments
      add constraint appointments_no_overlap
      exclude using gist (barber_id with =, tstzrange(starts_at, ends_at) with &&);
  end if;
end $$;

create or replace function public.appointments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.client_name := left(trim(coalesce(new.client_name, '')), 80);
  new.service := left(trim(coalesce(new.service, '')), 120);
  new.notes := left(trim(coalesce(new.notes, '')), 1000);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if current_user in ('anon', 'authenticated') then
      new.created_by := auth.uid();
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard on public.appointments;
create trigger appointments_guard
  before insert or update on public.appointments
  for each row execute function public.appointments_guard();

alter table public.appointments enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'appointments' loop
    execute format('drop policy %I on public.appointments', p.policyname);
  end loop;
end $$;

create policy "staff read agenda" on public.appointments
  for select to authenticated
  using ((select public.is_admin()) or barber_id = (select public.my_barber_id()));

create policy "staff insert agenda" on public.appointments
  for insert to authenticated
  with check ((select public.is_admin()) or barber_id = (select public.my_barber_id()));

create policy "staff update agenda" on public.appointments
  for update to authenticated
  using ((select public.is_admin()) or barber_id = (select public.my_barber_id()))
  with check ((select public.is_admin()) or barber_id = (select public.my_barber_id()));

create policy "staff delete agenda" on public.appointments
  for delete to authenticated
  using ((select public.is_admin()) or barber_id = (select public.my_barber_id()));

revoke all on public.appointments from anon;
grant select, insert, update, delete on public.appointments to authenticated;

-- Horários ocupados para o agendamento do site: só barbeiro, início e
-- fim (nada do cliente), de ontem até no máximo 62 dias à frente.
create or replace function public.busy_slots(p_from date, p_days int default 21)
returns table (barber_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select greatest(p_from, (now() at time zone 'America/Sao_Paulo')::date - 1) as d0,
           least(greatest(coalesce(p_days, 21), 1), 62) as n
  )
  select a.barber_id, a.starts_at, a.ends_at
  from public.appointments a
  join public.barbers b on b.id = a.barber_id and b.active
  cross join win
  where a.starts_at < ((win.d0 + win.n)::timestamp at time zone 'America/Sao_Paulo')
    and a.ends_at > (win.d0::timestamp at time zone 'America/Sao_Paulo')
  order by a.starts_at;
$$;

grant execute on function public.busy_slots(date, int) to anon, authenticated;

-- =========================================================
-- 9. LGPD: AGENDA APAGADA 12 MESES DEPOIS DO ATENDIMENTO
-- (prazo informado na Política de Privacidade do site)
-- =========================================================
create or replace function public.purge_old_appointments()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.appointments
    where ends_at < now() - interval '12 months'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.purge_old_appointments() from public, anon, authenticated;

-- Roda todo dia às 04:15 de São Paulo (07:15 UTC) pelo pg_cron. Se o pg_cron
-- não estiver disponível, só avisa: ative em Database > Extensions e rode
-- esta parte de novo.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-old-appointments';
  perform cron.schedule('purge-old-appointments', '15 7 * * *', 'select public.purge_old_appointments()');
exception when others then
  raise notice 'pg_cron indisponível (%): a agenda antiga não será apagada sozinha.', sqlerrm;
end $$;
