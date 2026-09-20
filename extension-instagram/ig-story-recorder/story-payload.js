// ===== IG Story Poster — montagem do payload de publicação =====
//
// Este arquivo é deliberadamente PURO (sem DOM, sem fetch, sem estado global):
// recebe dados, devolve o corpo da requisição. Isso existe porque o bug do link
// clicável morava justamente na montagem do payload, e a única forma de
// regressionar isso sem publicar de verdade é testar a função fora do browser.
//
// Carrega nos dois mundos:
//   - content script (clássico, sem modules) -> expõe window.IGStoryPayload
//   - Node (>=18)                            -> module.exports
//
// AVISO: endpoints internos/não documentados do Instagram. Ver README.

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IGStoryPayload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Enviado como `supported_capabilities_new`. Lista de capacidades que o app
  // anuncia ao criar a mídia; o Instagram usa isso para decidir quais stickers
  // o "cliente" consegue renderizar. Payloads sem isso (ou desatualizados) são
  // uma das causas de sticker aceito no 200 mas não renderizado.
  const SUPPORTED_CAPABILITIES = [
    {
      name: "SUPPORTED_SDK_VERSIONS",
      value:
        "119.0,120.0,121.0,122.0,123.0,124.0,125.0,126.0,127.0,128.0," +
        "129.0,130.0,131.0,132.0,133.0,134.0,135.0,136.0,137.0,138.0," +
        "139.0,140.0,141.0,142.0"
    },
    { name: "FACE_TRACKER_VERSION", value: "14" },
    { name: "COMPRESSION", value: "ETC2_COMPRESSION" },
    { name: "gyroscope", value: "gyroscope_enabled" }
  ];

  // Geometria padrão do sticker de link, em fração do frame (0..1).
  // O sticker é alinhado sobre a linha onde a URL foi desenhada, então a
  // altura acompanha a altura de uma linha de legenda (66px num canvas de
  // 1920 = ~0.034) com folga para virar um alvo de toque confortável.
  const LINK_STICKER_DEFAULTS = {
    x: 0.5,
    y: 0.5,
    z: 0,
    width: 0.7,
    height: 0.07,
    rotation: 0.0
  };

  // Faixa vertical "segura": acima de 0.10 fica a barra de perfil/close, abaixo
  // de 0.80 ficam a barra de resposta e o nome de usuário. Sticker fora disso
  // é criado, mas fica coberto pela UI do Instagram e não recebe toque.
  const STICKER_SAFE_TOP = 0.1;
  const STICKER_SAFE_BOTTOM = 0.8;

  // O Instagram aceita exatamente UM sticker de link por frame.
  const MAX_LINK_STICKERS = 1;

  const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//;
  const SCHEMED_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  // Host "pelado" (meusite.com/xy) — mesmo conjunto de TLDs que o drawText
  // já usava para pintar a URL de outra cor, para texto e sticker concordarem.
  const BARE_HOST_RE =
    /\b[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)*\.(?:com|net|org|io|me|co|app|dev|link|bio|br|gg|shop|site|online|store|blog)(?:\/[^\s<>"'`]*)?/gi;

  function clamp(n, min, max) {
    const v = Number(n);
    if (!isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
  }

  // O Instagram é sensível a float com many decimals nesses campos; o app
  // nativo sempre manda ~7 casas.
  function round7(n) {
    return Math.round(Number(n) * 1e7) / 1e7;
  }

  /**
   * Normaliza o que o usuário digitou numa URL utilizável, ou null se não der.
   * - "meusite.com"            -> "https://meusite.com/"
   * - "https://x.com/a?b=1."   -> "https://x.com/a?b=1"  (ponto final é pontuação)
   * - "ftp://x.com"            -> null (sticker só abre http/https no browser in-app)
   */
  function normalizeUrl(raw) {
    if (typeof raw !== "string") return null;
    let s = raw.trim();
    if (!s) return null;
    // URL não tem espaço interno; se tiver, é frase colada no campo, não link.
    if (/\s/.test(s)) return null;

    // Pontuação/aspas coladas no link ao copiar de uma frase.
    // fim: 'veja em x.com/loja.'   início: '"https://x.com/loja"'
    s = s.replace(/^[("'[{<]+/, "").replace(/[)\]}.,;:!?'"]+$/g, "");
    if (!s) return null;

    if (!SCHEME_RE.test(s)) s = "https://" + s.replace(/^\/+/, "");

    let parsed;
    try {
      parsed = new URL(s);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // Host precisa ter um ponto: "localhost" e "minhamaquina" não são URLs públicas.
    if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) return null;

    return parsed.toString();
  }

  /**
   * Procura a primeira URL em um texto livre.
   * @returns {{url: string, raw: string, index: number}|null}
   *   `url`  = URL normalizada (o que vai no payload)
   *   `raw`  = o pedaço exato do texto (necessário para remover depois)
   *   `index`= posição de `raw` no texto original
   */
  function findUrl(text) {
    if (typeof text !== "string" || !text) return null;
    const patterns = [SCHEMED_URL_RE, BARE_HOST_RE];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const url = normalizeUrl(m[0]);
        if (url) return { url, raw: m[0], index: m.index };
      }
    }
    return null;
  }

  /** Atalho: só a URL normalizada, ou null. */
  function extractUrl(text) {
    const found = findUrl(text);
    return found ? found.url : null;
  }

  /**
   * Remove a URL do texto que será desenhado em pixels.
   * Com o sticker ativo o Instagram já renderiza o link — deixar a URL também
   * queimada no canvas duplica a informação e vira um texto ilegível.
   */
  function stripUrlAt(text, found) {
    if (typeof text !== "string") return "";
    if (!found) return text;

    const out = text.slice(0, found.index) + text.slice(found.index + found.raw.length);

    return (
      out
        .split(/\r?\n/)
        // colapsa os espaços que sobraram no buraco da URL
        .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
        .join("\n")
        // mais de uma linha em branco seguida é quase sempre artefato da remoção
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  /**
   * Texto que vai ser desenhado em pixels quando há sticker de link ativo.
   *
   * O link TEM que aparecer no texto: é o que a pessoa vê no Story. O sticker
   * é alinhado sobre essa linha, então o que ela vê é exatamente o que ela
   * toca — e o toque abre a URL.
   *
   * Se a URL já estiver no texto, devolve o texto como está. Se não estiver,
   * acrescenta numa linha própria no fim.
   */
  function textForRender(text, link) {
    const val = (typeof text === "string" ? text : "").trim();
    if (!link || !link.url) return val;
    const lines = val.split(/\r?\n/);
    // já está no texto — escrita igual (comparação direta) ou de outro jeito
    // (ex.: "loja.com/x" sem o https://, que normaliza para a mesma URL)
    if (lines.some((line) => lineHasUrl(line, link.url))) return val;
    return val ? val + "\n" + link.url : link.url;
  }

  /**
   * A linha contém essa URL? Compara direto e também pela forma normalizada,
   * para reconhecer "loja.com/x" quando o sticker guarda "https://loja.com/x".
   */
  function lineHasUrl(line, url) {
    if (typeof line !== "string" || !url) return false;
    if (line.includes(url)) return true;
    const found = findUrl(line);
    return !!(found && found.url === url);
  }

  /** Mantém o sticker dentro da faixa vertical que realmente recebe toque. */
  function clampStickerY(y) {
    return clamp(y, STICKER_SAFE_TOP, STICKER_SAFE_BOTTOM);
  }

  /**
   * Monta um `tap_model` de link — a entidade de sticker clicável.
   * Este é o objeto que o app nativo envia quando você usa o sticker "Link";
   * é completamente separado do campo `caption`, que é só texto.
   */
  function buildLinkSticker(link) {
    const src = link || {};
    return {
      x: round7(clamp(src.x == null ? LINK_STICKER_DEFAULTS.x : src.x, 0, 1)),
      y: round7(clampStickerY(src.y == null ? LINK_STICKER_DEFAULTS.y : src.y)),
      z: src.z == null ? LINK_STICKER_DEFAULTS.z : src.z,
      width: round7(clamp(src.width == null ? LINK_STICKER_DEFAULTS.width : src.width, 0, 1)),
      height: round7(clamp(src.height == null ? LINK_STICKER_DEFAULTS.height : src.height, 0, 1)),
      rotation: src.rotation == null ? LINK_STICKER_DEFAULTS.rotation : src.rotation,
      type: "story_link",
      is_sticker: true,
      selected_index: 0,
      tap_state: 0,
      link_type: "web",
      url: src.url,
      tap_state_str_id: "link_sticker_default"
    };
  }

  /**
   * Corpo do `POST /api/v1/media/validate_reel_url/`.
   * O Instagram valida/allow-lista a URL ANTES do configure. Sem essa chamada
   * o configure aceita o payload mas descarta o sticker silenciosamente —
   * que é exatamente o sintoma que motivou este fix.
   */
  function buildValidateReelUrlBody(opts) {
    const { url, uid = "", uuid = "" } = opts || {};
    return new URLSearchParams({ url: String(url || ""), _uid: String(uid), _uuid: String(uuid) });
  }

  function dateTimeOriginal(now) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      `${now.getFullYear()}:${p(now.getMonth() + 1)}:${p(now.getDate())} ` +
      `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
    );
  }

  /**
   * Corpo do `POST /api/v1/media/configure_to_story/`.
   *
   * Campos de texto (`caption`) e de link (`tap_models` + `story_sticker_ids`)
   * são dimensões distintas: o caption nunca vira hyperlink, então link
   * clicável só existe como sticker.
   *
   * @param {object} opts
   * @param {string|number} opts.uploadId
   * @param {boolean} [opts.isVideo]
   * @param {{width:number,height:number,duration?:number}} [opts.meta]
   * @param {"all"|"besties"} [opts.audience]
   * @param {string} [opts.caption]                texto da legenda (metadado)
   * @param {{url:string,x?:number,y?:number}}|null [opts.link]
   * @param {Date}   [opts.now]                    injetável para testes
   * @param {number} [opts.timezoneOffsetSeconds]
   * @param {string} [opts.deviceId]
   * @param {string} [opts.uid]
   * @param {string} [opts.uuid]
   * @param {string} [opts.sessionId]
   * @param {number} [opts.cameraEntryPoint]
   * @returns {URLSearchParams}
   */
  function buildConfigureBody(opts) {
    const o = opts || {};
    const meta = o.meta || {};
    const now = o.now instanceof Date ? o.now : new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const w = Number(meta.width) || 1080;
    const h = Number(meta.height) || 1920;
    const tz = Number.isFinite(o.timezoneOffsetSeconds)
      ? o.timezoneOffsetSeconds
      : -now.getTimezoneOffset() * 60;

    const sessionId = o.sessionId || "";
    const body = new URLSearchParams({
      // --- campos que a extensão já enviava (preservados) ---
      upload_id: String(o.uploadId == null ? "" : o.uploadId),
      caption: o.caption || "",
      source_type: "4",
      configure_mode: "1",
      story_media_creation_date: String(ts),
      client_shared_at: String(ts - 5),
      client_timestamp: String(ts),

      // --- campos do payload atual, ausentes antes ---
      // Sem `uid`/`uuid`/`device_id` o Instagram não vincula o sticker à sessão
      // do dispositivo e costuma descartá-lo.
      _uid: String(o.uid || ""),
      _uuid: String(o.uuid || ""),
      device_id: String(o.deviceId || ""),
      camera_session_id: sessionId,
      composition_id: sessionId,
      supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES),
      timezone_offset: String(tz),
      scene_capture_type: "",
      media_folder: "Camera",
      creation_surface: "camera",
      capture_type: "normal",
      imported_taken_at: String(ts - 3 * 24 * 3600),
      rich_text_format_types: JSON.stringify(["modern_refreshed_v2"]),
      has_original_sound: "1",
      original_media_type: o.isVideo ? "video" : "photo",
      camera_entry_point: String(
        Number.isFinite(o.cameraEntryPoint) ? o.cameraEntryPoint : 25
      ),
      media_transformation_info: JSON.stringify({
        width: String(w),
        height: String(h),
        x_transform: "0",
        y_transform: "0",
        zoom: "1.0",
        rotation: "0.0",
        background_coverage: "0.0"
      }),
      edits: JSON.stringify({
        crop_original_size: [w * 1.0, h * 1.0],
        filter_type: 0,
        filter_strength: 1.0
      }),
      extra: JSON.stringify({ source_width: w, source_height: h }),
      // vazio quando não há sticker; preenchido abaixo
      story_sticker_ids: ""
    });

    if (o.isVideo) {
      const length = Number((meta.duration || 15).toFixed(2));
      body.set("poster_frame_index", "0");
      body.set("length", String(length));
      body.set("audio_muted", "false");
      body.set("filter_type", "0");
      body.set("width", String(w));
      body.set("height", String(h));
      body.set("date_time_original", dateTimeOriginal(now));
      body.set("clips", JSON.stringify([{ length, source_type: "4" }]));
    }

    if (o.audience === "besties") {
      // best-effort / não documentado: restringe a Melhores Amigos
      body.set("audience", "besties");
    }

    // >>> O FIX <<<
    // Link clicável = sticker, não texto. Precisa das DUAS chaves:
    //   tap_models          -> a entidade do sticker (url + geometria)
    //   story_sticker_ids   -> o registry que faz o Instagram instanciar o modelo
    // Mandar só uma das duas faz o Instagram aceitar o post e ignorar o link.
    if (o.link && o.link.url) {
      const sticker = buildLinkSticker(o.link);
      body.set("tap_models", JSON.stringify([sticker].slice(0, MAX_LINK_STICKERS)));
      body.set("story_sticker_ids", sticker.tap_state_str_id);
    }

    return body;
  }

  function uuidv4() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    // fallback só para ambientes sem WebCrypto; NÃO usar em produção
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /**
   * id de dispositivo estável no formato que o Instagram espera.
   * Precisa ser estável: trocar a cada post parece "novo aparelho" e aumenta
   * a chance de challenge/flags.
   */
  function makeDeviceId() {
    let hex = "";
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const b = crypto.getRandomValues(new Uint8Array(8));
      hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    } else {
      hex = Math.floor(Math.random() * 0xffffffffffffffff).toString(16).padStart(16, "0");
    }
    return `android-${hex}`;
  }

  return {
    SUPPORTED_CAPABILITIES,
    LINK_STICKER_DEFAULTS,
    STICKER_SAFE_TOP,
    STICKER_SAFE_BOTTOM,
    MAX_LINK_STICKERS,
    clamp,
    round7,
    normalizeUrl,
    findUrl,
    extractUrl,
    stripUrlAt,
    textForRender,
    lineHasUrl,
    clampStickerY,
    buildLinkSticker,
    buildValidateReelUrlBody,
    buildConfigureBody,
    dateTimeOriginal,
    uuidv4,
    makeDeviceId
  };
});
