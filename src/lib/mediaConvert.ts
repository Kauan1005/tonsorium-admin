import heic2any from 'heic2any';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Núcleo single-thread do FFmpeg — funciona em qualquer navegador/ambiente,
// sem precisar de headers especiais do servidor. (O modo multi-thread foi
// removido: em alguns ambientes ele trava silenciosamente, sem erro nem
// progresso — pior que ser só "mais lento".)
// Núcleo do FFmpeg servido localmente (pasta public/ffmpeg), sem depender de
// nenhum CDN externo — evita bloqueios de firewall/antivírus/rede corporativa
// que impediam o download desses arquivos de fora.
const FFMPEG_CORE_BASE = '/ffmpeg';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

/** Evita qualquer trava silenciosa: se passar do tempo, vira erro tratável. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  if (!ffmpegLoadingPromise) {
    ffmpegLoadingPromise = (async () => {
      const ffmpeg = new FFmpeg();
      try {
        await withTimeout(
          ffmpeg.load({
            coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
          }),
          30000,
          'timeout-core-load'
        );
      } catch (err) {
        // Libera pra permitir tentar de novo em vez de travar nesse erro.
        ffmpegLoadingPromise = null;
        throw new Error(
          'Não foi possível carregar o conversor de vídeo. Recarregue a página e tente de novo. Detalhe: ' +
            (err instanceof Error ? err.message : String(err))
        );
      }
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return ffmpegLoadingPromise;
}

function isHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

function replaceExtension(name: string, newExt: string): string {
  return name.replace(/\.[^.]+$/, '') + newExt;
}

const WEB_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Acima disso, mesmo no tamanho certo, recomprime (em alta qualidade) para o site não ficar lento. */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
}

/**
 * Recebe QUALQUER formato de imagem (jpg, png, webp, heic do iPhone, etc.) e
 * prioriza a qualidade:
 *  - se já é JPG/PNG/WEBP de até 3840px e até 8MB, envia o ARQUIVO ORIGINAL,
 *    sem recomprimir (nenhuma perda);
 *  - senão (HEIC, foto gigante), converte para JPEG de alta qualidade (92%),
 *    reduzindo só o que passar de 3840px (resolução 4K).
 * Também devolve largura e altura, para avisar quando a foto é pequena demais.
 */
export async function prepareImage(file: File, maxDimension = 3840, quality = 0.92): Promise<PreparedImage> {
  let workingFile: File = file;

  if (isHeic(file)) {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    workingFile = new File([blob], replaceExtension(file.name, '.jpg'), { type: 'image/jpeg' });
  }

  const bitmap =
    (await createImageBitmap(workingFile, { imageOrientation: 'from-image' }).catch(() => null)) ??
    (await createImageBitmap(workingFile).catch(() => null));
  if (!bitmap) {
    throw new Error('Não foi possível abrir essa imagem. Use JPG, PNG, WEBP ou foto do celular.');
  }

  const fitsAlready = bitmap.width <= maxDimension && bitmap.height <= maxDimension;
  if (WEB_IMAGE_TYPES.includes(workingFile.type) && fitsAlready && workingFile.size <= MAX_ORIGINAL_BYTES) {
    return { file: workingFile, width: bitmap.width, height: bitmap.height };
  }

  const resized = await normalizeImage(workingFile, maxDimension, quality, bitmap);
  return { file: resized.file, width: resized.width, height: resized.height };
}

/**
 * Converte para JPEG, reduzindo só se passar de maxDimension.
 */
async function normalizeImage(
  workingFile: File,
  maxDimension: number,
  quality: number,
  bitmap: ImageBitmap
): Promise<PreparedImage> {
  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file: workingFile, width: bitmap.width, height: bitmap.height };
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))),
      'image/jpeg',
      quality
    );
  });

  return {
    file: new File([blob], replaceExtension(workingFile.name, '.jpg'), { type: 'image/jpeg' }),
    width,
    height,
  };
}

