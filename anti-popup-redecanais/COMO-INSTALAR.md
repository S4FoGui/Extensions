# 🛡️ Anti-Popup & Anti-Redirect — Como instalar

## Chrome / Edge / Brave / Opera

1. Abra `chrome://extensions` (Edge: `edge://extensions`)
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação** ("Load unpacked")
4. Selecione a pasta `anti-popup-redecanais`
5. Recarregue a página do site (Ctrl+Shift+R)

O ícone do escudo aparece na barra. O número vermelho mostra quantos bloqueios ocorreram na página atual.

## O que ela bloqueia

| Truque do site | Como é neutralizado |
|---|---|
| Pop-up / pop-under | `window.open` substituído por objeto falso |
| Redirect ao clicar | `location.href/assign/replace` só passa se for o mesmo domínio ou se você clicou de verdade |
| Iframe sequestrando a aba | `top` e `parent` apontam para o próprio iframe |
| Overlay invisível em cima do player | Removido automaticamente (MutationObserver) |
| Nova aba de anúncio | Fechada pelo service worker |
| Redes de anúncio (PopAds, PropellerAds, ExoClick, Adsterra, Monetag...) | Bloqueadas na rede via declarativeNetRequest |
| "Tem certeza que quer sair?" | Listeners de `beforeunload` ignorados |

## Dicas

- Se o **player parar de funcionar**, o iframe do vídeo pode ter sido confundido com anúncio. Abra o console (F12) e veja as mensagens `[AntiPopup]`.
- Se o site mudar de domínio (ex: `www18.redecanais.xx`), adicione o novo domínio em `manifest.json` → `content_scripts.matches` e recarregue a extensão.
- Combine com **uBlock Origin** para cobertura máxima.

## Uso responsável

A extensão só bloqueia anúncios e redirecionamentos indesejados no seu próprio navegador. Vale lembrar que sites de streaming não oficiais costumam hospedar conteúdo sem autorização e são um vetor comum de malware — serviços legais (Globoplay, Netflix, Prime Video, canais oficiais no YouTube) são mais seguros.
