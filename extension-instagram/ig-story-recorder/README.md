# IG Story Poster (Desktop)

Adiciona um botão flutuante "📸 Criar Story" no Instagram Web com UI própria
(igual o modelo do vidIQ) que publica Stories direto do PC, sem depender do
Instagram achar que você está no celular.

## Como funciona
1. Você escolhe uma foto (JPG) ou vídeo (MP4) no modal próprio da extension.
2. `rupload_igphoto` / `rupload_igvideo` — sobe o arquivo pra API interna do
   Instagram, usando o cookie de sessão que já está logado no navegador.
3. `api/v1/media/configure_to_story/` — transforma o upload em Story.

## ⚠️ Avisos importantes
- **Não é API oficial**: são endpoints internos, não documentados, usados
  pelo próprio app/site do Instagram. Podem mudar sem aviso e quebrar a
  extension a qualquer momento.
- **Risco de conta**: publicar de forma automatizada fora do app oficial
  vai contra os Termos de Uso do Instagram. Existe risco (baixo, mas real)
  de a conta ser sinalizada, limitada ou banida. Use por sua conta e risco,
  de preferência numa conta secundária primeiro.
- **Fotos têm mais chance de funcionar** que vídeos — o fluxo de vídeo do
  Instagram costuma exigir parâmetros extras (upload segmentado, thumbnail,
  etc.) que este script não replica 100%.

## Instalar
1. `chrome://extensions` → Modo desenvolvedor → "Carregar sem compactação"
2. Selecione a pasta `ig-story-recorder`
3. Abra instagram.com já logado

## Novos recursos (v4)
- **Proporção**: "Original" faz upload direto (mais confiável). "Preencher"/
  "Ajustar" reprocessam a mídia num canvas 1080x1920 — mais fiel ao formato
  Story, porém mais pesado e mais sujeito a bug (principalmente em vídeo).
- **Público**: "Melhores amigos" envia `audience=besties` no `configure_to_story`.
  Esse campo **não é oficialmente documentado** — se não filtrar corretamente,
  o log vai mostrar a resposta crua pra gente ajustar.
- **Texto**: desenhado direto no canvas (funciona em foto e vídeo).
- **Música**: só aceita um arquivo de áudio seu — não é possível puxar o
  catálogo licenciado de músicas do Instagram por essa via. Se escolher
  música numa foto, a extension gera um vídeo automaticamente (foto + áudio).
  Em vídeo com música própria, o áudio original é substituído.
- Qualquer ajuste (proporção/texto/música) faz a mídia passar por um
  **reencode local via MediaRecorder (webm)** antes do upload — funciona,
  mas é mais lento e mais frágil que o envio direto do arquivo original.

## Se der erro (400/500)
O modal mostra um log com a resposta crua da API. Abra o DevTools
(F12 → Network) ao publicar, procure a chamada `configure_to_story`, e
compare os campos enviados pelo app oficial (se você tiver acesso a um
Instagram mobile logado, pode inspecionar via proxy) com os que estão em
`content.js`, função `configureToStory`. É comum precisar ajustar/adicionar
campos conforme o Instagram muda a validação.
