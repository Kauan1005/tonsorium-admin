import { useState } from 'react';
import { toast } from '../lib/toast';
import {
  createStaffLogin,
  generatePassword,
  passwordProblem,
  removeStaffLogin,
  resetStaffMfa,
  resetStaffPassword,
} from '../lib/staff';
import type { Barber, StaffAccount } from '../types';

interface Props {
  barber: Barber;
  account: StaffAccount | undefined;
  onChanged: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou';

/**
 * Acesso do barbeiro ao painel (só o admin vê): criar o login, trocar a
 * senha provisória, desativar o 2FA (celular perdido) e remover o acesso.
 */
export default function StaffLoginBox({ barber, account, onChanged }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'idle' | 'reset'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Mostra o acesso recém-criado/trocado para o admin repassar ao barbeiro.
  const [handout, setHandout] = useState<{ email: string; password: string } | null>(null);

  function validPassword() {
    const problem = passwordProblem(password);
    if (problem) setError(problem);
    return !problem;
  }

  async function create() {
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return setError('Informe um e-mail válido.');
    if (!validPassword()) return;
    setBusy(true);
    const { error: createError } = await createStaffLogin(barber.id, cleanEmail, password);
    setBusy(false);
    if (createError) return setError(createError);
    setHandout({ email: cleanEmail, password });
    setEmail('');
    setPassword('');
    toast('Login criado.');
    onChanged();
  }

  async function reset() {
    setError('');
    if (!account || !validPassword()) return;
    setBusy(true);
    const { error: resetError } = await resetStaffPassword(barber.id, password);
    setBusy(false);
    if (resetError) return setError(resetError);
    setHandout({ email: account.email, password });
    setPassword('');
    setMode('idle');
    toast('Senha provisória definida.');
  }

  async function disableMfa() {
    if (!confirm(`Desativar a verificação em duas etapas de ${barber.name}? Use quando ele perder ou trocar de celular.`)) return;
    setBusy(true);
    const { error: mfaError } = await resetStaffMfa(barber.id);
    setBusy(false);
    if (mfaError) return setError(mfaError);
    toast('2FA desativado. Ele pode ativar de novo em Minha conta.');
    onChanged();
  }

  async function remove() {
    if (!confirm(`Remover o acesso de ${barber.name} ao painel? O cadastro dele na Equipe e a agenda continuam.`)) return;
    setBusy(true);
    const { error: removeError } = await removeStaffLogin(barber.id);
    setBusy(false);
    if (removeError) return setError(removeError);
    setHandout(null);
    toast('Acesso removido.');
    onChanged();
  }

  async function copyHandout() {
    if (!handout) return;
    const text = `Painel Tonsorium\nE-mail: ${handout.email}\nSenha provisória: ${handout.password}\n(no primeiro acesso você cria a sua senha)`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copiado. Envie para o barbeiro.');
    } catch {
      toast('Não foi possível copiar. Selecione o texto e copie.', 'error');
    }
  }

  return (
    <div className="staff-box">
      <p className="staff-box-title">Acesso ao painel</p>

      {handout && (
        <div className="staff-handout">
          <p>
            Envie para {barber.name}: <strong>{handout.email}</strong> · senha provisória <code>{handout.password}</code>
          </p>
          <p className="field-hint">No primeiro acesso ele cria a senha dele. Esta senha não aparece de novo.</p>
          <div className="panel-actions">
            <button type="button" className="btn-secondary" onClick={copyHandout}>
              Copiar
            </button>
            <button type="button" className="btn-link" onClick={() => setHandout(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {!account ? (
        <>
          <p className="field-hint">
            Com o login, {barber.name} marca os horários ocupados e edita a própria foto e descrição. O e-mail é só o
            usuário de acesso: nenhum e-mail é enviado.
          </p>
          <div className="item-row">
            <label>
              E-mail de acesso
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@tonsorium.com.br"
                autoComplete="off"
              />
            </label>
            <label>
              Senha provisória
              <span className="input-with-button">
                <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" className="btn-secondary" onClick={() => setPassword(generatePassword())}>
                  Gerar
                </button>
              </span>
            </label>
          </div>
          <button type="button" onClick={create} disabled={busy}>
            {busy ? 'Criando...' : 'Criar login'}
          </button>
        </>
      ) : (
        <>
          <p className="staff-account">
            <strong>{account.email}</strong>
            <span>Último acesso: {formatDate(account.last_sign_in_at)}</span>
            <span>2FA: {account.mfa_enabled ? 'ativado' : 'desativado'}</span>
          </p>

          {mode === 'reset' ? (
            <div className="item-row">
              <label>
                Nova senha provisória
                <span className="input-with-button">
                  <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                  <button type="button" className="btn-secondary" onClick={() => setPassword(generatePassword())}>
                    Gerar
                  </button>
                </span>
              </label>
            </div>
          ) : null}

          <div className="panel-actions staff-actions">
            {mode === 'reset' ? (
              <>
                <button type="button" onClick={reset} disabled={busy}>
                  {busy ? 'Salvando...' : 'Salvar senha'}
                </button>
                <button type="button" className="btn-link" onClick={() => setMode('idle')}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setPassword(generatePassword());
                    setMode('reset');
                  }}
                  disabled={busy}
                >
                  Redefinir senha
                </button>
                {account.mfa_enabled && (
                  <button type="button" className="btn-secondary" onClick={disableMfa} disabled={busy}>
                    Desativar 2FA
                  </button>
                )}
                <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
                  Remover acesso
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
