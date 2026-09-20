// ===== Testes de regressão do payload de Story =====
//
// Roda sem browser e sem rede:
//   node --test tests/
//
// O objetivo é travar o comportamento que causava o bug do link: por muito
// tempo o `configure_to_story` saía SEM `tap_models` e SEM `story_sticker_ids`,
// então o Instagram aceitava o post (200) e descartava o link.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const P = require("../story-payload.js");

const NOW = new Date("2026-09-20T12:30:45Z");
const BASE = {
  uploadId: "17850000000000000",
  meta: { width: 1080, height: 1920 },
  caption: "Confira o drop de hoje",
  now: NOW,
  timezoneOffsetSeconds: -10800,
  deviceId: "android-0123456789abcdef",
  uid: "123456789",
  uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  sessionId: "11111111-2222-4333-8444-555555555555",
  cameraEntryPoint: 42
};

const body = (over = {}) => P.buildConfigureBody({ ...BASE, ...over });

// ---------------------------------------------------------------- normalizeUrl

test("normalizeUrl: adiciona https em host pelado", () => {
  assert.equal(P.normalizeUrl("meusite.com"), "https://meusite.com/");
  assert.equal(P.normalizeUrl("www.meusite.com/loja"), "https://www.meusite.com/loja");
});

test("normalizeUrl: preserva http e https explícitos", () => {
  assert.equal(P.normalizeUrl("http://a.com/x"), "http://a.com/x");
  assert.equal(P.normalizeUrl("https://a.com/x"), "https://a.com/x");
});

test("normalizeUrl: remove pontuação de fim de frase", () => {
  assert.equal(P.normalizeUrl("https://a.com/loja."), "https://a.com/loja");
  assert.equal(P.normalizeUrl("https://a.com/loja!"), "https://a.com/loja");
  assert.equal(P.normalizeUrl('"https://a.com/loja"'), "https://a.com/loja");
});

test("normalizeUrl: rejeita frase colada no campo (tem espaço)", () => {
  assert.equal(P.normalizeUrl("veja em https://a.com/loja"), null);
  assert.equal(P.normalizeUrl("link na bio https://a.com"), null);
});

test("normalizeUrl: preserva query string e fragmento", () => {
  assert.equal(
    P.normalizeUrl("https://a.com/p?utm_source=ig&id=7#topo"),
    "https://a.com/p?utm_source=ig&id=7#topo"
  );
});

test("normalizeUrl: rejeita o que não é URL pública", () => {
  assert.equal(P.normalizeUrl(""), null);
  assert.equal(P.normalizeUrl("   "), null);
  assert.equal(P.normalizeUrl("ftp://a.com"), null);
  assert.equal(P.normalizeUrl("javascript:alert(1)"), null);
  assert.equal(P.normalizeUrl("localhost"), null);
  assert.equal(P.normalizeUrl("minhamaquina"), null);
  assert.equal(P.normalizeUrl(null), null);
  assert.equal(P.normalizeUrl(42), null);
});

// -------------------------------------------------------------------- findUrl

test("findUrl: localiza URL com scheme dentro do texto", () => {
  const f = P.findUrl("link na bio: https://loja.com/drop dia 20");
  assert.ok(f);
  assert.equal(f.url, "https://loja.com/drop");
  assert.equal(f.raw, "https://loja.com/drop");
  assert.equal("link na bio: https://loja.com/drop dia 20".slice(f.index, f.index + f.raw.length), f.raw);
});

test("findUrl: localiza host pelado", () => {
  const f = P.findUrl("acesse loja.com.br/hoje agora");
  assert.ok(f);
  assert.equal(f.url, "https://loja.com.br/hoje");
});

test("findUrl: retorna null quando não há URL", () => {
  assert.equal(P.findUrl("só texto, sem link nenhum"), null);
  assert.equal(P.findUrl(""), null);
});

// ----------------------------------------------------------------- stripUrlAt

test("stripUrlAt: remove a URL mantendo o resto da legenda", () => {
  const text = "Confira o drop\nlink: https://loja.com/drop\ncorre!";
  const found = P.findUrl(text);
  assert.equal(P.stripUrlAt(text, found), "Confira o drop\nlink:\ncorre!");
});

test("stripUrlAt: não duplica espaços ao remover", () => {
  const text = "antes   https://loja.com/x   depois";
  const out = P.stripUrlAt(text, P.findUrl(text));
  assert.equal(out, "antes depois");
});

test("stripUrlAt: legenda que era só a URL vira string vazia", () => {
  const text = "https://loja.com/drop";
  assert.equal(P.stripUrlAt(text, P.findUrl(text)), "");
});

test("stripUrlAt: sem URL encontrada devolve o texto intacto", () => {
  assert.equal(P.stripUrlAt("texto puro", null), "texto puro");
});

// --------------------------------------------------------------- textForRender

test("textForRender: sem sticker, o texto vai inteiro para os pixels", () => {
  const t = "Drop novo → https://loja.com/drop";
  assert.equal(P.textForRender(t, null), t);
  assert.equal(P.textForRender(t, {}), t);
});

