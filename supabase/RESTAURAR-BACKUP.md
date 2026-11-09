# Como restaurar o backup do banco

O backup roda todo dia às 06:00 no repositório **privado** `tonsorium-backup`
no GitHub. Cada dia vira uma versão (commit) com três arquivos:

| Arquivo      | O que tem                                              |
|--------------|--------------------------------------------------------|
| `roles.sql`  | permissões do banco                                    |
| `schema.sql` | estrutura: tabelas, regras de segurança, funções       |
| `data.sql`   | os dados: textos do site, avaliações, contas, horários |

**Não estão no backup:** as fotos (logo, galeria, equipe, fotos de perfil),
as configurações de login (Google, e-mail, URLs) e as chaves do projeto.
Guarde os arquivos originais das fotos.

---

## Primeiro: descubra qual é o problema

### 1. O site parou de carregar o conteúdo / o painel não entra
Quase sempre é o **projeto pausado** (plano gratuito, 7 dias sem uso).
**Não precisa de backup:** no Supabase, abra o projeto e clique em
**Resume project**. Em alguns minutos tudo volta como estava.

### 2. Apaguei alguma coisa por engano (um serviço, uma pergunta, um texto)
Não restaure o banco inteiro por causa disso — você perderia o que mudou
depois do backup. Recupere só o que sumiu:

1. No GitHub, abra o repositório `tonsorium-backup` > **Commits**
   (ou o relógio "commits" acima da lista de arquivos).
2. Abra o backup do dia **anterior** ao erro > **Browse files** > `data.sql`.
3. Use **Ctrl+F** com o nome da tabela. As principais:

   | O que sumiu            | Procure por                  |
   |------------------------|------------------------------|
   | Textos do topo         | `public.site_hero`           |
   | Conceito / pilares     | `public.site_concept` / `public.site_pillars` |
   | Serviços               | `public.services_special` / `public.services_classic` |
   | Visagismo              | `public.site_visagism` / `public.visagism_points` |
   | Experiência            | `public.experience_steps`    |
   | Diferenciais           | `public.differentiators`     |
   | Equipe / Galeria       | `public.barbers` / `public.gallery_photos` |
   | Produtos               | `public.products`            |
   | Perguntas frequentes   | `public.faq_items`           |
   | Horários               | `public.business_hours`      |
   | Avaliações             | `public.reviews`             |

4. Logo abaixo da linha `COPY public.nome_da_tabela (...) FROM stdin;`
   aparecem os itens, um por linha, na mesma ordem das colunas entre
   parênteses (separadas por um espaço largo). Copie o texto e cadastre de
   novo pelo painel admin. Se preferir, me mande o trecho que eu gero o
   comando para reinserir.

### 3. Perdi o projeto inteiro (apagado ou corrompido)
Aí sim restaure o banco completo em um **projeto novo**, seguindo abaixo.

---

## Restauração completa (projeto novo)

### Passo 1 — Criar o projeto novo
1. Supabase > **New project** (região São Paulo). Anote a senha do banco
   e use só letras e números.
2. Aguarde o projeto ficar pronto.

### Passo 2 — Preparar o GitHub (só na primeira vez)
1. No repositório `tonsorium-backup`: **Add file > Create new file**, nome
   `.github/workflows/restore.yml`. Cole o conteúdo de
   `supabase/restore-github-actions.yml` (deste projeto) e faça o commit.
2. **Settings > Secrets and variables > Actions > New repository secret**:
   - Nome: `RESTORE_DB_URL`
   - Valor: o endereço **Session pooler** do projeto **novo**
     (botão **Connect** no topo do Supabase), com a senha no lugar de
     `[YOUR-PASSWORD]`.

   ⚠️ É um secret separado do `SUPABASE_DB_URL` de propósito: assim a
   restauração nunca escreve por cima do banco que está no ar.

### Passo 3 — Restaurar
1. Aba **Actions > restore-database > Run workflow**.
2. **Versão do backup:** deixe `main` para a mais recente, ou cole o código
   do commit de um dia específico (aparece na lista de **Commits**).
3. **Confirmação:** digite `RESTAURAR`.
4. Clique em **Run workflow** e espere o ✓ verde. Se der ✗, nada foi
   gravado (a restauração é "tudo ou nada") — mande o print do erro.

### Passo 4 — Reconectar tudo ao projeto novo
1. **SQL Editor** do projeto novo: rode o `supabase/schema.sql` deste
   projeto (recria os espaços de fotos e confere as regras de segurança;
   não apaga nada).
2. **Chaves novas** (Supabase > Project Settings > API: URL e chave pública):
   - site: `config.js` e o `preconnect` no topo do `index.html`;
   - admin: arquivo `.env` (e as variáveis na hospedagem, se já publicado);
   - `supabase/cron-google-reviews.sql`, se usar as avaliações do Google.
3. **Login de clientes** (Authentication):
   - **Sign In / Providers > Google:** mesmo ID e chave secreta de antes.
   - No Google Cloud, em **Clientes**, adicione o novo endereço de retorno:
     `https://NOVO-PROJETO.supabase.co/auth/v1/callback`.
   - **URL Configuration:** Site URL e Redirect URLs.
   - **Emails:** cole os modelos de `supabase/email-templates/`.
   - **SMTP (Resend)**, se já estiver configurado.
4. **Fotos:** envie de novo pelo painel admin (logo, galeria, equipe,
   produtos). Fotos de perfil dos clientes: cada um envia de novo, ou fica a
   foto da conta Google.
5. **Backup:** atualize o secret `SUPABASE_DB_URL` com o endereço do projeto
   novo, para os próximos backups saírem dele.
6. Teste: abra o site, entre no painel admin e confira as avaliações.

---

## Dica: teste a restauração uma vez
O plano gratuito permite 2 projetos. Vale criar um projeto de teste, rodar
a restauração completa nele e conferir os dados — assim, no dia em que
precisar, você já sabe que funciona. Depois é só apagar o projeto de teste.
