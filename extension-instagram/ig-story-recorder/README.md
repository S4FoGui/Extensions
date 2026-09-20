# IG Story Poster (Desktop)

Adiciona um botão flutuante "📸 Criar Story" no Instagram Web com UI própria
(igual o modelo do vidIQ) que publica Stories direto do PC, sem depender do
Instagram achar que você está no celular.

## Como funciona
1. Você escolhe uma foto (JPG) ou vídeo (MP4) no modal próprio da extension.
2. `rupload_igphoto` / `rupload_igvideo` — sobe o arquivo pra API interna do
   Instagram, usando o cookie de sessão que já está logado no navegador.
3. `api/v1/media/validate_reel_url/` — valida a URL antes de criar o sticker.
4. `api/v1/media/configure_to_story/` — transforma o upload em Story,
   carregando o sticker de link quando houver um.

> **Sobre o link:** link clicável em Story é um **sticker**, não texto. A
> extensão manda `tap_models` (geometria + URL) e `story_sticker_ids`, nunca a
> URL dentro da legenda — legenda nunca vira hyperlink, em nenhum formato.
> Detalhes em [`DIAGNOSTICO.md`](DIAGNOSTICO.md).

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

- **Link clicável de verdade (sticker).** Novo campo *Link clicável — sticker*,
  separado da legenda, igual ao app nativo. Se você colar a URL dentro da
  legenda, ela é detectada e promovida a sticker automaticamente — e sai do
  texto desenhado na imagem, porque quem mostra a URL passa a ser o Instagram.
- **Posição do sticker** (topo / centro / base), com clamp automático para a
  faixa que realmente recebe toque (10%–80% da altura — fora disso o sticker
  fica embaixo da barra de perfil ou da barra de resposta).
- **Prévia no player:** um chip mostra onde o sticker vai cair antes de publicar.
- **Payload alinhado com o cliente atual:** `_uid`, `_uuid`, `device_id`,
  `composition_id`, `camera_session_id`, `supported_capabilities_new`,
  `media_transformation_info`, `original_media_type`, `edits`.
- **44 testes de regressão** cobrindo a montagem do payload e a UI
  (`npm test` na pasta da extensão).

### Limitação: link clicável só existe em Story

Feed e Reels **não** têm parâmetro de link clicável nem botão de CTA para post
orgânico — nem na API oficial, nem na privada. É restrição da plataforma, não da
extensão (veja a seção final do [`DIAGNOSTICO.md`](DIAGNOSTICO.md)).
Alternativas: primeiro comentário com a URL + fixar, Story companheiro com o
sticker, ou link na bio.

## Recursos (v3)
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
(F12 → Network) ao publicar, procure as chamadas `validate_reel_url` e
`configure_to_story`, e compare os campos enviados pelo app oficial (se você
tiver acesso a um Instagram mobile logado, pode inspecionar via proxy) com os
que estão em `story-payload.js`, função `buildConfigureBody`. É comum precisar
ajustar/adicionar campos conforme o Instagram muda a validação.

O log também imprime uma linha de diagnóstico logo no início:

```
[payload] story_sticker_ids="link_sticker_default" tap_models=sim
```

Se aparecer `story_sticker_ids=""` ou `tap_models=não`, o link não vai.

## Testes

Suíte em Node puro (sem dependências obrigatórias) cobrindo normalização de
URL, detecção/extração de link na legenda, montagem do `tap_model`, o corpo do
`configure_to_story` (foto/vídeo, com e sem sticker) e a UI num DOM de mentira.

```bash
npm test     # ou: node --test tests/*.test.js
```

Os testes de UI usam `jsdom`; se ele não estiver disponível, eles são pulados e
a suíte de payload roda normalmente. A validação final precisa de uma conta
real — veja o roteiro no [`DIAGNOSTICO.md`](DIAGNOSTICO.md).

## Estrutura

```
ig-story-recorder/
├── manifest.json        # MV3; story-payload.js entra ANTES de content.js
├── story-payload.js     # montagem do payload (puro, testável)  ← o fix vive aqui
├── content.js           # UI + upload + orquestração
├── mp4-muxer.js         # muxer usado no pipeline de vídeo
├── DIAGNOSTICO.md       # causa raiz do bug do link
├── tests/               # 44 testes de regressão
└── README.md
```
