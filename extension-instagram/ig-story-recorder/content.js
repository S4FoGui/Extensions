// ===== IG Story Poster (Desktop) =====
// UI própria + upload via API interna do Instagram.
// AVISO: endpoints não documentados, podem mudar sem aviso. Ver README.

const APP_ID = "936619743392459";
const TARGET_W = 1080;
const TARGET_H = 1920;

// ---------- Ícones próprios (SVG inline, herdam cor via currentColor) ----------

const ICONS = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3.2L9 4h6l1.8 3H21a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.6"/></svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M7 5v14M16.5 5v14M2.5 10h4.5M16.5 10H21M2.5 15h4.5M16.5 15H21"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1"/><rect x="13.5" y="5" width="4.5" height="14" rx="1"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.5l2 2.5H19a2 2 0 0 1 2 2z"/></svg>`,
  music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 18.5V5.5l11-2v13"/><circle cx="6.5" cy="18.5" r="2.8"/><circle cx="17.5" cy="16.5" r="2.8"/></svg>`,
  volume2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  volumeX: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
};

function icon(name, extraAttrs = "") {
  return ICONS[name].replace("<svg ", `<svg ${extraAttrs} `);
}

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

function drawText(ctx, text, xRel, yRel, W, H, color) {
  if (!text) return;
  ctx.font = "bold 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = color || "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 7;
  const centerX = (xRel ?? 0.5) * W;
  const centerY = (yRel ?? 0.5) * H;
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
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => {
    const ly = startY + i * lineHeight;
    ctx.strokeText(l, centerX, ly);
    ctx.fillText(l, centerX, ly);
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

// ---------- WebCodecs + mp4-muxer: gera MP4 real (H.264+AAC/Opus) ----------

async function hasWebCodecsH264() {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const sup = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001e",
      width: TARGET_W,
      height: TARGET_H,
      bitrate: 2_000_000,
    });
    return sup.supported === true;
  } catch { return false; }
}

async function pickAudioCodec(sampleRate, channels) {
  if (typeof AudioEncoder === "undefined") return null;
  // Tentar AAC primeiro (Instagram prefere)
  try {
    const aac = await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2",
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });
    if (aac.supported) return { codec: "mp4a.40.2", muxCodec: "aac" };
  } catch {}
  // Fallback: Opus em mp4
  try {
    const opus = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: channels,
      bitrate: 128_000,
    });
    if (opus.supported) return { codec: "opus", muxCodec: "opus" };
  } catch {}
  return null;
}

// Encode AudioBuffer → EncodedAudioChunks via AudioEncoder
async function encodeAudioBuffer(audioBuf, durationSec, audioCodecInfo, muxer) {
  const channels = audioBuf.numberOfChannels;
  const srcRate = audioBuf.sampleRate;
  // Opus requer 48000
  const encRate = audioCodecInfo.muxCodec === "opus" ? 48000 : srcRate;

  return new Promise((resolve, reject) => {
    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => reject(e),
    });
    encoder.configure({
      codec: audioCodecInfo.codec,
      sampleRate: encRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });

    // Resample se necessário e split em AudioData frames
    const totalSamples = Math.min(Math.floor(durationSec * srcRate), audioBuf.length);
    const frameSize = 1024; // AAC frame size, Opus também aceita
    const resampleRatio = encRate / srcRate;
    const totalEncSamples = Math.floor(totalSamples * resampleRatio);

    // Intercalar canais em Float32Array planar
    const channelData = [];
    for (let ch = 0; ch < channels; ch++) {
      channelData.push(audioBuf.getChannelData(ch));
    }

    for (let offset = 0; offset < totalEncSamples; offset += frameSize) {
      const count = Math.min(frameSize, totalEncSamples - offset);
      const srcOffset = Math.floor(offset / resampleRatio);
      const data = new Float32Array(count * channels);
      // Interleaved format
      for (let i = 0; i < count; i++) {
        const srcIdx = Math.min(srcOffset + Math.floor(i / resampleRatio), totalSamples - 1);
        for (let ch = 0; ch < channels; ch++) {
          data[i * channels + ch] = channelData[ch][srcIdx] || 0;
        }
      }
      const audioData = new AudioData({
        format: "f32",
        sampleRate: encRate,
        numberOfFrames: count,
        numberOfChannels: channels,
        timestamp: Math.round((offset / encRate) * 1_000_000),
        data,
      });
      encoder.encode(audioData);
      audioData.close();
    }

    encoder.flush().then(() => {
      encoder.close();
      resolve();
    }).catch(reject);
  });
}

// Render foto estática como MP4 via WebCodecs (H.264 + Audio)
async function renderPhotoWebCodecs(canvas, audioBuf, durationSec, logEl) {
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
  const fps = 5;
  const totalFrames = Math.ceil(durationSec * fps);

  // Detectar codec de áudio
  const audioCodecInfo = await pickAudioCodec(audioBuf.sampleRate, audioBuf.numberOfChannels);
  if (!audioCodecInfo) {
    log(logEl, "⚠ Nenhum encoder de áudio disponível, vídeo sem som.");
  }

  const muxerOpts = {
    target: new ArrayBufferTarget(),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
    video: {
      codec: "avc",
      width: TARGET_W,
      height: TARGET_H,
      frameRate: fps,
    },
  };
  if (audioCodecInfo) {
    muxerOpts.audio = {
      codec: audioCodecInfo.muxCodec,
      numberOfChannels: audioBuf.numberOfChannels,
      sampleRate: audioCodecInfo.muxCodec === "opus" ? 48000 : audioBuf.sampleRate,
    };
  }
  const muxer = new Muxer(muxerOpts);

  // Video encoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  videoEncoder.configure({
    codec: "avc1.42001e",
    width: TARGET_W,
    height: TARGET_H,
    bitrate: 2_000_000,
    framerate: fps,
  });

  log(logEl, `Encoding ${totalFrames} video frames (${fps}fps, ${durationSec.toFixed(1)}s)...`);

  // Encode static frame repeated
  for (let i = 0; i < totalFrames; i++) {
    const timestampUs = Math.round((i / fps) * 1_000_000);
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / fps),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // Yield para evitar congelar UI
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await videoEncoder.flush();
  videoEncoder.close();

  // Encode áudio
  if (audioCodecInfo) {
    log(logEl, "Encoding áudio...");
    await encodeAudioBuffer(audioBuf, durationSec, audioCodecInfo, muxer);
  }

  muxer.finalize();
  const buf = muxer.target.buffer;
  log(logEl, `MP4 gerado: ${(buf.byteLength / 1024).toFixed(0)}KB`);
  return new Blob([buf], { type: "video/mp4" });
}

