# MulmoClaude

[![npm version](https://img.shields.io/npm/v/mulmoclaude.svg)](https://www.npmjs.com/package/mulmoclaude)
[![npm downloads](https://img.shields.io/npm/dm/mulmoclaude.svg)](https://www.npmjs.com/package/mulmoclaude)
[![License: MIT](https://img.shields.io/npm/l/mulmoclaude.svg)](LICENSE)
[![CI](https://github.com/receptron/mulmoclaude/actions/workflows/pull_request.yaml/badge.svg)](https://github.com/receptron/mulmoclaude/actions/workflows/pull_request.yaml)
[![GitHub stars](https://img.shields.io/github/stars/receptron/mulmoclaude.svg?style=social)](https://github.com/receptron/mulmoclaude/stargazers)

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Português (BR)** · [Français](README.fr.md) · [Deutsch](README.de.md)

Chat GUI com Claude Code — memória de longo prazo, saída visual rica, execução em sandbox e acesso remoto de qualquer lugar.

**Memória de longo prazo**: um wiki pessoal integrado — inspirado na ideia de Andrej Karpathy de dar a um LLM um caderno que cresce com o tempo — dá ao Claude **conhecimento persistente** que se acumula a cada conversa.

Converse com o Claude Code e receba de volta não apenas texto, mas **saída visual interativa**: documentos, planilhas, mapas mentais, gráficos, imagens, formulários, cenas 3D e muito mais.

**Execução em sandbox**: o Claude Code é executado dentro de um sandbox, protegendo seu sistema contra ataques de injeção de prompt.

**Acesso de qualquer lugar**: conecte Telegram, Slack, LINE, Discord ou [10 outros aplicativos de mensagens](#messaging-bridges) para conversar com seu agente de IA pelo celular.

**Tarefas agendadas**: delegue trabalhos recorrentes — resumos diários, verificações periódicas, lembretes programados — ao agendador integrado, que executa seu agente via cron.

## Início Rápido

```bash
# 1. Clone and install
git clone git@github.com:receptron/mulmoclaude.git
cd mulmoclaude && yarn install

# 2. Configure (optional — image generation requires Gemini API key)
cp .env.example .env   # edit .env to add GEMINI_API_KEY

# 3. Run
yarn dev
```

Abra [http://localhost:5173](http://localhost:5173). É isso — comece a conversar.

> **Pré-requisitos**: Node.js 20+, [Claude Code CLI](https://claude.ai/code) instalado e autenticado.

> **Idioma da UI**: 8 idiomas são suportados (inglês, japonês, chinês, coreano, espanhol, português (BR), francês, alemão). O padrão é detectado automaticamente a partir do idioma do navegador / sistema operacional. Para indicá-lo explicitamente, defina `VITE_LOCALE=pt-BR` em `.env`. O locale é escolhido em tempo de build/dev; reinicie `yarn dev` após alterá-lo. Consulte [`docs/developer.md`](docs/developer.md#i18n-vue-i18n) para saber como adicionar strings.

## O que você pode fazer?

| Peça ao Claude para...                              | O que você recebe                                          |
| --------------------------------------------------- | ---------------------------------------------------------- |
| "Escreva uma proposta de projeto"                   | Documento markdown rico no canvas                          |
| "Plote a receita do último trimestre em um gráfico" | Visualização interativa com ECharts                        |
| "Crie um plano de viagem para Kyoto"                | Guia ilustrado com imagens                                 |
| "Gerencie minhas tarefas"                           | Quadro Kanban com arrastar e soltar                        |
| "Ingerir este artigo: URL"                          | Página do wiki com `[[links]]` para memória de longo prazo |
| "Agende um resumo diário de notícias"               | Tarefa recorrente executada automaticamente                |
| "Gere uma imagem de um pôr do sol"                  | Imagem gerada por IA (Gemini)                              |
| "Assine este feed RSS"                              | Fonte registrada em `/sources`, coletada em horários       |
| "O que há de novo nos meus feeds?"                  | Caixa de não lidos em `/news` com chat por artigo          |

> **Páginas que você pode acessar diretamente**: `/wiki` (navegar + Lint), `/news` (caixa de não lidos), `/sources` (gerenciar fontes), `/automations` (tarefas recorrentes), `/calendar`, `/files`, `/skills`, `/roles`. Cada uma tem um compositor de chat próprio que inicia uma conversa nova já ciente do contexto da página.

> **Mexendo no MulmoClaude?** Consulte [`docs/developer.md`](docs/developer.md) para variáveis de ambiente, scripts e arquitetura.

<a id="messaging-bridges"></a>
### Bridges de mensagens

O MulmoClaude pode ser acessado de aplicativos de mensagens via **processos bridge**. Os bridges são executados como processos filhos separados e se conectam ao servidor via socket.io.

```bash
# Interactive CLI bridge (same machine)
yarn cli

# Telegram bot bridge (requires TELEGRAM_BOT_TOKEN in .env)
yarn telegram
```

Os bridges também estão disponíveis como pacotes npm independentes:

```bash
# Chat platforms
npx @mulmobridge/cli@latest          # CLI bridge
npx @mulmobridge/telegram@latest     # Telegram bridge
npx @mulmobridge/slack@latest        # Slack bridge
npx @mulmobridge/discord@latest      # Discord bridge
npx @mulmobridge/line@latest         # LINE bridge
npx @mulmobridge/whatsapp@latest     # WhatsApp bridge
npx @mulmobridge/matrix@latest       # Matrix bridge
npx @mulmobridge/irc@latest          # IRC bridge
npx @mulmobridge/mattermost@latest   # Mattermost bridge
npx @mulmobridge/zulip@latest        # Zulip bridge
npx @mulmobridge/messenger@latest    # Facebook Messenger bridge
npx @mulmobridge/google-chat@latest  # Google Chat bridge
npx @mulmobridge/mastodon@latest     # Mastodon bridge
npx @mulmobridge/bluesky@latest      # Bluesky bridge
npx @mulmobridge/chatwork@latest     # Chatwork bridge (Japanese business chat)
npx @mulmobridge/xmpp@latest         # XMPP / Jabber bridge
npx @mulmobridge/rocketchat@latest   # Rocket.Chat bridge
npx @mulmobridge/signal@latest       # Signal bridge (via signal-cli-rest-api)
npx @mulmobridge/teams@latest        # Microsoft Teams bridge (Bot Framework)
npx @mulmobridge/line-works@latest   # LINE Works bridge (enterprise LINE)
npx @mulmobridge/nostr@latest        # Nostr encrypted DM bridge
npx @mulmobridge/viber@latest        # Viber bridge

# Universal / glue
npx @mulmobridge/webhook@latest      # Generic HTTP webhook (dev glue)
npx @mulmobridge/twilio-sms@latest   # SMS via Twilio
npx @mulmobridge/email@latest        # Email bridge (IMAP + SMTP)
```

Todos os bridges suportam **streaming de texto em tempo real** (atualização da digitação conforme o agente escreve). CLI e Telegram também suportam **anexos de arquivos** (imagens, PDFs, DOCX, XLSX, PPTX). Consulte [`docs/mulmobridge-guide.md`](docs/mulmobridge-guide.md) para a lista completa de plataformas e instruções de configuração.

### Por que você precisa de uma chave da API do Gemini?

O MulmoClaude utiliza o modelo **Gemini 3.1 Flash Image (nano banana 2)** do Google para geração e edição de imagens. Isso habilita:

- `generateImage` — cria imagens a partir de descrições em texto
- `editImage` — transforma ou modifica uma imagem existente (por exemplo, "converter para o estilo Ghibli")
- Imagens inline incorporadas em documentos (Guia de Receitas, Planejador de Viagens, etc.)

Sem uma chave da API do Gemini, os papéis que usam geração de imagens serão desabilitados na UI.

### Obtendo uma chave da API do Gemini

1. Acesse o [Google AI Studio](https://aistudio.google.com/apikey)
2. Entre com sua conta Google
3. Clique em **Create API key**
4. Copie a chave e cole no seu arquivo `.env` como `GEMINI_API_KEY=...`

A API do Gemini tem uma camada gratuita que é suficiente para uso pessoal.

<a id="security"></a>
## Segurança

O MulmoClaude usa o Claude Code como backend de IA, que tem acesso a ferramentas incluindo Bash — o que significa que ele pode ler e escrever arquivos na sua máquina.

**Sem Docker**, o Claude pode acessar qualquer arquivo que sua conta de usuário possa alcançar, incluindo chaves SSH e credenciais armazenadas fora do seu workspace. Isso é aceitável para uso pessoal local, mas vale a pena entender.

**Com o Docker Desktop instalado**, o MulmoClaude executa automaticamente o Claude dentro de um contêiner em sandbox. Apenas seu workspace e a configuração do próprio Claude (`~/.claude`) são montados — o restante do seu sistema de arquivos é invisível para o Claude. Nenhuma configuração é necessária: o app detecta o Docker na inicialização e ativa o sandbox automaticamente.

**Autenticação por bearer token**: todo endpoint `/api/*` requer um cabeçalho `Authorization: Bearer <token>`. O token é gerado automaticamente na inicialização do servidor e injetado no navegador via uma tag `<meta>` — sem configuração manual. A única exceção é `/api/files/*` (isento porque as tags `<img>` em documentos renderizados não conseguem anexar cabeçalhos). Consulte [`docs/developer.md`](docs/developer.md#auth-bearer-token-on-api) para detalhes.

**Encaminhamento de credenciais do sandbox** (opcional): por padrão, o sandbox não tem acesso às credenciais do host. Duas variáveis de ambiente permitem expor seletivamente o que o `git` / `gh` precisam:

- `SANDBOX_SSH_AGENT_FORWARD=1` — encaminha o socket do agente SSH do host. As chaves privadas permanecem no host.
- `SANDBOX_MOUNT_CONFIGS=gh,gitconfig` — monta `~/.config/gh` e `~/.gitconfig` em modo somente leitura.

Contrato completo e notas de segurança: [`docs/sandbox-credentials.md`](docs/sandbox-credentials.md).

### Instalando o Docker Desktop

1. Baixe o Docker Desktop em [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. **macOS**: abra o `.dmg` e arraste o Docker para Aplicativos, depois inicie-o a partir de Aplicativos
3. **Windows**: execute o instalador e siga as instruções (WSL2 é configurado automaticamente se necessário)
4. **Linux**: siga o [guia de instalação para Linux](https://docs.docker.com/desktop/install/linux/)
5. Aguarde o Docker Desktop terminar de iniciar — o ícone da baleia na barra de menu / bandeja do sistema deve ficar estável (não animado)
6. Reinicie o MulmoClaude — ele detectará o Docker e construirá a imagem do sandbox na primeira execução (uma vez, leva cerca de um minuto)

Quando o sandbox Docker está ativo no macOS, as credenciais são gerenciadas automaticamente — o app extrai tokens OAuth do Keychain do sistema na inicialização e os atualiza em erros 401, portanto, nenhuma etapa manual é necessária.

Se o Docker não estiver instalado, o app exibe um banner de aviso e continua funcionando sem sandbox.

> **Modo de depuração**: Para executar sem o sandbox mesmo quando o Docker estiver instalado, defina `DISABLE_SANDBOX=1` antes de iniciar o servidor.

## Registro de logs

O servidor escreve texto legível no console e JSON de fidelidade total
em arquivos diários rotacionados em `server/system/logs/`. Tudo é
configurável via `LOG_LEVEL`, `LOG_*_FORMAT`, `LOG_FILE_DIR`, etc.

Consulte [docs/logging.md](docs/logging.md) para a referência completa, exemplos de
formato, comportamento de rotação e receitas.

## Papéis

Cada papel dá ao Claude uma persona, paleta de ferramentas e área de foco diferente:

| Papel               | O que faz                                                                           |
| ------------------- | ----------------------------------------------------------------------------------- |
| **General**         | Assistente para todos os fins — tarefas, agendador, wiki, documentos, mapas mentais |
| **Office**          | Documentos, planilhas, formulários, apresentações, painéis de dados                 |
| **Guide & Planner** | Guias de viagem, livros de receitas, planejadores de viagens com saída visual rica  |
| **Artist**          | Geração de imagens, edição de imagens, arte generativa com p5.js                    |
| **Tutor**           | Ensino adaptativo — avalia seu nível antes de explicar qualquer coisa               |
| **Storyteller**     | Histórias ilustradas interativas com imagens e cenas em HTML                        |

Trocar de papel reinicia o contexto do Claude e carrega apenas as ferramentas de que esse papel precisa — mantendo as respostas rápidas e focadas.

## Skills — Execute seus Claude Code Skills a partir do MulmoClaude

O MulmoClaude pode listar e iniciar os **Claude Code skills** que você já possui. Um skill é qualquer pasta em `~/.claude/skills/<name>/` contendo um arquivo `SKILL.md` com um `description` em frontmatter YAML e um corpo markdown de instruções. Veja a [documentação de Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills) para detalhes sobre como escrever skills.

### Como usar

1. Abra o MulmoClaude e permaneça em um dos papéis com skills habilitados: **General**, **Office** ou **Tutor**.
2. Peça ao Claude para mostrar seus skills — por exemplo, _"mostre meus skills"_ ou _"liste os skills"_.
3. O Claude invoca a ferramenta `manageSkills`, e uma visão **Skills** em painel dividido se abre no canvas:
   - **Esquerda**: cada skill descoberto na sua máquina, com sua descrição e o badge de escopo (`USER` / `PROJECT`).
   - **Direita**: o conteúdo completo do `SKILL.md` do skill selecionado.
4. Clique em **Run** em um skill. O MulmoClaude envia `/<skill-name>` ao Claude como uma mensagem de chat normal; a maquinaria de slash-command do Claude Code resolve isso contra `~/.claude/skills/` e executa as instruções do skill inline na mesma sessão de chat.

Sem digitação extra, sem copiar e colar corpos de SKILL.md — o botão Run é um wrapper de um clique em volta de `/skill-name`.

### Descoberta de skills — dois escopos

| Scope       | Location                               | Semântica                                                                                                     |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **User**    | `~/.claude/skills/<name>/SKILL.md`     | Skills pessoais, compartilhados em todos os projetos que você abre com o Claude CLI.                          |
| **Project** | `~/mulmoclaude/.claude/skills/<name>/` | Skills de escopo do workspace MulmoClaude. O escopo de projeto **vence** se um nome colidir com o de usuário. |

Ambos os escopos são somente leitura na fase 0 — as edições acontecem no sistema de arquivos. Uma versão futura permitirá que o próprio MulmoClaude crie / edite skills de escopo de projeto.

### Sandbox Docker vs. sem Docker

O **modo sandbox Docker** padrão do MulmoClaude isola o Claude Code em um contêiner por segurança (veja [Segurança](#security)). O comportamento dos skills difere entre os dois modos:

| Mode                                 | User skills (`~/.claude/skills/`) | Project skills (`~/mulmoclaude/.claude/skills/`) | Built-in CLI skills (`/simplify`, `/update-config`, …) |
| ------------------------------------ | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| **Non-Docker** (`DISABLE_SANDBOX=1`) | ✅ Todos funcionam                | ✅                                               | ✅                                                     |
| **Docker sandbox** (default)         | ⚠️ Veja ressalvas abaixo          | ✅ Montado via volume do workspace               | ✅                                                     |

**Ressalvas do Docker — por que os skills do usuário às vezes não funcionam no sandbox:**

- **`~/.claude/skills/` com symlink** — se o seu `~/.claude/skills` (ou qualquer subentrada) for um symlink apontando para fora de `~/.claude/` (por exemplo, `~/.claude/skills → ~/ss/dotfiles/claude/skills`), o alvo do symlink não está presente dentro do contêiner. O link aparece como **pendente**, e o Claude Code recorre apenas aos skills integrados.
- **CLI do Claude mais antigo dentro da imagem do sandbox** — `Dockerfile.sandbox` fixa a versão do CLI no momento da construção da imagem. Se essa versão estiver atrasada em relação ao CLI do host (por exemplo, 2.1.96 na imagem vs. 2.1.105 no host), a descoberta de skills de usuário pode se comportar de forma diferente.

**Soluções alternativas para configurações ricas em skills que não funcionam bem com o sandbox:**

1. **Desative o sandbox para esta sessão**:

   ```bash
   DISABLE_SANDBOX=1 yarn dev
   ```

   O Claude CLI executa com seu `~/.claude/` real e tudo é resolvido nativamente. Use isso quando confiar nos prompts que está prestes a enviar — o sandbox ainda é o padrão recomendado para trabalho não confiável / exploratório.

2. **Mova os skills para o escopo de projeto** — copie os skills específicos que você deseja para `~/mulmoclaude/.claude/skills/` (esse caminho é montado como o volume do workspace dentro do sandbox, portanto, sem dramas de symlink). Ótimo para skills que são específicos do seu fluxo de trabalho MulmoClaude de qualquer forma.

3. **Achatar symlinks** — se você mantém sua biblioteca de skills via symlinks (por exemplo, em um repositório dotfiles), substituir o symlink `~/.claude/skills` de nível superior pelo diretório real é a correção mais simples.

### O que o skill realmente recebe

Quando você pressiona **Run**, o MulmoClaude envia um turno simples de usuário contendo a string de slash-command:

```text
/my-skill-name
```

Esse é o payload inteiro — o MulmoClaude **não** inclui inline o corpo do `SKILL.md` nem contexto extra. O corpo é o que o Claude Code lê quando o CLI resolve o slash-command do lado dele. Isso mantém a entrada do chat pequena e torna seguro executar skills longos (`SKILL.md` de vários kilobytes) sem estourar o contexto do prompt.

### Salvar uma conversa como um novo skill

Depois de um chat produtivo, você pode pedir ao MulmoClaude para capturar o fluxo de trabalho:

```text
"transforme esta conversa em um skill chamado fix-ci"
"salve isto como um skill chamado publish-flow"
"transforme em skill"   ← Claude escolhe um slug para você
```

O Claude lê a transcrição atual do chat, destila os passos que você seguiu e escreve um novo `SKILL.md` em `~/mulmoclaude/.claude/skills/<slug>/`. O skill aparece na visão Skills imediatamente e pode ser invocado via `/<slug>` em qualquer sessão futura.

Notas sobre salvamento:

- **Apenas escopo de projeto** — os salvamentos vão para `~/mulmoclaude/.claude/skills/`, nunca para `~/.claude/skills/`. O escopo de usuário permanece somente leitura a partir do MulmoClaude.
- **Sem sobrescrever** — se um skill com o mesmo nome já existir (em qualquer escopo), o salvamento falha e o Claude pedirá um nome diferente.
- **Regras de slug** — letras minúsculas, dígitos e hifens; 1 a 64 caracteres; sem hifens iniciais / finais ou consecutivos. O Claude escolhe um automaticamente; se você quiser um nome específico, mencione-o no pedido.

### Excluir um skill salvo

Os skills de escopo de projeto ganham um botão **Delete** ao lado do botão Run na visão Skills (os skills de escopo de usuário são somente leitura — sem botão Delete exibido). Confirmar a caixa de diálogo remove `~/mulmoclaude/.claude/skills/<slug>/SKILL.md`. Se você também colocou arquivos extras nessa pasta manualmente, eles são mantidos; apenas o SKILL.md é removido.

Você também pode pedir ao Claude para excluir pelo nome:

```text
"exclua o skill fix-ci"
```

## Wiki — Memória de Longo Prazo para o Claude Code

O MulmoClaude inclui uma **base de conhecimento pessoal** inspirada na [ideia de Bases de Conhecimento para LLM de Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Ela dá ao Claude Code uma memória de longo prazo genuína — não apenas um `memory.md` curto, mas um wiki em crescimento e interconectado que o Claude constrói e mantém sozinho.

O papel **General** tem suporte a wiki integrado. Experimente:

- `"Ingerir este artigo: <URL>"` — o Claude busca a página, extrai o conhecimento principal, cria ou atualiza páginas do wiki e registra a atividade
- `"O que meu wiki diz sobre transformers?"` — o Claude pesquisa o índice, lê páginas relevantes e sintetiza uma resposta fundamentada
- `"Faça lint do meu wiki"` — verificação de saúde para páginas órfãs, links quebrados e entradas ausentes no índice
- `"Mostre o índice do wiki"` — renderiza o catálogo completo de páginas no canvas

### Como funciona

O wiki vive inteiramente como arquivos markdown simples no seu workspace:

```
<workspace>/data/wiki/
  index.md          ← catalog of all pages (title, description, last updated)
  log.md            ← append-only activity log
  pages/<slug>.md   ← one page per entity, concept, or theme
  sources/<slug>.md ← raw ingested sources
```

O Claude usa suas ferramentas de arquivo integradas (`read`, `write`, `glob`, `grep`) para navegar e manter o wiki — nenhum banco de dados especial ou indexação é necessário. As referências cruzadas usam a sintaxe `[[wiki link]]`, que a UI do canvas renderiza como navegação clicável.

Com o tempo, o wiki cresce para se tornar uma base de conhecimento pessoal que qualquer papel pode consultar, tornando o Claude progressivamente mais útil quanto mais você o usa.

## Gráficos (ECharts)

O plugin `presentChart` renderiza visualizações do [Apache ECharts](https://echarts.apache.org/) no canvas. Peça por uma linha, barra, candlestick, sankey, heatmap ou rede/grafo — o Claude escreve um objeto de opções ECharts e o plugin o monta. Cada gráfico tem um botão **[↓ PNG]** para exportação com um clique.

Disponível nos papéis **General**, **Office**, **Guide & Planner** e **Tutor**. Experimente:

```text
Chart last quarter's revenue by region as a bar chart
Plot AAPL's daily closes for the last 30 days as a candlestick
Show a sankey of energy flow: coal/gas/solar → electricity → home/industry/transport
```

### Armazenamento

Cada chamada de `presentChart` escreve um arquivo em `<workspace>/artifacts/charts/`:

```text
<workspace>/artifacts/charts/
  sales-overview-1776135210389.chart.json
  apple-stock-1776135300000.chart.json
```

Um único documento pode conter qualquer número de gráficos, que são renderizados empilhados no canvas:

```json
{
  "title": "Apple Stock Analysis",
  "charts": [
    {
      "title": "Daily close",
      "type": "line",
      "option": {
        "xAxis": {
          "type": "category",
          "data": ["2024-01", "2024-02", "2024-03"]
        },
        "yAxis": { "type": "value" },
        "series": [{ "type": "line", "data": [180, 195, 210] }]
      }
    },
    {
      "title": "Volume",
      "type": "bar",
      "option": {
        "xAxis": {
          "type": "category",
          "data": ["2024-01", "2024-02", "2024-03"]
        },
        "yAxis": { "type": "value" },
        "series": [{ "type": "bar", "data": [1000000, 1200000, 950000] }]
      }
    }
  ]
}
```

O campo `option` é passado para o [`setOption`](https://echarts.apache.org/en/api.html#echartsInstance.setOption) do ECharts como está — você pode consultar a [referência completa de opções do ECharts](https://echarts.apache.org/en/option.html) ao editar esses arquivos manualmente. As edições são refletidas da próxima vez que o documento for reaberto no canvas.

## Opcional: Ferramentas MCP para X (Twitter)

O MulmoClaude inclui ferramentas MCP opcionais para ler e pesquisar posts no X (Twitter) via a API X v2 oficial.

| Tool        | O que faz                                             |
| ----------- | ----------------------------------------------------- |
| `readXPost` | Busca um único post por URL ou ID de tweet            |
| `searchX`   | Pesquisa posts recentes por palavra-chave ou consulta |

Essas ferramentas estão **desabilitadas por padrão** e requerem um Bearer Token da API X para ativar.

### Configuração

1. Acesse [console.x.com](https://console.x.com) e entre com sua conta do X
2. Crie um novo app — um Bearer Token é gerado automaticamente
3. Copie o Bearer Token e adicione-o ao seu `.env`:
   ```
   X_BEARER_TOKEN=your_bearer_token_here
   ```
4. Adicione créditos à sua conta em [console.x.com](https://console.x.com) (necessário para fazer chamadas de API)
5. Reinicie o servidor de desenvolvimento — as ferramentas são ativadas automaticamente

### Uso

Essas ferramentas estão **disponíveis apenas em papéis personalizados**. Os papéis integrados não as incluem por padrão (exceto General). Para usá-las em seu próprio papel:

1. Crie ou edite um arquivo JSON de papel personalizado em `~/mulmoclaude/roles/<id>.json`
2. Adicione `readXPost` e/ou `searchX` à sua lista `availablePlugins`

Uma vez configurado, você pode colar qualquer URL de `x.com` ou `twitter.com` no chat e o Claude irá buscá-la e lê-la automaticamente.

## Configurando Ferramentas Adicionais (Configurações Web)

O ícone de engrenagem na barra lateral abre um modal de Configurações onde você pode estender o conjunto de ferramentas do Claude sem editar código. As alterações são aplicadas na próxima mensagem (sem necessidade de reiniciar o servidor).

### Aba Allowed Tools

Cole os nomes das ferramentas, um por linha. Útil para servidores MCP integrados do Claude Code (Gmail, Google Calendar) após um handshake OAuth de uma única vez:

```text
mcp__claude_ai_Gmail
mcp__claude_ai_Google_Calendar
```

Primeiro, execute `claude mcp` uma vez em um terminal e complete o fluxo OAuth para cada serviço — as credenciais persistem em `~/.claude/`.

### Aba MCP Servers

Adicione servidores MCP externos sem editar JSON manualmente. Dois tipos são suportados:

- **HTTP** — servidores remotos (ex.: `https://example.com/mcp`). Funciona em todos os modos; no Docker, URLs `localhost` / `127.0.0.1` são reescritas automaticamente para `host.docker.internal`.
- **Stdio** — subprocesso local, restrito a `npx` / `node` / `tsx` por segurança. Quando o sandbox Docker está habilitado, os caminhos de script devem ficar dentro do workspace para que sejam resolvidos dentro do contêiner.

A configuração fica em `<workspace>/config/`:

```text
<workspace>/config/
  settings.json    ← extra allowed tool names
  mcp.json         ← Claude CLI --mcp-config compatible
```

O arquivo MCP usa o formato padrão do Claude CLI, então você pode copiá-lo entre máquinas, ou mesmo usá-lo diretamente com o CLI do `claude`.

### Editando os arquivos de configuração diretamente

Ambos os arquivos são JSON simples — você pode editá-los com qualquer editor de texto em vez da UI de Configurações. O servidor os relê em cada mensagem, então:

- Não é necessário reiniciar o servidor após uma edição de arquivo.
- As alterações também são percebidas pela UI de Configurações — basta fechar e reabrir o modal.
- A UI e o arquivo estão sempre sincronizados: salvar a partir da UI sobrescreve o arquivo, e edições manuais aparecem na UI na próxima abertura.

Isso é útil para:

- Importar em massa servidores MCP de outra estação de trabalho (copie `mcp.json` por cima).
- Manter sua configuração sob controle de versão em um repositório dotfiles.
- Comentar temporariamente um servidor invertendo `"enabled": false`.

**Exemplo de `mcp.json`** — um servidor HTTP remoto (público, sem autenticação) e um servidor stdio local:

```json
{
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp",
      "enabled": true
    },
    "everything": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "enabled": true
    }
  }
}
```

Restrições que o servidor aplica ao carregar o arquivo:

- As chaves `mcpServers` (o id do servidor) devem corresponder a `^[a-z][a-z0-9_-]{0,63}$`.
- A `url` HTTP deve ser analisável como `http:` ou `https:`.
- O `command` stdio é restrito a `npx`, `node` ou `tsx`.
- Entradas que falham na validação são silenciosamente descartadas no carregamento (um aviso é registrado); o restante do arquivo ainda se aplica.

**Exemplo de `settings.json`**:

```json
{
  "extraAllowedTools": ["mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Calendar"]
}
```

Você não precisa listar entradas `mcp__<id>` para servidores definidos em `mcp.json` — essas são permitidas automaticamente em toda execução do agente. `extraAllowedTools` é apenas para ferramentas que não são acessíveis através de seus próprios `mcpServers`, tipicamente os bridges `mcp__claude_ai_*` integrados do Claude Code depois que você executou `claude mcp` e completou o OAuth.

## Anexos de Chat

Cole (Ctrl+V / Cmd+V) ou arraste e solte arquivos na entrada de chat para enviá-los ao Claude junto com sua mensagem.

| File type                                         | O que o Claude vê                       | Dependência                  |
| ------------------------------------------------- | --------------------------------------- | ---------------------------- |
| Image (PNG, JPEG, GIF, WebP, …)                   | Bloco de conteúdo de visão (nativo)     | Nenhuma                      |
| PDF                                               | Bloco de conteúdo de documento (nativo) | Nenhuma                      |
| Text (.txt, .csv, .json, .md, .xml, .html, .yaml) | Texto UTF-8 decodificado                | Nenhuma                      |
| DOCX                                              | Texto simples extraído                  | `mammoth` (npm)              |
| XLSX                                              | CSV por planilha                        | `xlsx` (npm)                 |
| PPTX                                              | Convertido para PDF                     | LibreOffice (sandbox Docker) |

A conversão de PPTX é executada dentro da imagem do sandbox Docker (`libreoffice --headless`). Sem Docker, uma mensagem sugere exportar para PDF ou imagens. O tamanho máximo de anexo é 30 MB.

## Modos de visualização do canvas

O canvas (painel direito) suporta 8 modos de visualização, alternáveis via barra de ferramentas do launcher, parâmetro de query de URL ou atalho de teclado:

| Shortcut     | View      | URL param         | Descrição                                    |
| ------------ | --------- | ----------------- | -------------------------------------------- |
| `Cmd/Ctrl+1` | Single    | (default)         | Mostra o resultado da ferramenta selecionada |
| `Cmd/Ctrl+2` | Stack     | `?view=stack`     | Todos os resultados empilhados verticalmente |
| `Cmd/Ctrl+3` | Files     | `?view=files`     | Explorador de arquivos do workspace          |
| `Cmd/Ctrl+4` | Todos     | `?view=todos`     | Quadro de tarefas Kanban / tabela / lista    |
| `Cmd/Ctrl+5` | Scheduler | `?view=scheduler` | Calendário de tarefas agendadas              |
| `Cmd/Ctrl+6` | Wiki      | `?view=wiki`      | Índice de páginas do wiki                    |
| `Cmd/Ctrl+7` | Skills    | `?view=skills`    | Lista e editor de skills                     |
| `Cmd/Ctrl+8` | Roles     | `?view=roles`     | Gerenciamento de papéis                      |

Todo modo de visualização é orientado por URL: clicar em um botão do launcher atualiza `?view=`, e chegar em uma URL com `?view=todos` (por exemplo) restaura a visualização correspondente. A lista de modos de visualização é definida uma vez em `src/utils/canvas/viewMode.ts` — adicionar um novo modo é apenas adicionar um item ao array.

## Workspace

Todos os dados são armazenados como arquivos simples no diretório do workspace, agrupados em quatro buckets semânticos (#284):

```
~/mulmoclaude/
  config/              ← settings.json, mcp.json, roles/, helps/
  conversations/       ← chat/, memory.md, summaries/, searches/
  data/                ← wiki/, todos/, calendar/, contacts/, scheduler/,
                         sources/, transports/
  artifacts/           ← charts/, documents/, html/, html-scratch/,
                         images/, news/, spreadsheets/, stories/
```

Consulte [`docs/developer.md`](docs/developer.md#workspace-layout-mulmoclaude) para a referência completa. Workspaces anteriores ao #284 devem executar a migração única (`yarn tsx scripts/migrate-workspace-284.ts --dry-run` → `--execute`) uma vez antes que o servidor inicie.

### Explorador de tarefas

O Explorador de Tarefas está acessível via `Cmd/Ctrl+4`, o botão do launcher Todos, ou selecionando `data/todos/todos.json` no explorador de arquivos. Ele fornece três sub-modos de visualização:

- **Kanban** — colunas no estilo GitHub Projects. Arraste cartões entre
  colunas para alterar o status. Cada coluna tem um menu para renomear, marcar como
  concluída ou excluir. Novas colunas podem ser adicionadas a partir da barra de ferramentas.
- **Table** — tabela classificável com colunas de status / prioridade / labels / data de
  vencimento / criação. Clique em uma linha para editar inline.
- **List** — checklist simples com o mesmo editor inline.

As colunas de status são armazenadas em `data/todos/columns.json` e têm como padrão
`Backlog / Todo / In Progress / Done`. Cada tarefa carrega campos opcionais
`status`, `priority` (low / medium / high / urgent) e `dueDate`
além dos campos originais text / note / labels / completed.

A ferramenta MCP `manageTodoList` do chat mantém seu comportamento existente
inalterado — ela pode ler e editar text / note / labels / completed
de tarefas, e os campos extras do explorador são preservados durante as edições via MCP.

### Agendador e agendamento de skills

O agendador (`Cmd/Ctrl+5` ou `?view=scheduler`) gerencia tarefas recorrentes armazenadas em `data/scheduler/items.json`. O núcleo do agendador (`@receptron/task-scheduler`) lida com a lógica de recuperação para execuções perdidas e suporta agendamentos `interval`, `daily` e `cron`.

Skills podem ser agendados para executar automaticamente adicionando um campo `schedule` ao frontmatter do SKILL.md:

```yaml
---
description: Morning news digest
schedule: daily 08:00
---
```

O Claude registrará o skill no agendador, e ele executará automaticamente no agendamento especificado.

### Extração de memória

O Claude extrai automaticamente fatos duráveis do usuário de conversas de chat e os acrescenta a `conversations/memory.md`. Isso é executado como parte da passagem diária do journal — fatos como preferências alimentares, hábitos de trabalho e preferências de ferramentas são destilados de chats recentes sem intervenção do usuário. O arquivo de memória é sempre carregado no contexto do agente para que o Claude possa personalizar as respostas.

## Pacotes Monorepo

Código compartilhado é extraído em pacotes npm publicáveis em `packages/`:

| Package                     | Descrição                                                | Links                                                                                                   |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@mulmobridge/protocol`     | Tipos e constantes compartilhados                        | [npm](https://www.npmjs.com/package/@mulmobridge/protocol) / [source](packages/protocol/)               |
| `@mulmobridge/client`       | Biblioteca cliente Socket.io                             | [npm](https://www.npmjs.com/package/@mulmobridge/client) / [source](packages/client/)                   |
| `@mulmobridge/chat-service` | Serviço de chat no lado do servidor (DI factory)         | [npm](https://www.npmjs.com/package/@mulmobridge/chat-service) / [source](packages/chat-service/)       |
| `@mulmobridge/cli`          | Bridge de terminal                                       | [npm](https://www.npmjs.com/package/@mulmobridge/cli) / [source](packages/bridges/cli/)                 |
| `@mulmobridge/telegram`     | Bridge de bot Telegram                                   | [npm](https://www.npmjs.com/package/@mulmobridge/telegram) / [source](packages/bridges/telegram/)       |
| `@mulmobridge/slack`        | Bridge de bot Slack                                      | [npm](https://www.npmjs.com/package/@mulmobridge/slack) / [source](packages/bridges/slack/)             |
| `@mulmobridge/discord`      | Bridge de bot Discord                                    | [npm](https://www.npmjs.com/package/@mulmobridge/discord) / [source](packages/bridges/discord/)         |
| `@mulmobridge/line`         | Bridge de bot LINE                                       | [npm](https://www.npmjs.com/package/@mulmobridge/line) / [source](packages/bridges/line/)               |
| `@mulmobridge/whatsapp`     | Bridge WhatsApp                                          | [npm](https://www.npmjs.com/package/@mulmobridge/whatsapp) / [source](packages/bridges/whatsapp/)       |
| `@mulmobridge/matrix`       | Bridge Matrix                                            | [npm](https://www.npmjs.com/package/@mulmobridge/matrix) / [source](packages/bridges/matrix/)           |
| `@mulmobridge/irc`          | Bridge IRC                                               | [npm](https://www.npmjs.com/package/@mulmobridge/irc) / [source](packages/bridges/irc/)                 |
| `@mulmobridge/mattermost`   | Bridge Mattermost                                        | [npm](https://www.npmjs.com/package/@mulmobridge/mattermost) / [source](packages/bridges/mattermost/)   |
| `@mulmobridge/zulip`        | Bridge Zulip                                             | [npm](https://www.npmjs.com/package/@mulmobridge/zulip) / [source](packages/bridges/zulip/)             |
| `@mulmobridge/messenger`    | Bridge Facebook Messenger                                | [npm](https://www.npmjs.com/package/@mulmobridge/messenger) / [source](packages/bridges/messenger/)     |
| `@mulmobridge/google-chat`  | Bridge Google Chat                                       | [npm](https://www.npmjs.com/package/@mulmobridge/google-chat) / [source](packages/bridges/google-chat/) |
| `@mulmobridge/mastodon`     | Bridge Mastodon                                          | [npm](https://www.npmjs.com/package/@mulmobridge/mastodon) / [source](packages/bridges/mastodon/)       |
| `@mulmobridge/bluesky`      | Bridge Bluesky                                           | [npm](https://www.npmjs.com/package/@mulmobridge/bluesky) / [source](packages/bridges/bluesky/)         |
| `@mulmobridge/chatwork`     | Bridge Chatwork (chat empresarial japonês)               | [npm](https://www.npmjs.com/package/@mulmobridge/chatwork) / [source](packages/bridges/chatwork/)       |
| `@mulmobridge/xmpp`         | Bridge XMPP / Jabber                                     | [npm](https://www.npmjs.com/package/@mulmobridge/xmpp) / [source](packages/bridges/xmpp/)               |
| `@mulmobridge/rocketchat`   | Bridge Rocket.Chat                                       | [npm](https://www.npmjs.com/package/@mulmobridge/rocketchat) / [source](packages/bridges/rocketchat/)   |
| `@mulmobridge/signal`       | Bridge Signal (via signal-cli-rest-api)                  | [npm](https://www.npmjs.com/package/@mulmobridge/signal) / [source](packages/bridges/signal/)           |
| `@mulmobridge/teams`        | Bridge Microsoft Teams (Bot Framework)                   | [npm](https://www.npmjs.com/package/@mulmobridge/teams) / [source](packages/bridges/teams/)             |
| `@mulmobridge/line-works`   | Bridge LINE Works (LINE corporativo)                     | [npm](https://www.npmjs.com/package/@mulmobridge/line-works) / [source](packages/bridges/line-works/)   |
| `@mulmobridge/nostr`        | Bridge de DM criptografado Nostr                         | [npm](https://www.npmjs.com/package/@mulmobridge/nostr) / [source](packages/bridges/nostr/)             |
| `@mulmobridge/viber`        | Bridge Viber                                             | [npm](https://www.npmjs.com/package/@mulmobridge/viber) / [source](packages/bridges/viber/)             |
| `@mulmobridge/webhook`      | Bridge genérico HTTP webhook (cola para desenvolvedores) | [npm](https://www.npmjs.com/package/@mulmobridge/webhook) / [source](packages/bridges/webhook/)         |
| `@mulmobridge/twilio-sms`   | SMS via Twilio                                           | [npm](https://www.npmjs.com/package/@mulmobridge/twilio-sms) / [source](packages/bridges/twilio-sms/)   |
| `@mulmobridge/email`        | Bridge de Email (IMAP + SMTP)                            | [npm](https://www.npmjs.com/package/@mulmobridge/email) / [source](packages/bridges/email/)             |
| `@mulmobridge/mock-server`  | Servidor mock para testes                                | [npm](https://www.npmjs.com/package/@mulmobridge/mock-server) / [source](packages/mock-server/)         |
| `@receptron/task-scheduler` | Agendador de tarefas persistente                         | [npm](https://www.npmjs.com/package/@receptron/task-scheduler) / [source](packages/scheduler/)          |

Qualquer pessoa pode escrever um bridge em qualquer linguagem — basta falar o protocolo socket.io documentado em [`docs/bridge-protocol.md`](docs/bridge-protocol.md).

## Documentação

A documentação completa está em [`docs/`](docs/README.md). Aqui estão os principais pontos de entrada:

### Para usuários

| Guia                                                                                                       | Descrição                                                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [MulmoBridge Guide](docs/mulmobridge-guide.en.md) / [日本語](docs/mulmobridge-guide.md)                    | Conecte aplicativos de mensagens (Telegram, Slack, LINE, etc.) ao seu PC de casa |
| [Scheduler Guide](docs/scheduler-guide.en.md) / [日本語](docs/scheduler-guide.md)                          | Calendário e tarefas recorrentes                                                 |
| [Obsidian Integration](docs/tips/obsidian.en.md) / [日本語](docs/tips/obsidian.md)                         | Use Obsidian para navegar pelo wiki e documentos do MulmoClaude                  |
| [Telegram Setup](docs/message_apps/telegram/README.md) / [日本語](docs/message_apps/telegram/README.ja.md) | Configuração passo a passo do Telegram Bot                                       |
| [LINE Setup](docs/message_apps/line/README.md) / [日本語](docs/message_apps/line/README.ja.md)             | Configuração passo a passo do LINE Bot                                           |

### Para desenvolvedores

| Guia                                               | Descrição                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Developer Guide](docs/developer.md)               | Variáveis de ambiente, scripts, estrutura do workspace, CI                   |
| [Bridge Protocol](docs/bridge-protocol.md)         | Especificação em nível de protocolo para escrever novos bridges de mensagens |
| [Sandbox Credentials](docs/sandbox-credentials.md) | Encaminhamento de credenciais do sandbox Docker (SSH, GitHub CLI)            |
| [Logging](docs/logging.md)                         | Níveis de log, formatos, rotação de arquivos                                 |
| [CHANGELOG](docs/CHANGELOG.md)                     | Histórico de releases                                                        |

## Licença

MIT — veja [LICENSE](LICENSE).
