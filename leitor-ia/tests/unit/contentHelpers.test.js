// tests/unit/contentHelpers.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '';
});

// Copied from content.js
function loginBarrier(cfg) {
  if (/\/(login|signin|auth|challenge)/i.test(location.pathname + location.search)) return true;
  return (cfg.login || []).some((s) => !!document.querySelector(s));
}

function findComposer(cfg) {
  for (const s of cfg.composer || []) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function isUiLine(s) {
  const t = (s || "").trim();
  if (!t) return true;
  if (t.length > 120) return false;
  return (
    /^(copy|copied|retry|try again|share|edit|delete|stop|👍|how was|response options|new chat|regenerate|rename|font|tokens?|words?|chars?)/i.test(
      t
    ) || t.length <= 8
  );
}

function cleanTail(raw) {
  const lines = String(raw || "").split("\n");
  while (lines.length && isUiLine(lines[lines.length - 1])) lines.pop();
  while (lines.length && isUiLine(lines[0])) lines.shift();
  return lines.join("\n").trim();
}

describe('content helpers', () => {
  describe('loginBarrier', () => {
    it('detects login URL', () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/login', search: '' },
        configurable: true
      });
      expect(loginBarrier({ login: [] })).toBe(true);
    });

    it('detects signin URL', () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/signin', search: '' },
        configurable: true
      });
      expect(loginBarrier({ login: [] })).toBe(true);
    });

    it('detects login selector', () => {
      document.body.innerHTML = '<a href="/login">Entrar</a>';
      expect(loginBarrier({ login: ['a[href*="login"]'] })).toBe(true);
    });

    it('returns false when no barrier', () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/chat', search: '' },
        configurable: true
      });
      document.body.innerHTML = '<div>Conteúdo normal</div>';
      expect(loginBarrier({ login: ['a[href*="login"]'] })).toBe(false);
    });
  });

  describe('findComposer', () => {
    it('finds first matching selector', () => {
      document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';
      const cfg = { composer: ['#prompt-textarea', '#other'] };
      expect(findComposer(cfg)).toBeTruthy();
      expect(findComposer(cfg).id).toBe('prompt-textarea');
    });

    it('returns null if none match', () => {
      document.body.innerHTML = '<div>Nada</div>';
      const cfg = { composer: ['#inexistente'] };
      expect(findComposer(cfg)).toBeNull();
    });
  });

  describe('isUiLine', () => {
    it('detects copy button text', () => {
      expect(isUiLine('Copy')).toBe(true);
      expect(isUiLine('Copiar')).toBe(true);
      expect(isUiLine('copy')).toBe(true);
    });

    it('detects short UI text', () => {
      expect(isUiLine('OK')).toBe(true);
      expect(isUiLine('👍')).toBe(true);
      expect(isUiLine('Retry')).toBe(true);
    });

    it('allows normal content', () => {
      expect(isUiLine('Esta é uma resposta normal do modelo.')).toBe(false);
      expect(isUiLine('Linha longa que definitivamente não é elemento de UI porque tem mais de oito caracteres.')).toBe(false);
    });
  });

  describe('cleanTail', () => {
    it('removes trailing UI lines', () => {
      const input = 'Resposta real\n\nCopy\n👍';
      expect(cleanTail(input)).toBe('Resposta real');
    });

    it('removes leading UI lines', () => {
      const input = 'Copy\n\nResposta real';
      expect(cleanTail(input)).toBe('Resposta real');
    });

    it('preserves middle content', () => {
      const input = 'Copy\n\nResposta real\n\nCopy';
      expect(cleanTail(input)).toBe('Resposta real');
    });

    it('handles empty', () => {
      expect(cleanTail('')).toBe('');
      expect(cleanTail('Copy')).toBe('');
    });
  });
});