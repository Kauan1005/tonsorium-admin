// =========================================================
// Edge Function: manage-staff
//
// Logins dos barbeiros no painel. Só o admin logado (com o 2FA em dia)
// consegue chamar. Ações:
//   create         — cria o login de um barbeiro (e-mail + senha provisória)
//   reset_password — define uma nova senha provisória
//   reset_mfa      — desativa o 2FA do barbeiro (celular perdido/trocado)
// Remover o login é feito direto no banco (função remove_staff_login).
//
// A chave service role fica SÓ aqui (secret do Supabase), nunca no
// navegador. Publicar:
//   supabase functions deploy manage-staff --no-verify-jwt
// (a própria função confere se quem chamou é admin).
// =========================================================
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ADMIN_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Informe a senha.';
  if (password.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use letras e números na senha.';
  return null;
}

async function callerIsAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  // is_admin() também exige o código do 2FA quando ele está ativado.
  const { data, error } = await userClient.rpc('is_admin');
  return !error && data === true;
}

/** Id da conta (auth.users) ligada ao barbeiro, se existir. */
async function staffUserId(admin: SupabaseClient, barberId: string): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('barber_id', barberId)
    .eq('role', 'barber')
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function createLogin(admin: SupabaseClient, barberId: string, email: string, password: string) {
  const { data: barber, error: barberError } = await admin
    .from('barbers')
    .select('id, name')
    .eq('id', barberId)
    .maybeSingle();
  if (barberError) throw barberError;
  if (!barber) return json({ error: 'Barbeiro não encontrado. Salve o cadastro antes de criar o login.' }, 404);

  if (await staffUserId(admin, barberId)) {
    return json({ error: 'Esse barbeiro já tem login. Use "Redefinir senha".' }, 409);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // Sem e-mail de confirmação: quem cria é o admin. O barbeiro troca a
    // senha provisória no primeiro acesso.
    email_confirm: true,
    user_metadata: { full_name: barber.name, must_change_password: true },
  });
  if (createError || !created?.user) {
    const msg = createError?.message ?? '';
    if ((createError as { code?: string } | null)?.code === 'email_exists' || /already been registered|already exists/i.test(msg)) {
      return json({ error: 'Esse e-mail já tem uma conta (talvez de cliente no site). Use outro e-mail para o login do barbeiro.' }, 409);
    }
    if (/password/i.test(msg)) return json({ error: 'Senha recusada pelo Supabase: ' + msg }, 400);
    throw createError ?? new Error('Falha ao criar o usuário.');
  }

  // O perfil é criado como cliente pelo trigger do banco; aqui vira barbeiro.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ role: 'barber', barber_id: barberId })
    .eq('id', created.user.id);
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw profileError;
  }
  return json({ ok: true });
}

async function resetPassword(admin: SupabaseClient, barberId: string, password: string) {
  const userId = await staffUserId(admin, barberId);
  if (!userId) return json({ error: 'Esse barbeiro ainda não tem login.' }, 404);
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { must_change_password: true },
  });
  if (error) {
    if (/password/i.test(error.message)) return json({ error: 'Senha recusada pelo Supabase: ' + error.message }, 400);
    throw error;
  }
  return json({ ok: true });
}

async function resetMfa(admin: SupabaseClient, barberId: string) {
  const userId = await staffUserId(admin, barberId);
  if (!userId) return json({ error: 'Esse barbeiro ainda não tem login.' }, 404);
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) throw deleteError;
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!(await callerIsAdmin(req))) return json({ error: 'Só o admin pode gerenciar logins.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Pedido inválido.' }, 400);
  }

  const action = String(body.action ?? '');
  const barberId = String(body.barber_id ?? '');
  if (!UUID_RE.test(barberId)) return json({ error: 'Barbeiro inválido.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'E-mail inválido.' }, 400);
      const problem = passwordProblem(body.password);
      if (problem) return json({ error: problem }, 400);
      return await createLogin(admin, barberId, email, body.password as string);
    }
    if (action === 'reset_password') {
      const problem = passwordProblem(body.password);
      if (problem) return json({ error: problem }, 400);
      return await resetPassword(admin, barberId, body.password as string);
    }
    if (action === 'reset_mfa') {
      return await resetMfa(admin, barberId);
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    console.error('manage-staff:', err);
    return json({ error: 'Não foi possível concluir. Tente de novo em instantes.' }, 500);
  }
});
