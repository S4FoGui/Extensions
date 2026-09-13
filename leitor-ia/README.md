# Leitor IA — extensão de leitura assistida

Extensão para Chrome/Edge (Manifest V3) que **lê a página que você está vendo**
e deixa você conversar sobre ela com **5 provedores**: ChatGPT (OpenAI),
Claude (Anthropic), Gemini (Google), Kimi (Moonshot) e GLM (Z.AI).

- Troca de modelo em **um clique** (dropdown agrupado por provedor + modelos personalizados).
- **Esforço de raciocínio** (Baixo / Médio / Alto) aplicado de verdade em cada API.
- Interface **minimalista em preto & branco inspirada no Claude web** (painel lateral,
  serifa nos títulos, seletor de modelo customizado com ícones por provedor).
- Respostas em **streaming** (aparecem enquanto o modelo escreve) + botão de parar.
- Envia a página como contexto (com limite configurável) e reconhece **texto selecionado**
  (menu de contexto “Perguntar ao Leitor IA”).
- Suas chaves ficam salvas **somente neste navegador** (chrome.storage.local).
- Abra `preview-ui.html` no navegador para ver o design sem instalar nada.

## Novidades

### Resposta dentro da extensão + leitura da página (fluxo padrão)
O fluxo padrão é 100% dentro do navegador, sem abrir aba nenhuma:
1. Você abre a extensão numa página qualquer (gaveta dentro da própria aba);
2. A extensão **lê a página atual** (título, URL, texto e trecho selecionado)
   — o chip no topo do painel mostra qual página foi lida;
3. Você digita a pergunta; a extensão envia **pergunta + conteúdo da página**
   ao modelo;
4. A **resposta aparece na própria extensão**, em streaming, enquanto você
   continua navegando.

Para isso cada provedor usa a **chave de API** (a do Gemini é grátis:
`aistudio.google.com/apikey`) ou, no caso do Google, **login com a conta
Google (OAuth)** usando o tier gratuito — ambos com resposta dentro do painel.

### Visão (print da página)
Botão de câmera no topo do painel: quando ativo, envia um **print JPEG da
aba** junto com a pergunta para modelos com suporte a visão (flag `vision`
por modelo no config) — schemas exatos de OpenAI (`image_url`), Anthropic
(`image/base64`) e Gemini (`inlineData`).

### Web grátis sem chave — e sem ser redirecionado
O modo padrão é a **web grátis**: a extensão mantém uma **aba oculta** no site
do modelo (chatgpt.com, claude.ai, gemini, kimi, z.ai). Você entra com sua
conta Google **uma única vez** nessa aba; daí em diante, pergunta no painel e
a resposta **chega no próprio painel**, em streaming — sem chave de API e sem
abrir/roubar nada: a aba oculta apenas digita e lê o chat, como você faria.
Se o site mudar de layout e a automação parar, o painel avisa. A aba oculta é
**nunca-descartável** (`autoDiscardable:false`), a resposta é capturada por
`MutationObserver` (não sofre throttling de timers), o stream sobrevive a
reload do painel (snapshot + resume) e, se aparecer login/Cloudflare, o painel
mostra o botão **“Fazer login no provedor”** em vez de falhar calado.
Alternativas com resposta no painel: **chave de API** (a do Gemini é grátis) e
**Conta Google (OAuth)** no Gemini.

### Painel se reativa sozinho após atualização da extensão
Se a extensão for **recarregada/atualizada com a página aberta**, o painel
perde a conexão (“Extension context invalidated”). Agora ele detecta isso,
ele se reconecta sozinho na hora (os botões “+” e “Ler página” também
reativam, em vez de mostrar o erro) — sem travar nos “três pontinhos” e sem
precisar recarregar a página inteira.

