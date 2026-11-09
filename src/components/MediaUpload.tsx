import { useState, type ChangeEvent } from 'react';
import { uploadAsset } from '../lib/supabaseClient';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface Props {
  /** Prefixo do nome do arquivo no storage (ex: "barber"). */
  prefix: string;
  allowVideo?: boolean;
  /**
   * Largura mínima (px) para a foto ficar nítida onde é usada. Abaixo disso a
   * foto é enviada mesmo assim, mas o painel avisa que vai ficar borrada.
   */
  minWidth?: number;
  /** Recebe a URL pública já enviada; normalmente grava no banco na hora. */
  onUploaded: (url: string, type: 'image' | 'video') => Promise<unknown> | void;
}

/**
 * Campo de envio de foto/vídeo: converte só o necessário (HEIC, MOV...),
 * mantém a qualidade original sempre que possível, avisa quando a foto é
 * pequena, envia com barra de progresso e mostra o erro só neste campo.
 */
export default function MediaUpload({ prefix, allowVideo = false, minWidth = 0, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    setError('');
    setWarning('');
    setProgress(0);

    try {
      const { prepareImage, normalizeVideo, looksLikeVideo } = await import('../lib/mediaConvert');
      const isVideo = looksLikeVideo(file);
      if (isVideo && !allowVideo) throw new Error('Aqui só é possível enviar imagens.');

      let processed: File;
      if (isVideo) {
        setStage('Convertendo vídeo');
        processed = await normalizeVideo(file, (ratio) => setProgress(Math.round(ratio * 100)));
      } else {
        setStage('Preparando imagem');
        const image = await prepareImage(file);
        processed = image.file;
        if (minWidth && image.width < minWidth) {
          setWarning(
            `Atenção: esta foto tem só ${image.width} × ${image.height} px e vai ficar borrada no site. ` +
              `Use uma de pelo menos ${minWidth} px de largura (o arquivo original da câmera/celular, ` +
              'não uma miniatura salva da internet ou do WhatsApp).'
          );
        }
      }

      if (!ALLOWED_TYPES.includes(processed.type)) {
        throw new Error('Formato não suportado. Use JPG, PNG, WEBP, foto do celular ou vídeo.');
      }
      if (processed.size > MAX_UPLOAD_BYTES) {
        throw new Error('O arquivo final passou de 50MB. Use um vídeo mais curto ou uma imagem menor.');
      }

      setStage('Enviando');
      setProgress(0);
      const url = await uploadAsset(prefix, processed, setProgress);
      await onUploaded(url, isVideo ? 'video' : 'image');
    } catch (err) {
      setError('Erro no envio: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
      setStage('');
      setProgress(0);
    }
  }

  return (
    <div className="media-upload">
      <input
        type="file"
        accept={allowVideo ? 'image/*,video/*,.heic,.heif,.mov,.avi,.mkv,.webm' : 'image/*,.heic,.heif'}
        onChange={handleChange}
        disabled={busy}
      />
      {minWidth > 0 && <p className="field-hint">Recomendado: foto com pelo menos {minWidth} px de largura.</p>}
      {busy && (
        <div>
          <p className="loading-text">
            {stage}
            {progress > 0 ? ` — ${progress}%` : '...'}
          </p>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {warning && <p className="warning-text">{warning}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
