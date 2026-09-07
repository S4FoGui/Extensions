// Anti-Popup — shim para frames de providers de vídeo (v1.2.0).
//
// Roda em MAIN world, document_start, SOMENTE nos domínios de providers
// (abyssplayer, megaembed, ...). Propósito único: neutralizar a COERÇÃO do
// tipo "só toca o vídeo se o popup abrir" (ex.: abyssplayer exige 2
// window.open bem-sucedidos antes do play e destrói o player se falharem).
//
// Como funciona: window.open retorna um objeto falso NÃO-nulo (closed=false,
// focus() etc. funcionais). O provider conclui que o popup "abriu" e libera
// o play — mas nenhuma aba de anúncio é criada.
//
// Deliberadamente MINIMALISTA: não toca em fetch, timers, DOM, eventos ou
// chrome.* (inexistente em MAIN), para não quebrar o player do provider.
// Sem postMessage/relatórios: os bloqueios aqui são silenciosos.
(function () {
  "use strict";

  if (window.__apShimDone) return;
  window.__apShimDone = true;

  const fakePopup = new Proxy(
    {},
    {
      get(t, p) {
        if (p === "closed") return false; // "popup abriu com sucesso"
        if (p === "document")
          return { write() {}, writeln() {}, close() {}, open() {}, body: null };
        if (p === "location")
          return new Proxy({}, { get: () => () => {}, set: () => true });
        if (typeof p === "string") return () => {};
        return undefined;
      },
      set: () => true,
    }
  );

  // Camuflagem: providers checam window.open.toString() === native
  // (ex.: abyss compara com "functionopen(){[nativecode]}" sem espaços).
  let nativeOpenStr = "function open() { [native code] }";
  try {
    nativeOpenStr = Function.prototype.toString.call(window.open);
  } catch (e) {}

  function shimmedOpen() {
    return fakePopup;
  }
  try {
    shimmedOpen.toString = () => nativeOpenStr;
  } catch (e) {}

  try {
    Object.defineProperty(window, "open", {
      configurable: false,
      writable: false,
      value: shimmedOpen,
    });
  } catch (e) {
    try {
      window.open = shimmedOpen;
    } catch (_) {}
  }
})();
