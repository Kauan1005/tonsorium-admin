-- =========================================================
-- TONSORIUM — adiciona foto/vídeo de fundo no Hero
-- Rode no SQL Editor do Supabase (não apaga nada existente)
-- =========================================================

alter table site_hero
  add column if not exists hero_media_url text not null default '',
  add column if not exists hero_media_type text not null default 'none';

alter table site_hero
  drop constraint if exists hero_media_type_check;

alter table site_hero
  add constraint hero_media_type_check check (hero_media_type in ('none', 'image', 'video'));
