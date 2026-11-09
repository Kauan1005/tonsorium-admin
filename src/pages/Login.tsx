import { useState, type FormEvent } from 'react';

interface Props {
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  sendPasswordReset: (email: string) => Promise<{ error: { message: string } | null }>;
}

export default function Login({ signIn, sendPasswordReset }: Props) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    if (mode === 'login') {
      const { error } = await signIn(email, password);
      setLoading(false);
      if (error) {
        setError(
          /rate|too many/i.test(error.message)
            ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
            : 'E-mail ou senha inválidos.'
        );
      }
      return;
    }

    await sendPasswordReset(email);
    setLoading(false);
    // Mesma mensagem com ou sem conta: não revela quais e-mails existem.
    setInfo('Se esse e-mail tiver acesso, você vai receber um link para criar uma nova senha.');
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/logo-mark.png" alt="Tonsorium" className="login-logo" />
        <p className="login-sub">{mode === 'login' ? 'Painel da barbearia' : 'Recuperar senha'}</p>

        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        {mode === 'login' && (
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
        )}

        {mode === 'forgot' && (
          <p className="field-hint">Barbeiro: peça ao admin para redefinir sua senha pela aba Equipe.</p>
        )}

        {error && <p className="error-text">{error}</p>}
        {info && <p className="save-ok">{info}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Enviar link'}
        </button>

        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setMode(mode === 'login' ? 'forgot' : 'login');
            setError('');
            setInfo('');
          }}
        >
          {mode === 'login' ? 'Esqueci minha senha' : 'Voltar para o login'}
        </button>
      </form>
    </div>
  );
}
