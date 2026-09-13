# Leitor IA — Arquitetura técnica (visão atual)

Extensão **Manifest V3** para Chromium (Chrome/Edge/Brave) que lê a página ativa
e conversa sobre ela com 5 provedores (OpenAI, Anthropic, Gemini, Kimi/Moonshot,
Z.AI/GLM), com três modos de acesso e resposta **sempre dentro do painel**.

## 1. Topologia dos componentes

| Arquivo | Contexto | Papel |
|---|---|---|
| `manifest.json` | — | MV3; permissões `sidePanel`, `activeTab`, `scripting`, `storage`, `contextMenus`, `identity`; `host_permissions: <all_urls>`; content script em `<all_urls>` (`document_idle`); `web_accessible_resources` (panel.*, config.js, icons) |
| `background.js` | Service worker | Roteador de mensagens, leitura da página, streaming das APIs, OAuth, orquestração da aba oculta, janelas encaixadas |
| `content.js` | Content script (isolated world) | Gaveta in-page (iframe `panel.html`), extração do DOM (`leitor-ia-getpage`), automação da web grátis (`leitor-ia-ask` + watcher) |
| `panel.html/css/js` | Página da extensão (iframe/side panel) | UI (tema P&B estilo Claude), chat com streaming, ajustes |
| `config.js` | Compartilhado (SW + painel) | `PROVIDERS` (modelos 2026, endpoints, `webUrl`, seletores), `EFFORTS` (5 níveis) |
| `tests/run-tests.js` | Node (`vm.runInNewContext`) | 136 testes com `chrome`/DOM/fetch stubados; exit 0/1/2 |

## 2. Abertura do painel (sempre in-browser, sem app separado)

`chrome.action.onClicked` → `prefs.panelMode`:

- `inpage` (padrão): `tabs.sendMessage({type:"leitor-ia-toggle"})` ao tab ativo;
  se o content script não estiver injetado, `chrome.scripting.executeScript`
  (`files:["content.js"]`) e retry. O content cria uma **gaveta fixed** à
  direita (`translateX`) com `<iframe src=chrome.runtime.getURL("panel.html")>`;
  nada é desenhado na página enquanto fechada.
- `sidepanel`: `chrome.sidePanel.open()`; se a API não existir (Brave), cai em `inpage`.
- `right|left`: janela popup encaixada via `computeDockRect()` — **somente** se
  o usuário escolher explicitamente.
- Falha total (aba `chrome://` etc.): `warnBadge()` ("!" no ícone). Nunca abre
  janela por conta própria.

## 3. Leitura da página (contexto)

Painel → `runtime.sendMessage({type:"get-context"})` → `getPageContext()`:

1. `windows.getLastFocused({windowTypes:["normal"]})` + `tabs.query(active)`;
2. **Camada 1**: `tabs.sendMessage({type:"leitor-ia-getpage"})` — o content
   script (mesmo origin da página) roda `extractLocalPage()`; funciona até sem
   permissão de scripting (caso Brave restrinja);
3. **Camada 2**: `scripting.executeScript({func: extractPage})`;
4. **Camada 3**: injeta `content.js` e repete a camada 1.

`extractPage/extractLocalPage`: clona `document.body`, remove
`script,style,nav,footer,form,…`, normaliza `innerText` (nbsp, `\n{3,}`),
cap 80k chars; `window.getSelection()` (4k) e `meta[name=description]`.

No painel: chip `#page-chip` mostra o título lido (toggle de inclusão, reler);
`buildSystemPrompt()` monta system + título/URL/descrição/seleção/texto com
`prefs.charLimit` (default 20k) e entra como `system` (ou
`systemInstruction`/`body.system` conforme a API).

## 4. Modos de acesso (`prefs.oauthMode[provider]`)

### 4.1 `web` (padrão) — free tier sem chave, sem redirecionar
Automação DOM da interface oficial numa **aba oculta** (`active:false`),
reutilizada por provedor:

1. Painel monta payload (pergunta + contexto da página) → `web-ask`;
2. `webAsk()`: `tabs.query` por origin → cria aba oculta se preciso → loop de
   `leitor-ia-ask` (12×500ms);
3. Content no host do provedor (`WEB_BRIDGES[host]`): sem composer ⇒
   `{needLogin:true}` ⇒ background ativa a aba **uma vez** para login Google
   interativo; com composer ⇒ `fillAndSend()`: `focus()` +
   `execCommand("insertText")` (dispara os eventos que React/ProseMirror
   esperam; fallback `textContent`+`input`) → 600ms → clique no send-button ou
   `KeyboardEvent Enter` sintetizado;
4. `watchAnswer(host, qSnippet)`: polling 700ms;
   `answerText()` = `ANSWER_SELECTORS[host]` + `GENERIC_ANSWERS` (último match,
   descartado se contiver `qSnippet` = bolha do usuário) → fallback universal:
   `body.innerText.slice(lastIndexOf(qSnippet))` + `cleanTail()` (dropa linhas
   de UI: copy/retry/👍…);
5. Transporte: `leitor-ia-web-delta` (painel faz `streamInto` = streaming) e
   `leitor-ia-web-done` (fim/erro). Conclusão: texto estável ≥3 ticks e sem
   `STOP_SELECTORS`; caps: ~2min total, ~45s sem nada ⇒ done com erro explícito.

### 4.2 `key` — APIs oficiais com SSE no painel
`chrome.runtime.connect({name:"chat"})` → `runChat` → por provedor:

