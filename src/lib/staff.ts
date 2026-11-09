// Logins dos barbeiros (só o admin usa). Criar login, trocar a senha e
// desativar o 2FA passam pela Edge Function manage-staff (precisa da
// chave service role, que fica só no servidor). Listar e remover o
// acesso são funções do banco que só respondem para o admin.
import { supabase } from './supabaseClient';
import type { StaffAccount } from '../types';

type Result = { error: string | null };

async function invokeStaff(body: Record<string, unknown>): Promise<Result> {
  const { error } = await supabase.functions.invoke('manage-staff', { body });
  if (!error) return { error: null };

  let detail = error.message;
  try {
    const payload = await (error as { context?: Response }).context?.json();
    if (payload?.error) detail = payload.error;
  } catch {
    /* resposta sem JSON */
  }
  if (/Failed to send a request|not found|404/i.test(detail)) {
    detail = 'A função manage-staff ainda não foi publicada no Supabase (veja o README).';
  }
  return { error: detail };
}

export async function listStaffAccounts(): Promise<{ accounts: Record<string, StaffAccount>; error: string | null }> {
  const { data, error } = await supabase.rpc('staff_accounts');
  if (error) return { accounts: {}, error: error.message };
  const accounts: Record<string, StaffAccount> = {};
  for (const row of (data ?? []) as StaffAccount[]) {
    if (row.barber_id) accounts[row.barber_id] = row;
  }
  return { accounts, error: null };
}

export const createStaffLogin = (barberId: string, email: string, password: string) =>
  invokeStaff({ action: 'create', barber_id: barberId, email, password });

export const resetStaffPassword = (barberId: string, password: string) =>
  invokeStaff({ action: 'reset_password', barber_id: barberId, password });

export const resetStaffMfa = (barberId: string) => invokeStaff({ action: 'reset_mfa', barber_id: barberId });

export async function removeStaffLogin(barberId: string): Promise<Result> {
  const { error } = await supabase.rpc('remove_staff_login', { p_barber_id: barberId });
  return { error: error ? error.message : null };
}

/** Senha provisória legível: 3 blocos de 4 (letras e números), ex: "k7Hq-2mPx-9Rt4". */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    const password = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) return password;
  }
}

/** Mesma regra da Edge Function e da troca de senha. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use letras e números na senha.';
  return null;
}
