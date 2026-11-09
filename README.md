# Tonsorium Admin

Painel para editar o conteúdo do site (pasta `Tonsorium Publico`), moderar
as avaliações e cuidar da **agenda dos barbeiros**. React + TypeScript + Vite +
Supabase.

## Quem entra no painel

| Conta | O que vê e faz |
|---|---|
| **Admin** | Tudo: conteúdo do site, avaliações, a agenda de **todos** os barbeiros e os logins da equipe (cria, redefine a senha, desativa o 2FA, remove o acesso). |
| **Barbeiro** | Só a **própria agenda** (marca horários ocupados com nome, serviço e especificações do cliente), **Meu perfil** (foto, especialidade, descrição e frase na seção Equipe do site) e **Minha conta** (senha e 2FA). |
| Cliente do site | Nenhum acesso ao painel (a conta serve só para avaliar). |

No site, quem for agendar vê os horários marcados como **ocupados** (riscados),
sem nome nem detalhes do cliente.

## Como a segurança funciona

- **Quem pode editar o site é decidido pelo banco**, não pela tela: toda tabela
  de conteúdo e o storage só aceitam escrita de quem tem `role = 'admin'` em
  `profiles` (função `is_admin()` nas regras RLS). Um cliente com conta não
  consegue alterar nada, nem chamando a API direto.
- Ninguém consegue se promover a admin ou barbeiro pela API (trigger bloqueia
  mudar `role` e `barber_id`). Logins de barbeiro só são criados pelo admin.
- **Barbeiro:** o banco só deixa ele ler e alterar a agenda dele e, no cadastro
  da Equipe, só foto/especialidade/descrição/frase (nome, visibilidade e ordem
  ficam com o admin). Fotos só na pasta dele no storage.
- **Agenda:** a tabela com os dados dos clientes não é lida pelo público. O site
  usa a função `busy_slots()`, que devolve só barbeiro, início e fim. O banco
  também impede dois horários sobrepostos para o mesmo barbeiro.
- **Verificação em duas etapas (2FA):** obrigatória para o admin e opcional para
  os barbeiros. Depois de ativada, o banco só libera os dados com o código do
  app autenticador: uma senha vazada sozinha não basta.
- **Content-Security-Policy** no painel e no site: só scripts do próprio
  endereço; o site não carrega mais a biblioteca de um CDN de terceiros.
- **Avaliações:** só conta com e-mail confirmado pode avaliar, uma por conta. O
  nome publicado é gerado pelo banco ("João S."), então o cliente não consegue
  se passar por outra pessoa nem mudar o status. O admin pode ocultar, responder
  ou excluir.
- **Google:** a chave da API do Google fica só no secret da Edge Function, nunca
  no navegador.
- Uploads: só o admin envia, com limite de 50MB e apenas JPG/PNG/WEBP/GIF/MP4.

---

## Passo a passo (na ordem)

### 1. Supabase: projeto ativo
No painel do Supabase, confira se o projeto está **ativo** (projetos gratuitos
são pausados após dias sem uso — aí o site fica sem conteúdo). Se ele não
existir mais, crie um novo e atualize URL/chave no `.env` e no `config.js` do site.

### 2. Rodar o schema
**SQL Editor > New query**, cole todo o `supabase/schema.sql` e clique em **Run**.
Ele serve para projeto novo e para atualizar o existente (pode rodar de novo).
Os arquivos `migration-*.sql` antigos ficaram obsoletos — não precisa rodar.

### 3. Tornar sua conta admin
Crie seu usuário em **Authentication > Users > Add user** (se ainda não existir)
e rode no SQL Editor, trocando o e-mail:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

Confira se não sobrou nenhum outro admin indevido:

```sql
select u.email, p.role from public.profiles p join auth.users u on u.id = p.id where p.role = 'admin';
```

### 4. Configurar o login de clientes (Authentication)
- **Sign In / Providers > Email:** deixe *Enable sign ups* LIGADO e
  **Confirm email LIGADO** (sem isso, qualquer e-mail falso conseguiria avaliar).
- **Senhas:** em *Authentication > Policies/Passwords*, mínimo de 8 caracteres e
  exigir letras e números.
- **URL Configuration:** *Site URL* = endereço do site público; em *Redirect URLs*
  adicione o site público e o endereço do admin.
- **Rate limits:** mantenha os limites padrão de e-mails/tentativas.
- **E-mails (obrigatório para o cadastro por e-mail):** o envio padrão do
  Supabase só entrega para membros da equipe do projeto — para clientes ele
  responde "Email address not authorized". Veja o passo 4.2.