/**
 * Testa se o PRÓPRIO navegador já consegue decodificar o vídeo, usando a
 * capacidade nativa dele (sem nenhuma biblioteca). Se conseguir, o formato
 * já é utilizável — evita carregar o FFmpeg (pesado) à toa.
 */
function canBrowserPlayNatively(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const url = URL.createObjectURL(file);

    const finish = (ok: boolean) => {
      URL.revokeObjectURL(url);
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), 8000);

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(Number.isFinite(video.duration) && video.duration > 0);
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };

    video.src = url;
  });
}

function isMp4Container(file: File): boolean {
  return file.type === 'video/mp4' || /\.(mp4|m4v)$/i.test(file.name);
}

/**
 * Recebe QUALQUER formato de vídeo e devolve um MP4 pronto pro site.
 *
 * Passo 1 (a maioria dos casos): se o arquivo já é .mp4 e o navegador
 * consegue tocá-lo nativamente, o FFmpeg nem é carregado — o arquivo já
 * está pronto, é só enviar. Isso resolve exatamente o caso de alguém subir
 * um vídeo que já veio em formato correto (do WhatsApp, editado no PC, etc).
 *
 * Passo 2 (caminho rápido do FFmpeg): formatos que o navegador não decodifica
 * de cara (.mov do iPhone, etc.) mas cujo vídeo interno já é compatível —
 * só "reembala" pra MP4, sem recodificar. Segundos, não minutos.
 *
 * Passo 3 (recodificação completa): só pra formatos realmente incompatíveis
 * (.avi antigo, codec raro). Mais lento, mas é o último recurso.
 */
export async function normalizeVideo(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<File> {
  onProgress?.(0.05);

  if (isMp4Container(file) && (await canBrowserPlayNatively(file))) {
    onProgress?.(1);
    return file;
  }

  const ffmpeg = await getFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(Math.max(progress, 0), 1));
  };
  if (onProgress) ffmpeg.on('progress', progressHandler);

  const inputName = 'input' + (file.name.match(/\.[^.]+$/)?.[0] ?? '.mov');
  const outputName = 'output.mp4';

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    onProgress?.(0.1);

    // ffmpeg.exec não lança erro quando a conversão falha: devolve o código
    // de saída (0 = deu certo). Sem conferir, um vídeo vazio era enviado.
    const outputSize = async () => {
      const out = await ffmpeg.readFile(outputName).catch(() => null);
      return out ? (out as Uint8Array).length : 0;
    };

    let usedFastPath = true;
    try {
      // Remux: copia o vídeo como está, sem recodificar. Rápido de verdade.
      const code = await withTimeout(
        ffmpeg.exec(['-i', inputName, '-c:v', 'copy', '-an', '-movflags', '+faststart', outputName]),
        30000,
        'timeout-fast-path'
      );
      if (code !== 0 || (await outputSize()) === 0) usedFastPath = false;
    } catch {
      usedFastPath = false;
    }

    if (!usedFastPath) {
      await ffmpeg.deleteFile(outputName).catch(() => {});
      onProgress?.(0.15);
      const code = await withTimeout(
        ffmpeg.exec([
          '-i', inputName,
          '-vf', "scale='min(1920,iw)':-2,fps=30",
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '28',
          '-movflags', '+faststart',
          '-an',
          outputName,
        ]),
        300000,
        'A conversão do vídeo demorou demais. Tente um arquivo menor ou mais curto.'
      );
      if (code !== 0 || (await outputSize()) === 0) {
        throw new Error('Não foi possível converter este vídeo. Tente outro arquivo (de preferência MP4).');
      }
    }

    onProgress?.(1);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data as BlobPart], { type: 'video/mp4' });

    return new File([blob], replaceExtension(file.name, '.mp4'), { type: 'video/mp4' });
  } finally {
    if (onProgress) ffmpeg.off('progress', progressHandler);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mov|avi|mkv|webm|mp4|m4v|3gp|wmv)$/i.test(file.name);
}