test("textForRender: com sticker, a URL continua no texto (é o que se vê)", () => {
  const t = "Drop novo → https://loja.com/drop";
  assert.equal(P.textForRender(t, { url: "https://loja.com/drop" }), t);
});

test("textForRender: URL ausente do texto é acrescentada em linha própria", () => {
  assert.equal(
    P.textForRender("Drop novo", { url: "https://loja.com/drop" }),
    "Drop novo\nhttps://loja.com/drop"
  );
});

test("textForRender: sem legenda, o texto vira só a URL", () => {
  assert.equal(P.textForRender("", { url: "https://loja.com/x" }), "https://loja.com/x");
  assert.equal(P.textForRender("   ", { url: "https://loja.com/x" }), "https://loja.com/x");
});

test("textForRender: reconhece a mesma URL escrita sem o https://", () => {
  // a pessoa digitou "loja.com/drop" na legenda; o sticker guarda a forma
  // normalizada. Não deve duplicar.
  assert.equal(P.textForRender("acesse loja.com/drop", { url: "https://loja.com/drop" }), "acesse loja.com/drop");
});

test("textForRender: URL diferente da do sticker é preservada e a dele entra", () => {
  assert.equal(
    P.textForRender("veja https://loja.com/a", { url: "https://outra.com/b" }),
    "veja https://loja.com/a\nhttps://outra.com/b"
  );
});

test("textForRender: não duplica quando a URL já está em qualquer linha", () => {
  const t = "linha 1\nhttps://loja.com/drop\nlinha 3";
  assert.equal(P.textForRender(t, { url: "https://loja.com/drop" }), t);
});

test("lineHasUrl: compara direto e pela forma normalizada", () => {
  assert.equal(P.lineHasUrl("https://loja.com/x", "https://loja.com/x"), true);
  assert.equal(P.lineHasUrl("veja loja.com/x agora", "https://loja.com/x"), true);
  assert.equal(P.lineHasUrl("sem link aqui", "https://loja.com/x"), false);
  assert.equal(P.lineHasUrl("https://outra.com/y", "https://loja.com/x"), false);
  assert.equal(P.lineHasUrl("", "https://loja.com/x"), false);
});

// ------------------------------------------------------------ clampStickerY

test("clampStickerY: mantém o sticker na faixa tocável", () => {
  assert.equal(P.clampStickerY(0.5), 0.5);
  assert.equal(P.clampStickerY(0.02), P.STICKER_SAFE_TOP);
  assert.equal(P.clampStickerY(0.99), P.STICKER_SAFE_BOTTOM);
  assert.equal(P.clampStickerY("basura"), P.STICKER_SAFE_TOP);
});

// ----------------------------------------------------------- buildLinkSticker

test("buildLinkSticker: defaults e formato do tap_model", () => {
  const s = P.buildLinkSticker({ url: "https://loja.com" });
  assert.equal(s.type, "story_link");
  assert.equal(s.is_sticker, true);
  assert.equal(s.tap_state, 0);
  assert.equal(s.selected_index, 0);
  assert.equal(s.link_type, "web");
  assert.equal(s.url, "https://loja.com");
  assert.equal(s.tap_state_str_id, "link_sticker_default");
  assert.equal(s.x, 0.5);
  assert.equal(s.y, 0.5);
  assert.equal(s.width, P.LINK_STICKER_DEFAULTS.width);
  assert.equal(s.height, P.LINK_STICKER_DEFAULTS.height);
  assert.equal(s.rotation, 0);
});

test("buildLinkSticker: clampa y para a faixa segura", () => {
  assert.equal(P.buildLinkSticker({ url: "https://a.com", y: 0.95 }).y, P.STICKER_SAFE_BOTTOM);
  assert.equal(P.buildLinkSticker({ url: "https://a.com", y: 0.01 }).y, P.STICKER_SAFE_TOP);
});

// --------------------------------------------------------- buildConfigureBody
// O coração da regressão.

test("REGRESSÃO: sem link não vai tap_models e story_sticker_ids fica vazio", () => {
  const b = body();
  assert.equal(b.get("tap_models"), null);
  assert.equal(b.get("story_sticker_ids"), "");
});

test("REGRESSÃO: com link vai tap_models E story_sticker_ids", () => {
  const b = body({ link: { url: "https://loja.com/drop", x: 0.5, y: 0.6 } });

  assert.equal(b.get("story_sticker_ids"), "link_sticker_default");

  const models = JSON.parse(b.get("tap_models"));
  assert.equal(models.length, 1);
  assert.equal(models[0].type, "story_link");
  assert.equal(models[0].url, "https://loja.com/drop");
  assert.equal(models[0].y, 0.6);
});