- **Login com Google (recomendado):** veja o passo 4.1 — quem entra com Google
  não recebe e-mail nenhum, então não gasta limite.
- **Modelos de e-mail em português:** em *Authentication > Emails*, cole o
  conteúdo dos arquivos de `supabase/email-templates/` (o assunto sugerido está
  no comentário do topo de cada arquivo):
  - `confirmar-cadastro.html` → *Confirm signup*
  - `redefinir-senha.html` → *Reset password*
  - `alterar-email.html` → *Change email address*
- **Anti-robô (opcional, recomendado):** crie um widget no Cloudflare Turnstile,
  ative *Attack Protection > Captcha* no Supabase com a Secret Key e coloque a
  Site Key em `window.TURNSTILE_SITE_KEY` no `config.js` do site.
- **MFA para o admin (recomendado):** ative TOTP em *Authentication > MFA*.

### 4.1 Login com Google (gratuito, sem e-mail de confirmação)
O botão "Continuar com Google" aparece sozinho no site assim que o Google é
ativado no Supabase — não precisa mexer no código.

1. Em console.cloud.google.com, crie um projeto (ex: "Tonsorium").
2. *APIs e serviços > Tela de consentimento OAuth* (Google Auth Platform):
   tipo **Externo**, nome do app `Tonsorium`, seu e-mail de suporte. Escopos:
   só os básicos (`email`, `profile`, `openid`).
3. *Credenciais > Criar credenciais > ID do cliente OAuth* > **Aplicativo da Web**.
   Em *URIs de redirecionamento autorizados*, adicione:
   `https://zqilpryywspzlholplij.supabase.co/auth/v1/callback`
4. Copie o **ID do cliente** e a **Chave secreta** e cole em Supabase >
   *Authentication > Sign In / Providers > Google* (ative e salve). A chave
   secreta fica só no Supabase — não coloque no código.
5. Volte à tela de consentimento e clique em **Publicar app** (sair do modo
   "Teste"); com escopos básicos o Google não exige verificação.
6. Confira que o endereço do site está em *Authentication > URL Configuration >
   Redirect URLs*.

### 4.2 Envio de e-mails (cadastro e "esqueci minha senha")
Volume real de uma barbearia: 1 e-mail por cadastro + alguns de troca de senha.

Serviço escolhido: **Resend** (grátis: 3.000/mês, 100/dia).

**Enquanto não houver domínio, o cadastro por e-mail fica desligado no site**
(`window.EMAIL_AUTH_ENABLED = false` no `config.js` do site) e os clientes
entram com Google. Sem domínio, o Resend só entrega para o e-mail do dono da
conta Resend, usando o remetente de teste `onboarding@resend.dev`.

**Agora (modo de teste, sem domínio):**
1. Crie a conta em resend.com com o e-mail em que você quer receber os testes.
2. *API Keys > Create API Key*, permissão **Sending access**. Copie a chave
   (ela aparece uma vez só).
3. No Supabase, *Authentication > SMTP Settings* > *Enable Custom SMTP*:
   host `smtp.resend.com`, porta `465`, usuário `resend`, senha = a chave do
   passo 2, remetente `onboarding@resend.dev`, nome `Tonsorium`.
4. Cole os modelos de e-mail (passo 4) e teste criando uma conta no site com o
   **mesmo e-mail** da conta Resend — é o único que recebe sem domínio.

**Quando tiver o domínio (ex: `tonsorium.com.br`):**
1. No Resend, *Domains > Add Domain*. Copie os registros DNS que ele mostrar
   para onde o domínio está (Registro.br, Netlify DNS etc.) e espere ficar
   **Verified** (costuma levar minutos).
2. *Integrations > Supabase*: conecte o Supabase, escolha o projeto
   `zqilpryywspzlholplij`, o domínio e o nome `Tonsorium`. A integração cria
   uma chave nova e troca o SMTP sozinha (o remetente vira algo como
   `nao-responda@tonsorium.com.br`).
3. *Authentication > Rate Limits*: suba "emails sent" para ~30 por hora.
4. No `config.js` do site, troque para `window.EMAIL_AUTH_ENABLED = true;`.
5. Apague a chave de teste do passo "Agora" em *API Keys* no Resend.

### 5. Avaliações do Google
1. No Google Cloud, ative **Places API (New)** e crie uma chave restrita a essa API
   (o projeto do Google precisa de faturamento ativo; o uso aqui fica dentro da
   cota gratuita mensal).
