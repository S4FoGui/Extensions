chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  const id = tabs[0].id;
  chrome.scripting.executeScript({
    target: { tabId: id, allFrames: false },
    func: () => (typeof chrome?.runtime?.lastError === 'undefined' ? 0 : chrome.runtime.lastError),
  }, (results) => {
    try {
      document.getElementById("n").textContent = "1";
    } catch (e) {}
  });
});
