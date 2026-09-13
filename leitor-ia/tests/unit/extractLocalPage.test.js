// tests/unit/extractLocalPage.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.title = 'Test Page';
});

// Copied from content.js for testing
function extractLocalPage() {
  try {
    const selection = String(window.getSelection() || "").slice(0, 4000);
    let text = "";
    if (document.body) {
      const clone = document.body.cloneNode(true);
      const drop = "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio";
      clone.querySelectorAll(drop).forEach((n) => n.remove());
      clone.querySelectorAll("input,textarea,select,button").forEach((el) => {
        const label =
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          el.getAttribute("type") ||
          (el.tagName === "BUTTON" ? (el.textContent || "").trim() : "");
        const desc =
          "[" +
          el.tagName.toLowerCase() +
          (label ? ": " + String(label).replace(/\s+/g, " ").slice(0, 60) : "") +
          "]";
        el.replaceWith(document.createTextNode(" " + desc + " "));
      });
      text = (clone.innerText || clone.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    const meta =
      (document.querySelector('meta[name="description"]') || {}).content ||
      (document.querySelector('meta[property="og:description"]') || {}).content ||
      "";
    return {
      ok: true,
      url: location.href,
      title: document.title || location.hostname,
      description: String(meta || ""),
      text: text.slice(0, 80000),
      selection: selection
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

describe('extractLocalPage', () => {
  it('returns basic page info', () => {
    document.body.innerHTML = '<h1>Título</h1><p>Conteúdo principal</p>';
    const result = extractLocalPage();
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Test Page');
    expect(result.text).toContain('Título');
    expect(result.text).toContain('Conteúdo principal');
  });

  it('removes scripts and styles', () => {
    document.body.innerHTML = `
      <script>alert('xss')</script>
      <style>body { color: red }</style>
      <p>Texto visível</p>
    `;
    const result = extractLocalPage();
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color: red');
    expect(result.text).toContain('Texto visível');
  });

  it('replaces form elements with descriptors', () => {
    document.body.innerHTML = `
      <input type="text" placeholder="Buscar" name="q">
      <button aria-label="Enviar">OK</button>
      <textarea name="msg"></textarea>
      <select name="opcao"><option>1</option></select>
    `;
    const result = extractLocalPage();
    expect(result.text).toContain('[input: Buscar]');
    expect(result.text).toContain('[button: Enviar]');
    expect(result.text).toContain('[textarea: msg]');
    expect(result.text).toContain('[select: opcao]');
  });

  it('handles missing body', () => {
    document.body.innerHTML = '';
    const result = extractLocalPage();
    expect(result.ok).toBe(true);
    expect(result.text).toBe('');
  });

  it('reads meta description', () => {
    document.head.innerHTML = `
      <meta name="description" content="Meta description">
      <meta property="og:description" content="OG description">
    `;
    document.body.innerHTML = '<p>Body</p>';
    const result = extractLocalPage();
    expect(result.description).toBe('Meta description');
  });

  it('falls back to og:description', () => {
    document.head.innerHTML = '<meta property="og:description" content="OG only">';
    document.body.innerHTML = '<p>Body</p>';
    const result = extractLocalPage();
    expect(result.description).toBe('OG only');
  });

  it('limits text to 80000 chars', () => {
    document.body.innerHTML = '<p>' + 'x'.repeat(100000) + '</p>';
    const result = extractLocalPage();
    expect(result.text.length).toBeLessThanOrEqual(80000);
  });
});