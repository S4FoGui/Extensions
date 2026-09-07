(function () {
  // Run only in the top-level frame to avoid duplicate injections in iframes
  if (window !== window.top) {
    return;
  }

  // ── Configurações ─────────────────────────────────────
  const TIMEZONE = 'America/Fortaleza';
  const Z_INDEX = 2147483647;
  const ID = 'lg-clock-container';
  const STORAGE_KEY = 'lg-clock-position';

  // ── Estado ───────────────────────────────────────────
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let clockContainer = null;

  // ── Funções de armazenamento ────────────────────────
  function savePosition(x, y) {
    chrome.storage.sync.set({ [STORAGE_KEY]: { x, y } });
  }

  function loadPosition(callback) {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      callback(result[STORAGE_KEY] || null);
    });
  }

  // ── Criação do elemento ───────────────────────────────
  function createClock() {
    const existing = document.getElementById(ID);
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = ID;

    const clock = document.createElement('div');
    clock.id = 'lg-clock';
    clock.innerHTML = `
    <span id="lg-time"></span>
    <span class="ampm" id="lg-ampm"></span>
    <span class="date" id="lg-date"></span>
    `;

    container.appendChild(clock);
    return container;
  }

  // ── Atualização do relógio ───────────────────────────
  function updateClock() {
    const now = new Date();
    const opts = { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    const parts = new Intl.DateTimeFormat('pt-BR', opts).formatToParts(now);

    let time = '';
    let ampm = '';
    for (const p of parts) {
      if (p.type === 'hour') time += p.value;
      else if (p.type === 'minute') time += ':' + p.value;
      else if (p.type === 'second') time += ':' + p.value;
      else if (p.type === 'dayPeriod') ampm = p.value.toUpperCase();
    }

    const dateOpts = { timeZone: TIMEZONE, weekday: 'short', day: 'numeric', month: 'short' };
    const dateStr = new Intl.DateTimeFormat('pt-BR', dateOpts).format(now);

    const timeEl = document.getElementById('lg-time');
    const ampmEl = document.getElementById('lg-ampm');
    const dateEl = document.getElementById('lg-date');

    if (timeEl) timeEl.textContent = time;
    if (ampmEl) ampmEl.textContent = ampm;
    if (dateEl) dateEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    // Self-correcting timeout to tick exactly at the start of the next second
    const delay = 1000 - (Date.now() % 1000);
    setTimeout(updateClock, delay);
  }

  // ── Funções de arraste (Pointer Events) ──────────────
  function setupDrag(container) {
    container.addEventListener('pointerdown', (e) => {
      isDragging = true;
      const rect = container.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      container.classList.add('dragging');
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    container.addEventListener('pointermove', (e) => {
      if (!isDragging) return;

      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;

      // Boundary checks to keep the clock on screen
      const maxX = window.innerWidth - container.offsetWidth;
      const maxY = window.innerHeight - container.offsetHeight;

      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));

      container.style.left = `${x}px`;
      container.style.top = `${y}px`;
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      container.classList.remove('dragging');
      container.releasePointerCapture(e.pointerId);

      const rect = container.getBoundingClientRect();
      savePosition(rect.left, rect.top);
    };

    container.addEventListener('pointerup', stopDrag);
    container.addEventListener('pointercancel', stopDrag);
  }

  // ── Inicialização ────────────────────────────────────
  function init() {
    loadPosition((pos) => {
      clockContainer = createClock();

      if (pos) {
        clockContainer.style.left = `${pos.x}px`;
        clockContainer.style.top = `${pos.y}px`;
        clockContainer.style.right = 'auto';
        clockContainer.style.bottom = 'auto';
      }

      // Append to documentElement. SPAs almost never replace <html>,
      // so the clock survives page navigations without heavy MutationObservers.
      const target = document.documentElement || document.body;
      target.appendChild(clockContainer);

      setupDrag(clockContainer);
      updateClock();
    });
  }

  // ── Executa init ─────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
