import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Faltam as variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Copie .env.example para .env e preencha com os dados do seu projeto Supabase.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Faz upload de um arquivo pro bucket "site-assets" com progresso real
 * (o método padrão do supabase-js não expõe progresso de envio).
 * Usa a mesma sessão de login do admin, então respeita as mesmas
 * permissões (RLS) de sempre.
 */
export async function uploadFileWithProgress(
  path: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('Sessão expirada. Saia e entre de novo no admin.');
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/site-assets/${path}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Falha no envio (status ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Erro de rede durante o envio.'));
    xhr.send(file);
  });
}

const PUBLIC_PREFIX = `${supabaseUrl}/storage/v1/object/public/site-assets/`;

/**
 * Envia um arquivo já convertido e devolve a URL pública dele.
 * O nome é aleatório (não dá pra adivinhar nem sobrescrever outro arquivo).
 */
export async function uploadAsset(
  prefix: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = EXT[file.type] ?? 'jpg';
  const path = `${prefix}-${crypto.randomUUID()}.${ext}`;
  await uploadFileWithProgress(path, file, onProgress);
  return supabase.storage.from('site-assets').getPublicUrl(path).data.publicUrl;
}

/**
 * Apaga do storage um arquivo que não é mais usado (foto trocada ou
 * item removido). Ignora URLs que não são do nosso bucket. Falhas não
 * interrompem o fluxo — no pior caso sobra um arquivo órfão.
 */
export async function removeAssetByUrl(url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return;
  const path = decodeURIComponent(url.slice(PUBLIC_PREFIX.length).split('?')[0]);
  if (!path) return;
  await supabase.storage.from('site-assets').remove([path]).catch(() => {});
}
