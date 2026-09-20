# Diagnóstico — por que o link não ficava clicável no Story

Data: 2026-09-20 · Escopo: `extension-instagram/ig-story-recorder`

---

## 1. Sintoma

Conteúdo publicado pela extensão (foto/vídeo → Story) chega ao app com a URL
no texto, mas **não tocável**. No fluxo nativo do app a mesma URL vira um
sticker que abre o browser in-app.

## 2. Causa raiz

Não é truncamento nem sanitização da string: **a extensão nunca enviou link
nenhum**. O link era tratado como texto desde a UI até o payload.

### 2.1 Código morto no builder do payload

`content.js` (v3) tinha a intenção registrada, mas sem implementação:

```js
if (extra.link) {
  // link sticker do Story (mesmo campo usado por clientes não oficiais, ex.: instagrapi)
  // sticker de link via API é ignorado pelo Instagram; o link vai no texto da legenda
}
```

O bloco é vazio **e** `extra.link` nunca era populado — em todo o fluxo a única
chave atribuída era `extra = { caption: opts.text }`. Ou seja: o `if` era
inalcançável e a URL viajava apenas dentro de `caption`.

### 2.2 Premissa errada: "link na legenda"

A conclusão escrita no comentário ("o link vai no texto da legenda") é a raiz
conceitual do bug. No Instagram, `caption` e link clicável são **duas
dimensões distintas** do payload:

| Dimensão | Campo | Renderização |
|---|---|---|
| Texto da legenda | `caption` | nunca vira hyperlink, em nenhum formato |
| Link clicável | `tap_models` + `story_sticker_ids` | sticker tocável, renderizado pelo Instagram sobre o frame |

Legenda de Story no app nativo é **texto desenhado na imagem**; o sticker é uma
entidade à parte, com geometria própria. Por isso "colar a URL na legenda" não
poderia funcionar por construção.

### 2.3 Faltava a validação prévia da URL

Antes de instanciar o sticker, o app nativo chama
`POST /api/v1/media/validate_reel_url/`. Sem essa chamada, o `configure_to_story`
aceita o payload (HTTP 200) e **descarta o sticker silenciosamente** — nenhum
erro, nenhum log, exatamente o sintoma relatado.

### 2.4 Payload de uma geração antiga da API

O corpo enviado era um esqueleto de ~10 campos, sem nenhum dos metadados que o
cliente atual manda (`_uid`, `_uuid`, `device_id`, `composition_id`,
`camera_session_id`, `supported_capabilities_new`, `media_transformation_info`,
`original_media_type`, `edits`, …). Sem `_uid`/`_uuid`/`device_id` o Instagram
não consegue vincular upload → configure → sticker à mesma sessão de
dispositivo, o que é causa conhecida de sticker aceito e não renderizado.

## 3. O que foi corrigido

| # | Mudança | Onde |
|---|---|---|
| 1 | `tap_models` com um `story_link` + `story_sticker_ids=link_sticker_default` | `story-payload.js` → `buildLinkSticker` / `buildConfigureBody` |
| 2 | `POST media/validate_reel_url/` antes do configure | `content.js` → `validateReelUrl` |
| 3 | Payload atualizado (identidade, capabilities, transformação, edits) | `story-payload.js` → `buildConfigureBody` |
| 4 | Campo "Link clicável" separado da legenda, com autodetecção | `content.js` → UI |
| 5 | URL deixa de ser desenhada em pixels quando há sticker | `story-payload.js` → `textForRender` |
| 6 | 44 testes de regressão (payload + fumaça de UI) | `tests/` |

Estrutura do sticker enviado (derivada do comportamento do cliente nativo):

```json
{
  "x": 0.5, "y": 0.5, "z": 0,
  "width": 0.64, "height": 0.1, "rotation": 0.0,
  "type": "story_link",
  "is_sticker": true,
  "selected_index": 0,
  "tap_state": 0,
  "link_type": "web",
  "url": "https://exemplo.com/oferta",
  "tap_state_str_id": "link_sticker_default"
}
```

Enviado como `tap_models=<json>` **e** `story_sticker_ids=link_sticker_default`.
Mandar só uma das duas chaves faz o Instagram aceitar o post e ignorar o link.

`y` é clamado para `[0.10, 0.80]`: fora dessa faixa o sticker fica sob a barra
de perfil (topo) ou sob a barra de resposta (base) e não recebe toque.

## 4. Feed / Reels — limitação de plataforma, não da extensão

Não existe parâmetro de link clicável ou botão de CTA para post orgânico em
Feed/Reels. Confirmado em três frentes:

- A **Instagram Graph API** (oficial) não expõe link em `ig-user/media` — Story
  stickers e links não são acessíveis a terceiros.
- O `media/configure/` da API privada não tem campo `link_url`/CTA; legenda é
  texto puro em foto, carrossel e Reel.
- Todo o ecossistema de agendamento (Vista Social, Sked, etc.) documenta a
  mesma restrição e oferece workaround manual.

Onde link clicável **existe** hoje: bio (até 5 links), sticker de link em
Stories, product tags (Shopping), DMs, e CTA de anúncios (Ads). Para Reels há
teste restrito a contas Meta Verificadas — não acessível por payload de API.

**Implicação:** o item "3. Para Feed/Reels" do pedido original não tem
implementação possível via payload. As alternativas viáveis (nenhuma é
transparente) seriam: primeiro comentário com a URL + fixar, Story companheiro
com sticker apontando para o post, ou direcionar para o link da bio.

## 5. Como validar de verdade (não automatizável)

A suíte de testes cobre a montagem do payload, mas **a prova final depende de
uma conta real**, porque o Instagram não oferece sandbox para endpoints
internos. Roteiro:

1. Carregue a extensão e publique um Story de **foto** com o campo de link
   preenchido. Foto é o caminho mais confiável (o de vídeo depende de
   transcode).
2. Abra o DevTools (F12 → Network) e confira três chamadas, nesta ordem:
   - `validate_reel_url` → 200
   - `configure_to_story` → 200
   - no corpo enviado: `tap_models` presente e `story_sticker_ids=link_sticker_default`
3. Abra o Story no **celular** e toque no sticker. Deve abrir o browser in-app.

Sinais de que algo ainda falta:

| Sintoma | Leitura provável |
|---|---|
| 200, mas sem sticker | `validate_reel_url` falhou ou `story_sticker_ids` não foi |
| 400 com mensagem sobre a URL | URL bloqueada/flagada pelo Instagram |
| Sticker aparece mas não toca | `y` fora da faixa segura ou `width/height` ≈ 0 |
| 400 genérico | campo novo rejeitado — comparar com captura do app nativo |

## 6. Riscos

- **Endpoints internos.** `validate_reel_url`, `configure_to_story` e
  `rupload_*` não são documentados e podem mudar sem aviso.
- **Termos de uso.** Publicar fora do cliente oficial vai contra os ToS do
  Instagram; risco (baixo, mas real) de sinalização da conta.
- **Identidade persistida.** `_uuid` e `device_id` ficam em `localStorage` para
  serem estáveis entre publicações. Um `device_id` novo por post parece "outro
  aparelho" e aumenta a chance de challenge.
- **Validação best-effort.** Se `validate_reel_url` retornar 404/405 (endpoint
  movido), a publicação segue; só abortamos quando o Instagram reclama
  especificamente da URL.
