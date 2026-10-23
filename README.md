# Caixa da Família

App de controle financeiro da família, com a **Casa**, o **Salão Samia Lima** e a **Base Mídia** na mesma conta, cada um com seu saldo.

- Login com usuário e senha (só quem tem senha entra)
- Instala no celular como aplicativo (iPhone e Android) e abre sem internet com os últimos dados salvos
- Fechamento do dia 10 ao dia 9 (ajustável)
- Caixa inicial, saldo real em conta, contas a pagar e a receber com liquidação por data
- Pagamento sugerido aos donos (Samia e Tiago), dízimo de 10% sobre o que vocês recebem
- Limites de gasto por categoria com alertas
- Contas fixas trazidas para o mês seguinte com um toque

Tudo roda na **Vercel**: as telas, o login e as funções do servidor. Os dados ficam num banco **Upstash Redis**, conectado pelo próprio painel da Vercel. Os dois serviços têm plano grátis.

---

## Como colocar no ar (uns 15 minutos)

### 1. Criar o projeto na Vercel

1. Entre em [vercel.com](https://vercel.com) com sua conta do GitHub.
2. Clique em **Add New… → Project**.
3. Escolha o repositório **caixadafamilia** e clique em **Import**.
4. Em **Framework Preset**, deixe **Other**. Não precisa mudar mais nada.
5. Clique em **Deploy**. O site vai abrir, mas ainda sem banco e sem senhas. É normal.

### 2. Conectar o banco de dados

1. No projeto, abra a aba **Storage**.
2. Clique em **Create Database** (ou **Connect Database**) e escolha **Upstash for Redis** (pode aparecer como **Redis**).
3. Escolha o plano **Free**, a região **São Paulo (gru1)** se aparecer, e confirme.
4. Na tela de conexão, marque o projeto **caixadafamilia** e todos os ambientes (**Production**, **Preview**, **Development**).

A Vercel cria sozinha as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`. O app usa essas duas.

### 3. Criar as senhas

1. No projeto, vá em **Settings → Environment Variables**.
2. Adicione uma variável para cada pessoa, com o nome em maiúsculas depois de `SENHA_`:

| Nome da variável | Valor |
|---|---|
| `SENHA_TIAGO` | a senha do Tiago |
| `SENHA_SAMIA` | a senha da Samia |

O usuário para entrar é o que vem depois de `SENHA_`, em minúsculas: **tiago** e **samia**.

Use senhas fortes, com pelo menos 10 caracteres. Depois de 8 tentativas erradas, o app bloqueia novas tentativas por 15 minutos.

3. (Opcional, recomendado) Adicione `AUTH_SECRET` com uma frase longa e aleatória. Ela assina as sessões de login. Se não existir, o app usa o token do banco.

### 4. Publicar de novo

As variáveis só valem depois de uma nova publicação:

1. Vá em **Deployments**.
2. No último item, clique nos três pontinhos e depois em **Redeploy**.

Pronto. Abra o endereço do projeto (algo como `caixadafamilia.vercel.app`) e entre.

### 5. Instalar no celular

- **iPhone:** abra o endereço no **Safari**, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- **Android:** abra no **Chrome** e toque em **Instalar** no aviso que aparece no app, ou no menu ⋮ → **Instalar app**.

Cada pessoa entra uma vez em cada aparelho. O login fica guardado por 90 dias.

---

## Dia a dia

- **Trocar uma senha:** mude a variável `SENHA_...` na Vercel e faça **Redeploy**. Todas as sessões abertas com a senha antiga são encerradas.
- **Incluir outra pessoa:** crie `SENHA_NOME` e faça **Redeploy**.
- **Sair de um aparelho:** em **Ajustes → Sair deste aparelho**. A cópia local dos dados é apagada.
- **Transferências:** dinheiro que só muda de conta (de outra conta sua, Pix com a Samia) vai na categoria **Transferência entre contas**. Ela entra no saldo em conta, mas não conta como renda, gasto nem base do dízimo.
- **Sem internet:** o app abre e mostra os últimos dados salvos no aparelho. Lançar e liquidar precisam de internet.
- **Os dois celulares:** os dados se atualizam ao abrir o app, a cada 30 segundos com ele aberto e pelo botão de atualizar no topo.

## Onde ficam os dados

No banco Upstash Redis ligado ao projeto:

- `lanc`: os lançamentos, um por item
- `config`: os ajustes (fechamento, caixa inicial, porcentagens, limites)

Para ver ou fazer cópia, abra o banco pela aba **Storage** da Vercel e clique em **Open in Upstash**.

## Estrutura

```
index.html            telas do app (login, painel e janelas)
app.css               visual, pensado primeiro para celular
app.js                lógica do app: cálculos, telas, sincronização
sw.js                 service worker (abre rápido e sem internet)
manifest.webmanifest  dados de instalação (nome, ícone, cores)
icons/                ícones do app
api/                  funções do servidor na Vercel
  login.js            entrar
  logout.js           sair
  me.js               quem está logado
  dados.js            todos os lançamentos e ajustes
  lancamentos.js      criar, editar, liquidar e excluir
  config.js           salvar ajustes
  _lib/core.js        banco, sessão, proteção e validação
vercel.json           cabeçalhos de segurança e de cache
```

## Segurança

- Senhas ficam só nas variáveis de ambiente da Vercel, nunca no código.
- A sessão usa um cookie `HttpOnly` e `Secure`, assinado no servidor.
- Toda função de dados exige login e valida cada campo antes de salvar.
- Pedidos de outros sites são recusados.
- O banco nunca é acessado direto pelo navegador, só pelas funções da Vercel.

## Testar no computador

Com Node 18 ou mais novo, dá para rodar as funções com um banco em memória, definindo `CAIXA_DEV_MEMORY=1`, `SENHA_TIAGO` e `SENHA_SAMIA`. O jeito mais simples é usar a CLI da Vercel (`vercel dev`), que já serve as telas e as funções juntas.
