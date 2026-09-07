// Service worker: carrega regras declarativeNetRequest, conta bloqueios.

// Carrega regras do arquivo rules.json
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    fetch(chrome.runtime.getURL("rules.json"))
      .then((r) => r.json())
      .then((rules) => {
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [],
          addRules: rules,
        });
      })
      .catch((e) => console.error("carregar regras:", e));
  }
});

const counts = {}; // tabId -> número

function setBadge(tabId) {
  const n = counts[tabId] || 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e11d48" });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "blocked" && sender.tab) {
    const id = sender.tab.id;
    counts[id] = (counts[id] || 0) + 1;
    setBadge(id);
  }
});

chrome.tabs.onRemoved.addListener((id) => {
  delete counts[id];
  chrome.action.setBadgeText({ tabId: id, text: "" });
});

chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading" && info.url) {
    counts[id] = 0;
    chrome.action.setBadgeText({ tabId: id, text: "" });
  }
});

// Fecha abas/popups abertas automaticamente a partir do site protegido
const PROTECTED = /redecanais\./i;

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.openerTabId) return;
  chrome.tabs.get(tab.openerTabId, (opener) => {
    if (chrome.runtime.lastError || !opener || !opener.url) return;
    if (!PROTECTED.test(opener.url)) return;
    const url = tab.pendingUrl || tab.url || "";
    // Se a nova aba não é do mesmo site, é pop-up de anúncio -> fecha
    if (url && !PROTECTED.test(url) && !url.startsWith("chrome://")) {
      chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError);
      counts[opener.id] = (counts[opener.id] || 0) + 1;
      setBadge(opener.id);
    }
  });
});

// ---- Camada 2: reverte redirects forçados que escaparem do content script ----
// O Chrome não deixa o content script blindar `window.location` (é
// não-configurável), então aqui vigiamos a aba principal: se ela sair do site
// protegido para um domínio externo SEM um clique real recente, voltamos atrás.

const lastGesture = {};   // tabId -> timestamp do último clique confiável
const lastGoodUrl = {};   // tabId -> última URL boa dentro do site protegido
const GESTURE_MS = 1500;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "gesture" && sender.tab) {
    lastGesture[sender.tab.id] = Date.now();
  }
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0 && PROTECTED.test(d.url)) lastGoodUrl[d.tabId] = d.url;
});

chrome.webNavigation.onBeforeNavigate.addListener(
  (d) => {
    if (d.frameId !== 0) return;

    const anterior = lastGoodUrl[d.tabId];
    if (!anterior) return;                    // não vínhamos do site protegido
    if (PROTECTED.test(d.url)) return;        // navegação interna: liberada
    if (/^(chrome|about|edge|devtools):/.test(d.url)) return;

    const comGesto = Date.now() - (lastGesture[d.tabId] || 0) < GESTURE_MS;
    if (comGesto) return;                     // o usuário realmente quis sair

    // Redirect automático para fora -> desfaz
    chrome.tabs.update(d.tabId, { url: anterior }, () => void chrome.runtime.lastError);
    counts[d.tabId] = (counts[d.tabId] || 0) + 1;
    setBadge(d.tabId);
  },
  { url: [{ schemes: ["http", "https"] }] }
);

chrome.tabs.onRemoved.addListener((id) => {
  delete lastGesture[id];
  delete lastGoodUrl[id];
});