// Render vídeo re-processado como MP4 via WebCodecs
async function renderVideoWebCodecs(videoEl, canvas, ctx, drawRect, opts, logEl) {
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
  const fps = 30;
  const durationSec = videoEl.duration;
  const totalFrames = Math.ceil(durationSec * fps);

  // Audio source
  let audioBuf = null;
  let audioCodecInfo = null;
  if (opts.audioFile) {
    const decoded = await decodeAudio(opts.audioFile);
    audioBuf = decoded.audioBuf;
    audioCodecInfo = await pickAudioCodec(audioBuf.sampleRate, audioBuf.numberOfChannels);
  }
  // TODO: extrair áudio do vídeo original se não tiver audioFile
  // (por ora só funciona com audioFile ou vídeo sem som)

  const muxerOpts = {
    target: new ArrayBufferTarget(),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
    video: {
      codec: "avc",
      width: TARGET_W,
      height: TARGET_H,
      frameRate: fps,
    },
  };
  if (audioCodecInfo && audioBuf) {
    muxerOpts.audio = {
      codec: audioCodecInfo.muxCodec,
      numberOfChannels: audioBuf.numberOfChannels,
      sampleRate: audioCodecInfo.muxCodec === "opus" ? 48000 : audioBuf.sampleRate,
    };
  }
  const muxer = new Muxer(muxerOpts);

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  videoEncoder.configure({
    codec: "avc1.42001e",
    width: TARGET_W,
    height: TARGET_H,
    bitrate: 4_000_000,
    framerate: fps,
  });

  log(logEl, `Encoding vídeo: ${totalFrames} frames (${fps}fps, ${durationSec.toFixed(1)}s)...`);

  // Seek frame-by-frame para extrair frames do vídeo
  videoEl.pause();
  videoEl.muted = true;
  for (let i = 0; i < totalFrames; i++) {
    const timeSec = i / fps;
    if (timeSec > durationSec) break;
    videoEl.currentTime = timeSec;
    await new Promise((r) => { videoEl.onseeked = r; });

    // Draw frame no canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TARGET_W, TARGET_H);
    ctx.drawImage(videoEl, drawRect.dx, drawRect.dy, drawRect.dw, drawRect.dh);
    drawText(ctx, opts.text, opts.textX, opts.textY, TARGET_W, TARGET_H, opts.color);

    const timestampUs = Math.round(timeSec * 1_000_000);
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / fps),
    });
    videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();

    if (i % 30 === 0) {
      log(logEl, `  frame ${i}/${totalFrames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();

  if (audioCodecInfo && audioBuf) {
    log(logEl, "Encoding áudio...");
    await encodeAudioBuffer(audioBuf, Math.min(durationSec, 60), audioCodecInfo, muxer);
  }

  muxer.finalize();
  const buf = muxer.target.buffer;
  log(logEl, `MP4 gerado: ${(buf.byteLength / 1024).toFixed(0)}KB`);
  return new Blob([buf], { type: "video/mp4" });
}

// ---------- MediaRecorder fallback (webm, pode não funcionar no Instagram) ----------

async function renderPhotoMediaRecorder(canvas, ac, audioBuf, durationSec, logEl) {
  const source = ac.createBufferSource();
  source.buffer = audioBuf;
  const dest = ac.createMediaStreamDestination();
  source.connect(dest);

  const stream = new MediaStream();
  canvas.captureStream(2).getVideoTracks().forEach((t) => stream.addTrack(t));
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  let mimeType = "";
  if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,opus")) mimeType = "video/mp4;codecs=avc1,opus";
  else if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) mimeType = "video/mp4;codecs=avc1";
  else if (MediaRecorder.isTypeSupported("video/webm;codecs=h264")) mimeType = "video/webm;codecs=h264";
  else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) mimeType = "video/webm;codecs=vp8,opus";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise((res) => (recorder.onstop = res));
  recorder.start();
  source.start();
  await new Promise((r) => setTimeout(r, durationSec * 1000));
  recorder.stop();
  await stopped;
  log(logEl, "⚠ Usando MediaRecorder fallback (webm). Instagram pode rejeitar.");
  return new Blob(chunks, { type: "video/mp4" });
}

async function renderVideoMediaRecorder(videoEl, canvas, ctx, drawRect, opts, logEl) {
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

  let recMime = "";
  if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,opus")) recMime = "video/mp4;codecs=avc1,opus";
  else if (MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")) recMime = "video/mp4;codecs=avc1";
  else if (MediaRecorder.isTypeSupported("video/webm;codecs=h264")) recMime = "video/webm;codecs=h264";
  else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) recMime = "video/webm;codecs=vp9,opus";
  const recorder = new MediaRecorder(outStream, recMime ? { mimeType: recMime } : {});
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise((res) => (recorder.onstop = res));

  let raf;
  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TARGET_W, TARGET_H);
    ctx.drawImage(videoEl, drawRect.dx, drawRect.dy, drawRect.dw, drawRect.dh);
    drawText(ctx, opts.text, opts.textX, opts.textY, TARGET_W, TARGET_H, opts.color);
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
  log(logEl, "⚠ Usando MediaRecorder fallback (webm). Instagram pode rejeitar.");
  return new Blob(chunks, { type: "video/mp4" });
}

// ---------- Funções públicas de render (despacham WebCodecs ou fallback) ----------

// foto estática + texto/proporção -> canvas; se tiver música, vira vídeo mp4
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
  drawText(ctx, opts.text, opts.textX, opts.textY, TARGET_W, TARGET_H, opts.color);

  if (!opts.audioFile) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    return { blob, isVideo: false, width: TARGET_W, height: TARGET_H };
  }

  log(logEl, "Gerando vídeo (foto + música)...");
  const { ac, audioBuf } = await decodeAudio(opts.audioFile);
  const durationSec = Math.min(audioBuf.duration, 60);

  let blob;
  const canUseWebCodecs = await hasWebCodecsH264();
  if (canUseWebCodecs && window.Mp4Muxer) {
    log(logEl, "Usando WebCodecs + mp4-muxer (MP4 real).");
    blob = await renderPhotoWebCodecs(canvas, audioBuf, durationSec, logEl);
  } else {
    log(logEl, "WebCodecs H.264 não disponível, usando MediaRecorder...");
    blob = await renderPhotoMediaRecorder(canvas, ac, audioBuf, durationSec, logEl);
  }

  return { blob, isVideo: true, width: TARGET_W, height: TARGET_H, duration: durationSec, coverCanvas: canvas };
}

// vídeo: re-renderiza frame a frame aplicando proporção/texto/música → MP4
async function renderVideo(videoEl, opts, logEl) {
  log(logEl, "Re-renderizando vídeo (proporção/texto/música)...");
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  const r = computeDrawRect(videoEl.videoWidth, videoEl.videoHeight, TARGET_W, TARGET_H, opts.aspect);

  let blob;
  const canUseWebCodecs = await hasWebCodecsH264();
  // WebCodecs quando tem audioFile (substituição) ou quando não precisa de áudio.
  // MediaRecorder quando precisa preservar áudio nativo do vídeo (sem audioFile).
  const needsNativeAudio = !opts.audioFile;
  if (canUseWebCodecs && window.Mp4Muxer && !needsNativeAudio) {
    log(logEl, "Usando WebCodecs + mp4-muxer (MP4 real).");
    blob = await renderVideoWebCodecs(videoEl, canvas, ctx, r, opts, logEl);
  } else {
    log(logEl, needsNativeAudio ? "Usando MediaRecorder (preserva áudio nativo)..." : "WebCodecs H.264 não disponível, usando MediaRecorder...");
    blob = await renderVideoMediaRecorder(videoEl, canvas, ctx, r, opts, logEl);
  }

  return { blob, isVideo: true, width: TARGET_W, height: TARGET_H, duration: videoEl.duration, coverCanvas: canvas };
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
  const entityType = "video/mp4";
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

function buildConfigureBody(uploadId, isVideo, meta, audience, opts) {
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
  if (opts && opts.link) {
    body.set("story_link_stickers", JSON.stringify([{
      x: 0.5,
      y: 0.8,
      z: 0,
      width: 0.5,
      height: 0.1,
      rotation: 0,
      is_sticker: 1,
      story_link: {
        link_type: "web",
        url: opts.link,
        link_title: ""
      }
    }]));
    body.set("story_cta", JSON.stringify([{"links":[{"webUri": opts.link}]}]));
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

async function configureToStory(uploadId, isVideo, meta, audience, opts, logEl) {
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
      body: buildConfigureBody(uploadId, isVideo, meta, audience, opts)
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
  const camSize = size * 0.46;
  const camOff = (size - camSize) / 2;
  const inner = avatarUrl
    ? `<image href="${avatarUrl}" x="3" y="3" width="${size - 6}" height="${size - 6}"
        clip-path="url(#igsp-clip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${r}" cy="${r}" r="${r - 3}" fill="#111"/>
       <g transform="translate(${camOff}, ${camOff}) scale(${camSize / 24})"
          stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
         <path d="M22 18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3.2L9 4h6l1.8 3H21a2 2 0 0 1 2 2z"/>
         <circle cx="12" cy="13" r="3.6"/>
       </g>`;

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
      .ring { width: 62px; height: 62px; border-radius: 50%; transition: transform .15s cubic-bezier(.34,1.56,.64,1); }
      .wrap:hover .ring { transform: scale(1.08); }
      .wrap:active .ring { transform: scale(.94); }
      svg { display: block; }
      .label {
        font-size: 12px; color: #f5f5f7; max-width: 74px; text-align: center;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        transition: color .15s ease;
      }
      .wrap:hover .label { color: #fff; }
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
  btn.innerHTML = `<span class="igsp-btn-ico">${icon("camera")}</span><span class="igsp-btn-label">Criar Story</span>`;
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
      position: fixed; bottom: 96px; right: 26px; z-index: 999999;
      display: flex; align-items: center; gap: 10px;
      background: var(--bg-card); color: var(--text);
      border: 2px solid transparent; border-radius: 999px; padding: 4px;
      font: 600 15px -apple-system, system-ui, sans-serif; cursor: pointer;
      background-image: linear-gradient(var(--bg-card), var(--bg-card)), var(--ig-gradient);
      background-origin: border-box; background-clip: padding-box, border-box;
      box-shadow: 0 10px 28px rgba(0,0,0,.5);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #igsp-btn:hover { transform: translateY(-3px); box-shadow: 0 14px 32px rgba(0,0,0,.6); }
    #igsp-btn:active { transform: translateY(-1px) scale(.97); box-shadow: 0 6px 16px rgba(0,0,0,.5); }
    #igsp-btn .igsp-btn-ico {
      display: grid; place-items: center; flex-shrink: 0;
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--ig-gradient); color: #fff;
      transition: transform .2s ease;
    }
    #igsp-btn .igsp-btn-ico svg { width: 19px; height: 19px; }
    #igsp-btn:hover .igsp-btn-ico { transform: rotate(-8deg) scale(1.06); }
    #igsp-btn .igsp-btn-label { padding: 0 16px 0 4px; }

    /* ===== Item da fileira de stories: isolado via Shadow DOM (ver createTrayButton) ===== */

    /* ===== Overlay + card ===== */
    #igsp-modal {
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,.72); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
    }
    #igsp-modal.hidden { display: none; }
    #igsp-card {
      position: relative; width: 720px; max-width: 95vw; max-height: 90vh;
      background: var(--bg-card); color: var(--text);
      border-radius: 22px; padding: 22px; font-size: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
      border: 1px solid var(--border);
      display: flex; flex-direction: column;
    }
    /* fio de luz gradiente no topo do card, assinatura visual do Instagram */
    #igsp-card::before {
      content: ""; position: absolute; top: 0; left: 20px; right: 20px; height: 3px;
      border-radius: 0 0 4px 4px; background: var(--ig-gradient);
    }

    #igsp-head { display: flex; align-items: center; gap: 10px; margin: 4px 0 16px; flex-shrink: 0; }
    #igsp-head .ico {
      width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
      background: var(--ig-gradient); display: grid; place-items: center; color: #fff;
    }
    #igsp-head .ico svg { width: 16px; height: 16px; }
    #igsp-card h2 { font-size: 16px; font-weight: 700; letter-spacing: -.2px; }
    #igsp-card h2 span { display: block; font-size: 11px; font-weight: 500; color: var(--text-muted); margin-top: 1px; }

    /* ===== Corpo: player (esquerda, fixo) + editor (direita, rolável) ===== */
    #igsp-body { display: flex; gap: 20px; min-height: 0; flex: 1; }

    /* ----- Coluna do player: onde a mídia é exibida e a legenda é posicionada ----- */
    #igsp-stage-col { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; }
    #igsp-stage {
      position: relative; width: 100%; aspect-ratio: 9 / 16; border-radius: 16px;
      overflow: hidden; background: #000; border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
    }
    #igsp-stage-empty {
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 8px; color: var(--text-muted); text-align: center; padding: 0 16px;
    }
    #igsp-stage-empty .ico { width: 30px; height: 30px; opacity: .55; }
    #igsp-stage-empty .ico svg { width: 100%; height: 100%; }
    #igsp-stage-empty span:last-child { font-size: 11.5px; line-height: 1.4; }
    #igsp-stage.igsp-filled #igsp-stage-empty { display: none; }

    #igsp-preview, #igsp-video-wrap {
      position: absolute; inset: 0; width: 100%; height: 100%;
    }
    #igsp-preview { object-fit: contain; }
    #igsp-preview-v { width: 100%; height: 100%; object-fit: contain; display: block; }

    /* animação de entrada quando a mídia termina de carregar no player */
    @keyframes igsp-pop-in {
      from { opacity: 0; transform: scale(.9) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    #igsp-stage.igsp-filled #igsp-preview,
    #igsp-stage.igsp-filled #igsp-video-wrap {
      animation: igsp-pop-in .4s cubic-bezier(.34,1.56,.64,1);
    }

    /* legenda arrastável sobre o player */
    #igsp-caption {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      max-width: 88%; padding: 4px 6px; font: 700 15px -apple-system, system-ui, sans-serif;
      color: #fff; text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,.8), 0 0 8px rgba(0,0,0,.5);
      white-space: pre-wrap; word-break: break-word; cursor: grab; user-select: none;
      touch-action: none; display: none; border-radius: 6px; transition: box-shadow .12s ease;
      line-height: 1.3;
    }
    #igsp-caption:hover { box-shadow: 0 0 0 2px rgba(255,255,255,.25); }
    #igsp-caption.igsp-dragging { cursor: grabbing; box-shadow: 0 0 0 2px var(--ig-pink); }
    #igsp-caption.igsp-visible { display: block; }
    #igsp-caption-hint {
      position: absolute; bottom: 6px; left: 0; right: 0; text-align: center;
      font-size: 9.5px; color: rgba(255,255,255,.55); pointer-events: none;
    }

    #igsp-video-controls {
      position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; background: linear-gradient(to top, rgba(0,0,0,.75), transparent);
      opacity: 0; transition: opacity .15s ease; z-index: 2;
    }
    #igsp-stage:hover #igsp-video-controls,
    #igsp-stage.igsp-paused #igsp-video-controls { opacity: 1; }
    #igsp-play, #igsp-mute {
      width: 26px; height: 26px; border-radius: 50%; border: 0; flex-shrink: 0;
      background: #fff; color: #000; cursor: pointer;
      display: grid; place-items: center; transition: transform .12s ease;
    }
    #igsp-play svg, #igsp-mute svg { width: 12px; height: 12px; }
    #igsp-play:hover, #igsp-mute:hover { transform: scale(1.08); }
    #igsp-progress {
      flex: 1; height: 4px; border-radius: 999px; background: rgba(255,255,255,.25);
      cursor: pointer; position: relative;
    }
    #igsp-progress-fill {
      position: absolute; left: 0; top: 0; bottom: 0; width: 0%; border-radius: 999px;
      background: var(--ig-gradient);
    }
    #igsp-time { font-size: 10.5px; color: #fff; flex-shrink: 0; min-width: 34px; text-align: right; }

    /* ----- Coluna do editor: formulário, rolável ----- */
    #igsp-editor-col { flex: 1; min-width: 260px; overflow-y: auto; padding-right: 4px; }

    /* ===== Seções: agrupam campos relacionados, separadas por uma linha discreta ===== */
    .igsp-section { padding: 14px 0; border-bottom: 1px solid var(--border); }
    .igsp-section:first-of-type { padding-top: 0; }
    .igsp-section:last-of-type { border-bottom: 0; padding-bottom: 0; }
    .igsp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    /* ===== Labels e campos ===== */
    #igsp-card label {
      display: block; margin: 0 0 6px; font-size: 11px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted);
    }
    .igsp-section + .igsp-section label:first-child { margin-top: 0; }

    #igsp-card input[type=file],
    #igsp-card select,
    #igsp-card textarea {
      width: 100%; padding: 10px 12px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--bg-field); color: var(--text);
      font-size: 13px; outline: none; transition: border-color .15s ease, box-shadow .15s ease;
      appearance: none; font-family: inherit;
    }
    #igsp-card select {
      cursor: pointer;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%238e8e93' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
      background-repeat: no-repeat; background-position: right 12px center; background-size: 11px 7px;
      padding-right: 30px;
    }
    #igsp-card textarea {
      resize: none; overflow: hidden; min-height: 40px; line-height: 1.4;
    }
    #igsp-card textarea::placeholder { color: var(--text-muted); }
    #igsp-card textarea:focus,
    #igsp-card select:focus {
      border-color: var(--ig-pink);
      box-shadow: 0 0 0 3px rgba(225,48,108,.18);
    }
    .igsp-count { text-align: right; font-size: 10.5px; color: var(--text-muted); margin-top: 4px; }

    /* input[type=file] custom: um "dropzone" compacto no lugar do botão nativo cru */
    .igsp-file {
      position: relative; display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--border);
      background: var(--bg-field); cursor: pointer; transition: border-color .15s ease, background .15s ease;
    }
    .igsp-file:hover { border-color: var(--ig-pink); background: #17171a; }
    .igsp-file .ico { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-muted); }
    .igsp-file .ico svg { width: 100%; height: 100%; display: block; }
    .igsp-file:hover .ico { color: var(--ig-pink); }
    .igsp-file .txt { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .igsp-file input[type=file] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; padding: 0; border: 0;
    }

    /* ===== Segmented control (atalhos de posição da legenda; arrastar no player também funciona) ===== */
    .igsp-segmented {
      display: flex; background: var(--bg-field); border: 1px solid var(--border);
      border-radius: 10px; padding: 3px; gap: 3px;
    }
    .igsp-segmented button {
      flex: 1; padding: 7px 0; border: 0; border-radius: 7px; background: transparent;
      color: var(--text-muted); font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background .15s ease, color .15s ease;
    }
    .igsp-segmented button.active { background: var(--ig-gradient); color: #fff; }
    .igsp-segmented button:hover:not(.active) { color: var(--text); }

    /* ===== Botões de ação ===== */
    #igsp-publish {
      width: 100%; margin-top: 18px; padding: 13px; border: 0; border-radius: 12px;
      background: var(--ig-gradient); color: #fff; font-weight: 700; font-size: 14px;
      cursor: pointer; letter-spacing: .01em;
      box-shadow: 0 6px 18px rgba(225,48,108,.35);
      transition: transform .12s ease, box-shadow .12s ease;
    }
    #igsp-publish:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(225,48,108,.45); }
    #igsp-publish:active { transform: translateY(0) scale(.98); box-shadow: 0 4px 12px rgba(225,48,108,.3); }
    #igsp-publish:disabled { opacity: .5; cursor: not-allowed; transform: none; }

    #igsp-close {
      width: 100%; margin-top: 8px; padding: 10px; border: 1px solid var(--border);
      border-radius: 12px; background: transparent; color: var(--text-muted);
      font-weight: 600; font-size: 13px; cursor: pointer; transition: color .15s ease, border-color .15s ease;
    }
    #igsp-close:hover { color: var(--text); border-color: #45454a; }
    #igsp-close:active { transform: scale(.98); }

    /* ===== Mobile-first: em telas estreitas o card vira folha inteira, colunas empilham ===== */
    @media (max-width: 620px) {
      #igsp-modal { align-items: flex-end; }
      #igsp-card {
        width: 100%; max-width: 100%; border-radius: 20px 20px 0 0;
        max-height: 92vh; padding: 18px 16px 22px;
      }
      #igsp-body { flex-direction: column; overflow-y: auto; }
      #igsp-stage-col { width: 100%; max-width: 260px; margin: 0 auto; }
      #igsp-editor-col { overflow-y: visible; }
      .igsp-row { grid-template-columns: 1fr; }
      #igsp-card input[type=file], #igsp-card select, #igsp-card textarea, .igsp-file {
        padding: 12px; font-size: 14px;
      }
      #igsp-publish, #igsp-close { padding: 14px; }
    }

    /* ===== Log de debug: discreto, monoespaçado, sem chamar atenção ===== */
    #igsp-log {
      margin-top: 14px; max-height: 70px; overflow-y: auto; resize: vertical;
      background: #000; color: #6fbf73; font: 10.5px/1.5 "SF Mono", Menlo, monospace;
      padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
      white-space: pre-wrap; opacity: .85;
    }
    #igsp-log:empty { display: none; }

    /* ===== Menu de contexto da legenda (cor/link) ===== */
    .igsp-color-btn {
      width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent;
      cursor: pointer; transition: transform 0.1s, border-color 0.1s;
    }
    .igsp-color-btn:hover { transform: scale(1.1); }
    .igsp-color-btn.active { border-color: var(--ig-pink) !important; transform: scale(1.15); box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  `;
  document.head.appendChild(style);

  const modal = document.createElement("div");
  modal.id = "igsp-modal";
  modal.className = "hidden";
  modal.innerHTML = `
    <div id="igsp-card">
      <div id="igsp-head">
        <div class="ico">${icon("camera")}</div>
        <h2>Criar Story<span>Publicado direto do PC, sem app</span></h2>
      </div>

      <div id="igsp-body">
        <div id="igsp-stage-col">
          <div id="igsp-stage">
            <div id="igsp-stage-empty">
              <span class="ico">${icon("film")}</span>
              <span>Selecione uma foto ou vídeo para ver o player aqui</span>
            </div>
            <img id="igsp-preview" style="display:none" />
            <div id="igsp-video-wrap" style="display:none">
              <video id="igsp-preview-v" playsinline></video>
              <div id="igsp-video-controls">
                <button id="igsp-play" type="button">${icon("play")}</button>
                <button id="igsp-mute" type="button">${icon("volume2")}</button>
                <div id="igsp-progress"><div id="igsp-progress-fill"></div></div>
                <span id="igsp-time">0:00</span>
              </div>
            </div>
            <div id="igsp-caption"></div>
          </div>
        </div>

        <div id="igsp-editor-col">
          <div class="igsp-section">
            <label>Arquivo (foto JPG ou vídeo MP4)</label>
            <label class="igsp-file" for="igsp-file">
              <span class="ico">${icon("folder")}</span>
              <span class="txt" id="igsp-file-txt">Toque para escolher uma foto ou vídeo</span>
              <input type="file" id="igsp-file" accept="image/jpeg,video/mp4" />
            </label>
          </div>

          <div class="igsp-section">
            <label>Legenda / texto no story (opcional)</label>
            <textarea id="igsp-text" placeholder="Escreva algo... use quebras de linha e emojis 🎉" rows="1" maxlength="200"></textarea>
            <div class="igsp-count"><span id="igsp-count">0</span>/200</div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
              <div>
                <label style="margin:0 0 6px">Cor da Legenda</label>
                <div class="igsp-colors" id="igsp-color-picker" style="display:flex; gap:6px;">
                  <div class="igsp-color-btn active" style="background:#ffffff; border-color:#fff;" data-color="#ffffff"></div>
                  <div class="igsp-color-btn" style="background:#000000;" data-color="#000000"></div>
                  <div class="igsp-color-btn" style="background:#ff3040;" data-color="#ff3040"></div>
                  <div class="igsp-color-btn" style="background:#00a0ff;" data-color="#00a0ff"></div>
                  <div class="igsp-color-btn" style="background:#00d050;" data-color="#00d050"></div>
                  <div class="igsp-color-btn" style="background:#ffce00;" data-color="#ffce00"></div>
                </div>
              </div>
              <div style="flex:1; margin-left:20px;">
                <label style="margin:0 0 6px">Posição</label>
                <div class="igsp-segmented" id="igsp-textpos">
                  <button type="button" data-value="top">Topo</button>
                  <button type="button" data-value="center" class="active">Centro</button>
                  <button type="button" data-value="bottom">Base</button>
                </div>
              </div>
            </div>
          </div>

          <div class="igsp-section">
            <label>Link no Story (opcional)</label>
            <input type="text" id="igsp-link-input" placeholder="https://..." style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--bg-field); color:var(--text); font-size:13px; outline:none;" />
          </div>

          <div class="igsp-section">
            <div class="igsp-row">
              <div>
                <label>Proporção</label>
                <select id="igsp-aspect">
                  <option value="original">Original</option>
                  <option value="cover">Preencher tela</option>
                  <option value="fit">Ajustar (fit)</option>
                </select>
              </div>
              <div>
                <label>Quem pode ver</label>
                <select id="igsp-audience">
                  <option value="all">Todos</option>
                  <option value="besties">Melhores amigos ⭐</option>
                </select>
              </div>
            </div>
          </div>

          <div class="igsp-section">
            <label>Música (opcional — arquivo de áudio seu, mp3/m4a)</label>
            <label class="igsp-file" for="igsp-audio">
              <span class="ico">${icon("music")}</span>
              <span class="txt" id="igsp-audio-txt">Toque para escolher um áudio</span>
              <input type="file" id="igsp-audio" accept="audio/*" />
            </label>
          </div>

          <button id="igsp-publish" type="button">Publicar Story</button>
          <button id="igsp-close" type="button">Fechar</button>
          <div id="igsp-log"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const stage = modal.querySelector("#igsp-stage");
  const fileInput = modal.querySelector("#igsp-file");
  const fileTxt = modal.querySelector("#igsp-file-txt");
  const previewImg = modal.querySelector("#igsp-preview");
  const videoWrap = modal.querySelector("#igsp-video-wrap");
  const previewVid = modal.querySelector("#igsp-preview-v");
  const playBtn = modal.querySelector("#igsp-play");
  const muteBtn = modal.querySelector("#igsp-mute");
  const progressEl = modal.querySelector("#igsp-progress");
  const progressFill = modal.querySelector("#igsp-progress-fill");
  const timeEl = modal.querySelector("#igsp-time");
  const captionEl = modal.querySelector("#igsp-caption");
  const logEl = modal.querySelector("#igsp-log");
  const aspectSel = modal.querySelector("#igsp-aspect");
  const audienceSel = modal.querySelector("#igsp-audience");
  const textInput = modal.querySelector("#igsp-text");
  const countEl = modal.querySelector("#igsp-count");
  const textPosWrap = modal.querySelector("#igsp-textpos");
  const audioInput = modal.querySelector("#igsp-audio");
  const audioTxt = modal.querySelector("#igsp-audio-txt");
  let selectedFile = null;
  // posição da legenda em fração da tela (0..1); presets abaixo movem esses valores,
  // e o arraste no player os atualiza livremente
  let textX = 0.5, textY = 0.5;
  let captionColor = "#ffffff";
  let captionLink = "";
  const presets = { top: 0.11, center: 0.5, bottom: 0.89 };

  function setTriggerVisible(visible) {
    const el = document.getElementById("igsp-btn") || document.getElementById("igsp-tray-btn");
    if (el) el.style.display = visible ? "" : "none";
  }

  mountTrigger(() => {
    setTriggerVisible(false);
    modal.classList.remove("hidden");
  });
  const draftOverlay = document.createElement("div");
  draftOverlay.innerHTML = `
    <h3 style="margin:0; font-size:16px; font-weight:600;">Salvar alterações?</h3>
    <p style="margin:8px 0 16px; font-size:13px; color:var(--text-muted); text-align:center; max-width:80%;">Você tem edições não publicadas. Deseja mantê-las como rascunho para continuar depois?</p>
    <div style="display:flex; gap:12px;">
      <button id="igsp-draft-discard" type="button" style="padding:10px 16px; border-radius:10px; border:0; background:#3a1c22; color:#ff4d4f; cursor:pointer; font-weight:600; transition:transform .1s;">Descartar</button>
      <button id="igsp-draft-save" type="button" style="padding:10px 16px; border-radius:10px; border:0; background:var(--text); color:var(--bg-card); cursor:pointer; font-weight:600; transition:transform .1s;">Manter Rascunho</button>
    </div>
  `;
  draftOverlay.style.cssText = "display:none; position:absolute; inset:0; background:rgba(26,26,29,0.92); backdrop-filter:blur(8px); z-index:1000; border-radius:22px; align-items:center; justify-content:center; flex-direction:column;";
  modal.querySelector("#igsp-card").appendChild(draftOverlay);

  function resetState() {
    fileInput.value = "";
    textInput.value = "";
    audioInput.value = "";
    captionLink = "";
    linkInput.value = "";
    captionColor = "#ffffff";
    captionEl.style.color = captionColor;
    modal.querySelectorAll("#igsp-color-picker .igsp-color-btn").forEach(b => b.classList.remove("active"));
    const whiteBtn = modal.querySelector("#igsp-color-picker .igsp-color-btn[data-color='#ffffff']");
    if (whiteBtn) whiteBtn.classList.add("active");
    captionEl.textContent = "";
    captionEl.classList.remove("igsp-visible");
    countEl.textContent = "0";
    stage.classList.remove("igsp-filled");
    selectedFile = null;
    fileTxt.textContent = "Toque para escolher uma foto ou vídeo";
    audioTxt.textContent = "Toque para escolher um áudio";
    if (previewVid.src) { URL.revokeObjectURL(previewVid.src); previewVid.src = ""; }
    if (previewImg.src) { URL.revokeObjectURL(previewImg.src); previewImg.src = ""; }
  }

  modal.querySelector("#igsp-close").onclick = () => {
    if (selectedFile || textInput.value.trim() !== "") {
      draftOverlay.style.display = "flex";
    } else {
      modal.classList.add("hidden");
      setTriggerVisible(true);
    }
  };

  draftOverlay.querySelector("#igsp-draft-save").onclick = (e) => {
    e.target.style.transform = "scale(0.95)";
    setTimeout(() => {
      e.target.style.transform = "none";
      draftOverlay.style.display = "none";
      modal.classList.add("hidden");
      setTriggerVisible(true);
    }, 100);
  };

  draftOverlay.querySelector("#igsp-draft-discard").onclick = (e) => {
    e.target.style.transform = "scale(0.95)";
    setTimeout(() => {
      e.target.style.transform = "none";
      draftOverlay.style.display = "none";
      resetState();
      modal.classList.add("hidden");
      setTriggerVisible(true);
    }, 100);
  };

  // legenda: textarea que cresce sozinha conforme o texto, com contador,
  // e espelha o texto ao vivo no overlay arrastável do player
  function autoGrow() {
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 140) + "px";
  }
  function syncCaption() {
    const val = textInput.value;
    captionEl.textContent = val;
    captionEl.classList.toggle("igsp-visible", val.trim().length > 0);
  }
  textInput.addEventListener("input", () => {
    autoGrow();
    countEl.textContent = textInput.value.length;
    syncCaption();
  });

  function placeCaption(xRel, yRel) {
    textX = Math.min(0.95, Math.max(0.05, xRel));
    textY = Math.min(0.95, Math.max(0.05, yRel));
    captionEl.style.left = textX * 100 + "%";
    captionEl.style.top = textY * 100 + "%";
  }
  placeCaption(0.5, 0.5);

  // controle segmentado: atalhos que movem a legenda para topo/centro/base do player
  textPosWrap.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      textPosWrap.querySelector("button.active").classList.remove("active");
      btn.classList.add("active");
      placeCaption(0.5, presets[btn.dataset.value]);
    };
  });

  // arrastar a legenda livremente sobre o player (mouse e toque)
  let dragging = false, dragOffX = 0, dragOffY = 0;
  function clearPreset() {
    const active = textPosWrap.querySelector("button.active");
    if (active) active.classList.remove("active");
  }
  captionEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.ctrlKey) return;
    dragging = true;
    captionEl.classList.add("igsp-dragging");
    captionEl.setPointerCapture(e.pointerId);
    const stageRect = stage.getBoundingClientRect();
    const capRect = captionEl.getBoundingClientRect();
    dragOffX = e.clientX - (capRect.left + capRect.width / 2);
    dragOffY = e.clientY - (capRect.top + capRect.height / 2);
  });
  captionEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const stageRect = stage.getBoundingClientRect();
    const x = (e.clientX - dragOffX - stageRect.left) / stageRect.width;
    const y = (e.clientY - dragOffY - stageRect.top) / stageRect.height;
    placeCaption(x, y);
    clearPreset();
  });
  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    captionEl.classList.remove("igsp-dragging");
  }
  captionEl.addEventListener("pointerup", stopDrag);
  captionEl.addEventListener("pointercancel", stopDrag);

  audioInput.onchange = () => {
    audioTxt.textContent = audioInput.files[0] ? audioInput.files[0].name : "Toque para escolher um áudio";
  };

  const linkInput = modal.querySelector("#igsp-link-input");

  modal.querySelectorAll("#igsp-color-picker .igsp-color-btn").forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll("#igsp-color-picker .igsp-color-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      captionColor = btn.dataset.color;
      captionEl.style.color = captionColor;
    };
  });

  linkInput.addEventListener("input", () => {
    captionLink = linkInput.value.trim();
  });

  aspectSel.addEventListener("change", () => {
    const val = aspectSel.value;
    const fit = val === "cover" ? "cover" : "contain";
    previewImg.style.objectFit = fit;
    previewVid.style.objectFit = fit;
  });

  function formatTime(s) {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  // player de vídeo customizado: play/pause + barra de progresso clicável
  playBtn.onclick = () => {
    if (!selectedFile || !selectedFile.type.startsWith("video")) return;
    previewVid.paused ? previewVid.play() : previewVid.pause();
  };
  previewVid.addEventListener("play", () => { playBtn.innerHTML = icon("pause"); stage.classList.remove("igsp-paused"); });
  previewVid.addEventListener("pause", () => { playBtn.innerHTML = icon("play"); stage.classList.add("igsp-paused"); });
  
  muteBtn.innerHTML = icon("volume2");
  muteBtn.onclick = (e) => {
    e.stopPropagation();
    if (!selectedFile || !selectedFile.type.startsWith("video")) return;
    previewVid.muted = !previewVid.muted;
    muteBtn.innerHTML = previewVid.muted ? icon("volumeX") : icon("volume2");
  };

  previewVid.addEventListener("timeupdate", () => {
    const pct = previewVid.duration ? (previewVid.currentTime / previewVid.duration) * 100 : 0;
    progressFill.style.width = pct + "%";
    timeEl.textContent = formatTime(previewVid.currentTime);
  });
  previewVid.addEventListener("loadedmetadata", () => { timeEl.textContent = formatTime(previewVid.duration); });
  progressEl.onclick = (e) => {
    if (!selectedFile || !selectedFile.type.startsWith("video")) return;
    const rect = progressEl.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (previewVid.duration) previewVid.currentTime = pct * previewVid.duration;
  };

  fileInput.onchange = () => {
    selectedFile = fileInput.files[0];
    if (!selectedFile) return;
    fileTxt.textContent = selectedFile.name;
    const url = URL.createObjectURL(selectedFile);

    // reinicia a animação de entrada do player a cada novo arquivo
    stage.classList.remove("igsp-filled");
    void stage.offsetWidth; // força reflow para a animação tocar de novo

    if (selectedFile.type.startsWith("video")) {
      previewVid.src = url;
      videoWrap.style.display = "block";
      previewImg.style.display = "none";
      stage.classList.add("igsp-paused");
      playBtn.innerHTML = icon("play");
    } else {
      previewImg.src = url;
      previewImg.style.display = "block";
      videoWrap.style.display = "none";
      previewVid.pause();
    }
    stage.classList.add("igsp-filled");
  };

  modal.querySelector("#igsp-publish").onclick = async () => {
    if (!selectedFile) {
      log(logEl, "Escolha um arquivo primeiro.");
      return;
    }
    logEl.textContent = "";
    const publishBtn = modal.querySelector("#igsp-publish");
    publishBtn.disabled = true;
    publishBtn.textContent = "Publicando...";

    const opts = {
      aspect: aspectSel.value,
      text: textInput.value.trim(),
      textX,
      textY,
      color: captionColor,
      link: captionLink,
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
      await configureToStory(uploadId, isVideo, meta, audience, opts, logEl);
      log(logEl, "✅ Story publicado! Confira seu perfil.");
      
      setTimeout(() => {
        modal.classList.add("hidden");
        setTriggerVisible(true);
        window.history.pushState(null, '', '/');
        window.dispatchEvent(new Event('popstate'));
        
        // Reset state for next time
        resetState();
      }, 2000);
    } catch (err) {
      log(logEl, "❌ " + err.message);
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "Publicar Story";
    }
  };
}

try {
  injectUI();
  console.log("[IGSP] extension carregada com sucesso.");
} catch (err) {
  console.error("[IGSP] erro fatal ao inicializar:", err);
}
