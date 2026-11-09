import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';
import { toast } from '../../lib/toast';
import { passwordProblem } from '../../lib/staff';
import MfaSetup from '../../components/MfaSetup';
import type { StaffContext } from '../../types';

interface Props {
  session: Session;
  staff: StaffContext;
  onSecurityChange: () => void;
}

/** Minha conta: trocar a senha e a verificação em duas etapas (2FA). */
export default function AccountSection({ session, staff, onSecurityChange }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [settingUp, setSettingUp] = useState(false);
  const isAdmin = staff.role === 'admin';

  async function loadMfa() {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
    setMfaFactorId(verified?.id ?? null);
    setMfaLoading(false);
  }

  useEffect(() => {
    loadMfa();
  }, []);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError('');
    const problem = passwordProblem(password);
    if (problem) return setPasswordError(problem);
    if (password !== confirmation) return setPasswordError('As senhas não conferem.');
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    setSavingPassword(false);
    if (error) {
      if (error.code === 'same_password' || /different from the old/i.test(error.message)) {
        return setPasswordError('A nova senha precisa ser diferente da atual.');
      }
      if (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message)) {
        return setPasswordError('Por segurança, saia e entre de novo antes de trocar a senha.');
      }
      return setPasswordError('Não foi possível trocar a senha: ' + error.message);
    }
    setPassword('');
    setConfirmation('');
    toast('Senha alterada.');
  }

  async function disableMfa(replace: boolean) {
    if (!mfaFactorId) return;
    const question = replace
      ? 'Trocar o celular da verificação? Você vai escanear um QR code novo agora.'
      : 'Desativar a verificação em duas etapas? Sua conta ficará protegida só pela senha.';
    if (!confirm(question)) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
    if (error) {
      toast('Não foi possível alterar o 2FA: ' + error.message, 'error');
      return;
    }
    setMfaFactorId(null);
    if (replace) setSettingUp(true);
    else {
      toast('Verificação em duas etapas desativada.');
      onSecurityChange();
    }
  }

  function mfaDone() {
    setSettingUp(false);
    toast('Verificação em duas etapas ativada.');
    loadMfa();
    onSecurityChange();
  }

  return (
    <section className="panel">
      <h2>Minha conta</h2>
      <p className="panel-sub">
        Acesso: <strong>{session.user.email}</strong> · {isAdmin ? 'Administrador' : `Barbeiro${staff.barberName ? ` (${staff.barberName})` : ''}`}
      </p>

      <div className="item-card">
        <h3 className="panel-subtitle">Verificação em duas etapas (2FA)</h3>
        {mfaLoading ? (
          <p className="loading-text">Carregando...</p>
        ) : settingUp ? (
          <MfaSetup onDone={mfaDone} />
        ) : mfaFactorId ? (
          <>
            <p className="save-ok">Ativada. Ao entrar, o painel pede o código do app autenticador.</p>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => disableMfa(true)}>
                Trocar de celular
              </button>
              {!isAdmin && (
                <button type="button" className="btn-danger" onClick={() => disableMfa(false)}>
                  Desativar
                </button>
              )}
            </div>
            {isAdmin && <p className="field-hint">Para o admin, a verificação é obrigatória.</p>}
          </>
        ) : (
          <>
            <p className="field-hint">
              Recomendado: além da senha, o painel pede um código do app autenticador do seu celular. Assim, ninguém
              entra só com a sua senha.
            </p>
            <button type="button" onClick={() => setSettingUp(true)}>
              Ativar verificação
            </button>
          </>
        )}
      </div>

      <form className="item-card" onSubmit={changePassword} style={{ marginTop: 16 }}>
        <h3 className="panel-subtitle">Trocar senha</h3>
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
        {passwordError && <p className="error-text">{passwordError}</p>}
        <div className="panel-actions">
          <button type="submit" disabled={savingPassword}>
            {savingPassword ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </div>
      </form>
    </section>
  );
}
