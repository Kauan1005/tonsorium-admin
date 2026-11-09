import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

interface Props {
  /** Chamado depois que o código foi confirmado (2FA ativado). */
  onDone: () => void;
  /** Mostra o botão de seguir sem 2FA quando o servidor falha (só na tela obrigatória do admin). */
  onSkip?: () => void;
}

/** "data:image/svg+xml;..." pronto para <img>, venha o QR como SVG puro ou já como data URL. */
function qrSrc(qr: string) {
  return qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

/**
 * Ativa a verificação em duas etapas (TOTP): mostra o QR code para o app
 * autenticador (Google Authenticator, Microsoft Authenticator, Authy...)
 * e confirma com o código de 6 dígitos.
 */
export default function MfaSetup({ onDone, onSkip }: Props) {
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function start() {
    setError('');
    setFailed(false);
    setQr('');
    // Tentativas anteriores que não foram concluídas atrapalham um novo cadastro.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.factor_type === 'totp' && f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'Tonsorium',
      friendlyName: `Painel Tonsorium ${new Date().toLocaleString('pt-BR')}`,
    });
    if (enrollError || !data) {
      setError(
        'Não foi possível iniciar a verificação em duas etapas' +
          (enrollError ? ` (${enrollError.message})` : '') +
          '. Confira se o MFA (TOTP) está ativo no Supabase: Authentication > Multi-Factor.'
      );
      setFailed(true);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Digite os 6 números que aparecem no app.');
      return;
    }
    setBusy(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
    setBusy(false);
    if (verifyError) {
      setError('Código incorreto ou expirado. Confira o horário do celular e digite o código atual.');
      return;
    }
    onDone();
  }

  if (failed) {
    return (
      <div className="mfa-setup">
        <p className="error-text">{error}</p>
        <div className="panel-actions">
          <button type="button" onClick={start}>
            Tentar de novo
          </button>
          {onSkip && (
            <button type="button" className="btn-secondary" onClick={onSkip}>
              Continuar sem 2FA desta vez
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!qr) return <p className="loading-text">Gerando o QR code...</p>;

  return (
    <form className="mfa-setup" onSubmit={verify}>
      <ol className="mfa-steps">
        <li>Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
        <li>No app, toque em adicionar conta e escaneie o QR code abaixo.</li>
        <li>Digite o código de 6 números que aparece no app.</li>
      </ol>
      <img className="mfa-qr" src={qrSrc(qr)} alt="QR code para o app autenticador" width={180} height={180} />
      <p className="field-hint">
        Não consegue escanear? Digite esta chave no app: <code className="mfa-secret">{secret}</code>
      </p>
      <label>
        Código do app
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000000"
          required
        />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Confirmando...' : 'Ativar verificação'}
      </button>
    </form>
  );
}
