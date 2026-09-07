// ===== IG Story Poster (Desktop) =====
// UI própria + upload via API interna do Instagram.
// AVISO: endpoints não documentados, podem mudar sem aviso. Ver README.

const APP_ID = "936619743392459";
const TARGET_W = 1080;
const TARGET_H = 1920;

function getCsrfToken() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : null;
}

function log(el, msg) {
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

// ---------- Canvas helpers (proporção + texto) ----------

function computeDrawRect(srcW, srcH, dstW, dstH, mode) {
  const scale =
    mode === "fit" ? Math.min(dstW / srcW, dstH / srcH) : Math.max(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

function drawText(ctx, text, pos, W, H) {
  if (!text) return;
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 7;
  const maxWidth = W - 120;
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const lineHeight = 66;
  const centerY = pos === "top" ? 180 : pos === "bottom" ? H - 160 : H / 2;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => {
    const ly = startY + i * lineHeight;
    ctx.strokeText(l, W / 2, ly);
    ctx.fillText(l, W / 2, ly);
  });
}

function loadImage(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = URL.createObjectURL(file);
  });
}

async function decodeAudio(audioFile) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await audioFile.arrayBuffer();
  const audioBuf = await ac.decodeAudioData(buf);
  return { ac, audioBuf };
}

// foto estática + texto/proporção -> canvas; se tiver música, vira vídeo (webm)
async function renderPhoto(file, opts, logEl) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TARGET_W, TARGET_H);
  const r = computeDrawRect(img.naturalWidth, img.naturalHeight, TARGET_W, TARGET_H, opts.aspect);
  ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
  drawText(ctx, opts.text, opts.textPos, TARGET_W, TARGET_H);

  if (!opts.audioFile) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    return { blob, isVideo: false, width: TARGET_W, height: TARGET_H };
  }

  log(logEl, "Gerando vídeo (foto + música)...");
  const { ac, audioBuf } = await decodeAudio(opts.audioFile);
  const source = ac.createBufferSource();
  source.buffer = audioBuf;
  const dest = ac.createMediaStreamDestination();
  source.connect(dest);
  const durationSec = Math.min(audioBuf.duration, 60);

  const stream = new MediaStream();
  canvas.captureStream(2).getVideoTracks().forEach((t) => stream.addTrack(t));
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus" });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise((res) => (recorder.onstop = res));
  recorder.start();
  source.start();
  await new Promise((r) => setTimeout(r, durationSec * 1000));
  recorder.stop();
  await stopped;

  return { blob: new Blob(chunks, { type: "video/webm" }), isVideo: true, width: TARGET_W, height: TARGET_H, duration: durationSec, coverCanvas: canvas };
}

// vídeo: re-renderiza frame a frame aplicando proporção/texto/música (webm)
async function renderVideo(videoEl, opts, logEl) {
  log(logEl, "Re-renderizando vídeo (proporção/texto/música)...");
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  const r = computeDrawRect(videoEl.videoWidth, videoEl.videoHeight, TARGET_W, TARGET_H, opts.aspect);

  const outStream = new MediaStream();
  canvas.captureStream(30).getVideoTracks().forEach((t) => outStream.addTrack(t));

  let acHandle;
  if (opts.audioFile) {
    videoEl.muted = true;
    const { ac, audioBuf } = await decodeAudio(opts.audioFile);
    const source = ac.createBufferSource();
    source.buffer = audioBuf;
    const dest = ac.createMediaStreamDestination();
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => outStream.addTrack(t));
    acHandle = { ac, source };
  } else {
    videoEl.muted = false;
    const vidStream = videoEl.captureStream ? videoEl.captureStream() : videoEl.mozCaptureStream();
    const at = vidStream && vidStream.getAudioTracks()[0];
    if (at) outStream.addTrack(at);
  }

  const recorder = new MediaRecorder(outStream, { mimeType: "video/webm;codecs=vp9,opus" });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise((res) => (recorder.onstop = res));

  let raf;
  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TARGET_W, TARGET_H);
    ctx.drawImage(videoEl, r.dx, r.dy, r.dw, r.dh);
    drawText(ctx, opts.text, opts.textPos, TARGET_W, TARGET_H);
    raf = requestAnimationFrame(draw);
  }

  videoEl.currentTime = 0;
  await videoEl.play();
  if (acHandle) acHandle.source.start();
  recorder.start();
  draw();

  await new Promise((res) => { videoEl.onended = res; });
  cancelAnimationFrame(raf);
  recorder.stop();
  await stopped;

  return { blob: new Blob(chunks, { type: "video/webm" }), isVideo: true, width: TARGET_W, height: TARGET_H, duration: videoEl.duration, coverCanvas: canvas };
}

