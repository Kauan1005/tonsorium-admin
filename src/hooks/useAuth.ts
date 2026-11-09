import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import type { StaffContext, StaffRole } from '../types';

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'recovery' // link "esqueci minha senha"
  | 'mfa-challenge' // conta com 2FA: falta digitar o código do app
  | 'no-access' // conta de cliente (criada no site para avaliar)
  | 'error' // não deu para conferir o acesso (rede/banco)
  | 'mfa-enroll' // admin ainda sem 2FA: precisa ativar
  | 'must-change-password' // barbeiro com senha provisória criada pelo admin
  | 'ready';

interface StaffRow {
  role: StaffRole;
  barber_id: string | null;
  barber_name: string;
}

/** Papel da conta. Se o banco ainda não tiver a função nova, cai no is_admin() antigo. */
async function fetchStaff(): Promise<{ staff: StaffContext | null; failed: boolean }> {
  const { data, error } = await supabase.rpc('staff_context');
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : null) as StaffRow | null;
    return {
      staff: row ? { role: row.role, barberId: row.barber_id, barberName: row.barber_name ?? '' } : null,
      failed: false,
    };
  }
  const legacy = await supabase.rpc('is_admin');
  if (!legacy.error) {
    return { staff: legacy.data === true ? { role: 'admin', barberId: null, barberName: '' } : null, failed: false };
  }
  return { staff: null, failed: true };
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffContext | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // Enquanto o usuário não define a nova senha (link do e-mail),
  // nenhuma outra checagem pode pular a tela de "nova senha".
  const recovering = useRef(false);
  // Só a checagem mais recente vale (eventos de login chegam em sequência).
  const lastCheck = useRef(0);
  // Admin que não conseguiu ativar o 2FA por erro do servidor pode seguir nesta sessão.
  const mfaSkipped = useRef(false);

  async function evaluate(newSession: Session | null) {
    if (recovering.current) return;
    const checkId = ++lastCheck.current;
    const stale = () => checkId !== lastCheck.current;

    if (!newSession) {
      setSession(null);
      setStaff(null);
      setStatus('signed-out');
      return;
    }

    // 1) Conta com 2FA ativado: pede o código antes de qualquer coisa.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (stale()) return;
    setSession(newSession);
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      setStaff(null);
      setStatus('mfa-challenge');
      return;
    }

    // 2) Estar logado não basta: quem decide o papel (admin, barbeiro ou
    //    cliente) é o banco — o mesmo que aplica as regras de segurança.
    const { staff: ctx, failed } = await fetchStaff();
    if (stale()) return;
    setStaff(ctx);
    if (failed) {
      setStatus('error');
      return;
    }
    if (!ctx) {
      setStatus('no-access');
      return;
    }

    // 3) Admin precisa da verificação em duas etapas.
    if (ctx.role === 'admin' && aal?.currentLevel !== 'aal2' && !mfaSkipped.current) {
      setStatus('mfa-enroll');
      return;
    }

    // 4) Senha provisória (login criado pelo admin): troca no primeiro acesso.
    if (newSession.user.user_metadata?.must_change_password === true) {
      setStatus('must-change-password');
      return;
    }

    setStatus('ready');
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) evaluate(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        recovering.current = true;
        setSession(newSession);
        setStatus('recovery');
        return;
      }
      if (event === 'USER_UPDATED' || event === 'SIGNED_OUT') recovering.current = false;
      if (event === 'SIGNED_OUT') mfaSkipped.current = false;
      // TOKEN_REFRESHED acontece a cada hora; não precisa checar o papel de novo.
      if (event === 'TOKEN_REFRESHED') {
        setSession(newSession);
        return;
      }
      // Evita chamar o banco de dentro do callback (recomendação do supabase-js).
      setTimeout(() => {
        if (active) evaluate(newSession);
      }, 0);
    });

    return () => {
      active = false;
      lastCheck.current++;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Confere tudo de novo (depois de ativar o 2FA, por exemplo). */
  async function refresh() {
    const { data } = await supabase.auth.getSession();
    await evaluate(data.session);
  }

  function skipMfaEnroll() {
    mfaSkipped.current = true;
    refresh();
  }

  function signIn(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  function signOut() {
    return supabase.auth.signOut();
  }

  function sendPasswordReset(email: string) {
    return supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  }

  async function updatePassword(password: string) {
    const result = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    if (!result.error) {
      recovering.current = false;
      await refresh();
    }
    return result;
  }

  return {
    session,
    staff,
    status,
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
    refresh,
    skipMfaEnroll,
  };
}
