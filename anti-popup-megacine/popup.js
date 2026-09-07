chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const el = document.getElementById("n");
  if (!tabs[0]) {
    el.textContent = "0";
    return;
  }
  chrome.runtime.sendMessage({ type: "getCount", tabId: tabs[0].id }, (res) => {
    if (chrome.runtime.lastError) {
      el.textContent = "0";
      return;
    }
    el.textContent = String((res && res.count) || 0);
  });
});
