# Por que a v1.0 não funcionava no MegaCine — e o que a v1.1.0 corrige

Analisei o código da extensão + o HTML real do `megacine.quest` e do player
`viewplayer.online` em 07/09/2026. Eram **3 defeitos**, qualquer um deles
sozinho já furava a proteção:

## 1. O bloqueador era invisível para os scripts da página (causa principal)

Content scripts rodam num **"isolated world"**: um objeto `window` separado do
que os scripts do site enxergam. Todo o `blocker.js` da v1.0 (patch de
`window.open`, `addEventListener`, `form.submit`, `document.onclick`...)
modificava só a cópia isolada — os scripts de anúncio continuavam chamando o
`window.open` **original** e os popups abriam normalmente.

**Correção:** o código foi dividido em dois:
- `blocker-main.js` com `"world": "MAIN"` no manifest — roda **no contexto da
  página**, antes de qualquer script do site (`document_start`), então os
  patches pegam de verdade. (Não tem acesso a `chrome.*`, então reporta via
  `postMessage`.)
- `blocker.js` (isolated) ficou só com o que funciona no isolated: defesa de
  DOM (cliques, overlays, iframes, CSS), relay das mensagens do MAIN e gestos.

Bônus: o `window.open` falso agora replica o `.toString()` nativo, para passar
em checagens `"native code"` que alguns scripts anti-adblock fazem.

## 2. O bloqueador nunca injetava no MegaCine nem no player

O `matches` só listava `*://*.megacine.quest/*` (curinga = **subdomínios**),
mas o site roda no ápice `https://megacine.quest/` e o player no ápice
`https://viewplayer.online/...`. O padrão com `*.` **não casa o domínio ápice**,
então o content script nunca executava nem na página do filme nem dentro do
iframe do player — justo onde o clique no Play dispara o popunder.

**Correção:** adicionados os padrões de ápice explícitos para todos os
domínios (`*://megacine.quest/*`, `*://viewplayer.online/*`, ápices dos
redecanais.* etc.), mantendo os curingas para subdomínios (`www.`, `img.`...).

## 3. Os domínios de popunder do próprio site não estavam bloqueados

O HTML real mostra os scripts de anúncio carregados hoje:

| Página | Scripts de popunder |
|---|---|
| `megacine.quest` (home e filme) | `fr.urnstallols.com`, `rn.taylorbrining.com` (este já estava), `waust.at` |
| `viewplayer.online` (player) | `ft.unwrynarcein.com`, `ge.grewiabromus.com`, `waust.at` |

**Correção:** `rules.json` ganhou as regras 37–40 (`urnstallols.com`,
`unwrynarcein.com`, `grewiabromus.com`, `waust.at`), e os iframes/CSS do
`blocker.js` também passaram a mirar esses domínios.

## 4. Brecha extra fechada: redirect sequestrando o clique no Play

Na v1.0, **qualquer** clique confiável (inclusive no botão Play) era avisado ao
background como "gesto do usuário" — e o background libera navegação externa
quando há gesto recente. Ou seja: você clicava no Play, o site redirecionava a
própria aba para um anúncio, e o background deixava passar.

**Correção:** agora só conta como gesto de saída: clique em `<a href>` real
(não `#`/javascript:), botão do meio (auxclick) e Enter/Espaço. Clique no Play
(div/button) não libera mais redirect externo — o background reverte.

## 5. Abas que abrem "vazias" e resolvem depois

Popups que nascem como `about:blank` e só depois ganham a URL do anúncio
escapavam do fechador de abas. Agora o background reagenda a verificação em
+1,5s e +4s para essas abas.

---

Se voltar a furar no futuro, o mais provável é rotação de domínio das redes de
popunder (os nomes aleatórios mudam com frequência). O procedimento é repetir a
extração dos `<script src="//...">` das páginas e acrescentar no `rules.json`.

---

# Apêndice v1.1.1 (08/09/2026) — "player não aparece"

Sintoma: com a v1.1.0, os popups sumiram mas o player ficou preto.
Auditoria feita no código real do player (`viewplayer.online/static/js/app.js`
+ `jwplayer.js` + embeds `abyssplayer`/`megaembed`/`bysebuho`):

- **DNR inocente**: simuladas as 40 regras contra 24 URLs do ecossistema do
  player (viewplayer, providers, iamcdn, srv224, jwpcdn, playerp1.sbs, CDNs…) —
  nenhuma é bloqueada. As regras nunca cobrem `media`/`xmlhttprequest` de
  vídeo vindo de CDN legítimo.