2. Instale a Supabase CLI e publique a função (sem verificação de JWT, porque ela
   faz a própria checagem de admin/cron):
   ```
   supabase login
   supabase link --project-ref zqilpryywspzlholplij
   supabase secrets set GOOGLE_PLACES_API_KEY=sua-chave CRON_SECRET=um-texto-longo-aleatorio
   supabase functions deploy sync-google-reviews --no-verify-jwt
   ```
3. No admin, aba **Avaliações**: cole o Place ID, salve e clique em
   **Sincronizar agora**.
4. Para sincronizar todo dia sozinho: edite `supabase/cron-google-reviews.sql`
   colocando o mesmo `CRON_SECRET` e rode no SQL Editor.

### 6. Agenda, logins dos barbeiros e 2FA
Faça nesta ordem (o painel novo precisa do banco atualizado):

1. **Banco:** rode de novo o `supabase/schema.sql` inteiro no SQL Editor (passo 2).
   Ele cria a agenda, o papel de barbeiro e as regras novas, sem apagar nada.
2. **2FA no Supabase:** em *Authentication > Multi-Factor*, confira que **TOTP**
   está ativado (vem ligado por padrão).
3. **Função que cria os logins:** com a Supabase CLI (passo 5), publique:
   ```
   supabase functions deploy manage-staff --no-verify-jwt
   ```
   Opcional: `supabase secrets set ADMIN_ORIGIN=https://endereco-do-admin`
   (restringe o CORS das funções ao endereço do painel).
4. **Publique o painel e o site** (passo 8). No site, envie também a pasta nova
   `vendor/` (biblioteca do Supabase servida pelo próprio site).
5. **Primeiro login do admin:** o painel pede para ativar a verificação em duas
   etapas. Instale um app autenticador (Google Authenticator, Microsoft
   Authenticator ou Authy), escaneie o QR code e digite o código. Depois, a cada
   login, o painel pede o código do app.
6. **Criar o login de cada barbeiro:** aba **Equipe e acessos** > "Acesso ao
   painel" > e-mail + senha provisória (botão *Gerar*) > **Criar login**. Envie o
   e-mail e a senha ao barbeiro (botão *Copiar*). O e-mail é só o usuário: nenhuma
   mensagem é enviada. No primeiro acesso ele cria a senha dele.
7. **Usar a agenda:** em **Agenda**, toque num horário livre para marcar
   (cliente, serviço/corte, especificações e duração) ou bloquear (folga,
   almoço). O botão *Bloquear o dia (folga)* ocupa todos os horários livres do
   dia. O admin vê todos os barbeiros lado a lado ou um de cada vez.

**Perdeu o celular do 2FA?**
- Barbeiro: o admin clica em *Desativar 2FA* na aba Equipe e acessos.
- Admin: rode no SQL Editor (trocando o e-mail) e entre de novo para ativar no celular novo:
  ```sql
  delete from auth.mfa_factors
  where user_id = (select id from auth.users where email = 'seu-email@exemplo.com');
  ```

**LGPD:** os registros da agenda são apagados sozinhos 12 meses depois do
atendimento (seção 9 do `schema.sql`, pelo pg_cron, todo dia às 04:15). É o prazo
informado na Política de Privacidade do site.

**Barbeiro esqueceu a senha:** o admin usa *Redefinir senha* na aba Equipe e
acessos. Remover um barbeiro da Equipe apaga também o login e a agenda dele.

### 7. Rodar o admin
É preciso ter o Node.js 18+ instalado.
```
copy .env.example .env   (e preencha)
npm install
npm run dev
```

### 8. Publicar (Netlify/Vercel)
Comando de build `npm run build`, pasta de saída `dist`, com as variáveis do
`.env` configuradas no painel da hospedagem. Os arquivos `public/_headers`
(Netlify) e `vercel.json` (Vercel) já aplicam a Content-Security-Policy, os
cabeçalhos de segurança e o `noindex` (mantenha os dois iguais). Use um
endereço separado do site (ex: `admin.seudominio.com.br`).
Observação: o conversor de vídeo (`public/ffmpeg`, 32MB) não cabe no
Cloudflare Pages (limite de 25MB por arquivo); Netlify e Vercel aceitam.

## O que dá pra editar
**Agenda** · Início · Conceito · **Visagismo** · Especiais · Clássicos (com preço opcional) ·
**Experiência** (passo a passo do atendimento) · Diferenciais · Galeria · Equipe e
acessos · Horários · Produtos · **Avaliações** · **Dúvidas** (perguntas frequentes) ·
Localização & WhatsApp · Logo & Contato · Minha conta.

Fotos e vídeos são publicados assim que o envio termina; textos usam o botão
Salvar (o painel avisa se você tentar sair com algo não salvo). O painel sai
sozinho após 1 hora sem uso.