- **OpenAI-compat** (OpenAI, Kimi `api.moonshot.ai/v1`, Z.AI `api.z.ai/api/paas/v4`):
  `POST /chat/completions` `stream:true`, `Authorization: Bearer`;
- **Anthropic**: `POST /v1/messages`, headers `x-api-key`,
  `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access`;
  SSE `content_block_delta/text_delta`;
- **Gemini**: `v1beta/models/{m}:streamGenerateContent?alt=sse`,
  `x-goog-api-key` ou `Bearer` (OAuth).

**Esforço (5 níveis)** mapeado por API: OpenAI `reasoning_effort`
(xhigh/max→high); Claude `output_config.effort` (legado: `thinking.budget_tokens`
1024…32000); Gemini 3.x `thinkingLevel` (xhigh,max→high) / 2.5 `thinkingBudget`;
Kimi/Z.AI `thinking` enabled/disabled (Baixo=off).

**Endpoints custom**: modelos personalizados com `baseUrl`; precedência
`model.baseUrl > baseUrls[provider] > provider.baseUrl` (`resolveBaseUrl`).

### 4.3 `oauth` (somente Gemini) — login Google, tier gratuito
`chrome.identity.launchWebAuthFlow` (fluxo implícito, `response_type=token`,
`redirect_uri https://<ext-id>.chromiumapp.org/`, scope
`…/auth/generative-language`); `parseOAuthRedirect()` salva
`oauth.tokens[provider]` em `chrome.storage.local`; `runGemini` usa Bearer.
Infra genérica (`provider.oauth`, `buildOAuthUrl`, `oauthProvider()`) pronta
para futuros provedores.

## 5. Resiliência de lifecycle

- `extAlive()` = `!!chrome.runtime.id` (detecção de *Extension context
  invalidated*);
- Watchdog 10s + handlers de `+`, “Ler página”, envio e `capturePage()`:
  contexto morto ⇒ `reativar()` = `location.reload()` **só do iframe**
  (guarda anti-loop 30s via `sessionStorage`) ou banner “Reativar painel”;
- `connect`/`postMessage` sempre em try/catch (nunca trava em spinner);
- Menu de contexto (seleção) → `pendingSelection` em `chrome.storage.session` →
  pré-preenche o input.

## 6. Ajustes (UI)

Cartão por provedor: seletor **Acesso** (web/key/oauth) com campos
condicionais (`data-fields`): senha+olho e endpoint próprio no modo key;
Client ID + conectar no oauth. Salvamento *on-input* (`persist()`). Seções:
Provedores / Painel (posição) / Contexto (charLimit) / Modelo personalizado.

## 7. Testes

`node tests/run-tests.js` — 136 testes: config/modelos, markdown+XSS,
builders de request por API, parsing SSE com `fetch` stubado, `get-context`
(3 camadas), `web-ask` (aba oculta, needLogin), gaveta/toggle/injeção,
contexto invalidado (autorecuperação), boot completo do painel com DOM stub,
dock/sidepanel/fallbacks, integridade HTML/CSS. Harness: `vm.runInNewContext`
+ exports `__T`/`__B`/`__C`.


## 9. Refactor desta revisão (resiliência + multimodal)

- **manifest**: `tabs` adicionada; `content_scripts` agora injeta `config.js`
  junto (seletores DOM centralizados em `PROVIDERS[].web` acessíveis no
  content script).
- **Aba oculta autônoma**: `webAsk()` cria/reutiliza a aba e aplica
  `chrome.tabs.update(tabId, {autoDiscardable:false})` — nunca descartada;
  deltas via **MutationObserver** (imune a timer throttling) + interval 1s só
  p/ conclusão/timeout.
- **Barreira de login/Cloudflare**: content detecta (URL de login/challenge +
  seletores `web.login`) e responde `needLogin{reason}`; o painel mostra
  banner com botão **“Fazer login no provedor”** (`web-login` ativa a aba —
  nada é ativado sozinho).
- **Transporte idempotente**: `reqId` por requisição em delta/done; painel
  ignora reqIds antigos; **keep-alive**: porta `chrome.runtime.connect`
  (`name:"keepalive"`) aberta durante o stream impede suspensão do SW;
  **resume**: `sessionStorage("leitor-ia-webreq")` + `web-resume` →
  `leitor-ia-snapshot` no content retoma o stream após reload do painel.
- **Leitura da aba**: `tabs.query({active:true, lastFocusedWindow:true})`
  (spec) com fallback por janela normal; 3 camadas mantidas.
- **Visão multimodal**: toggle `#btn-vision` (`prefs.includeVision`);
  `captureActiveTabScreenshot()` = `chrome.tabs.captureVisibleTab(null,
  {format:"jpeg",quality:70})`; injeção por schema exato quando
  `meta.vision`: OpenAI `image_url.data-url` · Anthropic
  `image.source.base64` · Gemini `inlineData`. Flags `vision` por modelo no
  config.
- **Digitação web**: `focus → execCommand selectAll/insertText → InputEvent
  (inputType insertText)` — compatível com ProseMirror/Lexical/React.

## 8. Limitações conhecidas

- Modo `web` é automação DOM não oficial: depende do layout de cada site
  (seletores centralizados em `content.js`); captcha/anti-bot podem barrar;
- APIs dos 4 provedores não-Google são pagas; free tier in-panel só via web
  (todos) ou OAuth/chave grátis do Gemini;
- Brave não expõe `chrome.sidePanel` ⇒ `inpage` é o padrão.
