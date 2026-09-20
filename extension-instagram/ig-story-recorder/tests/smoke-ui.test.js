// ===== Teste de fumaça da UI (content.js) =====
//
// Sobe o content.js dentro de um DOM de mentira (jsdom) e confere que:
//   1. o modal injeta com os novos controles de link;
//   2. colar uma URL na legenda pré-preenche o campo de sticker;
//   3. o texto que vai para os pixels perde a URL (quem mostra é o sticker);
//   4. o controle de posição move o sticker dentro da faixa segura.
//
// jsdom é opcional: se não estiver disponível, os testes são pulados em vez de
// falhar (a suíte de payload continua rodando sem dependência nenhuma).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXT_DIR = path.join(__dirname, "..");

function loadJsdom() {
  const candidates = [
    "jsdom",
    path.join(EXT_DIR, "node_modules", "jsdom"),
    // jsdom já vendido junto com a suíte do leitor-ia, no mesmo repo
    path.join(EXT_DIR, "..", "..", "leitor-ia", "node_modules", "jsdom")
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

const { JSDOM } = loadJsdom() || {};

function boot() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://www.instagram.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;

  // o content script usa requestAnimationFrame / AudioContext só no caminho de
  // música; o boot do modal não precisa deles, mas o jsdom reclama se faltar
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  const run = (file) => {
    window.eval(fs.readFileSync(path.join(EXT_DIR, file), "utf8"));
  };
  run("story-payload.js");
  run("content.js");

  return dom;
}

const skip = !JSDOM;
const opts = skip ? { skip: "jsdom não disponível" } : {};

test("content.js injeta o modal com os controles de link", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    assert.ok(d.getElementById("igsp-modal"), "modal não foi injetado");
    assert.ok(d.getElementById("igsp-link"), "campo de link não existe");
    assert.ok(d.getElementById("igsp-link-hint"), "hint do link não existe");
    assert.ok(d.getElementById("igsp-link-intext"), "checkbox do link no texto não existe");
    assert.ok(d.getElementById("igsp-linkchip"), "chip de prévia não existe");
    assert.equal(d.getElementById("igsp-link-intext").checked, true, "padrão deve ser mostrar o link no texto");
  } finally {
    dom.window.close();
  }
});

test("URL colada na legenda é promovida a sticker e permanece no texto", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const text = d.getElementById("igsp-text");
    const link = d.getElementById("igsp-link");
    const chip = d.getElementById("igsp-linkchip");
    const caption = d.getElementById("igsp-caption");

    text.value = "Drop novo, corre: https://loja.com/drop";
    text.dispatchEvent(new dom.window.Event("input"));

    assert.equal(link.value, "https://loja.com/drop", "link não foi autodetectado");
    assert.ok(chip.classList.contains("igsp-visible"), "chip do sticker não apareceu");
    assert.match(chip.textContent, /loja\.com\/drop/);
    // o link continua no texto: é o que a pessoa vê e (com o sticker alinhado
    // sobre a linha) o que ela toca
    assert.equal(caption.textContent, "Drop novo, corre: https://loja.com/drop");
  } finally {
    dom.window.close();
  }
});

test("link só no campo é acrescentado ao texto desenhado", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const text = d.getElementById("igsp-text");
    const link = d.getElementById("igsp-link");
    const caption = d.getElementById("igsp-caption");

    text.value = "Drop novo";
    text.dispatchEvent(new dom.window.Event("input"));
    link.value = "https://loja.com/drop";
    link.dispatchEvent(new dom.window.Event("input"));

    assert.equal(caption.textContent, "Drop novo\nhttps://loja.com/drop");
  } finally {
    dom.window.close();
  }
});

test("desmarcar o checkbox tira a URL do texto", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const text = d.getElementById("igsp-text");
    const link = d.getElementById("igsp-link");
    const chk = d.getElementById("igsp-link-intext");
    const caption = d.getElementById("igsp-caption");

    text.value = "Drop novo";
    text.dispatchEvent(new dom.window.Event("input"));
    link.value = "https://loja.com/drop";
    link.dispatchEvent(new dom.window.Event("input"));

    chk.checked = false;
    chk.dispatchEvent(new dom.window.Event("change"));

    assert.equal(caption.textContent, "Drop novo", "URL deveria sair do texto desenhado");
    // o sticker continua existindo (só não é desenhado por nós)
    assert.equal(d.getElementById("igsp-linkchip").classList.contains("igsp-visible"), true);
  } finally {
    dom.window.close();
  }
});

