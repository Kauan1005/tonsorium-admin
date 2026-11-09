import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

interface Props {
  onVerified: () => void;
  onSignOut: () => void;
}

/** Segundo passo do login: código de 6 dígitos do app autenticador. */
export default function MfaChallenge({ onVerified, onSignOut }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Digite os 6 números que aparecem no app.');
      return;
    }

    setLoading(true);
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    const factor = factors?.all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
    if (listError || !factor) {
      setLoading(false);
      setError('Não encontramos a verificação desta conta. Saia e entre de novo.');
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: clean });
    setLoading(false);
    if (verifyError) {
      setError(
        /rate|too many/i.test(verifyError.message)
          ? 'Muitas tentativas. Aguarde alguns minutos.'
          : 'Código incorreto ou expirado. Digite o código atual do app.'
      );
      setCode('');
      return;
    }
    onVerified();
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/logo-mark.png" alt="Tonsorium" className="login-logo" />
        <p className="login-sub">Verificação em duas etapas</p>
        <p className="field-hint" style={{ textAlign: 'center' }}>
          Abra o app autenticador no celular e digite o código de 6 números da conta Tonsorium.
        </p>

        <label>
          Código
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="000000"
            autoFocus
            required
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Confirmando...' : 'Confirmar'}
        </button>
        <button type="button" className="btn-link" onClick={onSignOut}>
          Sair
        </button>
        <p className="field-hint" style={{ textAlign: 'center' }}>
          Perdeu o celular? Barbeiro: peça ao admin para desativar o 2FA da sua conta.
        </p>
      </form>
    </div>
  );
}
