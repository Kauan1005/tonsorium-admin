-- =========================================================
-- TONSORIUM — sincroniza as avaliações do Google 1x por dia
--
-- Rode no SQL Editor DEPOIS de publicar a Edge Function
-- sync-google-reviews. Antes, troque COLE_AQUI_O_CRON_SECRET
-- pelo mesmo valor do secret CRON_SECRET da função.
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'sync-google-reviews';

-- 09:00 UTC = 06:00 em São Paulo
select cron.schedule(
  'sync-google-reviews',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://zqilpryywspzlholplij.supabase.co/functions/v1/sync-google-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'COLE_AQUI_O_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