test("sem sticker, a legenda vai inteira para os pixels", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const text = d.getElementById("igsp-text");
    const caption = d.getElementById("igsp-caption");

    text.value = "só texto, sem link";
    text.dispatchEvent(new dom.window.Event("input"));

    assert.equal(caption.textContent, "só texto, sem link");
    assert.equal(d.getElementById("igsp-linkchip").classList.contains("igsp-visible"), false);
  } finally {
    dom.window.close();
  }
});

test("o sticker acompanha a posição da legenda e fica na faixa segura", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const link = d.getElementById("igsp-link");
    const chip = d.getElementById("igsp-linkchip");

    link.value = "https://loja.com";
    link.dispatchEvent(new dom.window.Event("input"));

    const posButton = (v) => d.querySelector(`#igsp-textpos button[data-value="${v}"]`);
    posButton("bottom").click();
    // preset "base" da legenda é 0.89 -> clamado para o limite seguro de 0.80
    assert.equal(chip.style.top, "80%");

    posButton("top").click();
    // preset "topo" é 0.11, dentro da faixa segura (>= 0.10)
    assert.equal(chip.style.top, "11%");

    posButton("center").click();
    assert.equal(chip.style.top, "50%");
  } finally {
    dom.window.close();
  }
});

test("link inválido mostra aviso em vez de publicar escondido", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const link = d.getElementById("igsp-link");
    const hint = d.getElementById("igsp-link-hint");

    link.value = "nao é uma url";
    link.dispatchEvent(new dom.window.Event("input"));

    assert.equal(hint.hidden, false);
    assert.match(hint.textContent, /URL inválida/);
  } finally {
    dom.window.close();
  }
});

// ctx de mentira: não desenha nada, só registra as linhas e mede por caractere
function fakeCtx(charWidth = 28) {
  const drawn = [];
  return {
    drawn,
    font: "", textAlign: "", lineWidth: 0, strokeStyle: "", fillStyle: "",
    measureText: (t) => ({ width: String(t).length * charWidth }),
    fillText: (t) => drawn.push(String(t)),
    strokeText() {}, fillRect() {}, drawImage() {}
  };
}

test("drawText devolve a posição da linha do link para alinhar o sticker", opts, () => {
  const dom = boot();
  try {
    const { drawText } = dom.window;
    const ctx = fakeCtx();

    // 2 linhas centradas em 0.5: a do link fica um pouco abaixo do centro
    const y = drawText(ctx, "Drop novo", 0.5, 0.5, 1080, 1920, "https://loja.com/drop");

    assert.equal(typeof y, "number", "drawText não devolveu a posição do link");
    assert.ok(y > 0.5 && y < 0.55, `posição fora do esperado: ${y}`);
    assert.deepEqual(ctx.drawn, ["Drop novo", "https://loja.com/drop"]);
  } finally {
    dom.window.close();
  }
});

test("drawText sem link não devolve posição nem desenha URL", opts, () => {
  const dom = boot();
  try {
    const ctx = fakeCtx();
    const y = dom.window.drawText(ctx, "Drop novo", 0.5, 0.5, 1080, 1920);
    assert.equal(y, null);
    assert.deepEqual(ctx.drawn, ["Drop novo"]);
  } finally {
    dom.window.close();
  }
});

test("drawText não duplica a URL quando ela já está na legenda", opts, () => {
  const dom = boot();
  try {
    const ctx = fakeCtx();
    // escrita sem o https://, o sticker guarda a forma normalizada
    const y = dom.window.drawText(ctx, "acesse loja.com/drop", 0.5, 0.5, 1080, 1920, "https://loja.com/drop");

    assert.equal(typeof y, "number");
    assert.deepEqual(ctx.drawn, ["acesse loja.com/drop"], "a URL foi duplicada no desenho");
  } finally {
    dom.window.close();
  }
});

test("story-payload fica exposto no escopo do content script", opts, () => {
  const dom = boot();
  try {
    assert.equal(typeof dom.window.IGStoryPayload.buildConfigureBody, "function");
    assert.equal(typeof dom.window.IGStoryPayload.textForRender, "function");
  } finally {
    dom.window.close();
  }
});