test("REGRESSÃO: caption e link são dimensões independentes", () => {
  // A URL continua no caption (metadado/arquivo), mas o link clicável é o sticker.
  const b = body({
    caption: "Drop novo → https://loja.com/drop",
    link: { url: "https://loja.com/drop" }
  });
  assert.equal(b.get("caption"), "Drop novo → https://loja.com/drop");
  assert.equal(JSON.parse(b.get("tap_models"))[0].url, "https://loja.com/drop");
});

test("REGRESSÃO: Instagram aceita só 1 sticker de link por frame", () => {
  const b = body({ link: { url: "https://a.com" } });
  assert.equal(JSON.parse(b.get("tap_models")).length, P.MAX_LINK_STICKERS);
});

test("REGRESSÃO: link vazio/nulo não cria sticker", () => {
  assert.equal(body({ link: null }).get("tap_models"), null);
  assert.equal(body({ link: {} }).get("tap_models"), null);
  assert.equal(body({ link: { url: "" } }).get("tap_models"), null);
});

test("configure: preserva os campos que já funcionavam", () => {
  const b = body();
  assert.equal(b.get("upload_id"), BASE.uploadId);
  assert.equal(b.get("source_type"), "4");
  assert.equal(b.get("configure_mode"), "1");
  assert.equal(b.get("caption"), "Confira o drop de hoje");
  assert.equal(b.get("story_media_creation_date"), String(Math.floor(NOW.getTime() / 1000)));
  assert.equal(b.get("client_timestamp"), String(Math.floor(NOW.getTime() / 1000)));
});

test("configure: carrega identidade de dispositivo/sessão", () => {
  const b = body();
  assert.equal(b.get("_uid"), "123456789");
  assert.equal(b.get("_uuid"), BASE.uuid);
  assert.equal(b.get("device_id"), "android-0123456789abcdef");
  assert.equal(b.get("camera_session_id"), BASE.sessionId);
  assert.equal(b.get("composition_id"), BASE.sessionId);
  assert.equal(b.get("camera_entry_point"), "42");
});

test("configure: supported_capabilities_new é JSON válido", () => {
  const caps = JSON.parse(body().get("supported_capabilities_new"));
  assert.ok(Array.isArray(caps));
  assert.ok(caps.some((c) => c.name === "SUPPORTED_SDK_VERSIONS"));
});

test("configure: foto usa original_media_type=photo", () => {
  assert.equal(body({ isVideo: false }).get("original_media_type"), "photo");
});

test("configure: vídeo usa original_media_type=video e mantém os campos de duração", () => {
  const b = body({ isVideo: true, meta: { width: 1080, height: 1920, duration: 12.345 } });
  assert.equal(b.get("original_media_type"), "video");
  assert.equal(b.get("length"), "12.35");
  assert.equal(b.get("poster_frame_index"), "0");
  assert.equal(b.get("width"), "1080");
  assert.equal(b.get("height"), "1920");
  // formato EXIF, em hora LOCAL — comparado contra o mesmo Date para não
  // depender do fuso da máquina que roda o teste
  assert.equal(b.get("date_time_original"), P.dateTimeOriginal(NOW));
  assert.deepEqual(JSON.parse(b.get("clips")), [{ length: 12.35, source_type: "4" }]);
});

test("configure: vídeo com sticker de link combina os dois blocos", () => {
  const b = body({
    isVideo: true,
    meta: { width: 1080, height: 1920, duration: 9 },
    link: { url: "https://loja.com" }
  });
  assert.equal(b.get("length"), "9");
  assert.equal(b.get("story_sticker_ids"), "link_sticker_default");
  assert.equal(JSON.parse(b.get("tap_models"))[0].url, "https://loja.com");
});

test("configure: audience=besties continua sendo enviado", () => {
  assert.equal(body({ audience: "besties" }).get("audience"), "besties");
  assert.equal(body({ audience: "all" }).get("audience"), null);
});

test("configure: é determinístico dado o mesmo `now`", () => {
  assert.equal(body().toString(), body().toString());
});

test("configure: geometria da mídia vai em edits/extra/transformation", () => {
  const b = body({ meta: { width: 720, height: 1280 } });
  assert.deepEqual(JSON.parse(b.get("extra")), { source_width: 720, source_height: 1280 });
  assert.equal(JSON.parse(b.get("media_transformation_info")).width, "720");
  assert.deepEqual(JSON.parse(b.get("edits")).crop_original_size, [720, 1280]);
});

// -------------------------------------------------- buildValidateReelUrlBody

test("validate_reel_url: corpo leva url + identidade", () => {
  const b = P.buildValidateReelUrlBody({
    url: "https://loja.com/drop",
    uid: "123456789",
    uuid: "uuid-1234"
  });
  assert.equal(b.get("url"), "https://loja.com/drop");
  assert.equal(b.get("_uid"), "123456789");
  assert.equal(b.get("_uuid"), "uuid-1234");
});

// ------------------------------------------------------------------- utilitários

test("uuidv4 tem o formato esperado", () => {
  assert.match(P.uuidv4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("makeDeviceId é estável no formato android-<hex>", () => {
  assert.match(P.makeDeviceId(), /^android-[0-9a-f]{16}$/);
});
