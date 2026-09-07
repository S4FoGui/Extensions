# 🛡️ Anti-Popup & Anti-Redirect v1.2.2 — Como instalar

> ⚠️ **Se você tinha uma versão anterior instalada: REMOVA ela primeiro.**
> Em `chrome://extensions`, clique em **Remover** na versão antiga e depois
> instale esta pasta nova. (Só clicar em "recarregar" não basta, porque o
> `manifest.json` mudou de estrutura.)

## Chrome / Edge / Brave / Opera (versão 111 ou mais nova)

1. Abra `chrome://extensions` (Edge: `edge://extensions`)
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** ("Load unpacked")
4. Selecione a pasta `anti-popup-megacine`
5. Abra o MegaCine e recarregue com **Ctrl+Shift+R** (limpa o cache da página)

O ícone do escudo aparece na barra. O número vermelho mostra quantos bloqueios
ocorreram na página atual. Clique no ícone para ver o contador.

## Como confirmar que está funcionando

1. Abra um filme no MegaCine e clique no **Play**
2. Não deve abrir nenhuma aba extra nem sair da página do filme
3. Aperte **F12 → Console**: devem aparecer linhas azuis `[AntiPopup] bloqueado: ...`
4. O número no ícone do escudo deve aumentar a cada tentativa de popup

> 💡 Se o site soltar `debugger;` em loop com o DevTools aberto, aperte
> **Ctrl+F8** no painel Sources ("Deactivate breakpoints") para ignorar.

## O que ela bloqueia

| Truque do site | Como é neutralizado |
|---|---|
| Pop-up / pop-under | `window.open` substituído por objeto falso (**no contexto da página**) |
| Redirect ao clicar no Play | Revertido pelo background (clique no Play **não** conta como "sair") |
| Iframe sequestrando a aba | `top` e `parent` apontam para o próprio iframe |
| Overlay invisível em cima do player | Removido automaticamente (MutationObserver) |
| Nova aba de anúncio (mesmo as que abrem "vazias") | Fechada pelo service worker, com rechecagem |
| Scripts de popunder do próprio site | Bloqueados na rede (urnstallols, taylorbrining, unwrynarcein, grewiabromus, waust, decafeligiblyhad + redes grandes) |
| Coerção do provider ("só toca se o popup abrir") | Shim injeta `window.open` falso nos providers: o vídeo libera sem abrir aba |
| "Tem certeza que quer sair?" | Listeners de `beforeunload` ignorados |
| Sequestro de `document.onclick` | Atribuição bloqueada |

## Dicas

- Se o **player parar de funcionar**, abra o console (F12) e veja as mensagens
  `[AntiPopup]` — me mande um print que eu ajusto.
- Combine com **uBlock Origin** para cobertura máxima.
- Se o player não aparecer: desative **outras** extensões de bloqueio primeiro
  (só a nossa ativa) para descobrir quem está bloqueando o vídeo. No console (F12),
  clique no nome do recurso bloqueado para ver a URL completa e me mande.
- Estas redes de anúncio **trocam de domínio toda hora** (os nomes aleatórios
  tipo `urnstallols.com` são rotativos). Se voltar a abrir popup daqui a um
  tempo, me avise que eu adiciono os domínios novos no `rules.json`.

## Uso responsável

A extensão só bloqueia anúncios e redirecionamentos indesejados no seu próprio
navegador. Vale lembrar que sites de streaming não oficiais costumam hospedar
conteúdo sem autorização e são um vetor comum de malware — serviços legais
(Globoplay, Netflix, Prime Video, canais oficiais no YouTube) são mais seguros.
