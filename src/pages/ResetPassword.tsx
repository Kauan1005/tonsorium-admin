import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { passwordProblem } from '../lib/staff';

interface Props {
  updatePassword: (password: string) => Promise<{ error: { message: string; code?: string } | null }>;
  /** Título e explicação (ex: senha provisória criada pelo admin). */
  title?: string;
  intro?: string;
  onSignOut?: () => void;
}

/**
 * Criar nova senha: aberta pelo link de "Esqueci minha senha" ou no
 * primeiro acesso do barbeiro (senha provisória criada pelo admin).
 */
export default function ResetPassword({ updatePassword, title = 'Criar nova senha', intro, onSignOut }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirmation) return setError('As senhas não conferem.');

    setLoading(true);
    // Conta com 2FA: o Supabase só troca a senha depois do código do app.
    if (needsCode) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
      const verify = factor
        ? await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\D/g, '') })
        : { error: { message: 'sem fator' } };
      if (verify.error) {
        setLoading(false);
        return setError('Código do app incorreto ou expirado.');
      }
    }

    const { error } = await updatePassword(password);
    setLoading(false);
    if (!error) return;
    if (error.code === 'insufficient_aal' || /aal2/i.test(error.message)) {
      setNeedsCode(true);
      return setError('Esta conta usa verificação em duas etapas: digite também o código do app.');
    }
    if (error.code === 'same_password' || /different from the old/i.test(error.message)) {
      return setError('A nova senha precisa ser diferente da atual.');
    }
    if (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message)) {
      return setError('Por segurança, saia e entre de novo antes de trocar a senha.');
    }
    setError('Não foi possível alterar a senha: ' + error.message);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/logo-mark.png" alt="Tonsorium" className="login-logo" />
        <p className="login-sub">{title}</p>
        {intro && (
          <p className="field-hint" style={{ textAlign: 'center' }}>
            {intro}
          </p>
        )}

        <label>
          Nova senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            maxLength={72}
            required
          />
        </label>
        <label>
          Repita a nova senha
          <input
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            maxLength={72}
            required
          />
        </label>
        <p className="field-hint">Pelo menos 10 caracteres, com letras e números.</p>

        {needsCode && (
          <label>
            Código do app autenticador
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
            />
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar nova senha'}
        </button>
        {onSignOut && (
          <button type="button" className="btn-link" onClick={onSignOut}>
            Sair
          </button>
        )}
      </form>
    </div>
  );
}