// ---------- Upload / publicação ----------

async function uploadPhoto(blob, w, h, logEl) {
  const uploadId = Date.now().toString();
  const name = `fb_uploader_${uploadId}`;
  const res = await fetch(`https://www.instagram.com/rupload_igphoto/${name}`, {
    method: "POST",
    headers: {
      "x-csrftoken": getCsrfToken(),
      "x-ig-app-id": APP_ID,
      "x-entity-type": "image/jpeg",
      "x-entity-name": name,
      "x-entity-length": blob.size.toString(),
      "offset": "0",
      "content-type": "application/octet-stream",
      "x-instagram-rupload-params": JSON.stringify({
        media_type: 1,
        upload_id: uploadId,
        upload_media_height: h,
        upload_media_width: w
      })
    },
    body: blob
  });
  const text = await res.text();
  log(logEl, `[upload foto] ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error("Falha no upload da foto");
  return JSON.parse(text).upload_id || uploadId;
}

async function uploadVideo(blob, meta, logEl) {
  const uploadId = Date.now().toString();
  const name = `fb_uploader_${uploadId}`;
  const entityType = blob.type || "video/mp4";
  const res = await fetch(`https://www.instagram.com/rupload_igvideo/${name}`, {
    method: "POST",
    headers: {
      "x-csrftoken": getCsrfToken(),
      "x-ig-app-id": APP_ID,
      "x-entity-type": entityType,
      "x-entity-name": name,
      "x-entity-length": blob.size.toString(),
      "offset": "0",
      "content-type": "application/octet-stream",
      "x-instagram-rupload-params": JSON.stringify({
        media_type: 2,
        upload_id: uploadId,
        upload_media_duration_ms: Math.round((meta.duration || 15) * 1000),
        upload_media_height: meta.height,
        upload_media_width: meta.width,
        for_album: false,
        is_clips_video: false
      })
    },
    body: blob
  });
  const text = await res.text();
  log(logEl, `[upload vídeo] ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error("Falha no upload do vídeo");
  return JSON.parse(text).upload_id || uploadId;
}

async function uploadCoverPhoto(uploadId, sourceEl, w, h, logEl) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(sourceEl, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));

  const name = `fb_uploader_${uploadId}`;
  const res = await fetch(`https://www.instagram.com/rupload_igphoto/${name}`, {
    method: "POST",
    headers: {
      "x-csrftoken": getCsrfToken(),
      "x-ig-app-id": APP_ID,
      "x-entity-type": "image/jpeg",
      "x-entity-name": name,
      "x-entity-length": blob.size.toString(),
      "offset": "0",
      "content-type": "application/octet-stream",
      "x-instagram-rupload-params": JSON.stringify({
        media_type: 2,
        upload_id: uploadId,
        upload_media_height: h,
        upload_media_width: w,
        is_sidecar: false
      })
    },
    body: blob
  });
  const text = await res.text();
  log(logEl, `[upload capa] ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) throw new Error("Falha no upload da capa do vídeo");
}

function buildConfigureBody(uploadId, isVideo, meta, audience) {
  const now = new Date();
  const body = new URLSearchParams({
    upload_id: uploadId,
    caption: "",
    source_type: "4",
    configure_mode: "1",
    story_media_creation_date: Math.floor(Date.now() / 1000).toString(),
    client_shared_at: Math.floor(Date.now() / 1000).toString(),
    client_timestamp: Math.floor(Date.now() / 1000).toString()
  });
  if (audience === "besties") {
    // best-effort / não documentado oficialmente: restringe a Melhores Amigos
    body.set("audience", "besties");
  }
  if (isVideo) {
    const length = Number((meta.duration || 15).toFixed(2));
    body.set("poster_frame_index", "0");
    body.set("length", length.toString());
    body.set("audio_muted", "false");
    body.set("filter_type", "0");
    body.set("width", meta.width.toString());
    body.set("height", meta.height.toString());
    body.set(
      "date_time_original",
      `${now.getFullYear()}:${String(now.getMonth() + 1).padStart(2, "0")}:${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
    );
    body.set("timezone_offset", (-now.getTimezoneOffset() * 60).toString());
    body.set("clips", JSON.stringify([{ length, source_type: "4" }]));
    body.set("extra", JSON.stringify({ source_width: meta.width, source_height: meta.height }));
  }
  return body;
}