- **`document.onclick` inocente**: o jwplayer.js não usa `document.onclick`.
- **`beforeunload` inocente**: o JW registra um listener de limpeza que é
  irrelevante (página descarregando mesmo).
- **Culpa provável 1 (removida)**: o spoof de `window.top/parent` mudava o
  comportamento do JWPlayer (ele lê `window.top` 4×: detecção de framing,
  idioma, host). Era redundante — o background já reverte hijack do top via
  webNavigation — então foi REMOVIDO.
- **Culpa provável 2 (blindada)**: o removedor de overlays podia confundir o
  overlay `.jw-display` do JWPlayer (absolute, 100% do player, transparente,
  sem texto) com clickjacking. Novos guardas: nunca remove dentro de
  `#player/.jwplayer/.video-js/.plyr`, nunca remove se o pai contém `<video>`,
  e a regex de player agora cobre `jw-*`/`vjs-*`/`plyr` (mas "video-ad" e
  outras marcações explícitas de anúncio continuam sem proteção).
- **Bônus**: `<a download>` (botão "Baixar Vídeo") liberado no interceptador
  de cliques; regra CSS de z-index máximo agora exclui elementos de player;
  logs mudaram de `console.debug` (oculto por padrão) para `console.log`.

---

# Apêndice v1.2.0 (08/09/2026) — coerção dos providers ("só toca se o popup abrir")

Sintoma: após escolher episódio + provider, o vídeo não tocava.

Causa encontrada no código do `abyssplayer.com`: overlay `#overlay` exige 2
cliques; cada clique abre um popup (`decafeligiblyhad.com`) via `window.open`.
Só depois dos 2 popups "bem-sucedidos" o overlay sai e o `jwplayer().play()`
roda. Se os 2 popups falharem (`window.open` retorna null/lança → `track.window
>= 2`), o player é DESTRUÍDO (`jwplayer().remove()`) e um `document.write`
mostra o muro "Due to certain reasons (AdBlock/Sandbox)...". O `megaembed`
tem muro equivalente ("Please disable AdBlock to watch this video").

Correção — `provider-shim.js` (novo content script MAIN, só nos domínios dos
9 providers conhecidos): `window.open` retorna um falso NÃO-nulo com
`closed=false`, então o provider conclui que o popup abriu e libera o play,
sem criar aba nenhuma. Camufla o `toString` para passar na checagem
anti-extensão do abyss (`isUseExtension`). Minimalista de propósito: não toca
em fetch/timers/DOM/eventos para não quebrar o player do provider. De quebra:
providers entraram no `PROTECTED` do background (abas popup reais vindas deles
são fechadas) e `decafeligiblyhad.com` entrou no DNR (regra 41).

Nota: popups vindos de providers nunca foram bloqueados pela extensão antes
(opener fora do PROTECTED + domínio fora do DNR) — quem os segurava era o
bloqueador do navegador. Com o shim, nem chegam a nascer.

---

# Apêndice v1.2.1 (08/09/2026) — forense do overlay + blindagem play-overlay

Sintoma persistente: "player não aparece após selecionar o episódio", com a
linha `bloqueado: overlay clickjacking` no console sem identificar o elemento.

Mudanças: (1) o log de remoção agora é forense —
`overlay clickjacking <div#id.classe> LARGxALT z=... pos=...` — para identificar
exatamente o que foi removido no próximo relato; (2) `play-overlay` (container
legítimo do player do viewplayer) entrou na lista de proteção do removedor.
Nota: `play-banner` NÃO foi protegido de propósito — contém "banner" e a
marcação explícita de anúncio vence na lógica de proteção.

---

# Apêndice v1.2.2 (08/09/2026) — o removedor apagava o player (flagrado pela forense)

Linha que incriminou:
`bloqueado: overlay clickjacking <div#play.play-banner> 845x500 z=99999 pos=absolute`

Causa raiz: o container do episódio do viewplayer é `.play-banner`
(`position:absolute; 100vw×100vh; z-index:99999`, sem background-color → corpo
transparente). Ao clicar no episódio, o ajax injeta esse container e o nosso
removedor o deletava com `#player` + chooser dentro — "o player não aparece".
Duas falhas combinadas: (1) `play-banner` contém "banner" → a exceção de
anúncio (ADMARK) vencia; (2) `play` ≠ `player` → não casava a proteção.

Correção: proteção ABSOLUTA — `el.closest("#play, #player")` retorna antes de
qualquer análise, para o elemento e descendentes, vencendo até ADMARK.
Overlays de anúncio reais (injetados no nível do body) continuam removidos.
Comportamento travado pelos testes 117–119.
