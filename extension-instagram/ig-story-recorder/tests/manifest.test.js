// ===== Guardas do manifest =====
//
// O content script depende de `story-payload.js` já ter rodado: ele expõe
// window.IGStoryPayload, que `content.js` usa para montar o payload. Se a ordem
// no manifest inverter, o modal nem abre (há um guard que aborta).
// Já aconteceu de uma edição no manifest se perder silenciosamente — daí este
// arquivo existir.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXT_DIR = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));

test("manifest: MV3 e permissões de hospedeiro", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.includes("*://www.instagram.com/*"));
});

test("manifest: todo arquivo declarado existe", () => {
  const declared = [
    ...manifest.content_scripts.flatMap((cs) => cs.js || []),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ];
  for (const file of declared) {
    assert.ok(fs.existsSync(path.join(EXT_DIR, file)), `declarado mas ausente: ${file}`);
  }
});

test("REGRESSÃO: story-payload.js é carregado ANTES de content.js", () => {
  const js = manifest.content_scripts[0].js;
  const payloadAt = js.indexOf("story-payload.js");
  const contentAt = js.indexOf("content.js");
  assert.notEqual(payloadAt, -1, "story-payload.js não está no manifest");
  assert.notEqual(contentAt, -1, "content.js não está no manifest");
  assert.ok(payloadAt < contentAt, "ordem errada: content.js rodaria sem o payload pronto");
});

test("manifest: versão acompanha o package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version, "bump de versão esqueceu um dos dois");
});