async function configureToStory(uploadId, isVideo, meta, audience, logEl) {
  const maxTries = isVideo ? 12 : 1;
  const delayMs = 1500;

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const res = await fetch("https://www.instagram.com/api/v1/media/configure_to_story/", {
      method: "POST",
      headers: {
        "x-csrftoken": getCsrfToken(),
        "x-ig-app-id": APP_ID,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: buildConfigureBody(uploadId, isVideo, meta, audience)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    const stillTranscoding = res.status === 202 || /transcode/i.test(data.message || "");
    if (stillTranscoding && attempt < maxTries) {
      log(logEl, `[configure_to_story] tentativa ${attempt}: ainda processando, aguardando...`);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    log(logEl, `[configure_to_story] ${res.status} ${text.slice(0, 300)}`);
    if (!res.ok || data.status === "fail" || data.error_id) {
      throw new Error(data.message || data.error_title || "Instagram recusou a publicação (veja o log)");
    }
    return data;
  }
}

// ---------- Localizar a fileira de stories e inserir o botão lá ----------

function isHorizontalRow(kids) {
  if (kids.length < 2) return false;
  const r0 = kids[0].getBoundingClientRect();
  const r1 = kids[1].getBoundingClientRect();
  // itens lado a lado: mesma altura (top), left diferente. Lista vertical seria o oposto.
  return Math.abs(r0.top - r1.top) < 12 && Math.abs(r0.left - r1.left) > 12;
}

function findStoryTray() {
  const els = document.querySelectorAll("main div, main ul, section div, section ul");
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.top < 40 || rect.top > 260 || rect.height === 0 || rect.width < 300) continue;
    const kids = [...el.children];
    if (kids.length < 3) continue;
    const withImg = kids.filter((c) => c.querySelector("img"));
    if (withImg.length < 3 || withImg.length !== kids.length) continue;
    if (!isHorizontalRow(withImg)) continue;
    const img = withImg[0].querySelector("img");
    const r = img.getBoundingClientRect();
    if (r.width > 40 && r.width < 90 && Math.abs(r.width - r.height) < 8) {
      return el;
    }
  }
  return null;
}

function getMyAvatarUrl() {
  const trocar = [...document.querySelectorAll("a, button, span, div")].find(
    (el) => el.children.length === 0 && /^(trocar|switch)$/i.test(el.textContent.trim())
  );
  let node = trocar;
  for (let i = 0; i < 6 && node; i++) {
    const img = node.querySelector && node.querySelector("img");
    if (img) return img.src;
    node = node.parentElement;
  }
  // fallback: primeiro img pequeno e quadrado perto do topo (ícone de perfil)
  const avatarLike = [...document.querySelectorAll("img")].find((img) => {
    const r = img.getBoundingClientRect();
    return r.top < 250 && r.width > 20 && r.width < 60 && Math.abs(r.width - r.height) < 4;
  });
  return avatarLike ? avatarLike.src : null;
}

function buildTraySvg(avatarUrl) {
  const size = 62;
  const r = size / 2;
  const inner = avatarUrl
    ? `<image href="${avatarUrl}" x="3" y="3" width="${size - 6}" height="${size - 6}"
        clip-path="url(#igsp-clip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${r}" cy="${r}" r="${r - 3}" fill="#111"/>
       <text x="${r}" y="${r + 7}" text-anchor="middle" font-size="22">📸</text>`;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="igsp-clip"><circle cx="${r}" cy="${r}" r="${r - 3}"/></clipPath>
        <linearGradient id="igsp-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#833AB4"/>
          <stop offset="55%" stop-color="#E1306C"/>
          <stop offset="100%" stop-color="#F77737"/>
        </linearGradient>
      </defs>
      <circle cx="${r}" cy="${r}" r="${r}" fill="url(#igsp-grad)"/>
      ${inner}
      <circle cx="${size - 10}" cy="${size - 10}" r="11" fill="url(#igsp-grad)" stroke="#1a1a1d" stroke-width="2.5"/>
      <path d="M ${size - 15} ${size - 10} H ${size - 5} M ${size - 10} ${size - 15} V ${size - 5}"
        stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `;
}

function createTrayButton(onClick) {
  const item = document.createElement("div");
  item.id = "igsp-tray-btn";
  // reseta qualquer CSS herdado do Instagram no elemento host
  item.style.cssText = "all: initial !important;";

  const shadow = item.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        cursor: pointer; width: 74px; font-family: -apple-system, system-ui, sans-serif;
      }
      .ring { width: 62px; height: 62px; border-radius: 50%; transition: transform .15s ease; }
      .ring:hover { transform: scale(1.06); }
      svg { display: block; }
      .label {
        font-size: 12px; color: #f5f5f7; max-width: 74px; text-align: center;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
    </style>
    <div class="wrap">
      <div class="ring">${buildTraySvg(getMyAvatarUrl())}</div>
      <span class="label">Criar Story</span>
    </div>
  `;
  item.onclick = onClick;
  return item;
}

function createFloatingButton(onClick) {
  const btn = document.createElement("button");
  btn.id = "igsp-btn";
  btn.onclick = onClick;
  return btn;
}

function mountTrigger(onClick) {
  let item = null;
  let tray = null;

  function reposition() {
    if (!item || !tray || !document.body.contains(tray) || !document.body.contains(item)) return;
    const firstChild = tray.children[0];
    const cr = (firstChild || tray).getBoundingClientRect();
    item.style.left = Math.max(8, cr.left - 84) + "px";
    item.style.top = cr.top + "px";
  }

  function ensureMounted() {
    try {
      const trayStillValid = tray && document.body.contains(tray);
      const itemStillValid = item && document.body.contains(item);

      if (itemStillValid && (trayStillValid || item.id === "igsp-btn")) {
        reposition();
        return;
      }

      const found = findStoryTray();
      if (item) item.remove();

      if (found) {
        tray = found;
        item = createTrayButton(onClick);
        item.style.position = "fixed";
        item.style.zIndex = "999999";
        document.body.appendChild(item);
        reposition();
      } else {
        // fallback: fileira não encontrada, usa botão fixo no canto
        tray = null;
        item = createFloatingButton(onClick);
        document.body.appendChild(item);
      }
    } catch (err) {
      console.error("[IGSP] erro ao montar o botão, caindo pro botão flutuante:", err);
      if (!document.getElementById("igsp-btn") && !document.getElementById("igsp-tray-btn")) {
        try {
          document.body.appendChild(createFloatingButton(onClick));
        } catch (err2) {
          console.error("[IGSP] falha até no fallback:", err2);
        }
      }
    }
  }

  ensureMounted();
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  setInterval(ensureMounted, 1000);
}

function injectUI() {
  if (document.getElementById("igsp-modal")) return;

  const style = document.createElement("style");
  style.textContent = `
    /* ===== Paleta (gradiente Instagram) + base dark ===== */
    #igsp-modal, #igsp-modal * { box-sizing: border-box; }
    #igsp-modal {
      --ig-purple: #833AB4;
      --ig-pink: #E1306C;
      --ig-orange: #F77737;
      --ig-gradient: linear-gradient(135deg, var(--ig-purple), var(--ig-pink) 55%, var(--ig-orange));
      --bg-app: #0d0d0f;
      --bg-card: #1a1a1d;
      --bg-field: #131315;
      --border: #2c2c30;
      --text: #f5f5f7;
      --text-muted: #8e8e93;
      font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
    }

    /* ===== Botão flutuante (reserva, só usado se a fileira de stories não for encontrada) ===== */
    #igsp-btn {
      position: fixed; bottom: 26px; right: 26px; z-index: 999999;
      display: flex; align-items: center; gap: 8px;
      background: var(--bg-card); color: var(--text);
      border: 0; border-radius: 999px; padding: 3px;
      font: 600 14px -apple-system, system-ui, sans-serif; cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
      transition: transform .15s ease;
    }
    #igsp-btn:hover { transform: translateY(-2px); }
    #igsp-btn::before {
      content: "📸"; display: grid; place-items: center;
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--ig-gradient); font-size: 15px;
    }
    #igsp-btn::after { content: "Criar Story"; padding: 0 14px 0 2px; }

    /* ===== Item da fileira de stories: isolado via Shadow DOM (ver createTrayButton) ===== */

    /* ===== Overlay + card ===== */
    #igsp-modal {
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,.72); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
    }
    #igsp-modal.hidden { display: none; }
    #igsp-card {
      position: relative; width: 380px; max-height: 90vh; overflow-y: auto;
      background: var(--bg-card); color: var(--text);
      border-radius: 22px; padding: 24px; font-size: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
      border: 1px solid var(--border);
    }
    /* fio de luz gradiente no topo do card, assinatura visual do Instagram */
    #igsp-card::before {
      content: ""; position: absolute; top: 0; left: 20px; right: 20px; height: 3px;
      border-radius: 0 0 4px 4px; background: var(--ig-gradient);
    }

    #igsp-card h2 {
      margin: 4px 0 18px; font-size: 17px; font-weight: 700; letter-spacing: -.2px;
    }

    /* ===== Labels e campos ===== */
    #igsp-card label {
      display: block; margin: 16px 0 6px; font-size: 11px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted);
    }
    #igsp-card label:first-of-type { margin-top: 0; }

    #igsp-card input[type=file],
    #igsp-card select,
    #igsp-card input[type=text] {
      width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--bg-field); color: var(--text);
      font-size: 13px; outline: none; transition: border-color .15s ease, box-shadow .15s ease;
      appearance: none;
    }
    #igsp-card select { cursor: pointer; }
    #igsp-card input[type=text]::placeholder { color: var(--text-muted); }
    #igsp-card input[type=text]:focus,
    #igsp-card select:focus {
      border-color: var(--ig-pink);
      box-shadow: 0 0 0 3px rgba(225,48,108,.18);
    }
    /* input[type=file] custom: some navegadores não estilizam o botão nativo bem,
       então deixamos discreto e dependemos do texto padrão do navegador */
    #igsp-card input[type=file] { padding: 8px 10px; font-size: 12px; color: var(--text-muted); }

    #igsp-textpos { margin-top: 8px; }

    /* ===== Preview de mídia ===== */
    #igsp-preview, #igsp-preview-v {
      width: 100%; max-height: 220px; margin-top: 10px; object-fit: contain;
      background: #000; border-radius: 14px; border: 1px solid var(--border);
    }

    /* ===== Botões de ação ===== */
    #igsp-publish {
      width: 100%; margin-top: 20px; padding: 13px; border: 0; border-radius: 12px;
      background: var(--ig-gradient); color: #fff; font-weight: 700; font-size: 14px;
      cursor: pointer; letter-spacing: .01em;
      box-shadow: 0 6px 18px rgba(225,48,108,.35);
      transition: transform .12s ease, box-shadow .12s ease;
    }
    #igsp-publish:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(225,48,108,.45); }
    #igsp-publish:active { transform: translateY(0); }

    #igsp-close {
      width: 100%; margin-top: 8px; padding: 10px; border: 1px solid var(--border);
      border-radius: 12px; background: transparent; color: var(--text-muted);
      font-weight: 600; font-size: 13px; cursor: pointer; transition: color .15s ease, border-color .15s ease;
    }
    #igsp-close:hover { color: var(--text); border-color: #45454a; }

    /* ===== Log de debug: discreto, monoespaçado, sem chamar atenção ===== */
    #igsp-log {
      margin-top: 14px; max-height: 70px; overflow-y: auto; resize: vertical;
      background: #000; color: #6fbf73; font: 10.5px/1.5 "SF Mono", Menlo, monospace;
      padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
      white-space: pre-wrap; opacity: .85;
    }
    #igsp-log:empty { display: none; }
  `;
  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "igsp-modal";
  modal.className = "hidden";
  modal.innerHTML = `
    <div id="igsp-card">
      <h2>Criar Story (via PC)</h2>

      <label>Arquivo (foto JPG ou vídeo MP4)</label>
      <input type="file" id="igsp-file" accept="image/jpeg,video/mp4" />
      <img id="igsp-preview" style="display:none" />
      <video id="igsp-preview-v" style="display:none" controls></video>

      <label>Proporção</label>
      <select id="igsp-aspect">
        <option value="original">Original (sem reprocessar)</option>
        <option value="cover">Preencher a tela (corta bordas)</option>
        <option value="fit">Ajustar (mantém tudo, barras pretas)</option>
      </select>

      <label>Quem pode ver</label>
      <select id="igsp-audience">
        <option value="all">Todos</option>
        <option value="besties">Melhores amigos ⭐</option>
      </select>

      <label>Texto no story (opcional)</label>
      <input type="text" id="igsp-text" placeholder="Ex: Bom dia!" />
      <select id="igsp-textpos">
        <option value="top">Topo</option>
        <option value="center" selected>Centro</option>
        <option value="bottom">Base</option>
      </select>

      <label>Música (opcional — arquivo de áudio seu, mp3/m4a)</label>
      <input type="file" id="igsp-audio" accept="audio/*" />

      <button id="igsp-publish">Publicar Story</button>
      <button id="igsp-close">Fechar</button>
      <div id="igsp-log"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const fileInput = modal.querySelector("#igsp-file");
  const previewImg = modal.querySelector("#igsp-preview");
  const previewVid = modal.querySelector("#igsp-preview-v");
  const logEl = modal.querySelector("#igsp-log");
  const aspectSel = modal.querySelector("#igsp-aspect");
  const audienceSel = modal.querySelector("#igsp-audience");
  const textInput = modal.querySelector("#igsp-text");
  const textPosSel = modal.querySelector("#igsp-textpos");
  const audioInput = modal.querySelector("#igsp-audio");
  let selectedFile = null;

  mountTrigger(() => modal.classList.remove("hidden"));
  modal.querySelector("#igsp-close").onclick = () => modal.classList.add("hidden");

  fileInput.onchange = () => {
    selectedFile = fileInput.files[0];
    if (!selectedFile) return;
    const url = URL.createObjectURL(selectedFile);
    if (selectedFile.type.startsWith("video")) {
      previewVid.src = url;
      previewVid.style.display = "block";
      previewImg.style.display = "none";
    } else {
      previewImg.src = url;
      previewImg.style.display = "block";
      previewVid.style.display = "none";
    }
  };

  modal.querySelector("#igsp-publish").onclick = async () => {
    if (!selectedFile) {
      log(logEl, "Escolha um arquivo primeiro.");
      return;
    }
    logEl.textContent = "";

    const opts = {
      aspect: aspectSel.value,
      text: textInput.value.trim(),
      textPos: textPosSel.value,
      audioFile: audioInput.files[0] || null
    };
    const audience = audienceSel.value;
    const needsProcessing = opts.aspect !== "original" || opts.text || opts.audioFile;
    const isSourceVideo = selectedFile.type.startsWith("video");

    try {
      let uploadId, isVideo, meta, coverEl;

      if (!needsProcessing) {
        // caminho direto (já validado antes) — sem reprocessar nada
        log(logEl, "Enviando mídia (sem alterações)...");
        if (isSourceVideo) {
          if (previewVid.readyState < 1) {
            await new Promise((r) => previewVid.addEventListener("loadedmetadata", r, { once: true }));
          }
          meta = { duration: previewVid.duration || 15, width: previewVid.videoWidth, height: previewVid.videoHeight };
          uploadId = await uploadVideo(selectedFile, meta, logEl);
          coverEl = previewVid;
          isVideo = true;
        } else {
          const img = await loadImage(selectedFile);
          meta = { width: img.naturalWidth, height: img.naturalHeight };
          uploadId = await uploadPhoto(selectedFile, meta.width, meta.height, logEl);
          isVideo = false;
        }
      } else {
        // pipeline com canvas (proporção / texto / música)
        let result;
        if (isSourceVideo) {
          if (previewVid.readyState < 1) {
            await new Promise((r) => previewVid.addEventListener("loadedmetadata", r, { once: true }));
          }
          result = await renderVideo(previewVid, opts, logEl);
        } else {
          result = await renderPhoto(selectedFile, opts, logEl);
        }
        isVideo = result.isVideo;
        meta = { width: result.width, height: result.height, duration: result.duration };

        if (isVideo) {
          uploadId = await uploadVideo(result.blob, meta, logEl);
          coverEl = result.coverCanvas;
        } else {
          uploadId = await uploadPhoto(result.blob, meta.width, meta.height, logEl);
        }
      }

      if (isVideo) {
        log(logEl, "Gerando capa do vídeo...");
        await uploadCoverPhoto(uploadId, coverEl, meta.width, meta.height, logEl);
      }

      log(logEl, "Publicando como Story...");
      await configureToStory(uploadId, isVideo, meta, audience, logEl);
      log(logEl, "✅ Story publicado! Confira seu perfil.");
    } catch (err) {
      log(logEl, "❌ " + err.message);
    }
  };
}

try {
  injectUI();
  console.log("[IGSP] extension carregada com sucesso.");
} catch (err) {
  console.error("[IGSP] erro fatal ao inicializar:", err);
}