### Sempre dentro do navegador — nunca um app separado
A extensão nunca abre aplicativo/janela por conta própria: o painel abre como
**gaveta dentro da própria aba** (padrão) ou painel nativo. Se o content
script ainda não estiver na página, a extensão o injeta na hora; em páginas
restritas do navegador (chrome:// etc.) ela apenas mostra um “!” no ícone.

### Painel dentro da página (funciona em todo navegador, inclusive Brave)
Nem todo navegador tem painel lateral nativo (o **Brave** não expõe essa API,
e por isso o painel “não abria”). O modo padrão agora é **Dentro da página**:
ao clicar no ícone da extensão, uma **gaveta abre dentro da própria aba**,
presa à direita (abre e fecha pelo ícone da extensão; nada é desenhado na
página enquanto o painel está fechado).
Nada de janela/app separado. Nos Ajustes dá para trocar para o painel nativo
ou janela encaixada (esquerda/direita).

### OAuth — para todos os provedores que oferecem
Os Ajustes têm uma linha por provedor mostrando se ele **oferece OAuth**
(login com a sua conta, tier gratuito). Hoje, entre os cinco, **só o Google
(Gemini)** oferece: escolha *Conta (OAuth)*, cole um **Client ID OAuth**
criado no Google Cloud Console (com o URI `https://<id-da-extensão>.chromiumapp.org/`
autorizado) e clique em **Conectar conta**. OpenAI, Anthropic, Kimi e Z.AI
**não expõem OAuth para uso dos modelos** — a interface avisa isso na hora
(“não oferece OAuth — use chave”), e a infraestrutura fica pronta caso algum
deles passe a oferecer no futuro.

### Endpoint próprio no modelo personalizado
Ao adicionar um modelo personalizado dá para informar um **endpoint (base URL)
próprio** — útil para gateways/proxies (OpenRouter, LiteLLM, servidores
compatíveis com OpenAI etc.). Prioridade: endpoint do modelo > override do
provedor > endpoint oficial.

### Posição do painel
Nos Ajustes, *Posição do painel*: **dentro da página** (padrão), **painel
nativo do navegador** (direita), **janela encaixada à direita** ou **à
esquerda**. Nos modos de janela, a extensão abre uma janela própria, alta e
estreita, colada na borda escolhida da tela (e continua lendo a aba da
janela principal).

## ⚠️ Sobre os “endpoints”

Os links `chatgpt.com`, `claude.ai/new`, `gemini.google.com/app`,
`kimi.ai/agent` e `chat.z.ai` são as **interfaces web** dos produtos — elas não
expostas como API pública para outras aplicações chamarem. Por isso, a extensão
conversa com a **API oficial** de cada provedor, que é o equivalente programável
e estável desses sites — e a resposta volta para o próprio painel:

| Provedor | Site que você usa | API usada pela extensão | Onde criar a chave |
|---|---|---|---|
| ChatGPT | chatgpt.com | `https://api.openai.com/v1` | platform.openai.com/api-keys |
| Claude | claude.ai | `https://api.anthropic.com/v1` | console.anthropic.com/settings/keys |
| Gemini | gemini.google.com | `https://generativelanguage.googleapis.com/v1beta` | aistudio.google.com/apikey |
| Kimi | kimi.ai | `https://api.moonshot.ai/v1` | platform.moonshot.ai |
| GLM | chat.z.ai | `https://api.z.ai/api/paas/v4` | z.ai/manage-apikey/api-keys |

Sem chave configurada, a extensão avisa e abre os Ajustes. Se preferir, dá para
apontar cada provedor para outro endpoint (campo de base URL nos Ajustes) —
útil para proxies ou gateways compatíveis.

## ⚠ Se a extensão “parou de abrir” após uma atualização

Quando uma atualização **adiciona permissões** (ex.: `identity`, usada no
OAuth), o Chrome/Brave/Edge **desativa a extensão** até você aprovar as novas
permissões. Vá em `chrome://extensions`: se aparecer “Este item foi desativado”
ou “Revisar permissões”, aceite/reative — ou remova a extensão e carregue a
pasta de novo (Modo do desenvolvedor → Carregar sem compactação).

## Instalação

1. Descompacte este pacote (ou mantenha a pasta `leitor-ia` como está).
2. Abra `chrome://extensions` no Chrome/Edge.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta `leitor-ia`.
5. Clique no ícone da extensão em qualquer página → o painel abre dentro da página.
6. Na engrenagem (Ajustes), cole a chave do provedor que quiser usar.

## Esforço por provedor (5 níveis: Baixo / Médio / Alto / Extra / Máx)

| Provedor | Como o esforço é aplicado |
|---|---|
| ChatGPT | `reasoning_effort` low/medium/high (Extra e Máx viram high) |
| Claude | `output_config.effort` low…max (mesmos níveis do Claude web); modelos legados usam budget do extended thinking |
| Gemini | Série 3: `thinkingLevel` low/medium/high · Série 2.5: `thinkingBudget` |
| Kimi | No K3, Baixo desliga e Médio+ liga o raciocínio (como o “esforço” do Kimi web) |
| GLM (Z.AI) | Baixo desliga e Médio+ liga o modo thinking (equivalente ao Deep Think) |

## Testes

Suíte de **140 testes** em Node (sem browser), cobrindo: manifest/ícones,
configuração dos provedores (incluindo versão web e seletores da ponte),
renderizador de markdown (incluindo XSS), construção dos requests e parsing do
streaming de cada API (com `fetch` e `chrome` mockados), erros, abort, OAuth
genérico, **leitura da página ponta a ponta** (get-context → prompt do modelo),
ponte web opcional (criar/reutilizar aba e entregar o texto), gaveta dentro da
página (toggle, injeção sob demanda e aviso sem abrir janela), boot completo
do painel e abertura ao clicar no ícone, além da integridade do HTML/CSS.

```bash
node tests/run-tests.js   # ou: npm test
```

## Estrutura

```
leitor-ia/
├── manifest.json        # MV3: side panel, scripting, storage
├── config.js            # provedores, modelos, esforço
├── background.js        # lê a página + streaming das APIs + OAuth
├── content.js           # gaveta na página + ponte para as versões web
├── panel.html/css/js    # painel (UI estilo Claude)
├── icons/               # ícones da extensão
├── preview-ui.html      # preview estático do design
└── README.md
```

## Notas

- Funciona apenas em páginas http/https (abas internas do navegador não são legíveis).
- A conversa atual é mantida ao reabrir o painel; o botão “+” inicia outra.
- Cada provedor cobra pelo uso conforme seu plano — a extensão não inclui créditos.
