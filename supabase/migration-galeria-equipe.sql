-- =========================================================
-- TONSORIUM — migração ANTIGA: Galeria de cortes + Equipe
--
-- OBSOLETO: NÃO PRECISA RODAR. O schema.sql já inclui tudo isto.
-- Pode apagar este arquivo.
--
-- (A versão antiga deste arquivo deixava QUALQUER usuário logado,
-- inclusive clientes, editar a Galeria e a Equipe. Foi corrigida para
-- só o admin, igual ao schema.sql, caso alguém rode por engano.)
-- =========================================================

create extension if not exists pgcrypto;

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
  role text not null default '',
  photo_url text not null default '',
  position int not null default 0,
  active boolean not null default true
);

alter table gallery_photos enable row level security;
alter table barbers enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['gallery_photos', 'barbers']
  loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);

    execute format('drop policy if exists "auth write" on %I', t);
    execute format('drop policy if exists "admin write" on %I', t);
    execute format(
      'create policy "admin write" on %I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t
    );
  end loop;
end $$;

-- O bucket "site-assets" já existe (criado pelo schema.sql original)
-- e já aceita esses novos uploads, então não precisa recriar nada de storage.
