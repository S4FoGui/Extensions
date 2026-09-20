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
    assert.ok(d.getElementById("igsp-linkpos"), "controle de posição não existe");
    assert.ok(d.getElementById("igsp-linkchip"), "chip de prévia não existe");

    const posButtons = [...d.querySelectorAll("#igsp-linkpos button")];
    assert.equal(posButtons.length, 3);
    assert.deepEqual(posButtons.map((b) => b.dataset.value), ["top", "center", "bottom"]);
  } finally {
    dom.window.close();
  }
});

test("URL colada na legenda é promovida a sticker e sai do texto desenhado", opts, () => {
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
    // a URL sai do overlay de texto: o Instagram a renderiza pelo sticker
    assert.equal(caption.textContent, "Drop novo, corre:", "URL continua sendo desenhada");
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

test("controle de posição move o sticker para dentro da faixa segura", opts, () => {
  const dom = boot();
  try {
    const d = dom.window.document;
    const link = d.getElementById("igsp-link");
    const chip = d.getElementById("igsp-linkchip");

    link.value = "https://loja.com";
    link.dispatchEvent(new dom.window.Event("input"));

    const find = (v) => d.querySelector(`#igsp-linkpos button[data-value="${v}"]`);
    find("bottom").click();
    assert.equal(chip.style.top, "76%");

    find("top").click();
    assert.equal(chip.style.top, "16%");

    find("center").click();
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

test("story-payload fica exposto no escopo do content script", opts, () => {
  const dom = boot();
  try {
    assert.equal(typeof dom.window.IGStoryPayload.buildConfigureBody, "function");
    assert.equal(typeof dom.window.IGStoryPayload.textForRender, "function");
  } finally {
    dom.window.close();
  }
});
